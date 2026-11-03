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

export type LlmFn = (prompt: Prompt) => Promise<string | null>;

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
        for (const b of resp.content) if (b.type === "text") return b.text;
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
    return resp.choices[0]?.message?.content ?? null;
  } catch (e) {
    console.error("[OpenAI lỗi, offline] " + String(e));
    return null;
  }
};
