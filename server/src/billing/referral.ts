/**
 * Giới thiệu bạn bè.
 *
 * Mỗi người dùng có một mã giới thiệu (sinh khi cần lần đầu). Bạn bè nhập mã này vào ô mã giảm giá (hoặc mở
 * link `?ref=MÃ`) để được giảm giá; khi đơn đó thanh toán xong, người giới thiệu được cộng lượt thưởng
 * (credit_grants.referral_order_id). Đơn bị hoàn tiền → thu hồi phần lượt thưởng chưa dùng.
 *
 * Chống lạm dụng: không dùng mã của chính mình; mỗi người chỉ dùng mã giới thiệu cho một đơn (đơn đang giữ chỗ
 * như mã giảm giá); tuỳ chọn chỉ cho khách chưa từng thanh toán; tuỳ chọn giới hạn số lần thưởng mỗi người.
 * Cấu hình lưu trong app_settings['referral'], admin sửa được.
 */
import { randomInt } from "node:crypto";
import type { Db } from "../db/index.js";
import type { Plan } from "./billing.js";
import { CouponError, DON_GIU_CHO, apDungMa, chuanHoaMa, tinhGiam } from "./coupons.js";

export interface ReferralSettings {
  enabled: boolean;
  /** % giảm cho người được giới thiệu. */
  percent: number;
  max_discount: number | null;
  /** Lượt thưởng cho người giới thiệu mỗi đơn đã thanh toán. */
  reward_credits: number;
  reward_valid_days: number;
  /** Chỉ áp dụng cho khách chưa từng có đơn đã thanh toán. */
  chi_khach_moi: boolean;
  /** Số lần thưởng tối đa cho một người giới thiệu (null = không giới hạn). */
  max_rewards_per_referrer: number | null;
}

