/**
 * Guardrail / QA Agent — port từ agents/guardrail_agent.py.
 * 6 kiểm tra tất định (cổng chặn trước khi hiển thị):
 *  C1 trích dẫn hợp lệ · C2 độ phủ trích dẫn · C3 không mâu thuẫn miếu/hãm
 *  C4 không bịa sao ngoài nguồn · C5 có disclaimer · C6 không phán định mệnh
 */
import { pyreprList, pysorted } from "../lib/py.js";
import { cpLen, cpSlice, normNoStrip as norm, splitlines } from "../lib/text.js";

export interface Chunk { id: string; source: string; field: string; text: string }
export interface Check { check: string; pass: boolean; detail: string }

export function c1CitationsValid(text: string, chunks: Chunk[]): Check {
  const valid = new Set(chunks.map((c) => c.id));
  const cited = new Set([...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]));
  const bad = [...cited].filter((x) => !valid.has(x)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return {
    check: "C1 · trích dẫn hợp lệ", pass: bad.length === 0,
    detail: `${cited.size} trích dẫn, ${bad.length} không hợp lệ` + (bad.length ? `: ${pyreprList(bad)}` : ""),
  };
}

export function c2CitationCoverage(text: string, _chunks: Chunk[]): Check {
  // ##(?!#): chỉ tách ở tiêu đề "## " — "### phụ đề" không bị tách thành mục riêng.
  const sections = text.split(/\n(?=\*\*\d\)|##(?!#)|\*\*\d\.)/);
  const uncited: string[] = [];
  let checked = 0;
  for (const sec of sections) {
    const body = sec.trim();
    if (cpLen(body) < 60) continue;
    const first = (splitlines(body)[0] ?? "").trim();
    if (first.startsWith("# ")) continue;
    if (norm(body).includes(norm("tham khảo")) || norm(body).includes(norm("nguồn grounding"))) continue;
    checked += 1;
    if (!/\[S\d+\]/.test(body)) uncited.push(cpSlice(body, 40).replace(/\s+/g, " "));
  }
  return {
    check: "C2 · độ phủ trích dẫn", pass: uncited.length === 0,
    detail: `${checked} mục nội dung, ${uncited.length} mục thiếu trích dẫn` + (uncited.length ? `: ${pyreprList(uncited)}` : ""),
  };
}

export function c3NoMieuHamContradiction(text: string, chunks: Chunk[]): Check {
  // nguồn cho biết mỗi sao MIẾU hay HÃM, VÀ tại địa chi nào
  const status = new Map<string, [string, string]>();
  for (const c of chunks) {
    if (c.field.includes("Miếu/Vượng/Hãm")) {
      const st = norm(c.source);
      const parts = c.field.split("cung");
      const branch = norm(parts[parts.length - 1]);
      if (norm(c.text).includes("ham dia")) status.set(st, ["ham", branch]);
      else if (norm(c.text).includes("mieu") || norm(c.text).includes("vuong")) status.set(st, ["mieu", branch]);
    }
  }
  const n = norm(text);
  const problems: string[] = [];
  for (const [star, [stt, branch]] of status) {
    if (!star) continue;
    for (let i = n.indexOf(star); i !== -1; i = n.indexOf(star, i + star.length)) {
      const w = n.slice(Math.max(0, i - 45), i + star.length + 45);
      const cm = ["mieu", "vuong", "dac dia"].some((k) => w.includes(k));
      const ch = w.includes("ham");
      const nearBranch = Boolean(branch) && w.includes(branch);
      if (stt === "ham" && cm && nearBranch && !ch) problems.push(`'${star}' nguồn=hãm tại ${branch} nhưng bài ngụ ý miếu/vượng`);
      if (stt === "mieu" && ch && nearBranch && !cm) problems.push(`'${star}' nguồn=miếu tại ${branch} nhưng bài ngụ ý hãm`);
    }
  }
  const uniq = pysorted([...new Set(problems)]);
  return {
    check: "C3 · không mâu thuẫn miếu/hãm", pass: uniq.length === 0,
    detail: uniq.length === 0 ? "không phát hiện mâu thuẫn" : uniq.join("; "),
  };
}

const CT14 = ["Tử Vi", "Thiên Cơ", "Thái Dương", "Vũ Khúc", "Thiên Đồng", "Liêm Trinh", "Thiên Phủ",
  "Thái Âm", "Tham Lang", "Cự Môn", "Thiên Tướng", "Thiên Lương", "Thất Sát", "Phá Quân"];

export function c4NoOutOfSourceStars(text: string, chunks: Chunk[]): Check {
  const src = norm(chunks.map((c) => c.source + " " + c.field + " " + c.text).join(" "));
  // bỏ dòng disclaimer: "Tử vi" (bộ môn) không phải sao Tử Vi
  const body = splitlines(text).filter((ln) => !norm(ln).includes(norm("tham khảo"))).join(" ");
  const n = norm(body);
  const out = CT14.filter((s) => n.includes(norm(s)) && !src.includes(norm(s)));
  return {
    check: "C4 · không bịa sao ngoài nguồn", pass: out.length === 0,
    detail: out.length === 0 ? "mọi chính tinh nêu ra đều có trong nguồn" : `sao ngoài nguồn: ${pyreprList(out)}`,
  };
}

export function c5HasDisclaimer(text: string, _chunks: Chunk[]): Check {
  const ok = norm(text).includes(norm("tham khảo"));
  return { check: "C5 · có disclaimer", pass: ok, detail: ok ? "có nhắc tính tham khảo" : "THIẾU disclaimer" };
}

// Lá số không được dùng để phán sinh tử hay khẳng định tai hoạ chắc chắn xảy ra.
const DINH_MENH = [String.raw`\bchet\b`, String.raw`\bqua doi\b`, String.raw`\btu vong\b`, String.raw`\byeu menh\b`,
  String.raw`\bdoan tho\b`, String.raw`\btu tu\b`, String.raw`\btu van\b`, "khong the tranh", "chac chan (se )?(gap|mac|bi|mat)"];

export function c6NoFatalism(text: string, _chunks: Chunk[]): Check {
  const n = norm(text);
  const hits = pysorted([...new Set(DINH_MENH.filter((p) => new RegExp(p).test(n)))]);
  return {
    check: "C6 · không phán định mệnh", pass: hits.length === 0,
    detail: hits.length === 0 ? "không có câu phán sinh tử/tai hoạ" : `cụm vi phạm: ${pyreprList(hits)}`,
  };
}

export function run(text: string, chunks: Chunk[]) {
  const checks = [c1CitationsValid(text, chunks), c2CitationCoverage(text, chunks),
    c3NoMieuHamContradiction(text, chunks), c4NoOutOfSourceStars(text, chunks),
    c5HasDisclaimer(text, chunks), c6NoFatalism(text, chunks)];
  const passed = checks.filter((c) => c.pass).length;
  return {
    verdict: passed === checks.length ? "ĐẠT — cho phép hiển thị" : "CHẶN — cần sửa",
    passed: `${passed}/${checks.length}`,
    checks,
  };
}
