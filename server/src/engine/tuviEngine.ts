/**
 * Engine an sao (tầng TẤT ĐỊNH) — port từ src/tuvi_engine.py.
 *
 * Bọc lõi lasotuvi thành một hàm sạch, trả lá số có cấu trúc cho API và agent.
 * NGUYÊN TẮC: LLM không bao giờ tự sinh lá số, chỉ diễn giải output của module này.
 */
import { pycapitalize, pymod } from "../lib/py.js";
import { diaChi, nguHanh, nguHanhNapAm, thienCan, timCuc } from "./lasotuvi/amDuong.js";
import { lapDiaBan } from "./lasotuvi/app.js";
import { S2L } from "./lasotuvi/lich.js";
import { bangTuHoa, type LoaiHoa } from "./tuHoa.js";

export const CHINH_TINH_14 = [
  "Tử vi", "Thiên cơ", "Thái Dương", "Vũ khúc", "Thiên đồng", "Liêm trinh",
  "Thiên phủ", "Thái âm", "Tham lang", "Cự môn", "Thiên tướng", "Thiên lương",
  "Thất sát", "Phá quân",
];

export const CAN_TEN = thienCan.map((c) => c.tenCan) as string[]; // index 1..10
export const CHI_TEN = diaChi.map((c) => c.tenChi); // index 1..12

// Mệnh chủ theo địa chi cung Mệnh, Thân chủ theo địa chi năm sinh (index 1..12)
const MENH_CHU = [null, "Tham lang", "Cự môn", "Lộc tồn", "Văn khúc", "Liêm trinh", "Vũ khúc",
  "Phá quân", "Vũ khúc", "Liêm trinh", "Văn khúc", "Lộc tồn", "Cự môn"];
const THAN_CHU = [null, "Hỏa tinh", "Thiên tướng", "Thiên lương", "Thiên đồng", "Văn xương",
  "Thiên cơ", "Linh tinh", "Thiên tướng", "Thiên lương", "Thiên đồng", "Văn xương", "Thiên cơ"];

export const NHUAN_THANG_NAY = "thang_nay"; // tháng nhuận tính như tháng thường cùng số (lasotuvi)
export const NHUAN_CHIA_DOI = "chia_doi"; // mùng 1–15 tính tháng này, 16 trở đi tính tháng sau
export type NhuanPolicy = typeof NHUAN_THANG_NAY | typeof NHUAN_CHIA_DOI;

/** Lỗi dữ liệu đầu vào (API trả 400) — tương ứng ValueError bên Python. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export interface Star {
  name: string;
  nguHanh: string;
  loai: number;
  amDuong: number | string;
  dacTinh: string | null;
  hoa: LoaiHoa | null;
}

export interface Palace {
  branch: string;
  cung: string | null;
  is_than: boolean;
  am_duong: 1 | -1;
  index: number;
  can: string;
  hanh: string | null;
  dai_han: number;
  tieu_han: string;
  tuan: boolean;
  triet: boolean;
  stars: Star[];
}

export interface Chart {
  input: {
    ngay: number; thang: number; nam: number; gio_sinh: number; gioi_tinh: number;
    duong_lich: boolean; time_zone: number;
  };
  menh_index: number;
  than_index: number;
  am_lich: { ngay: number; thang: number; nam: number; nhuan: boolean };
  can_chi: { nam: string; can_nam: number; chi_nam: number; gio: string };
  cuc: { so: number; ten: string };
  ban_menh: string;
  menh_chu: string;
  than_chu: string;
  am_duong_nam_nu: string;
  dai_han_thuan: boolean;
  palaces: Palace[];
  hieu_chinh_gio?: unknown;
}

/** Thiên can của cung (Ngũ Hổ Độn, cùng công thức timCuc của lasotuvi). */
export function canCung(canNam: number, cungSo: number): number {
  const canThangGieng = pymod(canNam * 2 + 1, 10);
  return pymod(pymod(cungSo - 3, 12) + canThangGieng - 1, 10) + 1;
}

/** Kiểm tra ngày dương lịch tồn tại (giống datetime.date của Python). */
export function kiemTraNgay(nam: number, thang: number, ngay: number): void {
  if (!Number.isInteger(nam) || nam < 1 || nam > 9999) throw new InputError(`year ${nam} is out of range`);
  if (!Number.isInteger(thang) || thang < 1 || thang > 12) throw new InputError("month must be in 1..12");
  const soNgay = [31, namNhuan(nam) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][thang - 1];
  if (!Number.isInteger(ngay) || ngay < 1 || ngay > soNgay) throw new InputError("day is out of range for month");
}

export function namNhuan(nam: number): boolean {
  return nam % 4 === 0 && (nam % 100 !== 0 || nam % 400 === 0);
}

