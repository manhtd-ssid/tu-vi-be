/**
 * Luận giải VẬN NĂM: tổng quan năm + 12 tháng, grounded trên dữ liệu lưu niên/lưu nguyệt (tất định)
 * và kho luận giải. Bản tổng hợp ghép thẳng từ nguồn (miễn phí); bản AI viết lại thành văn, phải qua
 * Guardrail (C1 trích dẫn hợp lệ, C2 độ phủ, C4 không bịa sao, C5 có disclaimer, C6 không phán định mệnh),
 * trượt thì trả bản tổng hợp.
 */
import type { Chart, Palace } from "../engine/tuviEngine.js";
import { luuNguyet, luuNien } from "../engine/vanHan.js";
import { collapseWs } from "../lib/text.js";
import * as ga from "./guardrail.js";
import type { Chunk } from "./guardrail.js";
import * as ia from "./interpretation.js";
import type { KB } from "./kb.js";
import { resolveKbCung } from "./orchestrator.js";

export const DISCLAIMER_NAM = "*Vận hạn trong tử vi mang tính tham khảo văn hoá, không thay thế quyết định cá nhân.*";

export interface VanNam {
  nam: number;
  can_chi: string;
  tuoi_am: number;
  markdown: string;
  mode: "offline" | "llm" | "offline_sau_khi_llm_truot_guardrail";
  chunks: Chunk[];
  guardrail: { passed: number; total: number; fail: string[] };
}

const chinhTinhCua = (p: Palace | undefined) =>
  (p?.stars ?? []).map((s) => s.name).filter((n) => ia.NORM_CT.has(ia.norm(n)));

/** Gom nguồn tham chiếu cho năm `nam`. */
export function retrieveNam(chart: Chart, nam: number, kb: KB) {
  const ln = luuNien(chart, nam); // năm trước năm sinh → InputError
  const lng = luuNguyet(chart, nam);
  const byBranch = new Map(chart.palaces.map((p) => [p.branch, p]));
  const idMap = ia.starNameToKbId(kb);
  const chunks: Chunk[] = [];
  const add = (source: string, field: string, text: string | undefined | null) => {
    if (text && text.trim()) chunks.push({ id: `S${chunks.length + 1}`, source, field, text: collapseWs(text) });
  };
  const yNghiaCung = (cung: string | null) => {
    const k = resolveKbCung(cung, kb);
    return k ? kb.cung[k]?.overview?.short ?? "" : "";
  };
  const moTaCung = (cung: string | null, branch: string) => {
    const ct = chinhTinhCua(byBranch.get(branch));
    return `Cung ${cung} (${branch}), chính tinh: ${ct.join(", ") || "vô chính diệu"}. ${yNghiaCung(cung)}`;
  };

  add(`Năm ${ln.can_chi}`, "tổng quan năm",
    `Năm ${nam} (${ln.can_chi}), bạn ${ln.tuoi_am} tuổi âm lịch.` +
    (ln.dai_han ? ` Đang ở đại hạn cung ${ln.dai_han.cung} (${ln.dai_han.tuoi_tu}–${ln.dai_han.tuoi_den} tuổi).` : "") +
    ` Tiểu hạn năm nay tại cung ${ln.tieu_han.cung}, Lưu Thái Tuế tại cung ${ln.luu_thai_tue.cung}.`);
  if (ln.dai_han) add(`Đại hạn — cung ${ln.dai_han.cung}`, "bối cảnh 10 năm", moTaCung(ln.dai_han.cung, ln.dai_han.branch));
  add(`Tiểu hạn — cung ${ln.tieu_han.cung}`, "trọng tâm của năm", moTaCung(ln.tieu_han.cung, ln.tieu_han.branch));
  add(`Lưu Thái Tuế — cung ${ln.luu_thai_tue.cung}`, "nơi dễ có biến động", moTaCung(ln.luu_thai_tue.cung, ln.luu_thai_tue.branch));
  for (const h of ln.tu_hoa) {
    if (!h.cung || !h.branch) continue;
    const kid = idMap.get(ia.norm(h.sao));
    const star = kid ? kb.chinhTinh[kid] : undefined;
    add(`Hóa ${h.hoa} lưu niên`, `${h.sao} tại cung ${h.cung}`,
      `Năm ${ln.can_chi}, ${h.sao} hóa ${h.hoa}, rơi vào cung ${h.cung} (${h.branch}). ${yNghiaCung(h.cung)}` +
      (star?.overview?.short ? ` ${star.name}: ${star.overview.short}` : ""));
  }
  for (const m of lng) {
    const loc = m.tu_hoa.find((x) => x.hoa === "Lộc");
    const ky = m.tu_hoa.find((x) => x.hoa === "Kỵ");
    add(`Tháng ${m.thang} âm lịch`, `${m.can_chi}`,
      `Tháng ${m.thang} (${m.can_chi}): lưu nguyệt tại cung ${m.cung}. ` +
      `Hóa Lộc: ${loc?.sao}${loc?.cung ? ` tại cung ${loc.cung}` : ""}; Hóa Kỵ: ${ky?.sao}${ky?.cung ? ` tại cung ${ky.cung}` : ""}.`);
  }
  return { ln, chunks };
}

