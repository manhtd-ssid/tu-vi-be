/**
 * Bảng Tứ Hóa theo Thiên can — port từ src/tu_hoa.py.
 * Trường phái Việt (lasotuvi, cụ Thiên Lương). Khác bảng Trung Châu của ziwei-doushu:
 *   Canh: Khoa Thiên đồng, Kỵ Thái âm; Nhâm: Khoa Thiên phủ.
 */
export const LOAI_HOA = ["Lộc", "Quyền", "Khoa", "Kỵ"] as const;
export type LoaiHoa = (typeof LOAI_HOA)[number];

// index 1..10 = Giáp..Quý → [Lộc, Quyền, Khoa, Kỵ]
const BANG: (string[] | null)[] = [
  null,
  ["Liêm trinh", "Phá quân", "Vũ khúc", "Thái Dương"],
  ["Thiên cơ", "Thiên lương", "Tử vi", "Thái âm"],
  ["Thiên đồng", "Thiên cơ", "Văn xương", "Liêm trinh"],
  ["Thái âm", "Thiên đồng", "Thiên cơ", "Cự môn"],
  ["Tham lang", "Thái âm", "Hữu bật", "Thiên cơ"],
  ["Vũ khúc", "Tham lang", "Thiên lương", "Văn Khúc"],
  ["Thái Dương", "Vũ khúc", "Thiên đồng", "Thái âm"],
  ["Cự môn", "Thái Dương", "Văn Khúc", "Văn xương"],
  ["Thiên lương", "Tử vi", "Thiên phủ", "Vũ khúc"],
  ["Phá quân", "Cự môn", "Thái âm", "Tham lang"],
];

export function bangTuHoa(can: number): string[] {
  return [...(BANG[can] as string[])];
}

export function tuHoaTheoCan(can: number): Record<LoaiHoa, string> {
  const b = BANG[can] as string[];
  return { "Lộc": b[0], "Quyền": b[1], "Khoa": b[2], "Kỵ": b[3] };
}
