/**
 * Orchestrator / Report Composer — port từ agents/orchestrator.py.
 * Luận toàn bộ 12 cung: với mỗi cung retrieve KB → compose (LLM/offline) →
 * Guardrail từng cung → ghép báo cáo → C5 disclaimer toàn cục.
 */
import { nhanDienCachCuc, type CachCuc } from "../engine/cachCuc.js";
import type { Chart, Palace } from "../engine/tuviEngine.js";
import { collapseWs, cpLen, cpSlice } from "../lib/text.js";
import * as ga from "./guardrail.js";
import type { Chunk } from "./guardrail.js";
import * as ia from "./interpretation.js";
import { loadKb, type KB } from "./kb.js";

/** Thứ tự trình bày chuẩn. */
export const CANON = ["Mệnh", "Phụ Mẫu", "Phúc Đức", "Điền Trạch", "Quan Lộc", "Nô Bộc",
  "Thiên Di", "Tật Ách", "Tài Bạch", "Tử Nữ", "Phu Thê", "Huynh Đệ"];
/** alias tên cung: engine lasotuvi → khoá KB */
const ALIAS: Record<string, string> = { "tu tuc": "Tử Nữ" };

export function resolveKbCung(chartCung: string | null, kb: KB): string | undefined {
  const n = ia.norm(String(chartCung));
  for (const key of Object.keys(kb.cung)) if (ia.norm(key) === n) return key;
  return ALIAS[n];
}

const DAC_TINH: Record<string, string> = {
  M: "Miếu địa — sao phát huy mạnh", V: "Vượng địa — sao phát huy mạnh",
  "Đ": "Đắc địa — sao có lực khá", B: "Bình hòa — sao ở mức trung bình",
  H: "Hãm địa — sao bị chiết giảm, cần nỗ lực nhiều hơn",
};

export interface Retrieved {
  branch: string;
  cung: string | null;
  stars_all: string[];
  chinh_tinh: string[];
  is_than: boolean;
  chunks: Chunk[];
}

/** RAG cho MỘT cung bất kỳ. Miếu/hãm lấy từ engine, không suy từ văn bản KB. */
export function retrievePalace(palace: Palace, kb: KB, cachCuc: CachCuc[] | null = null): Retrieved {
  const branch = palace.branch;
  const starsAll = palace.stars.map((s) => s.name);
  const chinh = starsAll.filter((s) => ia.NORM_CT.has(ia.norm(s)));
  const starByNorm = new Map(palace.stars.map((s) => [ia.norm(s.name), s] as const));
  const idMap = ia.starNameToKbId(kb);
  const chunks: Chunk[] = [];
  const add = (source: string, field: string, text: string | undefined | null) => {
    if (text && text.trim()) chunks.push({ id: `S${chunks.length + 1}`, source, field, text: text.trim() });
  };

  const kbKey = resolveKbCung(palace.cung, kb);
  const cm = kbKey ? kb.cung[kbKey] ?? {} : {};
  add("Cung " + String(palace.cung), "vai trò", cm.overview?.detailed || cm.overview?.short || "");

  for (const s of chinh) {
    const kid = idMap.get(ia.norm(s));
    const star = kid ? kb.chinhTinh[kid] ?? {} : {};
    if (!star || !Object.keys(star).length) continue;
    const nm: string = star.name;
    const ov = star.overview ?? {};
    add(nm, "tổng quan", ov.short || ov.detailed || "");
    const sao = starByNorm.get(ia.norm(s))!;
    if (sao.dacTinh && sao.dacTinh in DAC_TINH) add(nm, "Miếu/Vượng/Hãm tại cung " + branch, DAC_TINH[sao.dacTinh]);
    if (sao.hoa) add(nm, "Tứ Hóa bản mệnh", nm + " hóa " + sao.hoa + " tại cung này.");
    const comb = star.combinations ?? {};
    if (comb && comb.notes) add(nm, "cách cục", comb.notes);
  }
  if (palace.tuan || palace.triet) {
    const ten = ([["Tuần", palace.tuan], ["Triệt", palace.triet]] as const).filter(([, on]) => on).map(([t]) => t).join(" và ");
    add("Cung " + String(palace.cung), "Tuần/Triệt", ten + " án ngữ tại cung này.");
  }
  const tenCung = ia.norm(String(palace.cung));
  for (const cc of cachCuc ?? []) {
    if (cc.cung.some((x) => ia.norm(String(x)) === tenCung)) add("Cách " + cc.ten, cc.nguon, cc.mo_ta);
  }
  return { branch, cung: palace.cung, stars_all: starsAll, chinh_tinh: chinh, is_than: palace.is_than ?? false, chunks };
}

