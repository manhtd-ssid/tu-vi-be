/**
 * Quy đổi giờ đồng hồ → giờ âm (chi), có Chân Thái Dương Thì và quy tắc Tý muộn.
 * Port từ src/thoi_gian.py (gốc: ziwei-doushu lib/ziwei/true-solar-time.ts, MIT):
 * giờ mặt trời thực = giờ đồng hồ + hiệu chỉnh kinh độ + phương trình thời gian (NOAA).
 * Mặc định theo Việt Nam: UTC+7, kinh tuyến chuẩn 105°.
 */
import { pyround } from "../lib/py.js";
import kinhDoTinh from "./kinhDoTinh.json" with { type: "json" };
import { InputError, kiemTraNgay, namNhuan } from "./tuviEngine.js";

export const TY_NGAY_SAU = "ngay_sau"; // 23:00–23:59 tính sang ngày hôm sau
export const TY_NGAY_HIEN_TAI = "ngay_hien_tai"; // 23:00–23:59 vẫn là ngày hiện tại
export type QuyTacTy = typeof TY_NGAY_SAU | typeof TY_NGAY_HIEN_TAI;

export const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

/** Kinh độ gần đúng tại trung tâm 63 tỉnh/thành (đơn vị hành chính trước sáp nhập 2025). */
export const KINH_DO_TINH: Record<string, number> = kinhDoTinh;

function ngayTrongNam(nam: number, thang: number, ngay: number): number {
  return Math.round((Date.UTC(nam, thang - 1, ngay) - Date.UTC(nam, 0, 1)) / 86400000) + 1;
}

/** Phương trình thời gian (phút) theo xấp xỉ NOAA; dương = mặt trời nhanh hơn đồng hồ. */
export function phuongTrinhThoiGian(nam: number, thang: number, ngay: number): number {
  const soNgay = namNhuan(nam) ? 366 : 365;
  const n = ngayTrongNam(nam, thang, ngay);
  const g = ((2 * Math.PI) / soNgay) * (n - 1);
  return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
}

/** Giờ:phút → số giờ âm 1..12 (1=Tý 23:00–00:59). */
export function chiCuaGio(gio: number, phut = 0): number {
  return (Math.floor((gio * 60 + phut + 60) / 120) % 12) + 1;
}

export interface GioQuyDoi { ngay: number; thang: number; nam: number; gio_sinh: number }
export interface HieuChinhGio {
  gio_mat_troi: string;
  hieu_chinh_phut: number;
  chan_thai_duong: boolean;
  gio_chi: string;
  ty_muon: boolean;
  doi_ngay: boolean;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Trả ([ngày, tháng, năm, giờ âm], thông tin hiệu chỉnh) để đưa vào lapLaSo. */
export function quyDoiGio(
  ngay: number, thang: number, nam: number, gio: number, phut = 0,
  kinhDo: number | null = null, utcOffsetPhut = 420, quyTacTy: QuyTacTy = TY_NGAY_SAU,
): [GioQuyDoi, HieuChinhGio] {
  if (quyTacTy !== TY_NGAY_SAU && quyTacTy !== TY_NGAY_HIEN_TAI) throw new InputError("quy_tac_ty không hợp lệ");
  kiemTraNgay(nam, thang, ngay);
  if (!Number.isInteger(gio) || gio < 0 || gio > 23) throw new InputError("hour must be in 0..23");
  if (!Number.isInteger(phut) || phut < 0 || phut > 59) throw new InputError("minute must be in 0..59");

  let hcKinhDo = 0;
  let hcPttg = 0;
  if (kinhDo !== null && kinhDo !== undefined) {
    hcKinhDo = (kinhDo - utcOffsetPhut / 4) * 4;
    hcPttg = phuongTrinhThoiGian(nam, thang, ngay);
  }
  // timedelta(minutes=x) của Python làm tròn tới micro giây; giờ gốc là phút chẵn
  // nên phút của giờ mặt trời = phút gốc + floor(micro giây / 60e6).
  const us = Math.round((hcKinhDo + hcPttg) * 60e6);
  const gocMs = Date.UTC(nam, thang - 1, ngay, gio, phut);
  const mt = new Date(gocMs + Math.floor(us / 60e6) * 60000);

  const tyMuon = mt.getUTCHours() === 23;
  const ngayTinh = new Date(Date.UTC(mt.getUTCFullYear(), mt.getUTCMonth(), mt.getUTCDate()));
  if (tyMuon && quyTacTy === TY_NGAY_SAU) ngayTinh.setUTCDate(ngayTinh.getUTCDate() + 1);
  const gioSinh = chiCuaGio(mt.getUTCHours(), mt.getUTCMinutes());
  const gocNgay = Date.UTC(nam, thang - 1, ngay);
  return [
    { ngay: ngayTinh.getUTCDate(), thang: ngayTinh.getUTCMonth() + 1, nam: ngayTinh.getUTCFullYear(), gio_sinh: gioSinh },
    {
      gio_mat_troi: `${mt.getUTCFullYear()}-${pad(mt.getUTCMonth() + 1)}-${pad(mt.getUTCDate())} ${pad(mt.getUTCHours())}:${pad(mt.getUTCMinutes())}`,
      hieu_chinh_phut: pyround(hcKinhDo + hcPttg, 1) || 0, // || 0: bỏ -0
      chan_thai_duong: kinhDo !== null && kinhDo !== undefined,
      gio_chi: CHI[gioSinh - 1],
      ty_muon: tyMuon,
      doi_ngay: ngayTinh.getTime() !== gocNgay,
    },
  ];
}
