/**
 * Lập địa bàn (an toàn bộ sao) — port từ lasotuvi/App.py. (c) 2016 doanguyen, MIT.
 * Thứ tự gọi nhapSao giữ đúng bản gốc vì thứ tự sao trong cung là một phần của output.
 */
import {
  diaChi, dichCung, ngayThangNam, ngayThangNamCanChi, nguHanh, thienCan, timCoThan, timCuc,
  timHoaLinh, timLuuTru, timPhaToai, timThienKhoi, timThienMa, timThienQuanThienPhuc,
  timTrangSinh, timTriet, timTuVi,
} from "./amDuong.js";
import { DiaBan } from "./diaBan.js";
import { taoSao as s } from "./sao.js";

export function lapDiaBan(
  nn: number,
  tt: number,
  nnnn: number,
  gioSinh: number,
  gioiTinh: number,
  duongLich: boolean,
  timeZone: number,
): DiaBan {
  if (duongLich) [nn, tt, nnnn] = ngayThangNam(nn, tt, nnnn, duongLich, timeZone);
  const [, canNam, chiNam] = ngayThangNamCanChi(nn, tt, nnnn, false, timeZone);

  const db = new DiaBan(tt, gioSinh);
  const amDuongNamSinh = thienCan[canNam].amDuong as number;
  const amDuongChiNamSinh = diaChi[chiNam].amDuong;

  const cucSo = nguHanh(timCuc(db.cungMenh, canNam)).cuc;
  db.nhapDaiHan(cucSo, gioiTinh * amDuongChiNamSinh);

  const khoiHan = dichCung(11, -3 * (chiNam - 1));
  db.nhapTieuHan(khoiHan, gioiTinh, chiNam);

  // Tử vi tinh hệ
  const viTriTuVi = timTuVi(cucSo, nn);
  db.nhapSao(viTriTuVi, s("saoTuVi"));
  const viTriLiemTrinh = dichCung(viTriTuVi, 4);
  db.nhapSao(viTriLiemTrinh, s("saoLiemTrinh"));
  const viTriThienDong = dichCung(viTriTuVi, 7);
  db.nhapSao(viTriThienDong, s("saoThienDong"));
  const viTriVuKhuc = dichCung(viTriTuVi, 8);
  db.nhapSao(viTriVuKhuc, s("saoVuKhuc"));
  const viTriThaiDuong = dichCung(viTriTuVi, 9);
  db.nhapSao(viTriThaiDuong, s("saoThaiDuong"));
  const viTriThienCo = dichCung(viTriTuVi, 11);
  db.nhapSao(viTriThienCo, s("saoThienCo"));

  // Thiên phủ tinh hệ
  const viTriThienPhu = dichCung(3, 3 - viTriTuVi);
  db.nhapSao(viTriThienPhu, s("saoThienPhu"));
  const viTriThaiAm = dichCung(viTriThienPhu, 1);
  db.nhapSao(viTriThaiAm, s("saoThaiAm"));
  const viTriThamLang = dichCung(viTriThienPhu, 2);
  db.nhapSao(viTriThamLang, s("saoThamLang"));
  const viTriCuMon = dichCung(viTriThienPhu, 3);
  db.nhapSao(viTriCuMon, s("saoCuMon"));
  const viTriThienTuong = dichCung(viTriThienPhu, 4);
  db.nhapSao(viTriThienTuong, s("saoThienTuong"));
  const viTriThienLuong = dichCung(viTriThienPhu, 5);
  db.nhapSao(viTriThienLuong, s("saoThienLuong"));
  const viTriThatSat = dichCung(viTriThienPhu, 6);
  db.nhapSao(viTriThatSat, s("saoThatSat"));
  const viTriPhaQuan = dichCung(viTriThienPhu, 10);
  db.nhapSao(viTriPhaQuan, s("saoPhaQuan"));

  // Vòng Lộc tồn (Bác sỹ cùng cung Lộc tồn)
  const viTriLocTon = thienCan[canNam].vitriDiaBan as number;
  db.nhapSao(viTriLocTon, s("saoLocTon"), s("saoBacSy"));
  const amDuongNamNu = gioiTinh * amDuongNamSinh;
  const vongLocTon = [
    "saoLucSi", "saoThanhLong", "saoTieuHao", "saoTuongQuan", "saoTauThu", "saoPhiLiem",
    "saoHyThan", "saoBenhPhu", "saoDaiHao", "saoPhucBinh", "saoQuanPhu2",
  ] as const;
  vongLocTon.forEach((ten, i) => db.nhapSao(dichCung(viTriLocTon, (i + 1) * amDuongNamNu), s(ten)));

  // Vòng Địa chi - Thái tuế
  const viTriThaiTue = chiNam;
  db.nhapSao(viTriThaiTue, s("saoThaiTue"));
  db.nhapSao(dichCung(viTriThaiTue, 1), s("saoThieuDuong"), s("saoThienKhong"));
  db.nhapSao(dichCung(viTriThaiTue, 2), s("saoTangMon"));
  db.nhapSao(dichCung(viTriThaiTue, 3), s("saoThieuAm"));
  db.nhapSao(dichCung(viTriThaiTue, 4), s("saoQuanPhu3"));
  db.nhapSao(dichCung(viTriThaiTue, 5), s("saoTuPhu"), s("saoNguyetDuc"));
  db.nhapSao(dichCung(viTriThaiTue, 6), s("saoTuePha"));
  db.nhapSao(dichCung(viTriThaiTue, 7), s("saoLongDuc"));
  db.nhapSao(dichCung(viTriThaiTue, 8), s("saoBachHo"));
  db.nhapSao(dichCung(viTriThaiTue, 9), s("saoPhucDuc"), s("saoThienDuc"));
  db.nhapSao(dichCung(viTriThaiTue, 10), s("saoDieuKhach"));
  db.nhapSao(dichCung(viTriThaiTue, 11), s("saoTrucPhu"));

  // Vòng Tràng sinh: Dương nam, Âm nữ thuận; Âm nam, Dương nữ nghịch
  const viTriTrangSinh = timTrangSinh(cucSo);
  db.nhapSao(viTriTrangSinh, s("saoTrangSinh"));
  const vongTrangSinh = [
    "saoMocDuc", "saoQuanDoi", "saoLamQuan", "saoDeVuong", "saoSuy", "saoBenh", "saoTu", "saoMo", "saoTuyet",
  ] as const;
  vongTrangSinh.forEach((ten, i) => db.nhapSao(dichCung(viTriTrangSinh, amDuongNamNu * (i + 1)), s(ten)));
  db.nhapSao(dichCung(viTriTrangSinh, amDuongNamNu * -1), s("saoThai"));
  db.nhapSao(dichCung(viTriTrangSinh, amDuongNamNu * -2), s("saoDuong"));

  // Kình dương - Đà la
  db.nhapSao(dichCung(viTriLocTon, -1), s("saoDaLa"));
  const viTriKinhDuong = dichCung(viTriLocTon, 1);
  db.nhapSao(viTriKinhDuong, s("saoKinhDuong"));

  // Không - Kiếp: khởi giờ Tý ở Hợi, đếm thuận đến giờ sinh là Địa kiếp
  const viTriDiaKiep = dichCung(11, gioSinh);
  db.nhapSao(viTriDiaKiep, s("saoDiaKiep"));
  db.nhapSao(dichCung(12, 12 - viTriDiaKiep), s("saoDiaKhong"));

  const [viTriHoaTinh, viTriLinhTinh] = timHoaLinh(chiNam, gioSinh, gioiTinh, amDuongNamSinh);
  db.nhapSao(viTriHoaTinh, s("saoHoaTinh"));
  db.nhapSao(viTriLinhTinh, s("saoLinhTinh"));

  const viTriLongTri = dichCung(5, chiNam - 1);
  db.nhapSao(viTriLongTri, s("saoLongTri"));
  db.nhapSao(dichCung(2, 2 - viTriLongTri), s("saoPhuongCac"), s("saoGiaiThan"));

  const viTriTaPhu = dichCung(5, tt - 1);
  db.nhapSao(viTriTaPhu, s("saoTaPhu"));
  const viTriHuuBat = dichCung(2, 2 - viTriTaPhu);
  db.nhapSao(viTriHuuBat, s("saoHuuBat"));

  const viTriVanKhuc = dichCung(5, gioSinh - 1);
  db.nhapSao(viTriVanKhuc, s("saoVanKhuc"));
  const viTriVanXuong = dichCung(2, 2 - viTriVanKhuc);
  db.nhapSao(viTriVanXuong, s("saoVanXuong"));

  const viTriTamThai = dichCung(5, tt + nn - 2);
  db.nhapSao(viTriTamThai, s("saoTamThai"));
  db.nhapSao(dichCung(2, 2 - viTriTamThai), s("saoBatToa"));

  // Ân quang - Thiên quý theo Xương - Khúc
  const viTriAnQuang = dichCung(viTriVanXuong, nn - 2);
  db.nhapSao(viTriAnQuang, s("saoAnQuang"));
  db.nhapSao(dichCung(2, 2 - viTriAnQuang), s("saoThienQuy"));

  const viTriThienKhoi = timThienKhoi(canNam);
  db.nhapSao(viTriThienKhoi, s("saoThienKhoi"));
  db.nhapSao(dichCung(5, 5 - viTriThienKhoi), s("saoThienViet"));

  db.nhapSao(dichCung(7, chiNam - 1), s("saoThienHu"));
  db.nhapSao(dichCung(7, -chiNam + 1), s("saoThienKhoc"));
  db.nhapSao(dichCung(db.cungMenh, chiNam - 1), s("saoThienTai"));
  db.nhapSao(dichCung(db.cungThan, chiNam - 1), s("saoThienTho"));

  const viTriHongLoan = dichCung(4, -chiNam + 1);
  db.nhapSao(viTriHongLoan, s("saoHongLoan"));
  db.nhapSao(dichCung(viTriHongLoan, 6), s("saoThienHy"));

  const [viTriThienQuan, viTriThienPhuc] = timThienQuanThienPhuc(canNam);
  db.nhapSao(viTriThienQuan, s("saoThienQuan"));
  db.nhapSao(viTriThienPhuc, s("saoThienPhuc"));

  const viTriThienHinh = dichCung(10, tt - 1);
  db.nhapSao(viTriThienHinh, s("saoThienHinh"));
  db.nhapSao(dichCung(viTriThienHinh, 4), s("saoThienRieu"), s("saoThienY"));

  const viTriCoThan = timCoThan(chiNam);
  db.nhapSao(viTriCoThan, s("saoCoThan"));
  db.nhapSao(dichCung(viTriCoThan, -4), s("saoQuaTu"));

  const viTriVanTinh = dichCung(viTriKinhDuong, 2);
  db.nhapSao(viTriVanTinh, s("saoVanTinh"));
  const viTriDuongPhu = dichCung(viTriVanTinh, 2);
  db.nhapSao(viTriDuongPhu, s("saoDuongPhu"));
  db.nhapSao(dichCung(viTriDuongPhu, 3), s("saoQuocAn"));

  db.nhapSao(dichCung(viTriVanKhuc, 2), s("saoThaiPhu"));
  db.nhapSao(dichCung(viTriVanKhuc, -2), s("saoPhongCao"));

  db.nhapSao(dichCung(9, 2 * tt - 2), s("saoThienGiai"));
  db.nhapSao(dichCung(viTriTaPhu, 3), s("saoDiaGiai"));

  db.nhapSao(5, s("saoThienLa"));
  db.nhapSao(11, s("saoDiaVong"));
  db.nhapSao(db.cungNoboc, s("saoThienThuong"));
  db.nhapSao(db.cungTatAch, s("saoThienSu"));

  // Vòng Thiên mã
  const viTriThienMa = timThienMa(chiNam);
  db.nhapSao(viTriThienMa, s("saoThienMa"));
  db.nhapSao(dichCung(viTriThienMa, 2), s("saoHoaCai"));
  const viTriKiepSat = dichCung(viTriThienMa, 3);
  db.nhapSao(viTriKiepSat, s("saoKiepSat"));
  db.nhapSao(dichCung(viTriKiepSat, 4), s("saoDaoHoa"));

  db.nhapSao(timPhaToai(chiNam), s("saoPhaToai"));
  db.nhapSao(dichCung(chiNam, -tt + gioSinh), s("saoDauQuan"));

  // Tứ Hóa (10 câu của cụ Thiên Lương) — [Lộc, Quyền, Khoa, Kỵ]
  const tuHoa: Record<number, [number, number, number, number]> = {
    1: [viTriLiemTrinh, viTriPhaQuan, viTriVuKhuc, viTriThaiDuong],
    2: [viTriThienCo, viTriThienLuong, viTriTuVi, viTriThaiAm],
    3: [viTriThienDong, viTriThienCo, viTriVanXuong, viTriLiemTrinh],
    4: [viTriThaiAm, viTriThienDong, viTriThienCo, viTriCuMon],
    5: [viTriThamLang, viTriThaiAm, viTriHuuBat, viTriThienCo],
    6: [viTriVuKhuc, viTriThamLang, viTriThienLuong, viTriVanKhuc],
    7: [viTriThaiDuong, viTriVuKhuc, viTriThienDong, viTriThaiAm],
    8: [viTriCuMon, viTriThaiDuong, viTriVanKhuc, viTriVanXuong],
    9: [viTriThienLuong, viTriTuVi, viTriThienPhu, viTriVuKhuc],
    10: [viTriPhaQuan, viTriCuMon, viTriThaiAm, viTriThamLang],
  };
  const [loc, quyen, khoa, ky] = tuHoa[canNam];
  db.nhapSao(loc, s("saoHoaLoc"));
  db.nhapSao(quyen, s("saoHoaQuyen"));
  db.nhapSao(khoa, s("saoHoaKhoa"));
  db.nhapSao(ky, s("saoHoaKy"));

  const [viTriLuuHa, viTriThienTru] = timLuuTru(canNam);
  db.nhapSao(viTriLuuHa, s("saoLuuHa"));
  db.nhapSao(viTriThienTru, s("saoThienTru"));

  // Tuần, Triệt
  const ketThucTuan = dichCung(chiNam, 10 - canNam);
  const viTriTuan1 = dichCung(ketThucTuan, 1);
  db.nhapTuan(viTriTuan1, dichCung(viTriTuan1, 1));
  db.nhapTriet(...timTriet(canNam));
  return db;
}