export function promptSection(r: Retrieved): ia.Prompt {
  const ctx = r.chunks.map((c) => `[${c.id}] (${c.source} — ${c.field})\n${c.text}`).join("\n");
  const user =
    `Luận cung ${r.cung} (toạ ${r.branch}${r.is_than ? ", an Thân" : ""}).\nSao trong cung: ${r.stars_all.join(", ") || "(không có)"}\n\n` +
    `NGUỒN THAM CHIẾU:\n${ctx}\n\n` +
    `YÊU CẦU: 2–4 đoạn, bắt đầu bằng tiêu đề '## Cung ${r.cung} — ${r.branch}'. Mỗi đoạn có chú dẫn [Sx]. ` +
    "Không phán sinh tử, không khẳng định tai hoạ chắc chắn xảy ra.";
  return { system: ia.SYSTEM, user };
}

/** Ghép offline một mục cung (bản LLM sẽ thay chỗ này bằng văn Quốc Sư). */
export function composeSection(r: Retrieved): string {
  const than = r.is_than ? " · **Thân**" : "";
  const head = `\n## Cung ${r.cung} — ${r.branch}${than}\n*Chính tinh: ${r.chinh_tinh.join(", ") || "vô chính diệu"}*\n`;
  const lines = [head];
  for (const c of r.chunks) {
    const flat = collapseWs(c.text); // gộp về 1 dòng, tránh Guardrail hiểu nhầm
    lines.push(`- **${c.source}** (${c.field}) [${c.id}]: ${cpSlice(flat, 220)}${cpLen(flat) > 220 ? "…" : ""}`);
  }
  return lines.join("\n");
}

export interface GuardrailKetQua { passed: number; total: number; fail: string[] }

/** C1..C4 + C6 cho từng cung (C5 disclaimer kiểm ở cấp báo cáo). */
export function guardrailSection(text: string, chunks: Chunk[]): GuardrailKetQua {
  const checks = [ga.c1CitationsValid(text, chunks), ga.c2CitationCoverage(text, chunks),
    ga.c3NoMieuHamContradiction(text, chunks), ga.c4NoOutOfSourceStars(text, chunks), ga.c6NoFatalism(text, chunks)];
  return { passed: checks.filter((c) => c.pass).length, total: checks.length, fail: checks.filter((c) => !c.pass).map((c) => c.check) };
}

export const DISCLAIMER = "*Tử vi mang tính tham khảo văn hoá, không thay thế quyết định cá nhân.*";

export interface LuanCung {
  cung: string | null;
  branch: string;
  chinh_tinh: string[];
  text: string;
  chunks: Chunk[];
  guardrail: GuardrailKetQua;
  mode: "offline" | "llm" | "offline_sau_khi_llm_truot_guardrail";
}

/** Luận một cung. Bản LLM không qua Guardrail thì rơi về bản ghép offline. */
export async function luanCung(
  palace: Palace, kb: KB, cachCuc: CachCuc[] | null = null, useLlm = false, llm: ia.LlmFn = ia.generateLlm,
): Promise<LuanCung> {
  const r = retrievePalace(palace, kb, cachCuc);
  let section = composeSection(r);
  let g = guardrailSection(section, r.chunks);
  let mode: LuanCung["mode"] = "offline";
  if (useLlm) {
    const text = await llm(promptSection(r));
    if (text) {
      const gLlm = guardrailSection(text, r.chunks);
      if (gLlm.passed === gLlm.total) [section, g, mode] = [text, gLlm, "llm"];
      else mode = "offline_sau_khi_llm_truot_guardrail";
    }
  }
  return { cung: palace.cung, branch: r.branch, chinh_tinh: r.chinh_tinh, text: section, chunks: r.chunks, guardrail: g, mode };
}

