/**
 * Hỏi đáp AI theo lá số: người dùng hỏi tự do ("Năm nay có nên đổi việc?"), AI trả lời CHỈ dựa trên lá số
 * (12 cung, chính tinh, kho luận giải) và vận năm đang xem, có chú dẫn [Sx], qua Guardrail (C1 trích dẫn hợp lệ,
 * C2 có trích dẫn, C4 không bịa sao, C5 có câu nhắc tham khảo, C6 không phán định mệnh).
 *
 * Câu hỏi về y tế, pháp lý, đầu tư cụ thể, sinh tử, cờ bạc bị từ chối trước khi gọi AI (không tính câu).
 * Không stream từng token: nội dung chưa qua Guardrail thì không được hiển thị.
 */
import type { Chart, Palace } from "../engine/tuviEngine.js";
import { luuNien } from "../engine/vanHan.js";
import { collapseWs, norm } from "../lib/text.js";
import * as ga from "./guardrail.js";
import type { Chunk } from "./guardrail.js";
import * as ia from "./interpretation.js";
import type { KB } from "./kb.js";
import { resolveKbCung } from "./orchestrator.js";

export const DISCLAIMER_HOI_DAP = "*Câu trả lời mang tính tham khảo, không thay thế quyết định của bạn.*";

/** Chủ đề không trả lời (so khớp trên chuỗi đã bỏ dấu, chữ thường). */
const CAM: { chu_de: string; mau: RegExp[] ; loi: string }[] = [
  {
    chu_de: "sinh tử",
    mau: [/\b(khi nao|bao gio|nam nao|tuoi nao) (thi )?(chet|mat|qua doi)\b/, /\btuoi tho\b/, /\bsong (duoc )?(bao lau|den bao nhieu)\b/, /\b(chet|qua doi|tu vong)\b/],
    loi: "Tử vi không dùng để đoán sinh tử hay tuổi thọ, nên mình không trả lời câu này.",
  },
  {
    chu_de: "y tế",
    mau: [/\b(benh gi|chua benh|chua tri|uong thuoc|thuoc gi|phau thuat|mo xe|ung thu|xet nghiem|chan doan|co thai|mang thai|vo sinh|hiem muon)\b/],
    loi: "Chuyện sức khoẻ, bệnh tật và thuốc men bạn nên hỏi bác sĩ; tử vi không thay được chẩn đoán y khoa.",
  },
  {
    chu_de: "pháp lý",
    mau: [/\b(kien tung|khoi kien|kien cao|toa an|ra toa|luat su|thang kien|thua kien|an tu|truy to)\b/],
    loi: "Việc kiện tụng, pháp lý bạn nên hỏi luật sư; mình không đoán kết quả pháp lý bằng tử vi.",
  },
  {
    chu_de: "đầu tư / cờ bạc",
    mau: [/\b(co phieu|ma (co phieu|chung khoan)|chung khoan|bitcoin|crypto|tien ao|coin|forex|vang (len|xuong))\b/, /\b(lo de|so de|xo so|danh bac|ca do|ca cuoc|con so may man|so nao)\b/],
    loi: "Mình không đưa ra lời khuyên mua bán cổ phiếu, tiền số hay con số may mắn. Bạn có thể hỏi về xu hướng tài lộc chung trong lá số.",
  },
];

/** Trả lời từ chối (không gọi AI) nếu câu hỏi thuộc chủ đề cấm; null nếu được hỏi. */
export function tuChoi(question: string): string | null {
  const n = norm(question);
  for (const c of CAM) if (c.mau.some((re) => re.test(n))) return c.loi;
  return null;
}

const chinhTinh = (p: Palace) => p.stars.filter((s) => ia.NORM_CT.has(ia.norm(s.name)));

