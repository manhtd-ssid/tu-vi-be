/** Test các phần kết hợp ziwei-doushu — port từ src/test_ket_hop.py. */
import { describe, expect, it } from "vitest";
import * as ga from "../src/agents/guardrail.js";
import { loadKb } from "../src/agents/kb.js";
import { buildReport, luanCung } from "../src/agents/orchestrator.js";
import { nhanDienCachCuc } from "../src/engine/cachCuc.js";
import { chiCuaGio, quyDoiGio } from "../src/engine/thoiGian.js";
import { tuHoaTheoCan } from "../src/engine/tuHoa.js";
import { InputError, lapLaSo } from "../src/engine/tuviEngine.js";
import * as vanHan from "../src/engine/vanHan.js";

const chart = () => lapLaSo(15, 8, 1990, 7, 1);

it("đặc tính không rò rỉ giữa các lá số", () => {
  const goc = chart();
  for (let i = 0; i < 30; i++) lapLaSo(1 + (i % 28), 1 + (i % 12), 1950 + i, 1 + (i % 12), i % 2 ? 1 : -1);
  expect(chart()).toEqual(goc);
});

it("mỗi năm đủ Tứ Hóa, gắn đúng sao", () => {
  for (let y = 1984; y < 1994; y++) {
    const c = lapLaSo(15, 8, y, 3, 1);
    const hoa: Record<string, string> = {};
    for (const p of c.palaces) for (const s of p.stars) if (s.hoa) hoa[s.name] = s.hoa;
    expect(Object.values(hoa).sort()).toEqual(["Khoa", "Kỵ", "Lộc", "Quyền"].sort());
    for (const [loai, sao] of Object.entries(tuHoaTheoCan(c.can_chi.can_nam))) {
      expect(hoa[sao]).toBe(loai);
      // sao gốc và sao "Hóa x" của lasotuvi phải cùng cung
      const pal = c.palaces.find((p) => p.stars.some((s) => s.name === sao))!;
      expect(pal.stars.some((s) => s.name.toLowerCase() === "hóa " + loai.toLowerCase())).toBe(true);
    }
  }
});

it("tháng nhuận chia đôi", () => {
  // 2023 có tháng 2 nhuận; 2023-04-10 dương = 20/2 nhuận âm
  const a = lapLaSo(10, 4, 2023, 1, 1);
  const b = lapLaSo(10, 4, 2023, 1, 1, { nhuanPolicy: "chia_doi" });
  expect(a.am_lich).toEqual({ ngay: 20, thang: 2, nam: 2023, nhuan: true });
  expect(a.menh_index).not.toBe(b.menh_index);
});

describe("chiCuaGio", () => {
  it.each([[23, 0, 1], [0, 59, 1], [1, 0, 2], [12, 30, 7], [22, 59, 12]])("%i:%i → %i", (h, m, chi) => {
    expect(chiCuaGio(h, m)).toBe(chi);
  });
});

it("Tý muộn đổi ngày", () => {
  let [q, tt] = quyDoiGio(31, 12, 1999, 23, 30);
  expect([q.ngay, q.thang, q.nam, q.gio_sinh]).toEqual([1, 1, 2000, 1]);
  expect(tt.doi_ngay).toBe(true);
  [q] = quyDoiGio(31, 12, 1999, 23, 30, null, 420, "ngay_hien_tai");
  expect([q.ngay, q.gio_sinh]).toEqual([31, 1]);
});

it("Chân Thái Dương đổi chi", () => {
  // Điện Biên 103.02°: chậm ~8 phút so với kinh tuyến 105°, 01:05 lùi về giờ Tý
  const [q, tt] = quyDoiGio(15, 6, 1990, 1, 5, 103.02);
  expect(q.gio_sinh).toBe(1);
  expect(tt.hieu_chinh_phut).toBeLessThan(-7);
});