export const REFERRAL_DEFAULT: ReferralSettings = {
  enabled: true, percent: 20, max_discount: null, reward_credits: 1, reward_valid_days: 365,
  chi_khach_moi: true, max_rewards_per_referrer: null,
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_PREFIX = "BAN";

export async function caiDatGioiThieu(q: Db["query"]): Promise<ReferralSettings> {
  const [r] = await q<{ value: Partial<ReferralSettings> }>("SELECT value FROM app_settings WHERE key = 'referral'");
  return { ...REFERRAL_DEFAULT, ...(r?.value ?? {}) };
}

/** Mã giới thiệu của người dùng; sinh nếu chưa có (không trùng mã giảm giá nào). */
export async function maGioiThieuCua(q: Db["query"], userId: number): Promise<string> {
  const [u] = await q<{ referral_code: string | null }>("SELECT referral_code FROM users WHERE id = $1", [userId]);
  if (u?.referral_code) return u.referral_code;
  for (let i = 0; i < 10; i++) {
    let code = REFERRAL_PREFIX;
    for (let j = 0; j < 6; j++) code += ALPHABET[randomInt(ALPHABET.length)];
    const [trungMa] = await q("SELECT 1 FROM coupons WHERE code = $1", [code]);
    if (trungMa) continue;
    const rows = await q<{ referral_code: string }>(
      `UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL
         AND NOT EXISTS (SELECT 1 FROM users WHERE referral_code = $2)
       RETURNING referral_code`, [userId, code]);
    if (rows.length) return rows[0].referral_code;
    const [again] = await q<{ referral_code: string | null }>("SELECT referral_code FROM users WHERE id = $1", [userId]);
    if (again?.referral_code) return again.referral_code; // vừa được sinh ở request khác
  }
  throw new Error("Không sinh được mã giới thiệu");
}

export interface KetQuaGiam {
  loai: "coupon" | "referral";
  code: string;
  original: number;
  discount: number;
  amount: number;
  note: string;
  referrer_id?: number;
}

/** Mã là mã giảm giá, mã giới thiệu, hay không có. Mã giảm giá được ưu tiên. */
export async function loaiMa(q: Db["query"], codeRaw: string): Promise<"coupon" | "referral" | null> {
  const code = chuanHoaMa(codeRaw);
  const [c] = await q("SELECT 1 FROM coupons WHERE code = $1", [code]);
  if (c) return "coupon";
  const [u] = await q("SELECT 1 FROM users WHERE referral_code = $1", [code]);
  return u ? "referral" : null;
}

/**
 * Kiểm tra mã (giảm giá hoặc giới thiệu) cho (người dùng, gói). Ném CouponError nếu không dùng được.
 * `khoa`: chạy trong transaction tạo đơn, khoá dòng để không vượt giới hạn khi tạo đơn đồng thời.
 */
export async function apDungMaBatKy(q: Db["query"], codeRaw: string, userId: number, plan: Plan, khoa = false, boQuaDonId?: number): Promise<KetQuaGiam> {
  const code = chuanHoaMa(codeRaw);
  const loai = await loaiMa(q, code);
  if (loai !== "referral") {
    const kq = await apDungMa(q, code, userId, plan, khoa, boQuaDonId);
    return { loai: "coupon", code: kq.coupon.code, original: kq.original, discount: kq.discount, amount: kq.amount, note: kq.coupon.note };
  }
  const cfg = await caiDatGioiThieu(q);
  if (!cfg.enabled) throw new CouponError("Chương trình giới thiệu bạn bè đang tạm dừng");
  const [ref] = await q<{ id: number }>("SELECT id FROM users WHERE referral_code = $1", [code]);
  if (ref.id === userId) throw new CouponError("Bạn không thể dùng mã giới thiệu của chính mình");
  // Khoá dòng người dùng: hai đơn tạo cùng lúc của cùng một người không cùng lọt qua kiểm tra
  if (khoa) await q("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  if (cfg.chi_khach_moi) {
    const [da] = await q("SELECT 1 FROM orders WHERE user_id = $1 AND status IN ('paid', 'refunded') AND amount > 0 LIMIT 1", [userId]);
    if (da) throw new CouponError("Mã giới thiệu chỉ dành cho khách mua lần đầu");
  }
  const [dung] = await q(
    `SELECT 1 FROM orders o WHERE o.user_id = $1 AND o.referrer_id IS NOT NULL AND ${DON_GIU_CHO} AND o.id <> $2 LIMIT 1`,
    [userId, boQuaDonId ?? 0]);
  if (dung) throw new CouponError("Bạn đã dùng mã giới thiệu rồi");
  const discount = tinhGiam({ kind: "percent", value: cfg.percent, max_discount: cfg.max_discount }, plan.price);
  return {
    loai: "referral", code, original: plan.price, discount, amount: plan.price - discount,
    note: `Mã giới thiệu của bạn bè: giảm ${cfg.percent}%`, referrer_id: ref.id,
  };
}

/** Cộng lượt thưởng cho người giới thiệu khi đơn được thanh toán (gọi trong transaction markPaid). */
export async function thuongGioiThieu(q: Db["query"], order: { id: number; code: string; referrer_id?: number | null }): Promise<boolean> {
  if (!order.referrer_id) return false;
  const cfg = await caiDatGioiThieu(q);
  if (cfg.reward_credits < 1) return false;
  if (cfg.max_rewards_per_referrer !== null) {
    const [{ n }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM credit_grants WHERE user_id = $1 AND referral_order_id IS NOT NULL`, [order.referrer_id]);
    if (n >= cfg.max_rewards_per_referrer) return false;
  }
  const rows = await q(
    `INSERT INTO credit_grants (user_id, credits_total, credits_left, expires_at, note, referral_order_id)
     VALUES ($1, $2, $2, now() + make_interval(days => $3), $4, $5)
     ON CONFLICT (referral_order_id) WHERE referral_order_id IS NOT NULL DO NOTHING RETURNING id`,
    [order.referrer_id, cfg.reward_credits, cfg.reward_valid_days, `Thưởng giới thiệu bạn bè (đơn ${order.code})`, order.id]);
  return rows.length > 0;
}

/** Thu hồi lượt thưởng chưa dùng khi đơn của người được giới thiệu bị hoàn tiền. Trả số lượt thu hồi. */
export async function thuHoiThuong(q: Db["query"], orderId: number): Promise<number> {
  const [g] = await q<{ id: number; credits_left: number }>(
    "SELECT id, credits_left FROM credit_grants WHERE referral_order_id = $1 FOR UPDATE", [orderId]);
  if (!g) return 0;
  await q("UPDATE credit_grants SET revoked_credits = revoked_credits + credits_left, credits_left = 0, revoked_at = now() WHERE id = $1", [g.id]);
  return g.credits_left;
}
