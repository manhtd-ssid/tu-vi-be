/** Schema đầu vào API (zod) — tương ứng các model pydantic trong src/service/api.py. */
import { z } from "zod";
import { KINH_DO_TINH } from "../engine/thoiGian.js";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const birthFields = {
  ngay: int(1, 31),
  thang: int(1, 12),
  nam: int(1800, 2199),
  gioi_tinh: z.union([z.literal(1), z.literal(-1)]),
  /** Giờ âm 1=Tý..12=Hợi */
  gio_sinh: int(1, 12).nullable().default(null),
  /** Giờ đồng hồ 0..23, thay cho gio_sinh */
  gio: int(0, 23).nullable().default(null),
  phut: int(0, 59).default(0),
  duong_lich: z.boolean().default(true),
  thang_nhuan: z.boolean().default(false),
  /** Nơi sinh, tra kinh độ để tính Chân Thái Dương */
  tinh: z.string().nullable().default(null),
  kinh_do: z.number().min(-180).max(180).nullable().default(null),
  utc_offset_phut: z.number().int().default(420),
  quy_tac_ty: z.enum(["ngay_sau", "ngay_hien_tai"]).default("ngay_sau"),
  nhuan_policy: z.enum(["thang_nay", "chia_doi"]).default("thang_nay"),
};

type BirthLike = { gio_sinh: number | null; gio: number | null; tinh: string | null; duong_lich: boolean; kinh_do: number | null };

function kiemTra(b: BirthLike, ctx: z.RefinementCtx) {
  if ((b.gio_sinh === null) === (b.gio === null)) {
    ctx.addIssue({ code: "custom", message: "Cần đúng một trong hai: gio_sinh hoặc gio" });
  } else if (b.tinh && !(b.tinh in KINH_DO_TINH)) {
    ctx.addIssue({ code: "custom", message: "Tỉnh không có trong danh sách, xem GET /v1/meta" });
  } else if (!b.duong_lich && (b.tinh || b.kinh_do !== null)) {
    ctx.addIssue({ code: "custom", message: "Chân Thái Dương chỉ áp dụng khi nhập dương lịch" });
  }
}

export const BirthInput = z.object(birthFields).superRefine(kiemTra);
export const YearInput = z.object({ ...birthFields, nam_xem: int(1800, 2300) }).superRefine(kiemTra);
export const ReportInput = z.object({ ...birthFields, use_llm: z.boolean().default(false) }).superRefine(kiemTra);
export const InterpretInput = z.object({ ...birthFields, cung: z.string() }).superRefine(kiemTra);

export type BirthInput = z.infer<typeof BirthInput>;

/** Chỉ các trường ảnh hưởng tới lá số (dùng làm khoá cache). */
export const BIRTH_KEYS = Object.keys(birthFields).sort() as (keyof BirthInput)[];
