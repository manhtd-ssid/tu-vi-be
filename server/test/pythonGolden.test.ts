/**
 * Hồi quy so với engine Python gốc (lasotuvi + các module tu-vi-be bản Python).
 *
 * `fixtures/python-golden.json.gz` do engine Python sinh ra (ngẫu nhiên, seed 2026, năm 1850–2150, âm/dương lịch,
 * tháng nhuận, cả hai nhuan_policy, quy đổi giờ có/không kinh độ) trước khi bản Python bị gỡ khỏi repo.
 * Mỗi ca so TOÀN BỘ output: lá số (mọi sao, đặc tính, Tứ Hóa, Tuần/Triệt, đại/tiểu hạn), danh sách đại hạn,
 * cách cục, lưu niên/lưu nguyệt, báo cáo luận giải offline, quy đổi giờ. Phải khớp 100%.
 *
 * Nếu cố ý đổi kết quả engine (sửa một quy tắc an sao…), test này sẽ đỏ: xem lại thay đổi có đúng ý không,
 * rồi cập nhật fixture có chủ đích và ghi rõ lý do trong commit.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadKb } from "../src/agents/kb.js";
import { buildReport } from "../src/agents/orchestrator.js";
import { nhanDienCachCuc } from "../src/engine/cachCuc.js";
import { quyDoiGio } from "../src/engine/thoiGian.js";
import { InputError, lapLaSo, type NhuanPolicy } from "../src/engine/tuviEngine.js";
import * as vanHan from "../src/engine/vanHan.js";

type Case = Record<string, any>;
const { cases, expected } = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/python-golden.json.gz", import.meta.url))).toString(),
) as { cases: Case[]; expected: Case[] };
// Bản kho luận giải lúc sinh fixture (cùng nội dung data/kb.json)
const kb = loadKb();

async function chay(c: Case): Promise<Case> {
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

describe("khớp engine Python gốc", () => {
  it(`có đủ ca kiểm tra (${cases.length})`, () => {
    expect(cases.length).toBe(expected.length);
    expect(cases.length).toBeGreaterThanOrEqual(1000);
    const loai = (k: string) => expected.filter((e) => k in e).length;
    expect(loai("chart")).toBeGreaterThan(700);
    expect(loai("report")).toBeGreaterThan(50);
    expect(loai("quy_doi")).toBeGreaterThanOrEqual(200);
    expect(cases.some((c) => c.thang_nhuan)).toBe(true);
  });

  // Chia nhóm 100 ca để khi lệch biết ngay vùng nào
  for (let start = 0; start < cases.length; start += 100) {
    it(`ca ${start}–${Math.min(start + 99, cases.length - 1)}`, async () => {
      for (let i = start; i < Math.min(start + 100, cases.length); i++) {
        // Qua JSON để -0.0 của Python và 0 của JS so được với nhau
        const got = JSON.parse(JSON.stringify(await chay(cases[i])));
        expect(got, `ca #${i}: ${JSON.stringify(cases[i])}`).toEqual(expected[i]);
      }
    });
  }
});