/** Bản tổng hợp ghép từ nguồn (không dùng LLM). */
export function composeNam(nam: number, canChi: string, chunks: Chunk[]): string {
  const thang = chunks.filter((c) => c.source.startsWith("Tháng "));
  const chung = chunks.filter((c) => !c.source.startsWith("Tháng "));
  return [
    `## Vận năm ${nam} — ${canChi}`,
    ...chung.map((c) => `- **${c.source}** (${c.field}) [${c.id}]: ${c.text}`),
    "",
    "### Từng tháng",
    ...thang.map((c) => `- **${c.source}** [${c.id}]: ${c.text}`),
    "",
    "---",
    DISCLAIMER_NAM,
  ].join("\n");
}

export function promptNam(nam: number, canChi: string, chunks: Chunk[]): ia.Prompt {
  const ctx = chunks.map((c) => `[${c.id}] (${c.source} — ${c.field})\n${c.text}`).join("\n");
  return {
    system: ia.SYSTEM,
    user:
      `Luận vận năm ${nam} (${canChi}) cho lá số này.\n\nNGUỒN THAM CHIẾU:\n${ctx}\n\n` +
      `YÊU CẦU: bắt đầu bằng tiêu đề '## Vận năm ${nam} — ${canChi}'. Viết 2–3 đoạn tổng quan (đại hạn, tiểu hạn, ` +
      `Thái Tuế, Tứ Hóa lưu niên), rồi tiêu đề '### Từng tháng' và đúng 12 gạch đầu dòng ngắn cho tháng 1–12 âm lịch. ` +
      "Mỗi đoạn và mỗi gạch đầu dòng phải có chú dẫn [Sx]. Chỉ nói những gì nguồn có. Không phán sinh tử, không khẳng " +
      "định tai hoạ chắc chắn xảy ra; nói về xu hướng và điều nên lưu ý. Kết bằng một câu nhắc nội dung mang tính tham khảo.",
  };
}

function kiemTra(text: string, chunks: Chunk[]) {
  const checks = [ga.c1CitationsValid(text, chunks), ga.c2CitationCoverage(text, chunks), ga.c4NoOutOfSourceStars(text, chunks),
    ga.c5HasDisclaimer(text, chunks), ga.c6NoFatalism(text, chunks)];
  return { passed: checks.filter((c) => c.pass).length, total: checks.length, fail: checks.filter((c) => !c.pass).map((c) => c.check) };
}

export async function luanVanNam(chart: Chart, nam: number, kb: KB, useLlm = false,
  llm: ia.LlmFn = ia.generateLlm, usage?: ia.LlmUsage): Promise<VanNam> {
  const { ln, chunks } = retrieveNam(chart, nam, kb);
  let markdown = composeNam(nam, ln.can_chi, chunks);
  let g = kiemTra(markdown, chunks);
  let mode: VanNam["mode"] = "offline";
  if (useLlm) {
    const text = ia.layText(await llm(promptNam(nam, ln.can_chi, chunks)), usage);
    if (text) {
      const gLlm = kiemTra(text, chunks);
      if (gLlm.passed === gLlm.total) [markdown, g, mode] = [text, gLlm, "llm"];
      else mode = "offline_sau_khi_llm_truot_guardrail";
    }
  }
  return { nam, can_chi: ln.can_chi, tuoi_am: ln.tuoi_am, markdown, mode, chunks, guardrail: g };
}
