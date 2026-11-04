/**
 * Ảnh xem trước (Open Graph, 1200×630 PNG) cho link chia sẻ lá số: tiêu đề + tóm tắt bên trái,
 * bàn 12 cung thu nhỏ (chính tinh) bên phải. Vẽ SVG rồi chuyển PNG bằng resvg với font Be Vietnam Pro
 * đi kèm repo (assets/fonts, giấy phép OFL) — không phụ thuộc font của máy chủ.
 */
import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHINH_TINH_14 } from "../agents/interpretation.js";
import type { Chart } from "../engine/tuviEngine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/share → server (cũng chạy được từ dist/share)
const FONT_DIR = [join(HERE, "..", "..", "assets", "fonts"), join(HERE, "..", "..", "..", "assets", "fonts")].find(existsSync)!;
const FONTS = ["BeVietnamPro-Regular.ttf", "BeVietnamPro-SemiBold.ttf"].map((f) => join(FONT_DIR, f));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Vị trí (hàng, cột) của 12 địa chi trên bàn 4×4 truyền thống. */
const VI_TRI: Record<string, [number, number]> = {
  "Tỵ": [0, 0], "Ngọ": [0, 1], "Mùi": [0, 2], "Thân": [0, 3],
  "Thìn": [1, 0], "Dậu": [1, 3],
  "Mão": [2, 0], "Tuất": [2, 3],
  "Dần": [3, 0], "Sửu": [3, 1], "Tý": [3, 2], "Hợi": [3, 3],
};
const CT = new Set(CHINH_TINH_14);
const hoaChu = (s: string) => s.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");

/** Cắt chuỗi cho vừa (ước lượng theo số ký tự). */
const cat = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);

export function ogSvg(chart: Chart, opts: { title: string; site: string }): string {
  const W = 1200, H = 630;
  const menh = chart.palaces.find((p) => p.index === chart.menh_index)!;
  const ctMenh = menh.stars.filter((s) => CT.has(s.name)).map((s) => s.name);

  // Bàn cung bên phải
  const B = 540, X0 = W - B - 45, Y0 = (H - B) / 2, C = B / 4;
  const cells = chart.palaces.map((p) => {
    const [r, c] = VI_TRI[p.branch] ?? [0, 0];
    const x = X0 + c * C, y = Y0 + r * C;
    const la = p.index === chart.menh_index;
    const sao = p.stars.filter((s) => CT.has(s.name)).map((s) => s.name);
    return `<g>
      <rect x="${x + 3}" y="${y + 3}" width="${C - 6}" height="${C - 6}" rx="10" fill="${la ? "#FBEFEA" : "#FFFFFF"}" stroke="${la ? "#A63D2F" : "#E2D8C6"}" stroke-width="${la ? 2.5 : 1.5}"/>
      <text x="${x + 14}" y="${y + 30}" font-size="15" font-weight="600" fill="${la ? "#A63D2F" : "#454B5C"}">${esc(hoaChu(p.cung ?? ""))}${p.is_than ? " · Thân" : ""}</text>
      ${sao.length
        ? sao.slice(0, 2).map((n, i) => `<text x="${x + 14}" y="${y + 62 + i * 24}" font-size="17" font-weight="600" fill="#1C1F2B">${esc(n)}</text>`).join("")
        : `<text x="${x + 14}" y="${y + 62}" font-size="14" fill="#8A8F9E">vô chính diệu</text>`}
      <text x="${x + C - 14}" y="${y + C - 14}" font-size="13" fill="#8A8F9E" text-anchor="end">${esc(p.branch)}</text>
    </g>`;
  }).join("");
  const cx = X0 + C, cy = Y0 + C;
  const giua = `<rect x="${cx + 3}" y="${cy + 3}" width="${2 * C - 6}" height="${2 * C - 6}" rx="12" fill="#F6F1E7" stroke="#E2D8C6" stroke-width="1.5"/>
    <text x="${cx + C}" y="${cy + C - 22}" font-size="22" font-weight="600" fill="#1C1F2B" text-anchor="middle">${esc(chart.can_chi.nam)}</text>
    <text x="${cx + C}" y="${cy + C + 10}" font-size="17" fill="#454B5C" text-anchor="middle">${esc(chart.cuc.ten)}</text>
    <text x="${cx + C}" y="${cy + C + 38}" font-size="15" fill="#6E7486" text-anchor="middle">${esc(cat(chart.ban_menh, 22))}</text>`;

  // Chữ bên trái
  const L = 60;
  const tieuDe = cat(opts.title, 26);
  const dong = [
    `Năm ${chart.can_chi.nam} · ${chart.cuc.ten}`,
    `Mệnh tại ${menh.branch}${ctMenh.length ? ` (${ctMenh.join(", ")})` : " (vô chính diệu)"}`,
    `Bản mệnh: ${chart.ban_menh}`,
  ].map((t) => cat(t, 34));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Be Vietnam Pro">
  <rect width="${W}" height="${H}" fill="#F6F1E7"/>
  <text x="${L}" y="92" font-size="22" font-weight="600" fill="#A63D2F">${esc(cat(opts.site, 30))}</text>
  <text x="${L}" y="178" font-size="44" font-weight="600" fill="#1C1F2B">Lá số tử vi</text>
  <text x="${L}" y="234" font-size="34" fill="#1C1F2B">${esc(tieuDe)}</text>
  ${dong.map((t, i) => `<text x="${L}" y="${310 + i * 40}" font-size="22" fill="#454B5C">${esc(t)}</text>`).join("")}
  <rect x="${L}" y="470" width="420" height="64" rx="32" fill="#A63D2F"/>
  <text x="${L + 210}" y="510" font-size="22" font-weight="600" fill="#FFFFFF" text-anchor="middle">Lập lá số của bạn — miễn phí</text>
  ${cells}${giua}
</svg>`;
}

export function ogPng(chart: Chart, opts: { title: string; site: string }): Buffer {
  const r = new Resvg(ogSvg(chart, opts), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Be Vietnam Pro" },
    fitTo: { mode: "original" },
  });
  return r.render().asPng();
}
