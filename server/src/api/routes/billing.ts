/** Gói, đơn hàng, lượt AI của người dùng và webhook SePay. */
import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { billingConfigured, findOrderCode, paymentInfo, type Order } from "../../billing/billing.js";
import { appUrl, receipt } from "../../email/templates.js";
import { SU_KIEN_TU_TRANG, track } from "../../analytics/events.js";
import { CouponError } from "../../billing/coupons.js";
import { apDungMaBatKy, caiDatGioiThieu, maGioiThieuCua } from "../../billing/referral.js";
import type { Plan } from "../../billing/billing.js";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";

/** Gửi email biên nhận cho đơn vừa thanh toán (lỗi gửi không ảnh hưởng đơn). */
export async function guiBienNhan(app: FastifyInstance, orderId: number): Promise<void> {
  try {
    const [o] = await app.db.query<{ code: string; amount: number; credits: number; valid_days: number; paid_at: string; email: string; plan_name: string }>(
      `SELECT o.code, o.amount, o.credits, o.valid_days, o.paid_at, u.email, p.name AS plan_name
       FROM orders o JOIN users u ON u.id = o.user_id JOIN plans p ON p.code = o.plan_code WHERE o.id = $1 AND o.status = 'paid'`, [orderId]);
    if (o) await app.mailer.send(receipt(o.email, o));
  } catch (e) {
    app.log.error({ err: e, orderId }, "gửi biên nhận lỗi");
  }
}

const CreateOrder = z.object({ plan_code: z.string().min(1).max(50), coupon_code: z.string().trim().max(40).nullish() });
const CheckCoupon = z.object({ plan_code: z.string().min(1).max(50), code: z.string().trim().min(1).max(40) });
const IdParam = z.object({ id: z.coerce.number().int().positive() });

/** Dữ liệu SePay gửi tới webhook (theo gói tích hợp chính thức sepayvn/laravel-sepay). */
const SePayWebhook = z.object({
  id: z.coerce.number().int(),
  gateway: z.string().nullish(),
  transactionDate: z.string().nullish(),
  accountNumber: z.string().nullish(),
  subAccount: z.string().nullish(),
  code: z.string().nullish(),
  content: z.string().nullish(),
  transferType: z.string(),
  transferAmount: z.coerce.number(),
  accumulated: z.coerce.number().nullish(),
  referenceCode: z.string().nullish(),
  description: z.string().nullish(),
}).loose();

/** Trạng thái hiển thị: đơn chờ quá hạn thì báo "het_han" (vẫn nhận tiền nếu khách chuyển muộn). */
function view(o: Order) {
  const status = o.status === "pending" && new Date(o.expires_at).getTime() < Date.now() ? "het_han" : o.status;
  return { ...o, status, payment: o.status === "pending" ? paymentInfo(o) : null };
}

