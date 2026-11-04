/**
 * Hỏi đáp AI theo lá số (cần đăng nhập).
 *
 * Tính phí: 1 lượt luận giải = HOI_DAP_CAU_MOI_LUOT câu hỏi (mặc định 5) cho MỘT lá số; số câu còn lại lưu ở
 * hoi_dap_threads. Giữ chỗ câu hỏi trong transaction (khoá dòng) trước khi gọi AI; AI lỗi hoặc câu trả lời không
 * qua Guardrail → trả lại câu. Câu bị từ chối vì chủ đề (y tế, pháp lý, đầu tư, sinh tử) không tính.
 * Giới hạn HOI_DAP_MAX_NGAY câu mỗi người mỗi 24 giờ (mặc định 30) và ngân sách LLM ngày.
 */
import type { FastifyInstance } from "fastify";
import { newUsage } from "../../agents/interpretation.js";
import { traLoi, tuChoi, type LuotHoi } from "../../agents/hoiDap.js";
import { track } from "../../analytics/events.js";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";
import { BirthInput, HoiDapInput } from "../schemas.js";
import { birthOnly, chartKey } from "../service.js";

const CAU_MOI_LUOT = () => Number(process.env.HOI_DAP_CAU_MOI_LUOT || 5);
const MAX_NGAY = () => Number(process.env.HOI_DAP_MAX_NGAY || 30);
const LOI_AI = "Mình chưa trả lời được câu này một cách chắc chắn dựa trên lá số (câu trả lời chưa đạt kiểm duyệt). " +
  "Câu hỏi này không bị tính, bạn thử hỏi lại cụ thể hơn nhé.";

interface Thread { id: number; questions_left: number; questions_total: number }
interface Msg { id: number; question: string; answer: string; mode: "llm" | "tu_choi" | "loi"; counted: boolean; created_at: string }

