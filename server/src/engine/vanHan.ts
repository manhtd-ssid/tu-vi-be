/**
 * Vận hạn tất định: Đại hạn, Tiểu hạn, Lưu niên, Lưu nguyệt — port từ src/van_han.py.
 * Khung phân tầng học từ ziwei-doushu (MIT); vị trí Đại hạn, Tiểu hạn, Đẩu quân
 * lấy từ lasotuvi để nhất quán với lá số.
 */
import { pymod } from "../lib/py.js";
import { tuHoaTheoCan } from "./tuHoa.js";
import { CAN_TEN, CHI_TEN, InputError, canCung, type Chart, type Palace } from "./tuviEngine.js";

// Can → cung Lộc tồn (index địa bàn 1..12), theo vitriDiaBan của lasotuvi
const LOC_TON = [null, 3, 4, 6, 7, 6, 7, 9, 10, 12, 1] as number[];

export const canNam = (nam: number) => pymod(nam + 6, 10) + 1;
export const chiNam = (nam: number) => pymod(nam + 8, 12) + 1;

function palByIndex(chart: Chart, idx: number): Palace {
  const i = pymod(idx - 1, 12) + 1;
  return chart.palaces.find((p) => p.index === i)!;
}

function viTriSao(chart: Chart, ten: string): Palace | undefined {
  const k = ten.toLowerCase();
  return chart.palaces.find((p) => p.stars.some((s) => (s.name || "").toLowerCase() === k));
}

export interface TuHoaDinhVi { hoa: string; sao: string; branch: string | null; cung: string | null }

function tuHoaDinhVi(chart: Chart, can: number): TuHoaDinhVi[] {
  return Object.entries(tuHoaTheoCan(can)).map(([loai, sao]) => {
    const p = viTriSao(chart, sao);
    return { hoa: loai, sao, branch: p ? p.branch : null, cung: p ? p.cung : null };
  });
}

function saoLoc(chart: Chart, can: number) {
  const loc = LOC_TON[can];
  return ([["Lưu Lộc tồn", loc], ["Lưu Kình dương", loc + 1], ["Lưu Đà la", loc - 1]] as const).map(([ten, idx]) => {
    const p = palByIndex(chart, idx);
    return { sao: ten, branch: p.branch, cung: p.cung };
  });
}

export interface DaiHan {
  tuoi_tu: number; tuoi_den: number; branch: string; cung: string | null; can: string;
  nam_tu: number; tu_hoa: TuHoaDinhVi[];
}

export function danhSachDaiHan(chart: Chart): DaiHan[] {
  const canSinh = chart.can_chi.can_nam;
  return [...chart.palaces]
    .sort((a, b) => a.dai_han - b.dai_han)
    .map((p) => {
      const can = canCung(canSinh, p.index);
      return {
        tuoi_tu: p.dai_han, tuoi_den: p.dai_han + 9, branch: p.branch, cung: p.cung, can: CAN_TEN[can],
        nam_tu: chart.am_lich.nam + p.dai_han - 1, tu_hoa: tuHoaDinhVi(chart, can),
      };
    });
}

export function daiHanTaiTuoi(chart: Chart, tuoi: number): DaiHan | null {
  return danhSachDaiHan(chart).find((d) => d.tuoi_tu <= tuoi && tuoi <= d.tuoi_den) ?? null;
}

/** Tổng hợp vận năm âm lịch `nam`. */
export function luuNien(chart: Chart, nam: number) {
  const can = canNam(nam);
  const chi = chiNam(nam);
  const tuoi = nam - chart.am_lich.nam + 1;
  if (tuoi < 1) throw new InputError("Năm xem phải từ năm sinh trở đi");
  const tenChi = CHI_TEN[chi];
  const tieuHan = chart.palaces.find((p) => p.tieu_han === tenChi)!;
  const thaiTue = palByIndex(chart, chi);
  return {
    nam, can_chi: CAN_TEN[can] + " " + tenChi, tuoi_am: tuoi,
    dai_han: daiHanTaiTuoi(chart, tuoi),
    tieu_han: { branch: tieuHan.branch, cung: tieuHan.cung },
    luu_thai_tue: { branch: thaiTue.branch, cung: thaiTue.cung },
    tu_hoa: tuHoaDinhVi(chart, can),
    sao_luu: saoLoc(chart, can),
  };
}

/** 12 tháng âm của năm `nam`: tháng Giêng khởi tại cung Lưu Đẩu quân, đi thuận. */
export function luuNguyet(chart: Chart, nam: number) {
  const canN = canNam(nam);
  const chi = chiNam(nam);
  const khoi = chi - chart.am_lich.thang + chart.input.gio_sinh;
  const rows = [];
  for (let thang = 1; thang <= 12; thang++) {
    const p = palByIndex(chart, khoi + thang - 1);
    // Can tháng: Ngũ Hổ Độn, tháng Giêng là tháng Dần (index 3)
    const can = canCung(canN, thang + 2);
    rows.push({
      thang, can_chi: CAN_TEN[can] + " " + CHI_TEN[((thang + 1) % 12) + 1],
      branch: p.branch, cung: p.cung, tu_hoa: tuHoaDinhVi(chart, can),
    });
  }
  return rows;
}
