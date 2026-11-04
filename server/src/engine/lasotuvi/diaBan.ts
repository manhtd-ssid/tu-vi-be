/**
 * Địa bàn 12 cung — port từ lasotuvi/DiaBan.py. (c) 2016 doanguyen, MIT.
 */
import { diaChi, dichCung, khoangCachCung } from "./amDuong.js";
import type { Sao } from "./sao.js";
import dacTinhData from "./dacTinhData.json" with { type: "json" };

const MA_TRAN_DAC_TINH = dacTinhData as Record<string, (string | null)[]>;
const HANH_CUNG = [null, "Thủy", "Thổ", "Mộc", "Mộc", "Thổ", "Hỏa", "Hỏa", "Thổ", "Kim", "Kim", "Thổ", "Thủy"];

export class CungDiaBan {
  cungSo: number;
  hanhCung: string | null;
  cungSao: Sao[] = [];
  cungAmDuong: 1 | -1;
  cungTen: string;
  cungThan = false;
  cungChu: string | null = null;
  cungDaiHan = 0;
  cungTieuHan = "";
  tuanTrung = false;
  trietLo = false;

  constructor(cungID: number) {
    this.cungSo = cungID;
    this.hanhCung = HANH_CUNG[cungID];
    this.cungAmDuong = cungID % 2 === 0 ? -1 : 1;
    this.cungTen = diaChi[cungID].tenChi;
  }

  themSao(sao: Sao): this {
    dacTinhSao(this.cungSo, sao);
    this.cungSao.push(sao);
    return this;
  }

  daiHan(daiHan: number): this {
    this.cungDaiHan = daiHan;
    return this;
  }

  tieuHan(tieuHan: number): this {
    this.cungTieuHan = diaChi[tieuHan + 1].tenChi;
    return this;
  }
}

export class DiaBan {
  thangSinhAmLich: number;
  gioSinhAmLich: number;
  thapNhiCung: CungDiaBan[];
  cungMenh!: number;
  cungThan!: number;
  cungNoboc!: number;
  cungTatAch!: number;

  constructor(thangSinhAmLich: number, gioSinhAmLich: number) {
    this.thangSinhAmLich = thangSinhAmLich;
    this.gioSinhAmLich = gioSinhAmLich;
    this.thapNhiCung = Array.from({ length: 13 }, (_, i) => new CungDiaBan(i));
    this.nhapCungChu();
    this.thapNhiCung[this.cungThan].cungThan = true;
  }

  private cungChu(thang: number, gio: number) {
    this.cungThan = dichCung(3, thang - 1, gio - 1);
    this.cungMenh = dichCung(3, thang - 1, -gio + 1);
    const m = this.cungMenh;
    this.cungNoboc = dichCung(m, 5);
    this.cungTatAch = dichCung(m, 7);
    return [
      { tenCung: "Mệnh", cungSoDiaBan: m },
      { tenCung: "Phụ mẫu", cungSoDiaBan: dichCung(m, 1) },
      { tenCung: "Phúc đức", cungSoDiaBan: dichCung(m, 2) },
      { tenCung: "Điền trạch", cungSoDiaBan: dichCung(m, 3) },
      { tenCung: "Quan lộc", cungSoDiaBan: dichCung(m, 4) },
      { tenCung: "Nô bộc", cungSoDiaBan: this.cungNoboc },
      { tenCung: "Thiên di", cungSoDiaBan: dichCung(m, 6) },
      { tenCung: "Tật Ách", cungSoDiaBan: this.cungTatAch },
      { tenCung: "Tài Bạch", cungSoDiaBan: dichCung(m, 8) },
      { tenCung: "Tử tức", cungSoDiaBan: dichCung(m, 9) },
      { tenCung: "Phu thê", cungSoDiaBan: dichCung(m, 10) },
      { tenCung: "Huynh đệ", cungSoDiaBan: dichCung(m, 11) },
    ];
  }

  private nhapCungChu() {
    for (const c of this.cungChu(this.thangSinhAmLich, this.gioSinhAmLich)) {
      this.thapNhiCung[c.cungSoDiaBan].cungChu = c.tenCung;
    }
  }

  nhapDaiHan(cucSo: number, gioiTinh: number): this {
    for (const cung of this.thapNhiCung) {
      const kc = khoangCachCung(cung.cungSo, this.cungMenh, gioiTinh);
      cung.daiHan(cucSo + kc * 10);
    }
    return this;
  }

  nhapTieuHan(khoiTieuHan: number, gioiTinh: number, chiNam: number): this {
    const viTriCungTy1 = dichCung(khoiTieuHan, -gioiTinh * (chiNam - 1));
    for (const cung of this.thapNhiCung) {
      cung.tieuHan(khoangCachCung(cung.cungSo, viTriCungTy1, gioiTinh));
    }
    return this;
  }

  nhapSao(cungSo: number, ...sao: Sao[]): this {
    for (const s of sao) this.thapNhiCung[cungSo].themSao(s);
    return this;
  }

  nhapTuan(...cung: number[]): this {
    for (const c of cung) this.thapNhiCung[c].tuanTrung = true;
    return this;
  }

  nhapTriet(...cung: number[]): this {
    for (const c of cung) this.thapNhiCung[c].trietLo = true;
    return this;
  }
}

/** Gán miếu/vượng/đắc/bình/hãm theo vị trí địa bàn. */
export function dacTinhSao(viTriDiaBan: number, sao: Sao): void {
  const row = MA_TRAN_DAC_TINH[String(sao.saoID)];
  if (!row) return;
  const v = row[viTriDiaBan];
  if (v && ["M", "V", "Đ", "B", "H"].includes(v)) sao.saoDacTinh = v;
}
