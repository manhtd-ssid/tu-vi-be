/**
 * Các hàm mô phỏng ngữ nghĩa Python mà engine gốc dựa vào.
 * Port 1-1 nên phải giữ đúng các khác biệt so với JS:
 *   - `a % b` của Python luôn cùng dấu với b (JS thì cùng dấu với a).
 *   - `int(x)` của Python cắt về 0 (Math.trunc), `//` là floor.
 *   - `round(x, n)` của Python làm tròn kiểu "banker's" khi đúng nửa.
 */

/** Phép chia lấy dư kiểu Python. */
export function pymod(a: number, b: number): number {
  const r = a % b;
  if (r === 0) return 0; // tránh -0
  return (r < 0) !== (b < 0) ? r + b : r;
}

/** int() kiểu Python: cắt phần thập phân về phía 0. */
export const pyint = Math.trunc;

/** round(x, digits) kiểu Python (round-half-even trên giá trị nhị phân thực). */
export function pyround(x: number, digits = 0): number {
  const m = 10 ** digits;
  const v = x * m;
  const fl = Math.floor(v);
  const diff = v - fl;
  // Chỉ coi là "đúng nửa" khi biểu diễn thập phân chính xác của x là ...5
  const exactHalf = diff === 0.5 && Number((fl + 0.5) / m) === x;
  let r: number;
  if (exactHalf) r = fl % 2 === 0 ? fl : fl + 1;
  else r = Number(x.toFixed(digits)) * m;
  return Math.round(r) / m;
}

/** "abc".title() kiểu Python cho chuỗi chỉ gồm chữ và khoảng trắng. */
export function pytitle(s: string): string {
  let out = "";
  let prevLetter = false;
  for (const ch of s) {
    const isLetter = /\p{L}/u.test(ch);
    out += isLetter ? (prevLetter ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prevLetter = isLetter;
  }
  return out;
}

/** "abc".capitalize() kiểu Python. */
export function pycapitalize(s: string): string {
  if (!s) return s;
  const [first, ...rest] = Array.from(s);
  return first.toUpperCase() + rest.join("").toLowerCase();
}

/** repr() của str kiểu Python (đủ cho chuỗi in được). */
export function pyreprStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let body = s.replace(/\\/g, "\\\\");
  if (q === "'") body = body.replace(/'/g, "\\'");
  body = body.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return q + body + q;
}

/** repr() của list[str] kiểu Python. */
export function pyreprList(items: string[]): string {
  return "[" + items.map(pyreprStr).join(", ") + "]";
}

/** So sánh chuỗi theo code point (giống sorted() của Python). */
export function cmpCodePoint(a: string, b: string): number {
  const A = Array.from(a);
  const B = Array.from(b);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i].codePointAt(0)!;
    const y = B[i].codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return A.length - B.length;
}

export function pysorted(items: string[]): string[] {
  return [...items].sort(cmpCodePoint);
}
