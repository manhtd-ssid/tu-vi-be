/** Nghiệp vụ dùng chung giữa các route: lập lá số (có cache), luận giải (có cache), ghi log. */
import type { FastifyBaseLogger } from "fastify";
import { chiPhiUsd, newUsage, type LlmFn, type LlmUsage } from "../agents/interpretation.js";
import { HttpError } from "./http.js";
import type { KbStore } from "../agents/kbStore.js";
import { buildReport, type LuanCung, type Report } from "../agents/orchestrator.js";
import type { Db } from "../db/index.js";
import { KINH_DO_TINH, chiCuaGio, quyDoiGio, type HieuChinhGio } from "../engine/thoiGian.js";
import { CHINH_TINH_14, lapLaSo, type Chart } from "../engine/tuviEngine.js";
import { LruCache } from "../lib/lru.js";
import { BIRTH_KEYS, type BirthInput } from "./schemas.js";

export function chartKey(body: BirthInput): string {
  const o: Record<string, unknown> = {};
  for (const k of BIRTH_KEYS) o[k] = body[k];
  return JSON.stringify(o);
}

/** Chỉ giữ các trường của lá số (bỏ nam_xem, use_llm, ...). */
export function birthOnly(body: BirthInput): BirthInput {
  return JSON.parse(chartKey(body));
}

export interface ChartSummary {
  menh: string;
  than: string;
  can_chi_nam: string;
  cuc: string;
  ban_menh: string;
  am_lich: Chart["am_lich"];
  chinh_tinh_menh: string[];
}

export function tomTat(c: Chart): ChartSummary {
  const menh = c.palaces.find((p) => p.index === c.menh_index)!;
  const than = c.palaces.find((p) => p.index === c.than_index)!;
  const ct = new Set(CHINH_TINH_14);
  return {
    menh: menh.branch, than: than.branch, can_chi_nam: c.can_chi.nam, cuc: c.cuc.ten, ban_menh: c.ban_menh,
    am_lich: c.am_lich, chinh_tinh_menh: menh.stars.filter((s) => ct.has(s.name)).map((s) => s.name),
  };
}

export class ChartService {
  private chartCache = new LruCache<string, string>(2048);
  private reportCache = new LruCache<string, Promise<Report>>(512);

  constructor(public db: Db, public kb: KbStore, public llm: LlmFn, private log: FastifyBaseLogger) {}

  tinhLaSo(body: BirthInput): Chart {
    const key = chartKey(body);
    const hit = this.chartCache.get(key);
    if (hit) return JSON.parse(hit);
    let hieuChinh: HieuChinhGio | null = null;
    let { ngay, thang, nam, gio_sinh: gioSinh } = body;
    if (body.gio !== null) {
      if (body.duong_lich) {
        const kd = body.tinh ? KINH_DO_TINH[body.tinh] : body.kinh_do;
        const [q, hc] = quyDoiGio(ngay, thang, nam, body.gio, body.phut, kd, body.utc_offset_phut, body.quy_tac_ty);
        hieuChinh = hc;
        ({ ngay, thang, nam, gio_sinh: gioSinh } = q);
      } else {
        gioSinh = chiCuaGio(body.gio, body.phut);
      }
    }
    const chart = lapLaSo(ngay, thang, nam, gioSinh as number, body.gioi_tinh, {
      duongLich: body.duong_lich, thangNhuan: body.thang_nhuan, nhuanPolicy: body.nhuan_policy,
    });
    chart.hieu_chinh_gio = hieuChinh;
    const s = JSON.stringify(chart);
    this.chartCache.set(key, s);
    return JSON.parse(s);
  }

  /**
   * Báo cáo 12 cung. Có cache theo (lá số, use_llm, phiên bản kho luận giải).
   * `usage` chỉ có ở lần tính thật (lần trúng cache không tốn token nên không tính chi phí).
   */
  async baoCao(body: BirthInput, useLlm: boolean): Promise<{ report: Report; usage: LlmUsage | null }> {
    const key = `${chartKey(body)}|${useLlm}|kb${this.kb.version}`;
    const hit = this.reportCache.get(key);
    if (hit) return { report: await hit, usage: null };
    const usage = newUsage();
    const p = buildReport(this.tinhLaSo(body), this.kb.get(), useLlm, this.llm, undefined, usage);
    p.catch(() => this.reportCache.delete(key)); // không giữ kết quả lỗi
    this.reportCache.set(key, p);
    return { report: await p, usage };
  }

  /** Báo cáo dạng streaming: gọi onCung khi từng cung xong. Không dùng cache. */
  baoCaoStream(body: BirthInput, useLlm: boolean, onCung: (k: LuanCung) => void, usage?: LlmUsage): Promise<Report> {
    return buildReport(this.tinhLaSo(body), this.kb.get(), useLlm, this.llm, onCung, usage);
  }

  /** Dừng AI khi chi phí LLM trong ngày (giờ Việt Nam) đã chạm LLM_DAILY_BUDGET_USD. */
  async kiemTraNganSach(): Promise<void> {
    const budget = Number(process.env.LLM_DAILY_BUDGET_USD || 0);
    if (!budget) return;
    const [{ chi }] = await this.db.query<{ chi: string }>(
      `SELECT coalesce(sum(cost_usd), 0) AS chi FROM luan_giai_logs
       WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`);
    if (Number(chi) >= budget) {
      this.log.warn({ chi, budget }, "đã chạm ngân sách LLM trong ngày");
      throw new HttpError(503, "Luận giải bằng AI đang tạm dừng vì quá tải, bạn thử lại vào ngày mai. Lượt của bạn không bị trừ.");
    }
  }

  /** Ghi log luận giải (bản bị Guardrail chặn, chi phí LLM). Lỗi ghi log không làm hỏng request. */
  ghiLog(body: BirthInput, useLlm: boolean, r: Pick<Report, "verdict" | "guardrail_tong" | "per_cung">, userId: number | null,
    usage: LlmUsage | null = null, loai: "la_so" | "nam" | "hoi_dap" = "la_so"): void {
    const blocked = r.verdict !== "ĐẠT" || r.per_cung.some((x) => x.mode === "offline_sau_khi_llm_truot_guardrail");
    const perCung = r.per_cung.map((x) => ({ cung: x.cung, branch: x.branch, mode: x.mode, guardrail: x.guardrail }));
    const u = usage ?? newUsage();
    this.db.query(
      `INSERT INTO luan_giai_logs (user_id, input, use_llm, verdict, guardrail_tong, blocked, per_cung, loai,
         llm_model, llm_calls, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [userId, JSON.stringify(birthOnly(body)), useLlm, r.verdict, r.guardrail_tong, blocked, JSON.stringify(perCung), loai,
        u.model, useLlm ? u.calls : 0, u.input_tokens, u.output_tokens, chiPhiUsd(u).toFixed(6)],
    ).catch((e) => this.log.error({ err: e }, "ghi luan_giai_logs lỗi"));
  }
}
