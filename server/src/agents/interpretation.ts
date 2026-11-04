/**
 * Interpretation Agent — phần dùng chung cho luận giải (port từ agents/interpretation_agent.py):
 * chuẩn hoá tên, bảng chính tinh, prompt hệ thống "Quốc Sư", gọi LLM (Claude → OpenAI → null).
 */
import { norm } from "../lib/text.js";
import type { KB } from "./kb.js";

export { norm };

export const CHINH_TINH_14 = ["Tử vi", "Thiên cơ", "Thái dương", "Vũ khúc", "Thiên đồng", "Liêm trinh",
  "Thiên phủ", "Thái âm", "Tham lang", "Cự môn", "Thiên tướng", "Thiên lương", "Thất sát", "Phá quân"];
export const NORM_CT = new Set(CHINH_TINH_14.map(norm));

export function starNameToKbId(kb: KB): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(kb.chinhTinh)) m.set(norm(v.name), k);
  return m;
}

export const SYSTEM =
  "Bạn là Quốc Sư chuyên luận giải Tử Vi Đẩu Số cho hoàng tộc, văn phong uy nghi, " +
  "mạch lạc. TUYỆT ĐỐI chỉ dùng thông tin trong NGUỒN THAM CHIẾU; không bịa ngoài nguồn. " +
  "Mỗi luận điểm phải chú dẫn [Sx]. Nếu nguồn không đủ, nói rõ 'thư tịch chưa bàn tới'. " +
  "Kết bằng câu nhắc tử vi mang tính tham khảo, không thay thế quyết định cá nhân.";

export interface Prompt { system: string; user: string }

/** Kết quả một lần gọi LLM: text kèm số token để tính chi phí. */
export interface LlmResult { text: string; model?: string; input_tokens?: number; output_tokens?: number }
export type LlmFn = (prompt: Prompt) => Promise<string | LlmResult | null>;

/** Cộng dồn số lần gọi / token của một báo cáo. */
export interface LlmUsage { calls: number; input_tokens: number; output_tokens: number; model: string | null }
export const newUsage = (): LlmUsage => ({ calls: 0, input_tokens: 0, output_tokens: 0, model: null });

/** Chuẩn hoá kết quả LLM và cộng token vào `usage`. */
export function layText(r: string | LlmResult | null, usage?: LlmUsage): string | null {
  if (usage) usage.calls += 1;
  if (r === null || typeof r === "string") return r;
  if (usage) {
    usage.input_tokens += r.input_tokens ?? 0;
    usage.output_tokens += r.output_tokens ?? 0;
    usage.model = r.model ?? usage.model;
  }
  return r.text;
}

/** Giá USD / 1 triệu token (vào, ra). Đặt LLM_PRICE_IN_PER_MTOK / LLM_PRICE_OUT_PER_MTOK để ghi đè. */
const GIA: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20], "claude-haiku-5-5": [0.1, 0.5], "gpt-4o-mini": [0.15, 0.6],
};

export function chiPhiUsd(u: LlmUsage): number {
  const [gIn, gOut] = process.env.LLM_PRICE_IN_PER_MTOK
    ? [Number(process.env.LLM_PRICE_IN_PER_MTOK), Number(process.env.LLM_PRICE_OUT_PER_MTOK || 0)]
    : GIA[u.model ?? ""] ?? [0, 0];
  return (u.input_tokens * gIn + u.output_tokens * gOut) / 1e6;
}

/** Ưu tiên Claude (ANTHROPIC_API_KEY) → OpenAI (OPENAI_API_KEY) → null (chạy offline). */
export const generateLlm: LlmFn = async (prompt) => {
  const keyA = process.env.ANTHROPIC_API_KEY;
  if (keyA) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: keyA });
      const resp = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 4096,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      });
      // Model bị bộ lọc an toàn từ chối → không có nội dung dùng được, rơi về nhánh sau.
      if (resp.stop_reason !== "refusal") {
        // content có thể bắt đầu bằng block thinking — phải lọc đúng block "text".
        for (const b of resp.content) {
          if (b.type === "text") {
            return { text: b.text, model: resp.model, input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens };
          }
        }
      }
    } catch (e) {
      console.error("[Claude lỗi, thử OpenAI/offline] " + String(e));
    }
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: key });
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      temperature: 0.7,
    });
    const text = resp.choices[0]?.message?.content;
    return text ? { text, model: resp.model, input_tokens: resp.usage?.prompt_tokens, output_tokens: resp.usage?.completion_tokens } : null;
  } catch (e) {
    console.error("[OpenAI lỗi, offline] " + String(e));
    return null;
  }
};
