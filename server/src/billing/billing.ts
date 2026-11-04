/**
 * Thanh toán & lượt luận giải AI.
 *
 * Luồng mua: người dùng chọn gói → tạo đơn (mã TUVIxxxxxxxx) → chuyển khoản qua VietQR của SePay
 * với nội dung là mã đơn → SePay gọi webhook → khớp đơn, cộng lượt (credit_grants).
 * Luồng dùng: mở khoá luận giải AI cho một lá số tốn 1 lượt; báo cáo được lưu (unlocked_reports)
 * nên đọc lại không tốn lượt và không gọi LLM lần nữa.
 */
import { randomInt } from "node:crypto";
import type { Db } from "../db/index.js";
import { apDungMa, chuanHoaMa } from "./coupons.js";

export const ORDER_PREFIX = () => (process.env.ORDER_PREFIX || "TUVI").toUpperCase();
const ORDER_TTL_MIN = () => Number(process.env.ORDER_EXPIRES_MIN || 30);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ 0/O, 1/I để khách khỏi gõ nhầm

export interface Plan {
  code: string; name: string; description: string; price: number; credits: number;
  valid_days: number; active: boolean; sort: number;
}

export interface Order {
  id: number; code: string; user_id: number; plan_code: string; amount: number; credits: number;
  valid_days: number; status: "pending" | "paid" | "cancelled" | "refunded"; created_at: string; expires_at: string;
  paid_at: string | null; paid_by: string | null; note: string;
  refunded_at?: string | null; refund_amount?: number | null; refund_note?: string | null;
  original_amount?: number | null; discount_amount?: number; coupon_code?: string | null;
}

export function newOrderCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return ORDER_PREFIX() + s;
}

/** Tìm mã đơn trong nội dung chuyển khoản (ngân hàng có thể đổi hoa/thường, chèn ký tự khác). */
export function findOrderCode(...texts: (string | null | undefined)[]): string | null {
  const re = new RegExp(`${ORDER_PREFIX()}[A-Z0-9]{8}`);
  for (const t of texts) {
    const m = (t ?? "").toUpperCase().match(re);
    if (m) return m[0];
  }
  return null;
}

export interface PaymentInfo {
  bank: string;
  account_number: string;
  account_name: string;
  amount: number;
  content: string;
  qr_url: string;
}

export function paymentInfo(order: Pick<Order, "code" | "amount">): PaymentInfo {
  const bank = process.env.SEPAY_BANK || "";
  const acc = process.env.SEPAY_ACCOUNT_NUMBER || "";
  const q = new URLSearchParams({ acc, bank, amount: String(order.amount), des: order.code, template: "compact" });
  return {
    bank, account_number: acc, account_name: process.env.SEPAY_ACCOUNT_NAME || "",
    amount: order.amount, content: order.code, qr_url: `https://qr.sepay.vn/img?${q}`,
  };
}

export const billingConfigured = () => Boolean(process.env.SEPAY_BANK && process.env.SEPAY_ACCOUNT_NUMBER);

const ORDER_COLS = "id, code, user_id, plan_code, amount, credits, valid_days, status, created_at, expires_at, paid_at, paid_by, note, refunded_at, refund_amount, original_amount, discount_amount, coupon_code";

export class Billing {
  constructor(private db: Db) {}

  plans(all = false): Promise<Plan[]> {
    return this.db.query<Plan>(`SELECT code, name, description, price, credits, valid_days, active, sort FROM plans
      ${all ? "" : "WHERE active"} ORDER BY sort, price`);
  }

  /**
   * Tạo đơn (có thể kèm mã giảm giá). Nếu người dùng đã có đơn chờ cùng gói, cùng mã, cùng giá thì dùng lại
   * (tránh tạo trùng khi tải lại trang). Mã giảm 100% → đơn 0đ được coi là đã thanh toán ngay.
   * Ném CouponError nếu mã không dùng được.
   */
  async createOrder(userId: number, planCode: string, couponCode?: string | null): Promise<Order | null> {
    return this.db.tx(async (q) => {
      const [plan] = await q<Plan>("SELECT * FROM plans WHERE code = $1 AND active", [planCode]);
      if (!plan) return null;
      const ma = couponCode ? chuanHoaMa(couponCode) : null;
      const [reuse] = await q<Order>(
        `SELECT ${ORDER_COLS} FROM orders WHERE user_id = $1 AND plan_code = $2 AND status = 'pending'
         AND expires_at > now() + interval '5 minutes' AND coupon_code IS NOT DISTINCT FROM $3
         AND original_amount = $4 ORDER BY id DESC LIMIT 1`, [userId, planCode, ma, plan.price]);
      // Có mã: kiểm tra lại (mã có thể vừa bị tắt/hết hạn); đơn đang giữ chỗ của chính người này không tính.
      const kq = ma ? await apDungMa(q, ma, userId, plan, true, reuse?.id) : null;
      const amount = kq ? kq.amount : plan.price;
      if (reuse && reuse.amount === amount) return reuse;
      for (let attempt = 0; attempt < 5; attempt++) {
        const rows = await q<Order>(
          `INSERT INTO orders (code, user_id, plan_code, amount, credits, valid_days, expires_at, original_amount, discount_amount, coupon_code)
           VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7), $8, $9, $10)
           ON CONFLICT (code) DO NOTHING RETURNING ${ORDER_COLS}`,
          [newOrderCode(), userId, plan.code, amount, plan.credits, plan.valid_days, ORDER_TTL_MIN(), plan.price, kq?.discount ?? 0, ma]);
        if (!rows.length) continue;
        if (amount > 0) return rows[0];
        // Đơn 0đ (mã giảm 100%): không cần chuyển khoản
        await this.markPaid(rows[0].id, `coupon:${ma}`, q);
        const [paid] = await q<Order>(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [rows[0].id]);
        return paid;
      }
      throw new Error("Không sinh được mã đơn");
    });
  }