it("đại hạn 10 năm liên tục", () => {
  const d = vanHan.danhSachDaiHan(chart());
  expect(d).toHaveLength(12);
  expect(new Set(d.map((x) => x.cung))).toEqual(new Set(chart().palaces.map((p) => p.cung)));
  for (let i = 1; i < d.length; i++) expect(d[i].tuoi_tu).toBe(d[i - 1].tuoi_den + 1);
});

it("lưu niên: Tứ Hóa và tiểu hạn", () => {
  const r = vanHan.luuNien(chart(), 2026);
  expect(r.can_chi).toBe("Bính Ngọ");
  expect(r.tuoi_am).toBe(37);
  expect(r.tieu_han.branch).toBe("Thìn"); // tuổi Ngọ khởi Thìn, nam đi thuận
  expect(r.dai_han?.tuoi_tu).toBe(36);
  expect(new Set(r.tu_hoa.map((x) => x.sao))).toEqual(new Set(["Thiên đồng", "Thiên cơ", "Văn xương", "Liêm trinh"]));
  expect(r.tu_hoa.every((x) => x.branch)).toBe(true);
});

it("lưu niên trước năm sinh bị từ chối", () => {
  expect(() => vanHan.luuNien(chart(), 1980)).toThrow(InputError);
});

it("lưu nguyệt đủ 12 cung, đi thuận", () => {
  const r = vanHan.luuNguyet(chart(), 2026);
  expect(r.map((x) => x.thang)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(new Set(r.map((x) => x.branch)).size).toBe(12);
  expect(r[0].can_chi).toBe("Canh Dần"); // Bính niên khởi Canh Dần
});

it("cách cục có cấu trúc và không phán định mệnh", () => {
  let seed = 7;
  const rnd = (a: number, b: number) => a + ((seed = (seed * 48271) % 2147483647) % (b - a + 1));
  for (let i = 0; i < 600; i++) {
    const c = lapLaSo(rnd(1, 28), rnd(1, 12), rnd(1930, 2025), rnd(1, 12), rnd(0, 1) ? 1 : -1);
    for (const x of nhanDienCachCuc(c)) {
      expect(["dai_cat", "cat", "trung_binh", "can_luu_y"]).toContain(x.muc);
      expect(x.dieu_kien.bat_buoc.length && x.nguon).toBeTruthy();
      expect(ga.c6NoFatalism(x.mo_ta, []).pass).toBe(true);
    }
  }
});

it("Sát Phá Tham hội ở lá số mẫu (Mệnh có Phá quân)", () => {
  expect(nhanDienCachCuc(chart()).map((x) => x.ten)).toContain("Sát Phá Tham");
});

it("báo cáo offline qua Guardrail", async () => {
  const r = await buildReport(chart());
  expect(r.verdict).toBe("ĐẠT");
  expect(r.markdown).toContain("Cách cục nổi bật");
  expect(r.per_cung.every((q) => q.mode === "offline")).toBe(true);
});

it("LLM trượt Guardrail thì về offline", async () => {
  const c = chart();
  const k = await luanCung(c.palaces[1], loadKb(), [], true, async () => "## Cung X\nBạn chắc chắn sẽ gặp hoạ [S99]");
  expect(k.mode).toBe("offline_sau_khi_llm_truot_guardrail");
  expect(k.text).not.toContain("[S99]");
});

it("LLM qua Guardrail thì dùng bản LLM", async () => {
  const c = chart();
  const k = await luanCung(c.palaces[1], loadKb(), [], true, async () => "## Cung Sửu\nĐoạn luận ngắn gọn [S1].");
  expect(k.mode).toBe("llm");
});

it("C6 bắt câu phán sinh tử", () => {
  expect(ga.c6NoFatalism("Năm này đương số sẽ qua đời", []).pass).toBe(false);
  expect(ga.c6NoFatalism("Năm nay nên giữ sức khoẻ, tham khảo thêm.", []).pass).toBe(true);
});