function timCung(chart: Chart, ten: string): Palace | undefined {
  const byCung = new Map<string, Palace>();
  for (const p of chart.palaces) byCung.set(ia.norm(String(p.cung)), p);
  const pal = byCung.get(ia.norm(ten));
  return pal !== undefined || ten !== "Tử Nữ" ? pal : byCung.get("tu tuc");
}

/** Chạy fn cho từng phần tử với tối đa `limit` việc song song, giữ thứ tự kết quả. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const CHI_GIO = ["", "Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

export interface Report {
  markdown: string;
  verdict: "ĐẠT" | "CÓ CẢNH BÁO";
  guardrail_tong: string;
  disclaimer: boolean;
  cach_cuc: CachCuc[];
  per_cung: Omit<LuanCung, "text">[];
}

/** Luận 12 cung, trả {markdown, verdict, per_cung, ...} — dùng chung cho CLI và API. */
export async function buildReport(
  chart: Chart, kb: KB | null = null, useLlm = false, llm: ia.LlmFn = ia.generateLlm,
): Promise<Report> {
  const k = kb ?? loadKb();
  const cachCuc = "cuc" in chart ? nhanDienCachCuc(chart) : [];
  const cacCung = CANON.map((c) => timCung(chart, c)).filter((p): p is Palace => p !== undefined);
  const ketQua = await mapLimit(cacCung, useLlm ? 6 : 1, (p) => luanCung(p, k, cachCuc, useLlm, llm));

  const menh = timCung(chart, "Mệnh");
  const thanCung = chart.palaces.find((p) => p.is_than)?.cung ?? "?";
  const inp = chart.input ?? ({} as Chart["input"]);
  const gs = inp.gio_sinh ?? 0;
  const gio = gs < CHI_GIO.length ? CHI_GIO[gs] : "?";
  const sinh = `${inp.ngay}/${inp.thang}/${inp.nam} · giờ ${gio} · ${inp.gioi_tinh === 1 ? "Nam" : "Nữ"} · ${inp.duong_lich ? "dương lịch" : "âm lịch"}`;
  const report = [
    "# BÁO CÁO TỬ VI TỔNG HỢP (12 cung)",
    `*Sinh: ${sinh} | Mệnh an tại ${menh ? menh.branch : "?"}, Thân tại cung ${thanCung}*`,
    "\n> Lá số an bằng engine tất định (lasotuvi); phần luận do agent tổng " +
      "hợp, grounded trên kho tri thức, đã qua Guardrail từng cung.\n",
  ];
  if (cachCuc.length) {
    report.push("## Cách cục nổi bật");
    for (const c of cachCuc) report.push(`- **${c.ten}** (${c.nguon}): ${c.mo_ta}`);
  }
  for (const x of ketQua) report.push(x.text);
  report.push("\n---\n" + DISCLAIMER);
  const full = report.join("\n");

  const totalPass = ketQua.reduce((a, x) => a + x.guardrail.passed, 0);
  const totalChk = ketQua.reduce((a, x) => a + x.guardrail.total, 0);
  const c5 = ga.c5HasDisclaimer(full, []);
  return {
    markdown: full,
    verdict: totalPass === totalChk && c5.pass ? "ĐẠT" : "CÓ CẢNH BÁO",
    guardrail_tong: `${totalPass}/${totalChk}`,
    disclaimer: c5.pass,
    cach_cuc: cachCuc,
    per_cung: ketQua.map(({ text: _t, ...rest }) => rest),
  };
}