/** Nguồn tham chiếu: 12 cung (chính tinh + ý nghĩa cung + nét chính của sao) và vận năm `nam`. */
export function retrieveHoiDap(chart: Chart, kb: KB, nam: number): Chunk[] {
  const chunks: Chunk[] = [];
  const idMap = ia.starNameToKbId(kb);
  const add = (source: string, field: string, text: string) => {
    if (text.trim()) chunks.push({ id: `S${chunks.length + 1}`, source, field, text: collapseWs(text) });
  };
  const thuTu = [...chart.palaces].sort((a, b) =>
    ((a.index - chart.menh_index + 12) % 12) - ((b.index - chart.menh_index + 12) % 12));
  for (const p of thuTu) {
    const kc = resolveKbCung(p.cung, kb);
    const yNghia = kc ? kb.cung[kc]?.overview?.short ?? "" : "";
    const ct = chinhTinh(p);
    const sao = ct.map((s) => {
      const k = idMap.get(ia.norm(s.name));
      const d = k ? kb.chinhTinh[k] : undefined;
      return `${s.name}${s.dacTinh ? ` (${s.dacTinh})` : ""}${d?.overview?.short ? `: ${d.overview.short}` : ""}`;
    });
    add(`Cung ${p.cung} (${p.branch})${p.is_than ? " — cư Thân" : ""}`, ct.length ? "chính tinh" : "vô chính diệu",
      `${yNghia} ${ct.length ? `Chính tinh: ${sao.join(" ")}` : "Không có chính tinh (vô chính diệu), mượn sao cung đối diện."}`);
  }
  try {
    const ln = luuNien(chart, nam);
    add(`Năm ${nam} (${ln.can_chi})`, "vận năm",
      `Năm ${nam} bạn ${ln.tuoi_am} tuổi âm lịch.` +
      (ln.dai_han ? ` Đại hạn cung ${ln.dai_han.cung} (${ln.dai_han.tuoi_tu}–${ln.dai_han.tuoi_den} tuổi).` : "") +
      ` Tiểu hạn tại cung ${ln.tieu_han.cung}, Lưu Thái Tuế tại cung ${ln.luu_thai_tue.cung}.` +
      ` Tứ Hóa lưu niên: ${ln.tu_hoa.map((h) => `${h.sao} hóa ${h.hoa}${h.cung ? ` tại ${h.cung}` : ""}`).join("; ")}.`);
  } catch {
    // năm trước năm sinh: bỏ phần vận năm
  }
  return chunks;
}

export const SYSTEM_HOI_DAP =
  "Bạn là người đọc Tử Vi Đẩu Số tận tâm, nói chuyện đời thường, ấm áp và rõ ràng (xưng 'mình', gọi người hỏi là 'bạn'). " +
  "TUYỆT ĐỐI chỉ dựa vào NGUỒN THAM CHIẾU của lá số; không bịa sao, không bịa dữ kiện ngoài nguồn. Mỗi luận điểm phải " +
  "chú dẫn [Sx]. Nếu nguồn không đủ để trả lời, nói thẳng là lá số chưa cho thấy điều đó. Không phán sinh tử, không " +
  "khẳng định tai hoạ chắc chắn xảy ra, không khuyên mua bán tài sản cụ thể; nói về xu hướng, điểm mạnh và điều nên lưu ý. " +
  "Trả lời gọn trong 2–4 đoạn ngắn, không dùng tiêu đề. Kết bằng một câu nhắc nội dung mang tính tham khảo.";

export interface LuotHoi { question: string; answer: string }

export function promptHoiDap(question: string, chunks: Chunk[], lichSu: LuotHoi[]): ia.Prompt {
  const ctx = chunks.map((c) => `[${c.id}] (${c.source} — ${c.field})\n${c.text}`).join("\n");
  const ls = lichSu.slice(-3).map((h) => `Hỏi: ${h.question}\nĐáp: ${[...h.answer].slice(0, 600).join("")}`).join("\n\n");
  return {
    system: SYSTEM_HOI_DAP,
    user: `NGUỒN THAM CHIẾU (lá số của người hỏi):\n${ctx}\n\n` +
      (ls ? `CÁC CÂU ĐÃ HỎI TRƯỚC (chỉ để hiểu ngữ cảnh):\n${ls}\n\n` : "") +
      `CÂU HỎI: ${question}\n\nTrả lời câu hỏi theo đúng yêu cầu, có chú dẫn [Sx].`,
  };
}

export function kiemTraHoiDap(text: string, chunks: Chunk[]) {
  const checks = [ga.c1CitationsValid(text, chunks), ga.c2CitationCoverage(text, chunks), ga.c4NoOutOfSourceStars(text, chunks),
    ga.c5HasDisclaimer(text, chunks), ga.c6NoFatalism(text, chunks)];
  const coTrichDan = /\[S\d+\]/.test(text);
  if (!coTrichDan) checks.push({ check: "C2b · có ít nhất một trích dẫn", pass: false, detail: "không có [Sx]" });
  return { passed: checks.filter((c) => c.pass).length, total: checks.length, fail: checks.filter((c) => !c.pass).map((c) => c.check) };
}

export interface KetQuaHoiDap {
  mode: "llm" | "loi";
  answer: string;
  guardrail: { passed: number; total: number; fail: string[] };
}

export async function traLoi(chart: Chart, kb: KB, nam: number, question: string, lichSu: LuotHoi[],
  llm: ia.LlmFn, usage: ia.LlmUsage): Promise<KetQuaHoiDap> {
  const chunks = retrieveHoiDap(chart, kb, nam);
  const text = ia.layText(await llm(promptHoiDap(question, chunks, lichSu)), usage);
  if (!text) return { mode: "loi", answer: "", guardrail: { passed: 0, total: 0, fail: ["không có AI"] } };
  const g = kiemTraHoiDap(text, chunks);
  return g.passed === g.total ? { mode: "llm", answer: text.trim(), guardrail: g } : { mode: "loi", answer: "", guardrail: g };
}
