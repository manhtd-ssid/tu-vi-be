/**
 * Mã giảm giá.
 *
 * Một lượt dùng = một đơn có mã đó đang giữ chỗ: đơn đã thanh toán, hoặc đơn đang chờ thanh toán còn hạn.
 * Đơn chờ giữ chỗ để mã giới hạn 100 lần không bị vượt khi nhiều người tạo đơn cùng lúc; đơn hết hạn hoặc
 * bị huỷ thì trả lại chỗ. Đơn đã hoàn tiền không tính (khách được dùng lại mã).
 * Kiểm tra số lượt chạy trong transaction có khoá dòng mã (FOR UPDATE).
 */
import type { Db } from "../db/index.js";
import type { Plan } from "./billing.js";

export interface Coupon {
  code: string;
  kind: "percent" | "amount";
  value: number;
  max_discount: number | null;
  min_amount: number;
  plan_codes: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_user: number;
  active: boolean;
  note: string;
}

export class CouponError extends Error {}

/** Chuẩn hoá mã người dùng gõ: bỏ khoảng trắng, chữ hoa. */
export const chuanHoaMa = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Điều kiện "đang giữ chỗ" của một đơn có mã. */
export const DON_GIU_CHO = "(o.status = 'paid' OR (o.status = 'pending' AND o.expires_at > now()))";

/** Tính số tiền giảm cho một mức giá (không âm, không quá giá). */
export function tinhGiam(c: Pick<Coupon, "kind" | "value" | "max_discount">, price: number): number {
  let giam = c.kind === "percent" ? Math.floor((price * Math.min(c.value, 100)) / 100) : c.value;
  if (c.max_discount) giam = Math.min(giam, c.max_discount);
  return Math.max(0, Math.min(giam, price));
}

export interface KetQuaMa { coupon: Coupon; original: number; discount: number; amount: number }

/**
 * Kiểm tra mã cho (người dùng, gói) và tính giá sau giảm. Ném CouponError với lý do dễ hiểu nếu không dùng được.
 * `boQuaDonId`: không tính đơn này vào số lượt (khi dùng lại chính đơn đang chờ của người dùng).
 */
export async function apDungMa(q: Db["query"], codeRaw: string, userId: number, plan: Plan, khoa = false, boQuaDonId?: number): Promise<KetQuaMa> {
  const code = chuanHoaMa(codeRaw);
  const [c] = await q<Coupon>(`SELECT * FROM coupons WHERE code = $1 ${khoa ? "FOR UPDATE" : ""}`, [code]);
  if (!c || !c.active) throw new CouponError("Mã giảm giá không tồn tại hoặc đã ngừng áp dụng");
  const now = Date.now();
  if (c.starts_at && new Date(c.starts_at).getTime() > now) throw new CouponError("Mã giảm giá chưa đến thời gian áp dụng");
  if (c.ends_at && new Date(c.ends_at).getTime() <= now) throw new CouponError("Mã giảm giá đã hết hạn");
  if (c.plan_codes?.length && !c.plan_codes.includes(plan.code)) throw new CouponError(`Mã này không áp dụng cho gói “${plan.name}”`);
  if (plan.price < c.min_amount) throw new CouponError(`Mã này chỉ áp dụng cho gói từ ${c.min_amount.toLocaleString("vi-VN")}đ`);

  const bo = boQuaDonId ?? 0;
  const [{ tong, cua_ban }] = await q<{ tong: number; cua_ban: number }>(
    `SELECT count(*)::int AS tong, count(*) FILTER (WHERE o.user_id = $2)::int AS cua_ban
     FROM orders o WHERE o.coupon_code = $1 AND ${DON_GIU_CHO} AND o.id <> $3`, [code, userId, bo]);
  if (c.max_uses !== null && tong >= c.max_uses) throw new CouponError("Mã giảm giá đã hết lượt sử dụng");
  if (cua_ban >= c.max_uses_per_user) {
    throw new CouponError(c.max_uses_per_user === 1 ? "Bạn đã dùng mã này rồi" : `Bạn đã dùng mã này ${c.max_uses_per_user} lần`);
  }
  const discount = tinhGiam(c, plan.price);
  return { coupon: c, original: plan.price, discount, amount: plan.price - discount };
}
