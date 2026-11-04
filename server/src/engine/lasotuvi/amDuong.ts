/**
 * Âm dương, can chi, ngũ hành, các hàm tìm vị trí sao — port từ lasotuvi/AmDuong.py.
 * (c) 2016 doanguyen <dungnv2410@gmail.com>, MIT.
 */
import { pymod } from "../../lib/py.js";
import { S2L, L2S, jdFromDate } from "./lich.js";

export type HanhKyTu = "K" | "M" | "T" | "H" | "O";

export interface ThienCan {
  id: number;
  chuCaiDau: string | null;
  tenCan: string | null;
  nguHanh: HanhKyTu | null;
  nguHanhID: number | null;
  vitriDiaBan: number | null;
  amDuong: 1 | -1 | null;
}

export const thienCan: ThienCan[] = [
  { id: 0, chuCaiDau: null, tenCan: null, nguHanh: null, nguHanhID: null, vitriDiaBan: null, amDuong: null },
  { id: 1, chuCaiDau: "G", tenCan: "Giáp", nguHanh: "M", nguHanhID: 2, vitriDiaBan: 3, amDuong: 1 },
  { id: 2, chuCaiDau: "A", tenCan: "Ất", nguHanh: "M", nguHanhID: 2, vitriDiaBan: 4, amDuong: -1 },
  { id: 3, chuCaiDau: "B", tenCan: "Bính", nguHanh: "H", nguHanhID: 4, vitriDiaBan: 6, amDuong: 1 },
  { id: 4, chuCaiDau: "D", tenCan: "Đinh", nguHanh: "H", nguHanhID: 4, vitriDiaBan: 7, amDuong: -1 },
  { id: 5, chuCaiDau: "M", tenCan: "Mậu", nguHanh: "O", nguHanhID: 5, vitriDiaBan: 6, amDuong: 1 },
  { id: 6, chuCaiDau: "K", tenCan: "Kỷ", nguHanh: "O", nguHanhID: 5, vitriDiaBan: 7, amDuong: -1 },
  { id: 7, chuCaiDau: "C", tenCan: "Canh", nguHanh: "K", nguHanhID: 1, vitriDiaBan: 9, amDuong: 1 },
  { id: 8, chuCaiDau: "T", tenCan: "Tân", nguHanh: "K", nguHanhID: 1, vitriDiaBan: 10, amDuong: -1 },
  { id: 9, chuCaiDau: "N", tenCan: "Nhâm", nguHanh: "T", nguHanhID: 3, vitriDiaBan: 12, amDuong: 1 },
  { id: 10, chuCaiDau: "Q", tenCan: "Quý", nguHanh: "T", nguHanhID: 3, vitriDiaBan: 1, amDuong: -1 },
];

export interface DiaChi {
  id: number;
  tenChi: string;
  tenHanh: string;
  menhChu?: string;
  thanChu?: string;
  amDuong: 1 | -1 | 0;
}

export const diaChi: DiaChi[] = [
  { id: 0, tenChi: "Hem có", tenHanh: ":D", amDuong: 0 },
  { id: 1, tenChi: "Tý", tenHanh: "T", menhChu: "Tham lang", thanChu: "Linh tinh", amDuong: 1 },
  { id: 2, tenChi: "Sửu", tenHanh: "O", menhChu: "Cự môn", thanChu: "Thiên tướng", amDuong: -1 },
  { id: 3, tenChi: "Dần", tenHanh: "M", menhChu: "Lộc tồn", thanChu: "Thiên lương", amDuong: 1 },
  { id: 4, tenChi: "Mão", tenHanh: "M", menhChu: "Văn khúc", thanChu: "Thiên đồng", amDuong: -1 },
  { id: 5, tenChi: "Thìn", tenHanh: "O", menhChu: "Liêm trinh", thanChu: "Văn xương", amDuong: 1 },
  { id: 6, tenChi: "Tỵ", tenHanh: "H", menhChu: "Vũ khúc", thanChu: "Thiên cơ", amDuong: -1 },
  { id: 7, tenChi: "Ngọ", tenHanh: "H", menhChu: "Phá quân", thanChu: "Hỏa tinh", amDuong: 1 },
  { id: 8, tenChi: "Mùi", tenHanh: "O", menhChu: "Vũ khúc", thanChu: "Thiên tướng", amDuong: -1 },
  { id: 9, tenChi: "Thân", tenHanh: "K", menhChu: "Liêm trinh", thanChu: "Thiên lương", amDuong: 1 },
  { id: 10, tenChi: "Dậu", tenHanh: "K", menhChu: "Văn khúc", thanChu: "Thiên đồng", amDuong: -1 },
  { id: 11, tenChi: "Tuất", tenHanh: "O", menhChu: "Lộc tồn", thanChu: "Văn xương", amDuong: 1 },
  { id: 12, tenChi: "Hợi", tenHanh: "T", menhChu: "Cự môn", thanChu: "Thiên cơ", amDuong: -1 },
];