function doiLich(
  ngay: number, thang: number, nam: number, duongLich: boolean, timeZone: number,
  thangNhuan: boolean, nhuanPolicy: NhuanPolicy,
) {
  let d: number, m: number, y: number, leap: number;
  if (duongLich) [d, m, y, leap] = S2L(ngay, thang, nam, timeZone);
  else [d, m, y, leap] = [ngay, thang, nam, thangNhuan ? 1 : 0];
  const goc = { ngay: d, thang: m, nam: y, nhuan: Boolean(leap) };
  if (leap && nhuanPolicy === NHUAN_CHIA_DOI && d > 15) {
    m += 1;
    if (m > 12) [m, y] = [1, y + 1];
  }
  return { d, m, y, goc };
}

export interface LapLaSoOptions {
  duongLich?: boolean;
  timeZone?: number;
  /** chỉ dùng khi duongLich=false */
  thangNhuan?: boolean;
  nhuanPolicy?: NhuanPolicy;
}

/**
 * Lập lá số Tử Vi.
 * @param gioSinh 1..12 (1=Tý, 2=Sửu, ...)
 * @param gioiTinh 1 = Nam, -1 = Nữ
 */
export function lapLaSo(
  ngay: number, thang: number, nam: number, gioSinh: number, gioiTinh: number,
  opts: LapLaSoOptions = {},
): Chart {
  const { duongLich = true, timeZone = 7, thangNhuan = false, nhuanPolicy = NHUAN_THANG_NAY } = opts;
  if (duongLich) kiemTraNgay(nam, thang, ngay);
  else if (!(ngay >= 1 && ngay <= 30)) throw new InputError("Ngày âm lịch phải trong khoảng 1..30");
  if (gioiTinh !== 1 && gioiTinh !== -1) throw new InputError("gioi_tinh phải là 1 (Nam) hoặc -1 (Nữ)");
  if (!(gioSinh >= 1 && gioSinh <= 12)) throw new InputError("gio_sinh phải trong khoảng 1..12");
  if (nhuanPolicy !== NHUAN_THANG_NAY && nhuanPolicy !== NHUAN_CHIA_DOI) throw new InputError("nhuan_policy không hợp lệ");

  const { d, m, y, goc } = doiLich(ngay, thang, nam, duongLich, timeZone, thangNhuan, nhuanPolicy);
  const db = lapDiaBan(d, m, y, gioSinh, gioiTinh, false, timeZone);

  const canNam = pymod(y + 6, 10) + 1;
  const chiNam = pymod(y + 8, 12) + 1;
  const hoaMap = new Map<string, LoaiHoa>();
  (["Lộc", "Quyền", "Khoa", "Kỵ"] as const).forEach((k, i) => hoaMap.set(bangTuHoa(canNam)[i].toLowerCase(), k));

  const palaces: Palace[] = db.thapNhiCung.slice(1).map((cung) => ({
    branch: cung.cungTen,
    cung: cung.cungChu,
    is_than: Boolean(cung.cungThan),
    am_duong: cung.cungAmDuong,
    index: cung.cungSo,
    can: CAN_TEN[canCung(canNam, cung.cungSo)],
    hanh: cung.hanhCung,
    dai_han: cung.cungDaiHan,
    tieu_han: cung.cungTieuHan,
    tuan: cung.tuanTrung,
    triet: cung.trietLo,
    stars: cung.cungSao.map((s) => ({
      name: s.saoTen,
      nguHanh: s.saoNguHanh,
      loai: s.saoLoai,
      amDuong: s.saoAmDuong,
      dacTinh: s.saoDacTinh,
      hoa: hoaMap.get((s.saoTen ?? "").toLowerCase()) ?? null,
    })),
  }));

  const cuc = nguHanh(timCuc(db.cungMenh, canNam));
  const duongNamSinh = thienCan[canNam].amDuong === 1;
  const amDuongNamNu = (duongNamSinh ? "Dương" : "Âm") + (gioiTinh === 1 ? " Nam" : " Nữ");

  return {
    input: { ngay, thang, nam, gio_sinh: gioSinh, gioi_tinh: gioiTinh, duong_lich: duongLich, time_zone: timeZone },
    menh_index: db.cungMenh,
    than_index: db.cungThan,
    am_lich: goc,
    can_chi: { nam: CAN_TEN[canNam] + " " + CHI_TEN[chiNam], can_nam: canNam, chi_nam: chiNam, gio: CHI_TEN[gioSinh] },
    cuc: { so: cuc.cuc, ten: cuc.tenCuc },
    ban_menh: pycapitalize(nguHanhNapAm(chiNam, canNam, true)),
    menh_chu: MENH_CHU[db.cungMenh] as string,
    than_chu: THAN_CHU[chiNam] as string,
    am_duong_nam_nu: amDuongNamNu,
    dai_han_thuan: (gioiTinh === 1) === (diaChi[chiNam].amDuong === 1),
    palaces,
  };
}

/** Gộp tên tất cả sao trong lá số (dùng cho kiểm chứng). */
export function allStarNames(chart: Chart): string[] {
  return chart.palaces.flatMap((p) => p.stars.map((s) => s.name));
}
