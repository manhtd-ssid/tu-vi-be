/**
 * Test engine an sao — port từ src/test_engine.py.
 *  A. INVARIANTS: đúng với mọi lá số hợp lệ.
 *  B. GOLDEN SNAPSHOT: khoá kết quả các ca mẫu (cùng file golden của bản Python).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHINH_TINH_14, allStarNames, lapLaSo, type Chart } from "../src/engine/tuviEngine.js";

const SAMPLES = [
  { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 },
  { ngay: 1, thang: 1, nam: 2000, gio_sinh: 1, gioi_tinh: -1 },
  { ngay: 29, thang: 12, nam: 1985, gio_sinh: 12, gioi_tinh: 1 },
  { ngay: 10, thang: 6, nam: 1975, gio_sinh: 5, gioi_tinh: -1 },
  { ngay: 20, thang: 3, nam: 2010, gio_sinh: 9, gioi_tinh: 1 },
];
const lap = (s: (typeof SAMPLES)[number]) => lapLaSo(s.ngay, s.thang, s.nam, s.gio_sinh, s.gioi_tinh);
const BRANCHES_12 = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

describe.each(SAMPLES.map((s) => [`${s.ngay}/${s.thang}/${s.nam}`, s] as const))("invariants %s", (_id, s) => {
  const chart = lap(s);

  it("có đủ 12 cung, 12 địa chi không trùng", () => {
    expect(chart.palaces).toHaveLength(12);
    expect(new Set(chart.palaces.map((p) => p.branch))).toEqual(new Set(BRANCHES_12));
  });

  it("đủ 12 cung chủ", () => {
    expect(new Set(chart.palaces.map((p) => p.cung)).size).toBe(12);
  });

  it("đủ 14 chính tinh, mỗi sao đúng 1 lần", () => {
    const names = allStarNames(chart);
    for (const ct of CHINH_TINH_14) expect(names.filter((n) => n === ct)).toHaveLength(1);
  });

  it("đúng 1 cung an Thân, index Mệnh/Thân hợp lệ", () => {
    expect(chart.palaces.filter((p) => p.is_than)).toHaveLength(1);
    for (const i of [chart.menh_index, chart.than_index]) expect(i >= 1 && i <= 12).toBe(true);
  });

  it("serialize được JSON", () => {
    expect(() => JSON.stringify(chart)).not.toThrow();
  });
});

function fingerprint(c: Chart) {
  return {
    menh: c.menh_index,
    than: c.than_index,
    palaces: Object.fromEntries(c.palaces.map((p) => [p.branch, p.stars.map((s) => s.name).sort(cmp)])),
  };
}
// sorted() của Python so theo code point
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

it("golden snapshot khớp bản Python", () => {
  const golden = JSON.parse(readFileSync(new URL("./golden_charts.json", import.meta.url), "utf-8"));
  const current = Object.fromEntries(SAMPLES.map((s) => [`${s.ngay}/${s.thang}/${s.nam}-g${s.gio_sinh}`, fingerprint(lap(s))]));
  expect(current).toEqual(golden);
});
