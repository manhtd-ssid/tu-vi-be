/**
 * Danh mục sao — port từ lasotuvi/Sao.py. (c) 2016 doanguyen, MIT.
 *
 * Bản Python giữ mỗi sao là một singleton cấp module rồi append thẳng `__dict__`
 * vào cung, nên đặc tính (miếu/hãm) của lá số trước rò sang lá số sau. Ở đây mỗi
 * lá số tạo bản sao mới (`taoSao`) nên không cần khoá hay reset.
 * Dữ liệu `saoData.json` sinh trực tiếp từ Sao.py để giữ nguyên từng ký tự tên sao.
 */
import saoData from "./saoData.json" with { type: "json" };

export interface Sao {
  saoID: number;
  saoTen: string;
  saoNguHanh: string;
  saoLoai: number;
  saoPhuongVi: string;
  saoAmDuong: number | string;
  vongTrangSinh: number;
  cssSao: string;
  saoDacTinh: string | null;
}

export type TenSao = keyof typeof saoData;

export function taoSao(ten: TenSao): Sao {
  return { ...(saoData[ten] as Omit<Sao, "saoDacTinh">), saoDacTinh: null };
}
