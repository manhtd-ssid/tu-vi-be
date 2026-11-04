/**
 * Nạp file .env ở gốc repo vào process.env — port từ src/env_loader.py.
 *  - Mỗi dòng KEY=VALUE; bỏ dòng trống và dòng bắt đầu bằng `#`; chấp nhận `export `.
 *  - VALUE được bỏ cặp nháy bao quanh nếu có; VALUE rỗng bị bỏ qua.
 *  - Biến đã có trong môi trường được giữ nguyên (env thật ưu tiên hơn .env).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/lib → server → repo root (cũng chạy được từ dist/lib)
export const ENV_FILES = [join(HERE, "..", "..", ".env"), join(HERE, "..", "..", "..", ".env")];

export function loadEnv(paths: string[] = ENV_FILES): void {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      if (line.startsWith("export ")) line = line.slice("export ".length);
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
        val = val.slice(1, -1);
      }
      if (key && val && !(key in process.env)) process.env[key] = val;
    }
  }
}
