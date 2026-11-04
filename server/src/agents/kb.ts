import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Kho tri thức luận giải (12 cung + 14 chính tinh) — nội dung tự biên của dự án. */
export interface KB {
  _nguon?: string;
  cung: Record<string, any>;
  chinhTinh: Record<string, any>;
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadKb(path = join(HERE, "..", "..", "data", "kb.json")): KB {
  return JSON.parse(readFileSync(path, "utf-8"));
}
