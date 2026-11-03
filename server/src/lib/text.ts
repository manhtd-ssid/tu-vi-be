/** Tiện ích chuỗi mô phỏng Python (dùng bởi tầng agent). */

/** unicodedata NFD + bỏ dấu (Mn) + lower + đ→d. `strip` như bản interpretation_agent. */
export function normNoStrip(s: string | null | undefined): string {
  return (s || "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/đ/g, "d");
}

export function norm(s: string | null | undefined): string {
  return normNoStrip(s).trim();
}

/** str.splitlines() của Python. */
export function splitlines(s: string): string[] {
  if (!s) return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (/(\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])$/.test(s)) parts.pop();
  return parts;
}

/** " ".join(s.split()) của Python. */
export function collapseWs(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(" ");
}

/** len() theo code point. */
export const cpLen = (s: string) => Array.from(s).length;

/** s[:n] theo code point. */
export const cpSlice = (s: string, n: number) => Array.from(s).slice(0, n).join("");
