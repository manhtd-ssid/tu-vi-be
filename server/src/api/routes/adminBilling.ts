/**
 * API quản trị thanh toán: gói, đơn hàng (xác nhận tay, huỷ, hoàn tiền), giao dịch SePay, cộng lượt thủ công.
 * Mọi thao tác ghi dữ liệu đều ghi nhật ký admin_audit trong cùng transaction.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ghiNhatKy } from "../../admin/audit.js";
import type { Order } from "../../billing/billing.js";
import { refundNotice } from "../../email/templates.js";
import { HttpError, Paging, parse, requireAdmin } from "../http.js";
import { guiBienNhan } from "./billing.js";

const sec = { tags: ["admin"], security: [{ bearer: [] }] };
const IdParam = z.object({ id: z.coerce.number().int().positive() });
const PlanBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(""),
  price: z.number().int().min(1000).max(100_000_000),
  credits: z.number().int().min(1).max(10_000),
  valid_days: z.number().int().min(1).max(3650),
  active: z.boolean(),
  sort: z.number().int().default(0),
});
const PLAN_COLS = "code, name, description, price, credits, valid_days, active, sort";
/** Giao dịch cần admin xem: không khớp đơn và chưa được đánh dấu đã xử lý. */
const CAN_XEM = "t.match_status NOT IN ('khop', 'tien_ra') AND t.resolved_at IS NULL";