export async function hoiDapRoutes(app: FastifyInstance) {
  const db = app.db;
  const svc = app.svc;
  const sec = { tags: ["hỏi đáp AI"], security: [{ bearer: [] as string[] }, { cookie: [] as string[] }] as Record<string, string[]>[] };

  async function threadCua(q: typeof db.query, userId: number, key: string, input: unknown, khoa: boolean): Promise<Thread> {
    await q(`INSERT INTO hoi_dap_threads (user_id, chart_key, input) VALUES ($1, $2, $3) ON CONFLICT (user_id, chart_key) DO NOTHING`,
      [userId, key, JSON.stringify(input)]);
    const [t] = await q<Thread>(`SELECT id, questions_left, questions_total FROM hoi_dap_threads WHERE user_id = $1 AND chart_key = $2 ${khoa ? "FOR UPDATE" : ""}`,
      [userId, key]);
    return t;
  }
  const luuCau = async (q: typeof db.query, threadId: number, question: string, answer: string, mode: Msg["mode"], counted: boolean) =>
    (await q<Msg>(`INSERT INTO hoi_dap_messages (thread_id, question, answer, mode, counted) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, question, answer, mode, counted, created_at`, [threadId, question, answer, mode, counted]))[0];

  app.post("/v1/hoi-dap/lich-su", { schema: { ...sec, summary: "Lịch sử hỏi đáp và số câu còn lại của một lá số", body: jsonSchema(BirthInput) } }, async (req) => {
    const me = await currentUser(req, true);
    const b = parse(BirthInput, req.body);
    const [t] = await db.query<Thread>("SELECT id, questions_left, questions_total FROM hoi_dap_threads WHERE user_id = $1 AND chart_key = $2",
      [me.id, chartKey(b)]);
    const messages = t
      ? await db.query<Msg>("SELECT id, question, answer, mode, counted, created_at FROM hoi_dap_messages WHERE thread_id = $1 ORDER BY id DESC LIMIT 50", [t.id])
      : [];
    const { credits_left } = await app.billing.credits(me.id);
    return { cau_moi_luot: CAU_MOI_LUOT(), questions_left: t?.questions_left ?? 0, credits_left, messages: messages.reverse() };
  });

  app.post("/v1/hoi-dap", { schema: { ...sec, summary: "Hỏi AI một câu về lá số", body: jsonSchema(HoiDapInput) }, ...app.limit(20, "10 minutes", true) }, async (req, reply) => {
    const me = await currentUser(req, true);
    const b = parse(HoiDapInput, req.body);
    const chart = svc.tinhLaSo(b); // lỗi ngày giờ → 400
    const input = birthOnly(b);
    const key = chartKey(b);
    const ev = (n: string, p: Record<string, unknown> = {}) => track(app, req, reply, n, { loai: "hoi_dap", ...p });
    const ketQua = async (message: Msg, charged: boolean) => {
      const [t] = await db.query<Thread>("SELECT questions_left FROM hoi_dap_threads WHERE user_id = $1 AND chart_key = $2", [me.id, key]);
      const { credits_left } = await app.billing.credits(me.id);
      return { message, questions_left: t?.questions_left ?? 0, credits_left, charged_credit: charged, cau_moi_luot: CAU_MOI_LUOT() };
    };

    // 1. Chủ đề không trả lời: không gọi AI, không tính câu
    const tc = tuChoi(b.question);
    if (tc) {
      const t = await threadCua(db.query.bind(db), me.id, key, input, false);
      return ketQua(await luuCau(db.query.bind(db), t.id, b.question, tc, "tu_choi", false), false);
    }

    // 2. Giới hạn mỗi ngày + ngân sách AI
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hoi_dap_messages m JOIN hoi_dap_threads t ON t.id = m.thread_id
       WHERE t.user_id = $1 AND m.created_at > now() - interval '24 hours' AND m.mode <> 'tu_choi'`, [me.id]);
    if (n >= MAX_NGAY()) throw new HttpError(429, `Mỗi ngày bạn hỏi được tối đa ${MAX_NGAY()} câu. Mai mình nói chuyện tiếp nhé.`);
    await svc.kiemTraNganSach();

    // 3. Giữ chỗ một câu (dùng câu còn lại, hoặc đổi 1 lượt lấy CAU_MOI_LUOT câu)
    const giu = await db.tx(async (q) => {
      const t = await threadCua(q, me.id, key, input, true);
      if (t.questions_left > 0) {
        await q("UPDATE hoi_dap_threads SET questions_left = questions_left - 1, updated_at = now() WHERE id = $1", [t.id]);
        return { thread: t, charged: false };
      }
      const [g] = await q<{ id: number }>(
        `SELECT id FROM credit_grants WHERE user_id = $1 AND credits_left > 0 AND expires_at > now()
         ORDER BY expires_at, id LIMIT 1 FOR UPDATE`, [me.id]);
      if (!g) return null;
      await q("UPDATE credit_grants SET credits_left = credits_left - 1 WHERE id = $1", [g.id]);
      await q(`UPDATE hoi_dap_threads SET questions_left = questions_left + $2 - 1, questions_total = questions_total + $2, updated_at = now()
               WHERE id = $1`, [t.id, CAU_MOI_LUOT()]);
      return { thread: t, charged: true };
    });
    if (!giu) {
      ev("ai_het_luot");
      throw new HttpError(402, `Bạn đã dùng hết lượt. Mỗi lượt luận giải chuyên sâu đổi được ${CAU_MOI_LUOT()} câu hỏi cho lá số này — mua thêm gói để hỏi tiếp.`);
    }
    if (giu.charged) ev("ai_mo_khoa");
    ev("hoi_dap");

    // 4. Gọi AI (ngữ cảnh: 3 câu gần nhất đã trả lời)
    const lichSu = (await db.query<LuotHoi>(
      "SELECT question, answer FROM hoi_dap_messages WHERE thread_id = $1 AND mode = 'llm' ORDER BY id DESC LIMIT 3", [giu.thread.id])).reverse();
    const usage = newUsage();
    let kq;
    try {
      kq = await traLoi(chart, svc.kb.get(), b.nam_xem ?? new Date().getFullYear(), b.question, lichSu, svc.llm, usage);
    } catch (e) {
      req.log.error({ err: e }, "hoi dap llm");
      kq = { mode: "loi" as const, answer: "", guardrail: { passed: 0, total: 0, fail: ["lỗi gọi AI"] } };
    }
    svc.ghiLog(b, true, {
      verdict: kq.mode === "llm" ? "ĐẠT" : "CHẶN",
      guardrail_tong: `${kq.guardrail.passed}/${kq.guardrail.total}`,
      per_cung: [{ cung: "Hỏi đáp", branch: "", mode: kq.mode === "llm" ? "llm" : "offline_sau_khi_llm_truot_guardrail", guardrail: kq.guardrail, chinh_tinh: [], chunks: [] }],
    } as never, me.id, usage, "hoi_dap");

    // 5. Lưu câu; AI không đạt → trả lại câu đã giữ
    const msg = await db.tx(async (q) => {
      if (kq.mode !== "llm") {
        await q("UPDATE hoi_dap_threads SET questions_left = questions_left + 1 WHERE id = $1", [giu.thread.id]);
        return luuCau(q, giu.thread.id, b.question, LOI_AI, "loi", false);
      }
      return luuCau(q, giu.thread.id, b.question, kq.answer, "llm", true);
    });
    return ketQua(msg, giu.charged);
  });
}