/** Dương lịch → [ngày, tháng, năm, nhuận] âm (hoặc giữ nguyên nếu đã là âm lịch). */
export function ngayThangNam(
  nn: number,
  tt: number,
  nnnn: number,
  duongLich = true,
  timeZone = 7,
): [number, number, number, number] {
  if (nn > 0 && nn < 32 && tt < 13 && tt > 0) {
    if (duongLich) return S2L(nn, tt, nnnn, timeZone);
    return [nn, tt, nnnn, 0];
  }
  throw new Error("Ngày, tháng, năm không chính xác.");
}

/** [can ngày, chi ngày] (1-based). */
export function canChiNgay(
  nn: number,
  tt: number,
  nnnn: number,
  duongLich = true,
  timeZone = 7,
  thangNhuan = false,
): [number, number] {
  if (!duongLich) [nn, tt, nnnn] = L2S(nn, tt, nnnn, thangNhuan, timeZone);
  const jd = jdFromDate(nn, tt, nnnn);
  return [((jd + 9) % 10) + 1, ((jd + 1) % 12) + 1];
}

/** [can tháng, can năm, chi năm] (1-based). */
export function ngayThangNamCanChi(
  nn: number,
  tt: number,
  nnnn: number,
  duongLich = true,
  timeZone = 7,
): [number, number, number] {
  if (duongLich) [nn, tt, nnnn] = ngayThangNam(nn, tt, nnnn, true, timeZone);
  const canThang = pymod(nnnn * 12 + tt + 3, 10) + 1;
  const canNamSinh = pymod(nnnn + 6, 10) + 1;
  const chiNam = pymod(nnnn + 8, 12) + 1;
  return [canThang, canNamSinh, chiNam];
}

export interface NguHanh {
  id: number;
  tenHanh: string;
  cuc: number;
  tenCuc: string;
  css: string;
}

export function nguHanh(tenHanh: string): NguHanh {
  if (tenHanh === "Kim" || tenHanh === "K") return { id: 1, tenHanh: "Kim", cuc: 4, tenCuc: "Kim tứ Cục", css: "hanhKim" };
  if (tenHanh === "Moc" || tenHanh === "M") return { id: 2, tenHanh: "Mộc", cuc: 3, tenCuc: "Mộc tam Cục", css: "hanhMoc" };
  if (tenHanh === "Thuy" || tenHanh === "T") return { id: 3, tenHanh: "Thủy", cuc: 2, tenCuc: "Thủy nhị Cục", css: "hanhThuy" };
  if (tenHanh === "Hoa" || tenHanh === "H") return { id: 4, tenHanh: "Hỏa", cuc: 6, tenCuc: "Hỏa lục Cục", css: "hanhHoa" };
  if (tenHanh === "Tho" || tenHanh === "O") return { id: 5, tenHanh: "Thổ", cuc: 5, tenCuc: "Thổ ngũ Cục", css: "hanhTho" };
  throw new Error("Tên Hành phải thuộc Kim (K), Mộc (M), Thủy (T), Hỏa (H) hoặc Thổ (O)");
}