export async function adminBillingRoutes(app: FastifyInstance) {
  const db = app.db;
  const billing = app.billing;
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/admin/")) await requireAdmin(req);
  });

  app.get("/admin/billing/stats", { schema: sec }, async () => {
    // Doanh thu thực = tiền đơn đã trả − phần đã hoàn.
    const thucThu = "CASE WHEN status = 'refunded' THEN amount - coalesce(refund_amount, 0) ELSE amount END";
    const [r] = await db.query(`SELECT
      (SELECT coalesce(sum(${thucThu}), 0)::bigint FROM orders WHERE status IN ('paid', 'refunded')) AS doanh_thu,
      (SELECT coalesce(sum(${thucThu}), 0)::bigint FROM orders WHERE status IN ('paid', 'refunded') AND paid_at > now() - interval '30 days') AS doanh_thu_30d,
      (SELECT coalesce(sum(refund_amount), 0)::bigint FROM orders WHERE status = 'refunded') AS da_hoan,
      (SELECT count(*)::int FROM orders WHERE status = 'paid') AS don_da_tra,
      (SELECT count(*)::int FROM orders WHERE status = 'refunded') AS don_da_hoan,
      (SELECT count(*)::int FROM orders WHERE status = 'pending' AND expires_at > now()) AS don_dang_cho,
      (SELECT coalesce(sum(credits_total - credits_left - revoked_credits), 0)::int FROM credit_grants) AS luot_da_dung,
      (SELECT count(*)::int FROM payment_transactions t WHERE ${CAN_XEM}) AS giao_dich_can_xem,
      (SELECT coalesce(sum(cost_usd), 0) FROM luan_giai_logs
         WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS chi_phi_llm_hom_nay,
      (SELECT coalesce(sum(cost_usd), 0) FROM luan_giai_logs WHERE created_at > now() - interval '30 days') AS chi_phi_llm_30d,
      (SELECT count(*)::int FROM unlocked_reports WHERE created_at > now() - interval '30 days') AS mo_khoa_30d`);
    const chi30 = Number(r.chi_phi_llm_30d);
    return {
      ...r, doanh_thu: Number(r.doanh_thu), doanh_thu_30d: Number(r.doanh_thu_30d), da_hoan: Number(r.da_hoan),
      chi_phi_llm_hom_nay: Number(r.chi_phi_llm_hom_nay), chi_phi_llm_30d: chi30,
      chi_phi_moi_lan_mo_khoa_30d: r.mo_khoa_30d ? chi30 / r.mo_khoa_30d : null,
      ngan_sach_llm_ngay: Number(process.env.LLM_DAILY_BUDGET_USD || 0) || null,
    };
  });

  // ---- Gói ----
  app.get("/admin/plans", { schema: sec }, async () => ({ items: await billing.plans(true) }));

  app.put("/admin/plans/:code", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/, "Mã gói chỉ gồm A-Z, 0-9, _") }), req.params, "path");
    const b = parse(PlanBody, req.body);
    // Đơn đã tạo giữ nguyên giá/lượt lúc tạo (lưu trong orders), sửa gói chỉ áp dụng cho đơn mới.
    return db.tx(async (q) => {
      const [truoc] = await q(`SELECT ${PLAN_COLS} FROM plans WHERE code = $1 FOR UPDATE`, [code]);
      const [p] = await q(
        `INSERT INTO plans (code, name, description, price, credits, valid_days, active, sort, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (code) DO UPDATE SET name = $2, description = $3, price = $4, credits = $5, valid_days = $6,
           active = $7, sort = $8, updated_at = now()
         RETURNING ${PLAN_COLS}`,
        [code, b.name, b.description, b.price, b.credits, b.valid_days, b.active, b.sort]);
      await ghiNhatKy(q, req, me, { action: truoc ? "plan.update" : "plan.create", target_type: "plan", target_id: code, before: truoc, after: p });
      return p;
    });
  });

  // ---- Đơn hàng ----
  app.get("/admin/orders", { schema: sec }, async (req) => {
    const { limit, offset, status, q } = parse(Paging.extend({
      status: z.enum(["pending", "paid", "cancelled", "refunded"]).optional(), q: z.string().trim().max(200).default(""),
    }), req.query, "query");
    const cond: string[] = [];
    const params: unknown[] = [];
    if (status) { params.push(status); cond.push(`o.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); cond.push(`(o.code ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const items = await db.query(
      `SELECT o.*, u.email AS user_email,
              g.credits_total, g.credits_left, g.revoked_credits
       FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN credit_grants g ON g.order_id = o.id ${where}
       ORDER BY o.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM orders o JOIN users u ON u.id = o.user_id ${where}`, params);
    return { items, total };
  });

  /** Xác nhận đã nhận tiền bằng tay (khách ghi sai nội dung, chuyển thiếu rồi bù...). */
  app.post("/admin/orders/:id/mark-paid", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { id } = parse(IdParam, req.params, "path");
    const { note } = parse(z.object({ note: z.string().max(500).default("") }), req.body ?? {});
    const ok = await db.tx(async (q) => {
      const done = await billing.markPaid(id, `admin:${me.id}`, q);
      if (!done) return false;
      if (note) await q("UPDATE orders SET note = $2 WHERE id = $1", [id, note]);
      await ghiNhatKy(q, req, me, { action: "order.mark_paid", target_type: "order", target_id: id, before: { status: "pending" }, after: { status: "paid" }, note });
      return true;
    });
    if (!ok) throw new HttpError(409, "Đơn không ở trạng thái chờ thanh toán");
    await guiBienNhan(app, id);
    return billing.order(id);
  });

  app.post("/admin/orders/:id/cancel", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { id } = parse(IdParam, req.params, "path");
    const { note } = parse(z.object({ note: z.string().max(500).default("") }), req.body ?? {});
    const ok = await db.tx(async (q) => {
      const rows = await q("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id", [id]);
      if (!rows.length) return false;
      await ghiNhatKy(q, req, me, { action: "order.cancel", target_type: "order", target_id: id, before: { status: "pending" }, after: { status: "cancelled" }, note });
      return true;
    });
    if (!ok) throw new HttpError(409, "Chỉ huỷ được đơn đang chờ thanh toán");
    return billing.order(id);
  });

  /**
   * Ghi nhận hoàn tiền cho đơn đã thanh toán (việc chuyển tiền trả khách làm ngoài hệ thống, qua ngân hàng).
   * Thu hồi số lượt CHƯA DÙNG của đơn; các lá số/năm đã mở khoá bằng lượt của đơn vẫn được giữ.
   * Gửi email báo khách.
   */
  app.post("/admin/orders/:id/refund", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { id } = parse(IdParam, req.params, "path");
    const b = parse(z.object({
      amount: z.number().int().min(1),
      note: z.string().trim().min(1, "Ghi lý do hoàn tiền").max(500),
    }), req.body);
    const kq = await db.tx(async (q) => {
      const [o] = await q<Order>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
      if (!o) throw new HttpError(404, "Không tìm thấy đơn");
      if (o.status !== "paid") throw new HttpError(409, "Chỉ hoàn tiền được đơn đã thanh toán");
      if (b.amount > o.amount) throw new HttpError(400, `Số tiền hoàn không được lớn hơn số tiền đơn (${o.amount})`);
      const [g] = await q<{ id: number; credits_total: number; credits_left: number }>(
        "SELECT id, credits_total, credits_left FROM credit_grants WHERE order_id = $1 FOR UPDATE", [id]);
      const thuHoi = g?.credits_left ?? 0;
      if (g) {
        await q("UPDATE credit_grants SET revoked_credits = revoked_credits + credits_left, credits_left = 0, revoked_at = now() WHERE id = $1", [g.id]);
      }
      await q("UPDATE orders SET status = 'refunded', refunded_at = now(), refund_amount = $2, refund_note = $3 WHERE id = $1",
        [id, b.amount, b.note]);
      const daDung = g ? g.credits_total - g.credits_left : 0;
      await ghiNhatKy(q, req, me, {
        action: "order.refund", target_type: "order", target_id: id,
        before: { status: "paid", credits_left: thuHoi },
        after: { status: "refunded", refund_amount: b.amount, luot_thu_hoi: thuHoi, luot_da_dung_giu_lai: daDung },
        note: b.note,
      });
      const [u] = await q<{ email: string }>("SELECT email FROM users WHERE id = $1", [o.user_id]);
      return { order: o, thuHoi, daDung, email: u?.email };
    });
    if (kq.email) {
      await app.mailer.send(refundNotice(kq.email, { code: kq.order.code, amount: b.amount, luot_thu_hoi: kq.thuHoi, luot_da_dung: kq.daDung }));
    }
    return { ...(await billing.order(id)), luot_thu_hoi: kq.thuHoi, luot_da_dung: kq.daDung };
  });

  // ---- Giao dịch SePay ----
  app.get("/admin/payment-transactions", { schema: sec }, async (req) => {
    const { limit, offset, can_xem } = parse(Paging.extend({ can_xem: z.enum(["true", "false"]).optional() }), req.query, "query");
    const where = can_xem === "true" ? `WHERE ${CAN_XEM}` : "";
    const items = await db.query(
      `SELECT t.id, t.gateway, t.transaction_date, t.account_number, t.code, t.content, t.transfer_type, t.transfer_amount,
              t.reference_code, t.match_status, t.order_id, o.code AS order_code, t.received_at,
              t.resolved_at, t.resolved_by, t.resolve_note
       FROM payment_transactions t LEFT JOIN orders o ON o.id = t.order_id ${where}
       ORDER BY t.received_at DESC, t.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM payment_transactions t ${where}`);
    return { items, total };
  });

  /** Đánh dấu giao dịch không khớp đã được xử lý (đã hoàn tiền trả trùng, đã xác nhận tay đơn tương ứng...). */
  app.post("/admin/payment-transactions/:id/resolve", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params, "path");
    const { note } = parse(z.object({ note: z.string().trim().min(1, "Ghi cách đã xử lý").max(500) }), req.body);
    return db.tx(async (q) => {
      const [t] = await q<{ match_status: string; resolved_at: string | null }>(
        "SELECT match_status, resolved_at FROM payment_transactions WHERE id = $1 FOR UPDATE", [id]);
      if (!t) throw new HttpError(404, "Không tìm thấy giao dịch");
      if (t.resolved_at) throw new HttpError(409, "Giao dịch đã được đánh dấu xử lý");
      const [r] = await q(
        `UPDATE payment_transactions SET resolved_at = now(), resolved_by = $2, resolve_note = $3 WHERE id = $1
         RETURNING id, match_status, resolved_at, resolved_by, resolve_note`, [id, me.email, note]);
      await ghiNhatKy(q, req, me, { action: "payment.resolve", target_type: "payment_transaction", target_id: id, before: { match_status: t.match_status }, after: { resolved: true }, note });
      return r;
    });
  });

  // ---- Lượt của người dùng ----
  app.get("/admin/users/:id/credits", { schema: sec }, async (req) => {
    const { id } = parse(IdParam, req.params, "path");
    return billing.credits(id);
  });

  app.post("/admin/users/:id/credits", { schema: sec }, async (req, reply) => {
    const me = await requireAdmin(req);
    const { id } = parse(IdParam, req.params, "path");
    const b = parse(z.object({
      credits: z.number().int().min(1).max(1000), valid_days: z.number().int().min(1).max(3650).default(365),
      note: z.string().trim().min(1, "Ghi lý do cộng lượt").max(300),
    }), req.body);
    const g = await db.tx(async (q) => {
      const [u] = await q("SELECT id FROM users WHERE id = $1", [id]);
      if (!u) throw new HttpError(404, "Không tìm thấy người dùng");
      const [grant] = await q(
        `INSERT INTO credit_grants (user_id, credits_total, credits_left, expires_at, note, created_by)
         VALUES ($1, $2, $2, now() + make_interval(days => $3), $4, $5) RETURNING *`, [id, b.credits, b.valid_days, b.note, me.id]);
      await ghiNhatKy(q, req, me, { action: "credits.grant", target_type: "user", target_id: id, after: { credits: b.credits, valid_days: b.valid_days, grant_id: grant.id }, note: b.note });
      return grant;
    });
    return reply.status(201).send(g);
  });
}
