/** API quản trị thanh toán: gói, đơn hàng, giao dịch chưa khớp, cộng lượt thủ công. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, Paging, parse, requireAdmin } from "../http.js";

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

export async function adminBillingRoutes(app: FastifyInstance) {
  const db = app.db;
  const billing = app.billing;
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/admin/")) await requireAdmin(req);
  });

  app.get("/admin/billing/stats", { schema: sec }, async () => {
    const [r] = await db.query(`SELECT
      (SELECT coalesce(sum(amount), 0)::bigint FROM orders WHERE status = 'paid') AS doanh_thu,
      (SELECT coalesce(sum(amount), 0)::bigint FROM orders WHERE status = 'paid' AND paid_at > now() - interval '30 days') AS doanh_thu_30d,
      (SELECT count(*)::int FROM orders WHERE status = 'paid') AS don_da_tra,
      (SELECT count(*)::int FROM orders WHERE status = 'pending' AND expires_at > now()) AS don_dang_cho,
      (SELECT coalesce(sum(credits_total - credits_left), 0)::int FROM credit_grants) AS luot_da_dung,
      (SELECT count(*)::int FROM payment_transactions WHERE match_status NOT IN ('khop', 'tien_ra')) AS giao_dich_can_xem`);
    return { ...r, doanh_thu: Number(r.doanh_thu), doanh_thu_30d: Number(r.doanh_thu_30d) };
  });

  // ---- Gói ----
  app.get("/admin/plans", { schema: sec }, async () => ({ items: await billing.plans(true) }));

  app.put("/admin/plans/:code", { schema: sec }, async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/, "Mã gói chỉ gồm A-Z, 0-9, _") }), req.params, "path");
    const b = parse(PlanBody, req.body);
    // Đơn đã tạo giữ nguyên giá/lượt lúc tạo (lưu trong orders), sửa gói chỉ áp dụng cho đơn mới.
    const [p] = await db.query(
      `INSERT INTO plans (code, name, description, price, credits, valid_days, active, sort, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (code) DO UPDATE SET name = $2, description = $3, price = $4, credits = $5, valid_days = $6,
         active = $7, sort = $8, updated_at = now()
       RETURNING code, name, description, price, credits, valid_days, active, sort`,
      [code, b.name, b.description, b.price, b.credits, b.valid_days, b.active, b.sort]);
    return p;
  });

  // ---- Đơn hàng ----
  app.get("/admin/orders", { schema: sec }, async (req) => {
    const { limit, offset, status, q } = parse(Paging.extend({
      status: z.enum(["pending", "paid", "cancelled"]).optional(), q: z.string().trim().max(200).default(""),
    }), req.query, "query");
    const cond: string[] = [];
    const params: unknown[] = [];
    if (status) { params.push(status); cond.push(`o.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); cond.push(`(o.code ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const items = await db.query(
      `SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id ${where}
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
      if (done && note) await q("UPDATE orders SET note = $2 WHERE id = $1", [id, note]);
      return done;
    });
    if (!ok) throw new HttpError(409, "Đơn không ở trạng thái chờ thanh toán");
    return billing.order(id);
  });

  app.post("/admin/orders/:id/cancel", { schema: sec }, async (req) => {
    const { id } = parse(IdParam, req.params, "path");
    const rows = await db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id", [id]);
    if (!rows.length) throw new HttpError(409, "Chỉ huỷ được đơn đang chờ thanh toán");
    return billing.order(id);
  });

  // ---- Giao dịch SePay ----
  app.get("/admin/payment-transactions", { schema: sec }, async (req) => {
    const { limit, offset, can_xem } = parse(Paging.extend({ can_xem: z.enum(["true", "false"]).optional() }), req.query, "query");
    const where = can_xem === "true" ? "WHERE t.match_status NOT IN ('khop', 'tien_ra')" : "";
    const items = await db.query(
      `SELECT t.id, t.gateway, t.transaction_date, t.account_number, t.code, t.content, t.transfer_type, t.transfer_amount,
              t.reference_code, t.match_status, t.order_id, o.code AS order_code, t.received_at
       FROM payment_transactions t LEFT JOIN orders o ON o.id = t.order_id ${where}
       ORDER BY t.received_at DESC, t.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM payment_transactions t ${where}`);
    return { items, total };
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
    const [u] = await db.query("SELECT id FROM users WHERE id = $1", [id]);
    if (!u) throw new HttpError(404, "Không tìm thấy người dùng");
    return reply.status(201).send(await billing.grant(id, b.credits, b.valid_days, b.note, me.id));
  });
}