const BAN_MENH: Record<string, string> = {
  "K1": "HẢI TRUNG KIM",
  "T1": "GIÁNG HẠ THỦY",
  "H1": "TÍCH LỊCH HỎA",
  "O1": "BÍCH THƯỢNG THỔ",
  "M1": "TANG ÐỐ MỘC",
  "T2": "ÐẠI KHÊ THỦY",
  "H2": "LƯ TRUNG HỎA",
  "O2": "THÀNH ÐẦU THỔ",
  "M2": "TÒNG BÁ MỘC",
  "K2": "KIM BẠCH KIM",
  "H3": "PHÚ ÐĂNG HỎA",
  "O3": "SA TRUNG THỔ",
  "M3": "ÐẠI LÂM MỘC",
  "K3": "BẠCH LẠP KIM",
  "T3": "TRƯỜNG LƯU THỦY",
  "K4": "SA TRUNG KIM",
  "T4": "THIÊN HÀ THỦY",
  "H4": "THIÊN THƯỢNG HỎA",
  "O4": "LỘ BÀN THỔ",
  "M4": "DƯƠNG LIỄU MỘC",
  "T5": "TRUYỀN TRUNG THỦY",
  "H5": "SƠN HẠ HỎA",
  "O5": "ÐẠI TRẠCH THỔ",
  "M5": "THẠCH LỰU MỘC",
  "K5": "KIẾM PHONG KIM",
  "H6": "SƠN ÐẦU HỎA",
  "O6": "ỐC THƯỢNG THỔ",
  "M6": "BÌNH ÐỊA MỘC",
  "K6": "XOA XUYẾN KIM",
  "T6": "ÐẠI HẢI THỦY"
};

type O = false;
const _ = false as O;
// Hàng = địa chi (1..12), cột = thiên can (1..10)
const MA_TRAN_NAP_AM: (string | O)[][] = [
  [],
  [_, "K1", _, "T1", _, "H1", _, "O1", _, "M1", _],
  [_, _, "K1", _, "T1", _, "H1", _, "O1", _, "M1"],
  [_, "T2", _, "H2", _, "O2", _, "M2", _, "K2", _],
  [_, _, "T2", _, "H2", _, "O2", _, "M2", _, "K2"],
  [_, "H3", _, "O3", _, "M3", _, "K3", _, "T3", _],
  [_, _, "H3", _, "O3", _, "M3", _, "K3", _, "T3"],
  [_, "K4", _, "T4", _, "H4", _, "O4", _, "M4", _],
  [_, _, "K4", _, "T4", _, "H4", _, "O4", _, "M4"],
  [_, "T5", _, "H5", _, "O5", _, "M5", _, "K5", _],
  [_, _, "T5", _, "H5", _, "O5", _, "M5", _, "K5"],
  [_, "H6", _, "O6", _, "M6", _, "K6", _, "T6", _],
  [_, _, "H6", _, "O6", _, "M6", _, "K6", _, "T6"],
];

/** Ngũ hành nạp âm: ký tự hành (K/M/T/H/O) hoặc tên bản mệnh đầy đủ. */
export function nguHanhNapAm(chi: number, can: number, xuatBanMenh = false): string {
  const nh = MA_TRAN_NAP_AM[chi]?.[can];
  if (!nh) throw new Error("Không tra được ngũ hành nạp âm (địa chi " + chi + ", thiên can " + can + ")");
  return xuatBanMenh ? BAN_MENH[nh] : nh[0];
}

/** Dịch cung trên địa bàn (1..12). */
export function dichCung(cungBanDau: number, ...args: number[]): number {
  let c = Math.trunc(cungBanDau);
  for (const s of args) c += Math.trunc(s);
  const r = pymod(c, 12);
  return r === 0 ? 12 : r;
}

export function khoangCachCung(cung1: number, cung2: number, chieu = 1): number {
  if (chieu === 1) return pymod(cung1 - cung2 + 12, 12);
  return pymod(cung2 - cung1 + 12, 12);
}

export function timCuc(viTriCungMenhTrenDiaBan: number, canNamSinh: number): string {
  const canThangGieng = pymod(canNamSinh * 2 + 1, 10);
  let canThangMenh = pymod(pymod(viTriCungMenhTrenDiaBan - 3, 12) + canThangGieng, 10);
  if (canThangMenh === 0) canThangMenh = 10;
  return nguHanhNapAm(viTriCungMenhTrenDiaBan, canThangMenh);
}

