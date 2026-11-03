/**
 * Đối chiếu chéo engine Node ⇄ engine Python (nguồn chân lý trong giai đoạn chuyển đổi).
 *
 *   npm run crossval -- --n 2000 --seed 1
 *
 * Mỗi ca so TOÀN BỘ output: lá số (mọi sao, đặc tính, Tứ Hóa, Tuần/Triệt, đại/tiểu hạn),
 * danh sách đại hạn, cách cục, lưu niên/lưu nguyệt, báo cáo luận giải offline, quy đổi giờ.
 * Khớp 100% mới coi là đạt (exit 0).
 */
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKb } from "../src/agents/kb.js";
import { buildReport } from "../src/agents/orchestrator.js";
import { nhanDienCachCuc } from "../src/engine/cachCuc.js";
import { quyDoiGio } from "../src/engine/thoiGian.js";
import { InputError, lapLaSo, type NhuanPolicy } from "../src/engine/tuviEngine.js";
import * as vanHan from "../src/engine/vanHan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k: string, d: number) => {
  const i = args.indexOf(k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const N = arg("--n", 1000);
let seed = arg("--seed", 1);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ri = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

type Case = Record<string, any>;
const cases: Case[] = [];
for (let i = 0; i < N; i++) {
  const duong = rand() < 0.8;
  cases.push({
    ngay: ri(1, duong ? 31 : 30), thang: ri(1, 12), nam: ri(1850, 2150), gio_sinh: ri(1, 12),
    gioi_tinh: rand() < 0.5 ? 1 : -1, duong_lich: duong, thang_nhuan: !duong && rand() < 0.3,
    nhuan_policy: rand() < 0.5 ? "thang_nay" : "chia_doi", nam_xem: ri(1840, 2250),
    report: i % 10 === 0,
  });
}
// Quy đổi giờ: đủ 24 giờ, phút sát ranh giới chi, có/không kinh độ
for (let i = 0; i < Math.max(200, N / 4); i++) {
  cases.push({
    ngay: ri(1, 28), thang: ri(1, 12), nam: ri(1900, 2100), gio: ri(0, 23), phut: [0, 59, 58, 1, ri(0, 59)][ri(0, 4)],
    kinh_do: rand() < 0.7 ? 102 + rand() * 8 : null, utc_offset_phut: rand() < 0.9 ? 420 : 480,
    quy_tac_ty: rand() < 0.5 ? "ngay_sau" : "ngay_hien_tai",
  });
}

const py = spawnSync("python3", [join(HERE, "oracle.py")], { input: JSON.stringify(cases), maxBuffer: 1 << 30 });
if (py.status !== 0) {
  console.error(py.stderr.toString());
  process.exit(2);
}
// JSON.stringify(-0) === "0": chuẩn hoá cả hai phía qua JSON để -0.0 của Python khớp 0.
const expected: Case[] = JSON.parse(JSON.stringify(JSON.parse(py.stdout.toString())));
const kb = loadKb();

async function runTs(c: Case): Promise<Case> {
  const out: Case = {};
  try {
    if ("gio" in c) {
      out.quy_doi = quyDoiGio(c.ngay, c.thang, c.nam, c.gio, c.phut, c.kinh_do, c.utc_offset_phut, c.quy_tac_ty);
      return out;
    }
    const chart = lapLaSo(c.ngay, c.thang, c.nam, c.gio_sinh, c.gioi_tinh, {
      duongLich: c.duong_lich, thangNhuan: c.thang_nhuan, nhuanPolicy: c.nhuan_policy as NhuanPolicy,
    });
    out.chart = chart;
    out.dai_han = vanHan.danhSachDaiHan(chart);
    out.cach_cuc = nhanDienCachCuc(chart);
    try {
      out.luu_nien = vanHan.luuNien(chart, c.nam_xem);
      out.luu_nguyet = vanHan.luuNguyet(chart, c.nam_xem);
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      out.luu_nien_error = true;
    }
    if (c.report) out.report = await buildReport(chart, kb, false);
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    out.error = true;
  }
  return out;
}

function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      const d = firstDiff((a as any)[k], (b as any)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: py=${JSON.stringify(a)?.slice(0, 200)} ts=${JSON.stringify(b)?.slice(0, 200)}`;
}

let ok = 0;
const fails: string[] = [];
const counts: Record<string, number> = {};
for (let i = 0; i < cases.length; i++) {
  const got = JSON.parse(JSON.stringify(await runTs(cases[i])));
  for (const k of Object.keys(expected[i])) counts[k] = (counts[k] ?? 0) + 1;
  const d = firstDiff(expected[i], got);
  if (d) fails.push(`ca #${i} ${JSON.stringify(cases[i])}\n    ${d}`);
  else ok++;
}
console.log(`Đối chiếu ${cases.length} ca: khớp ${ok}, lệch ${fails.length}`);
console.log("Phủ:", JSON.stringify(counts));
for (const f of fails.slice(0, 10)) console.log("  ✗", f);
process.exit(fails.length ? 1 : 0);