  async order(id: number, userId?: number): Promise<Order | undefined> {
    const [o] = await this.db.query<Order>(
      `SELECT ${ORDER_COLS} FROM orders WHERE id = $1 ${userId !== undefined ? "AND user_id = $2" : ""}`,
      userId !== undefined ? [id, userId] : [id]);
    return o;
  }

  ordersOf(userId: number): Promise<Order[]> {
    return this.db.query<Order>(`SELECT ${ORDER_COLS} FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, [userId]);
  }

  /** Đánh dấu đã thanh toán + cộng lượt, trong một transaction. Trả false nếu đơn không còn ở trạng thái chờ. */
  async markPaid(orderId: number, paidBy: string, q: Db["query"]): Promise<boolean> {
    const rows = await q<Order>(
      `UPDATE orders SET status = 'paid', paid_at = now(), paid_by = $2
       WHERE id = $1 AND status = 'pending' RETURNING ${ORDER_COLS}`, [orderId, paidBy]);
    if (!rows.length) return false;
    const o = rows[0];
    await q(
      `INSERT INTO credit_grants (user_id, order_id, credits_total, credits_left, expires_at, note)
       VALUES ($1, $2, $3, $3, now() + make_interval(days => $4), $5)`,
      [o.user_id, o.id, o.credits, o.valid_days, `Đơn ${o.code}`]);
    return true;
  }

  /** Cộng lượt thủ công (admin bù, khuyến mãi). */
  async grant(userId: number, credits: number, days: number, note: string, adminId: number) {
    const [g] = await this.db.query(
      `INSERT INTO credit_grants (user_id, credits_total, credits_left, expires_at, note, created_by)
       VALUES ($1, $2, $2, now() + make_interval(days => $3), $4, $5) RETURNING *`, [userId, credits, days, note, adminId]);
    return g;
  }

  async credits(userId: number) {
    const grants = await this.db.query<{ id: number; credits_total: number; credits_left: number; revoked_credits: number; expires_at: string; note: string; created_at: string }>(
      `SELECT id, credits_total, credits_left, revoked_credits, expires_at, note, created_at FROM credit_grants
       WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    const now = Date.now();
    const left = grants.filter((g) => new Date(g.expires_at).getTime() > now).reduce((a, g) => a + g.credits_left, 0);
    const [{ n }] = await this.db.query<{ n: number }>("SELECT count(*)::int AS n FROM unlocked_reports WHERE user_id = $1", [userId]);
    return { credits_left: left, unlocked_reports: n, grants };
  }

  async unlocked(userId: number, chartKey: string) {
    const [r] = await this.db.query<{ report: any; sections: any; created_at: string }>(
      "SELECT report, sections, created_at FROM unlocked_reports WHERE user_id = $1 AND chart_key = $2", [userId, chartKey]);
    return r;
  }

  /**
   * Lưu báo cáo đã mở khoá và trừ 1 lượt (lô sắp hết hạn trước). Chạy trong transaction:
   * nếu lá số đã được mở khoá (bấm hai lần) hoặc hết lượt thì không trừ gì.
   */
  async unlock(userId: number, chartKey: string, input: unknown, report: unknown, sections: unknown):
    Promise<"ok" | "da_mo_khoa" | "het_luot"> {
    return this.db.tx(async (q) => {
      const [g] = await q<{ id: number }>(
        `SELECT id FROM credit_grants WHERE user_id = $1 AND credits_left > 0 AND expires_at > now()
         ORDER BY expires_at, id LIMIT 1 FOR UPDATE`, [userId]);
      if (!g) return "het_luot";
      const ins = await q(
        `INSERT INTO unlocked_reports (user_id, chart_key, input, grant_id, report, sections)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, chart_key) DO NOTHING RETURNING id`,
        [userId, chartKey, JSON.stringify(input), g.id, JSON.stringify(report), JSON.stringify(sections)]);
      if (!ins.length) return "da_mo_khoa";
      await q("UPDATE credit_grants SET credits_left = credits_left - 1 WHERE id = $1", [g.id]);
      return "ok";
    });
  }
}