export function timTuVi(cuc: number, ngaySinhAmLich: number): number {
  let cungDan = 3;
  const cucBanDau = cuc;
  if (![2, 3, 4, 5, 6].includes(cuc)) throw new Error("Số cục phải là 2, 3, 4, 5, 6");
  while (cuc < ngaySinhAmLich) {
    cuc += cucBanDau;
    cungDan += 1;
  }
  let saiLech = cuc - ngaySinhAmLich;
  if (pymod(saiLech, 2) === 1) saiLech = -saiLech;
  return dichCung(cungDan, saiLech);
}

export function timTrangSinh(cucSo: number): number {
  if (cucSo === 6) return 3;
  if (cucSo === 4) return 6;
  if (cucSo === 2 || cucSo === 5) return 9;
  if (cucSo === 3) return 12;
  throw new Error("Không tìm được cung an sao Trường sinh");
}

export function timHoaLinh(chiNamSinh: number, gioSinh: number, gioiTinh: number, amDuongNamSinh: number): [number, number] {
  let khoiHoa: number;
  let khoiLinh: number;
  if ([3, 7, 11].includes(chiNamSinh)) [khoiHoa, khoiLinh] = [2, 4];
  else if ([1, 5, 9].includes(chiNamSinh)) [khoiHoa, khoiLinh] = [3, 11];
  else if ([6, 10, 2].includes(chiNamSinh)) [khoiHoa, khoiLinh] = [11, 4];
  else if ([12, 4, 8].includes(chiNamSinh)) [khoiHoa, khoiLinh] = [10, 11];
  else throw new Error("Không thể khởi cung tìm Hỏa-Linh");

  const k = gioiTinh * amDuongNamSinh;
  if (k === -1) return [dichCung(khoiHoa + 1, -gioSinh), dichCung(khoiLinh - 1, gioSinh)];
  if (k === 1) return [dichCung(khoiHoa - 1, gioSinh), dichCung(khoiLinh + 1, -gioSinh)];
  throw new Error("Không xác định được chiều an Hỏa-Linh");
}

function tra<T>(bang: (T | null)[], i: number, loi: string): T {
  const v = bang[i];
  if (v === undefined || v === null) throw new Error(loi);
  return v;
}

export function timThienKhoi(canNam: number): number {
  return tra([null, 2, 1, 12, 10, 8, 1, 8, 7, 6, 4], canNam, "Không tìm được vị trí Khôi-Việt");
}

export function timThienQuanThienPhuc(canNam: number): [number, number] {
  const thienQuan = [null, 8, 5, 6, 3, 4, 10, 12, 10, 11, 7];
  const thienPhuc = [null, 10, 9, 1, 12, 4, 3, 7, 6, 7, 6];
  return [tra(thienQuan, canNam, "Không tìm được Quan-Phúc"), tra(thienPhuc, canNam, "Không tìm được Quan-Phúc")];
}

export function timCoThan(chiNam: number): number {
  if ([12, 1, 2].includes(chiNam)) return 3;
  if ([3, 4, 5].includes(chiNam)) return 6;
  if ([6, 7, 8].includes(chiNam)) return 9;
  return 12;
}

export function timThienMa(chiNam: number): number {
  return [6, 3, 12, 9][pymod(chiNam, 4)];
}

export function timPhaToai(chiNam: number): number {
  return [6, 10, 2][pymod(chiNam, 3)];
}

export function timTriet(canNam: number): [number, number] {
  if ([1, 6].includes(canNam)) return [9, 10];
  if ([2, 7].includes(canNam)) return [7, 8];
  if ([3, 8].includes(canNam)) return [5, 6];
  if ([4, 9].includes(canNam)) return [3, 4];
  if ([5, 10].includes(canNam)) return [1, 2];
  throw new Error("Không tìm được Triệt");
}

export function timLuuTru(canNam: number): [number, number] {
  const luuHa = [null, 10, 11, 8, 5, 6, 7, 9, 4, 12, 3];
  const thienTru = [null, 6, 7, 1, 6, 7, 9, 3, 7, 10, 11];
  return [tra(luuHa, canNam, "Không tìm được Lưu - Trù"), tra(thienTru, canNam, "Không tìm được Lưu - Trù")];
}
