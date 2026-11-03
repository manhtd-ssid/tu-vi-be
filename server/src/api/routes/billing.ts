/** Gói, đơn hàng, lượt AI của người dùng và webhook SePay. */
import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { billingConfigured, findOrderCode, paymentInfo, type Order } from "../../billing/billing.js";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";

const CreateOrder = z.object({ plan_code: z.string().min(1).max(50) });
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

  app.get("/v1/orders", { schema: sec }, async (req) => {
    const me = await currentUser(req, true);
    return { items: (await billing.ordersOf(me.id)).map(view) };
  });

  app.post("/v1/orders", { schema: { ...sec, body: jsonSchema(CreateOrder), summary: "Tạo đơn, trả thông tin chuyển khoản + VietQR" } }, async (req, reply) => {
    const me = await currentUser(req, true);
    if (!billingConfigured()) throw new HttpError(503, "Thanh toán chưa được cấu hình (thiếu SEPAY_BANK / SEPAY_ACCOUNT_NUMBER)");
    const { plan_code } = parse(CreateOrder, req.body);
    const o = await billing.createOrder(me.id, plan_code);
    if (!o) throw new HttpError(404, "Gói không tồn tại hoặc đã ngừng bán");
    return reply.status(201).send(view(o));
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
  app.post("/v1/payments/sepay/webhook", { schema: { tags: ["thanh toán"], summary: "Webhook SePay" } }, async (req, reply) => {
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
      if (!ins.length) return "trung_lap";

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
      return status;
    });
    req.log.info({ sepay_id: t.id, ket_qua: ketQua }, "sepay webhook");
    return { success: true };
  });
}
