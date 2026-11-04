/** Route lá số / luận giải — hợp đồng giữ nguyên bản Python (src/service/api.py). */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ia from "../../agents/interpretation.js";
import { newUsage } from "../../agents/interpretation.js";
import { luanCung, type LuanCung, type Report } from "../../agents/orchestrator.js";
import { nhanDienCachCuc } from "../../engine/cachCuc.js";
import { CHI, KINH_DO_TINH } from "../../engine/thoiGian.js";
import { InputError } from "../../engine/tuviEngine.js";
import * as vanHan from "../../engine/vanHan.js";
import { pysorted } from "../../lib/py.js";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";
import { BirthInput, InterpretInput, ReportInput, YearInput, YearReportInput } from "../schemas.js";
import { luanVanNam, type VanNam } from "../../agents/vanNam.js";
import { birthOnly, chartKey } from "../service.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWER = join(HERE, "..", "..", "..", "data", "laso_viewer.html");

function apiKeyHopLe(given: unknown, expected: string): boolean {
  const a = Buffer.from(typeof given === "string" ? given : "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Quyền dùng bản LLM (tốn tiền):
 *  - header X-API-Key khớp API_KEY → dùng nội bộ, không tính lượt;
 *  - còn lại phải đăng nhập; lá số đã mở khoá thì đọc lại bản đã lưu, chưa thì cần còn lượt.
 */
async function quyenLlm(req: Parameters<typeof currentUser>[0]): Promise<{ noiBo: true } | { noiBo: false; userId: number }> {
  const can = process.env.API_KEY;
  if (can && apiKeyHopLe(req.headers["x-api-key"], can)) return { noiBo: true };
  const u = await currentUser(req, false);
  if (!u) throw new HttpError(401, "Cần đăng nhập để dùng luận giải chuyên sâu (AI)");
  return { noiBo: false, userId: u.id };
}

/** Số cung tối thiểu viết được bằng AI (qua Guardrail) thì mới trừ lượt. */
const MIN_CUNG_AI = () => Number(process.env.MIN_CUNG_AI || 7);

export async function coreRoutes(app: FastifyInstance) {
  const svc = app.svc;
  const tag = (tags: string[], body?: Parameters<typeof jsonSchema>[0], extra: object = {}) =>
    ({ schema: { tags, ...(body ? { body: jsonSchema(body) } : {}), ...extra } });

  app.get("/health", tag(["hệ thống"]), async () => ({ status: "ok" }));

  app.get("/v1/meta", tag(["lá số"], undefined, { summary: "Danh sách giờ âm và 63 tỉnh" }), async () => ({
    gio: CHI.map((c, i) => ({ gio_sinh: i + 1, chi: c })),
    tinh: pysorted(Object.keys(KINH_DO_TINH)),
  }));

  app.post("/v1/la-so", tag(["lá số"], BirthInput, { summary: "Lá số + đại hạn + cách cục" }), async (req) => {
    const c = svc.tinhLaSo(parse(BirthInput, req.body));
    return { chart: c, dai_han: vanHan.danhSachDaiHan(c), cach_cuc: nhanDienCachCuc(c) };
  });

  app.post("/v1/luu-nien", tag(["lá số"], YearInput, { summary: "Vận năm nam_xem + 12 tháng" }), async (req) => {
    const body = parse(YearInput, req.body);
    const c = svc.tinhLaSo(body);
    return { luu_nien: vanHan.luuNien(c, body.nam_xem), luu_nguyet: vanHan.luuNguyet(c, body.nam_xem) };
  });

  /**
   * Chạy luận giải (thường hoặc AI) và trả kết quả + thông tin tính lượt.
   * onCung (nếu có) được gọi lần lượt từng cung — dùng cho streaming.
   */
  async function luanGiai(req: Parameters<typeof currentUser>[0], body: z.infer<typeof ReportInput>,
    onCung?: (k: LuanCung) => void) {
    const user = await currentUser(req, false).catch(() => null);
    const chay = async (ai: boolean) => {
      if (onCung) {
        const usage = newUsage();
        return { report: await svc.baoCaoStream(body, ai, onCung, usage), usage };
      }
      return svc.baoCao(body, ai);
    };
    if (!body.use_llm) {
      const { report: r } = await chay(false);
      svc.ghiLog(body, false, r, user?.id ?? null);
      return { ...r };
    }
    const q = await quyenLlm(req);
    if (q.noiBo) {
      await svc.kiemTraNganSach();
      const { report: r, usage } = await chay(true);
      svc.ghiLog(body, true, r, user?.id ?? null, usage);
      return { ...r };
    }
    const key = chartKey(body);
    const saved = await app.billing.unlocked(q.userId, key);
    if (saved) {
      for (const k of saved.sections as LuanCung[]) onCung?.(k);
      const { credits_left } = await app.billing.credits(q.userId);
      return { ...(saved.report as Report), billing: { charged: false, da_mo_khoa: true, credits_left } };
    }
    if ((await app.billing.credits(q.userId)).credits_left <= 0) {
      throw new HttpError(402, "Bạn đã dùng hết lượt luận giải chuyên sâu. Mua thêm gói để mở khoá lá số này.");
    }
    await svc.kiemTraNganSach();
    const sections: LuanCung[] = [];
    const usage = newUsage();
    const r = await svc.baoCaoStream(body, true, (k) => {
      sections.push(k);
      onCung?.(k);
    }, usage);
    svc.ghiLog(body, true, r, q.userId, usage);
    const soCungAi = r.per_cung.filter((x) => x.mode === "llm").length;
    let charged = false;
    if (soCungAi >= MIN_CUNG_AI()) {
      const kq = await app.billing.unlock(q.userId, key, birthOnly(body), r, sections);
      charged = kq === "ok";
    }
    const { credits_left } = await app.billing.credits(q.userId);
    return {
      ...r,
      billing: {
        charged, da_mo_khoa: charged, credits_left,
        ...(soCungAi < MIN_CUNG_AI() ? { ly_do: "AI chưa viết được đủ số cung đạt kiểm duyệt nên không trừ lượt; đây là bản tổng hợp từ nguồn." } : {}),
      },
    };
  }

  app.post("/v1/luan-giai", { ...app.limit(60, "1 hour", true), ...tag(["luận giải"], ReportInput, {
    summary: "Báo cáo luận giải 12 cung (đã qua Guardrail). use_llm=true: AI, cần X-API-Key hoặc đăng nhập + còn lượt",
    security: [{ apiKey: [] }, { bearer: [] }, { cookie: [] }, {}],
  }) }, async (req) => {
    const body = parse(ReportInput, req.body);
    svc.tinhLaSo(body); // lỗi đầu vào → 400 trước khi kiểm tra quyền/lượt
    return luanGiai(req, body);
  });

  /**
   * Luận giải dạng Server-Sent Events: mỗi cung được gửi ngay khi luận xong VÀ đã qua
   * Guardrail (không stream từng token, vì nội dung chưa kiểm thì không được hiển thị).
   *   event: cach_cuc → danh sách cách cục
   *   event: cung     → {cung, branch, chinh_tinh, text, chunks, guardrail, mode}
   *   event: done     → báo cáo đầy đủ (giống /v1/luan-giai, có `billing` khi dùng AI)
   *   event: error    → {detail}
   * Lỗi quyền/lượt (401/402) trả HTTP bình thường, trước khi mở stream.
   */
  app.post("/v1/luan-giai/stream", { ...app.limit(60, "1 hour", true), ...tag(["luận giải"], ReportInput, {
    summary: "Luận giải 12 cung dạng SSE (text/event-stream)", security: [{ apiKey: [] }, { bearer: [] }, { cookie: [] }, {}],
  }) }, async (req, reply) => {
    const body = parse(ReportInput, req.body);
    const chart = svc.tinhLaSo(body);
    if (body.use_llm) {
      const q = await quyenLlm(req);
      const daMoKhoa = !q.noiBo && Boolean(await app.billing.unlocked(q.userId, chartKey(body)));
      if (!q.noiBo && !daMoKhoa && (await app.billing.credits(q.userId)).credits_left <= 0) {
        throw new HttpError(402, "Bạn đã dùng hết lượt luận giải chuyên sâu. Mua thêm gói để mở khoá lá số này.");
      }
      if (!daMoKhoa) await svc.kiemTraNganSach();
    }

    reply.hijack();
    const raw = reply.raw;
    const headers: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string;
    raw.writeHead(200, { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      send("cach_cuc", nhanDienCachCuc(chart));
      const r = await luanGiai(req, body, (k) => send("cung", k));
      send("done", r);
    } catch (e) {
      req.log.error(e);
      send("error", { detail: e instanceof InputError || e instanceof HttpError ? e.message : "Lỗi khi luận giải" });
    } finally {
      raw.end();
    }
  });

  /**
   * Luận giải VẬN NĂM (tổng quan năm + 12 tháng âm lịch).
   * use_llm=false: bản tổng hợp từ nguồn, miễn phí. use_llm=true: bản AI, cùng quy tắc với luận giải lá số —
   * X-API-Key nội bộ không tính lượt; người dùng cần đăng nhập, mỗi cặp (lá số, năm) tốn 1 lượt, đọc lại
   * không tốn; AI trượt Guardrail thì trả bản tổng hợp và không trừ lượt.
   */
  app.post("/v1/luan-giai/nam", { ...app.limit(60, "1 hour", true), ...tag(["luận giải"], YearReportInput, {
    summary: "Luận giải vận năm + 12 tháng", security: [{ apiKey: [] }, { bearer: [] }, { cookie: [] }, {}],
  }) }, async (req) => {
    const body = parse(YearReportInput, req.body);
    const chart = svc.tinhLaSo(body);
    const user = await currentUser(req, false).catch(() => null);
    const kb = svc.kb.get();
    const logNam = (r: VanNam, userId: number | null, usage: ia.LlmUsage | null) => svc.ghiLog(body, body.use_llm, {
      verdict: r.guardrail.passed === r.guardrail.total ? "ĐẠT" : "CÓ CẢNH BÁO",
      guardrail_tong: `${r.guardrail.passed}/${r.guardrail.total}`,
      per_cung: [{ cung: `Vận năm ${r.nam}`, branch: r.can_chi, mode: r.mode, guardrail: r.guardrail, chinh_tinh: [], chunks: [] }],
    }, userId, usage, "nam");

    if (!body.use_llm) {
      const r = await luanVanNam(chart, body.nam_xem, kb, false);
      logNam(r, user?.id ?? null, null);
      return r;
    }
    const q = await quyenLlm(req);
    if (q.noiBo) {
      await svc.kiemTraNganSach();
      const usage = newUsage();
      const r = await luanVanNam(chart, body.nam_xem, kb, true, svc.llm, usage);
      logNam(r, user?.id ?? null, usage);
      return r;
    }
    const key = `${chartKey(body)}|nam:${body.nam_xem}`;
    const saved = await app.billing.unlocked(q.userId, key);
    if (saved) {
      const { credits_left } = await app.billing.credits(q.userId);
      return { ...(saved.report as VanNam), billing: { charged: false, da_mo_khoa: true, credits_left } };
    }
    if ((await app.billing.credits(q.userId)).credits_left <= 0) {
      throw new HttpError(402, "Bạn đã dùng hết lượt luận giải chuyên sâu. Mua thêm gói để mở khoá luận giải năm này.");
    }
    await svc.kiemTraNganSach();
    const usage = newUsage();
    const r = await luanVanNam(chart, body.nam_xem, kb, true, svc.llm, usage);
    logNam(r, q.userId, usage);
    let charged = false;
    if (r.mode === "llm") charged = (await app.billing.unlock(q.userId, key, { ...birthOnly(body), nam_xem: body.nam_xem }, r, [])) === "ok";
    const { credits_left } = await app.billing.credits(q.userId);
    return {
      ...r,
      billing: {
        charged, da_mo_khoa: charged, credits_left,
        ...(r.mode !== "llm" ? { ly_do: "AI chưa viết được bản đạt kiểm duyệt nên không trừ lượt; đây là bản tổng hợp từ nguồn." } : {}),
      },
    };
  });

  // ---- Tương thích laso_viewer.html ----
  app.post("/chart", tag(["tương thích"], BirthInput), async (req) => svc.tinhLaSo(parse(BirthInput, req.body)));

  app.post("/interpret", tag(["tương thích"], InterpretInput), async (req) => {
    const body = parse(InterpretInput, req.body);
    const c = svc.tinhLaSo(body);
    const pal = c.palaces.find((p) => ia.norm(String(p.cung)) === ia.norm(body.cung));
    if (!pal) throw new InputError("Không có cung " + body.cung);
    const k = await luanCung(pal, svc.kb.get(), nhanDienCachCuc(c));
    const g = k.guardrail;
    return {
      interpretation: k.text,
      sources: k.chunks.map((x) => ({ id: x.id, label: x.source + " — " + x.field })),
      guardrail: { passed: g.passed, fail: g.fail, verdict: g.passed === g.total ? "ĐẠT" : "CẢNH BÁO" },
    };
  });

  app.get("/viewer", { schema: { hide: true } }, async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(readFileSync(VIEWER)));
}
