/** Route lá số / luận giải — hợp đồng giữ nguyên bản Python (src/service/api.py). */
import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ia from "../../agents/interpretation.js";
import { luanCung } from "../../agents/orchestrator.js";
import { nhanDienCachCuc } from "../../engine/cachCuc.js";
import { CHI, KINH_DO_TINH } from "../../engine/thoiGian.js";
import { InputError } from "../../engine/tuviEngine.js";
import * as vanHan from "../../engine/vanHan.js";
import { pysorted } from "../../lib/py.js";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";
import { BirthInput, InterpretInput, ReportInput, YearInput } from "../schemas.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWER = join(HERE, "..", "..", "..", "data", "laso_viewer.html");

function apiKeyHopLe(given: unknown, expected: string): boolean {
  const a = Buffer.from(typeof given === "string" ? given : "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bản LLM tốn tiền: nếu đặt API_KEY thì bắt buộc header X-API-Key, hoặc người dùng đã đăng nhập. */
async function kiemTraQuyenLlm(req: Parameters<typeof currentUser>[0]) {
  const can = process.env.API_KEY;
  if (!can) return;
  if (apiKeyHopLe(req.headers["x-api-key"], can)) return;
  if (process.env.LLM_ALLOW_USERS === "1" && (await currentUser(req, false))) return;
  throw new HttpError(401, "Sai API key");
}

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

  app.post("/v1/luan-giai", tag(["luận giải"], ReportInput, {
    summary: "Báo cáo luận giải 12 cung (đã qua Guardrail)", security: [{ apiKey: [] }, {}],
  }), async (req) => {
    const body = parse(ReportInput, req.body);
    if (body.use_llm) await kiemTraQuyenLlm(req);
    const user = await currentUser(req, false).catch(() => null);
    svc.tinhLaSo(body);
    const r = await svc.baoCao(body, body.use_llm);
    svc.ghiLog(body, body.use_llm, r, user?.id ?? null);
    return r;
  });

  /**
   * Luận giải dạng Server-Sent Events: mỗi cung được gửi ngay khi luận xong VÀ đã qua
   * Guardrail (không stream từng token, vì nội dung chưa kiểm thì không được hiển thị).
   *   event: cach_cuc → danh sách cách cục
   *   event: cung     → {cung, branch, chinh_tinh, text, chunks, guardrail, mode}
   *   event: done     → báo cáo đầy đủ (giống /v1/luan-giai)
   *   event: error    → {detail}
   */
  app.post("/v1/luan-giai/stream", tag(["luận giải"], ReportInput, {
    summary: "Luận giải 12 cung dạng SSE (text/event-stream)", security: [{ apiKey: [] }, {}],
  }), async (req, reply) => {
    const body = parse(ReportInput, req.body);
    if (body.use_llm) await kiemTraQuyenLlm(req);
    const user = await currentUser(req, false).catch(() => null);
    const chart = svc.tinhLaSo(body); // lỗi đầu vào → 400 trước khi mở stream

    reply.hijack();
    const raw = reply.raw;
    const headers: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string;
    raw.writeHead(200, { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      send("cach_cuc", nhanDienCachCuc(chart));
      const r = await svc.baoCaoStream(body, body.use_llm, (k) => send("cung", k));
      svc.ghiLog(body, body.use_llm, r, user?.id ?? null);
      send("done", r);
    } catch (e) {
      req.log.error(e);
      send("error", { detail: e instanceof InputError ? e.message : "Lỗi khi luận giải" });
    } finally {
      raw.end();
    }
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