/** So khớp header "Authorization: Apikey <khoá>" với SEPAY_WEBHOOK_KEY. */
function sepayKeyHopLe(header: string | undefined): boolean {
  const expected = process.env.SEPAY_WEBHOOK_KEY;
  if (!expected || !header) return false;
  const i = header.lastIndexOf("Apikey ");
  if (i < 0) return false;
  const a = Buffer.from(header.slice(i + 7).split(",")[0].trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function billingRoutes(app: FastifyInstance) {
  const billing = app.billing;
  const sec = { tags: ["thanh toán"], security: [{ bearer: [] }] };

  app.get("/v1/plans", { schema: { tags: ["thanh toán"], summary: "Các gói đang bán" } }, async () => ({
    items: await billing.plans(), thanh_toan_san_sang: billingConfigured(),
  }));

  app.get("/v1/me/credits", { schema: { ...sec, summary: "Lượt luận giải AI còn lại" } }, async (req) => {
    const me = await currentUser(req, true);
    return billing.credits(me.id);
  });

  /** Mã giới thiệu của tôi + điều kiện chương trình + số bạn đã mua qua mã. */
  app.get("/v1/me/referral", { schema: { ...sec, summary: "Giới thiệu bạn bè" } }, async (req) => {
    const me = await currentUser(req, true);
    const q = app.db.query.bind(app.db);
    const cfg = await caiDatGioiThieu(q);
    const code = await maGioiThieuCua(q, me.id);
    const [r] = await q<{ ban_da_mua: number; luot_da_nhan: number }>(
      `SELECT (SELECT count(DISTINCT user_id)::int FROM orders WHERE referrer_id = $1 AND status = 'paid') AS ban_da_mua,
              (SELECT coalesce(sum(credits_total - revoked_credits), 0)::int FROM credit_grants WHERE user_id = $1 AND referral_order_id IS NOT NULL) AS luot_da_nhan`,
      [me.id]);
    return {
      code, link: `${appUrl()}/?ref=${code}`,
      enabled: cfg.enabled, percent: cfg.percent, max_discount: cfg.max_discount, reward_credits: cfg.reward_credits,
      reward_valid_days: cfg.reward_valid_days, chi_khach_moi: cfg.chi_khach_moi, ...r,
    };
  });

  app.get("/v1/orders", { schema: sec }, async (req) => {
    const me = await currentUser(req, true);
    return { items: (await billing.ordersOf(me.id)).map(view) };
  });

  app.post("/v1/orders", { ...app.limit(20, "1 hour", true), schema: { ...sec, body: jsonSchema(CreateOrder), summary: "Tạo đơn, trả thông tin chuyển khoản + VietQR" } }, async (req, reply) => {
    const me = await currentUser(req, true);
    if (!billingConfigured()) throw new HttpError(503, "Thanh toán chưa được cấu hình (thiếu SEPAY_BANK / SEPAY_ACCOUNT_NUMBER)");
    // Cần email đã xác thực để gửi biên nhận và liên hệ khi phải hoàn tiền.
    if (process.env.REQUIRE_EMAIL_VERIFIED !== "0" && !me.email_verified) {
      throw new HttpError(403, "Bạn cần xác nhận email trước khi mua gói. Kiểm tra hộp thư hoặc gửi lại email xác nhận.");
    }
    const { plan_code, coupon_code } = parse(CreateOrder, req.body);
    let o;
    try {
      o = await billing.createOrder(me.id, plan_code, coupon_code || null);
    } catch (e) {
      if (e instanceof CouponError) throw new HttpError(400, e.message);
      throw e;
    }
    if (!o) throw new HttpError(404, "Gói không tồn tại hoặc đã ngừng bán");
    track(app, req, reply, "don_tao", { order_id: o.id, plan: o.plan_code, coupon: o.coupon_code ?? null, amount: o.amount });
    if (o.status === "paid") await guiBienNhan(app, o.id); // đơn 0đ (mã giảm 100%)
    return reply.status(201).send(view(o));
  });

  /** Kiểm tra mã giảm giá cho một gói, trả giá sau giảm (chưa giữ chỗ — chỉ giữ khi tạo đơn). */
  app.post("/v1/coupons/check", { schema: { ...sec, body: jsonSchema(CheckCoupon) }, ...app.limit(30, "10 minutes", true) }, async (req) => {
    const me = await currentUser(req, true);
    const b = parse(CheckCoupon, req.body);
    const [plan] = await app.db.query<Plan>("SELECT * FROM plans WHERE code = $1 AND active", [b.plan_code]);
    if (!plan) throw new HttpError(404, "Gói không tồn tại hoặc đã ngừng bán");
    try {
      const kq = await apDungMaBatKy(app.db.query.bind(app.db), b.code, me.id, plan);
      return { code: kq.code, loai: kq.loai, original: kq.original, discount: kq.discount, amount: kq.amount, note: kq.note };
    } catch (e) {
      if (e instanceof CouponError) throw new HttpError(400, e.message);
      throw e;
    }
  });

  /** Sự kiện do trang web gửi (chỉ nhận danh sách cho phép; dùng cho phễu chuyển đổi). */
  app.post("/v1/events", { schema: { tags: ["thống kê"], summary: "Ghi sự kiện phễu từ trang web" }, ...app.limit(120, "10 minutes") }, async (req, reply) => {
    const b = parse(z.object({ name: z.enum(SU_KIEN_TU_TRANG), plan: z.string().max(50).optional() }), req.body);
    track(app, req, reply, b.name, b.plan ? { plan: b.plan } : {});
    return reply.status(204).send();
  });

  app.get("/v1/orders/:id", { schema: { ...sec, summary: "Xem đơn (dùng để chờ thanh toán)" } }, async (req) => {
    const me = await currentUser(req, true);
    const { id } = parse(IdParam, req.params, "path");
    const o = await billing.order(id, me.id);
    if (!o) throw new HttpError(404, "Không tìm thấy đơn");
    return view(o);
  });

  /**
   * Webhook SePay. Xác thực bằng header `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`.
   * SePay gửi lại khi không nhận được 2xx, nên mỗi giao dịch (theo `id`) chỉ được xử lý một lần.
   * Giao dịch không khớp đơn (thiếu tiền, sai nội dung, đơn đã trả) vẫn trả 200 để SePay không gửi lại,
   * và được lưu với match_status để admin xử lý tay.
   */
  app.post("/v1/payments/sepay/webhook", { schema: { tags: ["thanh toán"], summary: "Webhook SePay" }, ...app.limit(300, "1 minute") }, async (req, reply) => {
    if (!process.env.SEPAY_WEBHOOK_KEY) return reply.status(503).send({ success: false, message: "Webhook chưa được cấu hình" });
    if (!sepayKeyHopLe(req.headers.authorization)) return reply.status(401).send({ success: false, message: "Invalid Token" });
    const t = parse(SePayWebhook, req.body);
    const ketQua = await app.db.tx(async (q) => {
      const ins = await q(
        `INSERT INTO payment_transactions (id, gateway, transaction_date, account_number, code, content, transfer_type,
           transfer_amount, reference_code, match_status, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'dang_xu_ly', $10) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [t.id, t.gateway ?? "", t.transactionDate ?? "", t.accountNumber ?? "", t.code ?? null, t.content ?? "",
          t.transferType, Math.round(t.transferAmount), t.referenceCode ?? null, JSON.stringify(req.body)]);
      if (!ins.length) return { status: "trung_lap", orderId: null };

      let status: string;
      let orderId: number | null = null;
      const code = t.transferType === "in" ? findOrderCode(t.code, t.content, t.description) : null;
      if (t.transferType !== "in") status = "tien_ra";
      else if (!code) status = "khong_co_ma_don";
      else {
        const [o] = await q<Order>("SELECT * FROM orders WHERE code = $1 FOR UPDATE", [code]);
        if (!o) status = "khong_tim_thay_don";
        else {
          orderId = o.id;
          if (o.status === "paid") status = "don_da_thanh_toan";
          else if (o.status === "cancelled") status = "don_da_huy";
          else if (t.transferAmount < o.amount) status = "thieu_tien";
          else status = (await billing.markPaid(o.id, `sepay:${t.id}`, q)) ? "khop" : "don_da_thanh_toan";
        }
      }
      await q("UPDATE payment_transactions SET match_status = $2, order_id = $3 WHERE id = $1", [t.id, status, orderId]);
      return { status, orderId };
    });
    req.log.info({ sepay_id: t.id, ket_qua: ketQua.status }, "sepay webhook");
    if (ketQua.status === "khop" && ketQua.orderId) await guiBienNhan(app, ketQua.orderId);
    return { success: true };
  });
}
