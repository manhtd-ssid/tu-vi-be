/** Test thanh toán SePay, lượt luận giải AI và quản trị thanh toán (PGlite trong bộ nhớ). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { findOrderCode } from "../src/billing/billing.js";
import { createDb, type Db } from "../src/db/index.js";

const ENV = {
  SEPAY_BANK: "MBBank", SEPAY_ACCOUNT_NUMBER: "0123456789", SEPAY_ACCOUNT_NAME: "CONG TY TU VI",
  SEPAY_WEBHOOK_KEY: "khoa-webhook-bi-mat", ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "admin-pass-123",
};
let app: FastifyInstance;
let db: Db;
let llmCalls = 0;
let llmMode: "ok" | "fail" = "ok";
const BASE = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };
const KHAC = { ngay: 2, thang: 3, nam: 1995, gio_sinh: 4, gioi_tinh: -1 };

beforeAll(async () => {
  Object.assign(process.env, ENV);
  // TEST_DATABASE_URL=postgres://... để chạy trên PostgreSQL thật (schema public bị xoá sạch).
  const url = process.env.TEST_DATABASE_URL ?? "";
  if (url) {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await c.end();
  }
  db = await createDb(url);
  app = await buildApp({
    db,
    llm: async (p) => {
      llmCalls++;
      if (llmMode === "fail") return null;
      const m = p.user.match(/'## (Cung [^']+)'/);
      return `## ${m?.[1] ?? "Cung"}\nĐoạn luận viết bằng AI, có dẫn nguồn [S1].`;
    },
  });
});
afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await app.close();
  await db.close();
});

const req = (method: "GET" | "POST" | "PUT", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

async function user(email: string) {
  const r = await req("POST", "/v1/auth/register", undefined, { email, password: "12345678" });
  return r.json().token as string;
}
const admin = async () => (await req("POST", "/v1/auth/login", undefined, { email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD })).json().token as string;

let sepayId = 1000;
function webhook(body: Partial<Record<string, unknown>>, key = ENV.SEPAY_WEBHOOK_KEY) {
  return req("POST", "/v1/payments/sepay/webhook", undefined, {
    id: ++sepayId, gateway: "MBBank", transactionDate: "2026-11-03 10:00:00", accountNumber: ENV.SEPAY_ACCOUNT_NUMBER,
    subAccount: null, code: null, transferType: "in", transferAmount: 0, accumulated: 0, referenceCode: "FT1", description: "",
    ...body,
  }, key ? { authorization: `Apikey ${key}` } : {});
}

it("tìm mã đơn trong nội dung chuyển khoản", () => {
  expect(findOrderCode(null, "MBVCB.123 chuyen tien tuviabcd2345 cam on")).toBe("TUVIABCD2345");
  expect(findOrderCode("TUVIWXYZ9876", "khác")).toBe("TUVIWXYZ9876");
  expect(findOrderCode(null, "khong co ma")).toBeNull();
});

describe("mua gói qua SePay", () => {
  let token: string;
  let order: any;

  it("xem gói, chưa có lượt, chưa đăng nhập không dùng được AI", async () => {
    const plans = (await req("GET", "/v1/plans")).json();
    expect(plans.items.map((p: any) => p.code)).toEqual(["MO_KHOA_1", "GOI_5", "GOI_15"]);
    expect(plans.thanh_toan_san_sang).toBe(true);
    token = await user("mua@example.com");
    expect((await req("GET", "/v1/me/credits", token)).json().credits_left).toBe(0);
    expect((await req("POST", "/v1/luan-giai", undefined, { ...BASE, use_llm: true })).statusCode).toBe(401);
    expect((await req("POST", "/v1/luan-giai", token, { ...BASE, use_llm: true })).statusCode).toBe(402);
    expect((await req("POST", "/v1/luan-giai/stream", token, { ...BASE, use_llm: true })).statusCode).toBe(402);
  });

  it("tạo đơn: VietQR SePay, tải lại thì dùng lại đơn cũ", async () => {
    const r = await req("POST", "/v1/orders", token, { plan_code: "MO_KHOA_1" });
    expect(r.statusCode).toBe(201);
    order = r.json();
    expect(order.code).toMatch(/^TUVI[A-Z0-9]{8}$/);
    expect(order).toMatchObject({ amount: 49000, credits: 1, status: "pending" });
    const qr = new URL(order.payment.qr_url);
    expect(qr.host).toBe("qr.sepay.vn");
    expect(Object.fromEntries(qr.searchParams)).toMatchObject({ acc: "0123456789", bank: "MBBank", amount: "49000", des: order.code });
    expect((await req("POST", "/v1/orders", token, { plan_code: "MO_KHOA_1" })).json().id).toBe(order.id);
    expect((await req("POST", "/v1/orders", token, { plan_code: "KHONG_CO" })).statusCode).toBe(404);
  });

  it("webhook sai khoá bị từ chối", async () => {
    expect((await webhook({ content: order.code, transferAmount: 49000 }, "")).statusCode).toBe(401);
    expect((await webhook({ content: order.code, transferAmount: 49000 }, "sai-khoa")).statusCode).toBe(401);
    expect((await req("GET", `/v1/orders/${order.id}`, token)).json().status).toBe("pending");
  });

  it("chuyển thiếu tiền: không cộng lượt, lưu để admin xem", async () => {
    const r = await webhook({ content: `chuyen khoan ${order.code.toLowerCase()}`, transferAmount: 40000 });
    expect(r.json()).toEqual({ success: true });
    expect((await req("GET", `/v1/orders/${order.id}`, token)).json().status).toBe("pending");
    const [t] = await db.query("SELECT match_status FROM payment_transactions WHERE id = $1", [sepayId]);
    expect(t.match_status).toBe("thieu_tien");
  });

  it("chuyển đủ tiền: đơn đã trả, cộng lượt; SePay gửi lại cùng id không cộng lần hai", async () => {
    const r = await webhook({ content: `NGUYEN VAN A CHUYEN TIEN ${order.code}`, transferAmount: 49000 });
    expect(r.statusCode).toBe(200);
    const o = (await req("GET", `/v1/orders/${order.id}`, token)).json();
    expect(o.status).toBe("paid");
    expect(o.payment).toBeNull();
    expect((await req("GET", "/v1/me/credits", token)).json().credits_left).toBe(1);

    const again = await req("POST", "/v1/payments/sepay/webhook", undefined,
      { id: sepayId, transferType: "in", transferAmount: 49000, content: order.code }, { authorization: `Apikey ${ENV.SEPAY_WEBHOOK_KEY}` });
    expect(again.json()).toEqual({ success: true });
    expect((await req("GET", "/v1/me/credits", token)).json().credits_left).toBe(1);

    // khách chuyển thêm lần nữa vào đơn đã trả → không cộng, đánh dấu để hoàn tiền
    await webhook({ content: order.code, transferAmount: 49000 });
    expect((await req("GET", "/v1/me/credits", token)).json().credits_left).toBe(1);
    const [t] = await db.query("SELECT match_status FROM payment_transactions WHERE id = $1", [sepayId]);
    expect(t.match_status).toBe("don_da_thanh_toan");
  });

  it("giao dịch tiền ra / không có mã đơn được ghi nhận, không lỗi", async () => {
    expect((await webhook({ transferType: "out", transferAmount: 10000, content: "rut tien" })).statusCode).toBe(200);
    expect((await webhook({ transferAmount: 10000, content: "tien an trua" })).statusCode).toBe(200);
    const rows = await db.query("SELECT match_status FROM payment_transactions ORDER BY received_at DESC, id DESC LIMIT 2");
    expect(rows.map((r) => r.match_status).sort()).toEqual(["khong_co_ma_don", "tien_ra"]);
  });

  it("mở khoá luận giải AI: trừ 1 lượt, đọc lại không tốn lượt và không gọi LLM", async () => {
    const before = llmCalls;
    const r = (await req("POST", "/v1/luan-giai", token, { ...BASE, use_llm: true })).json();
    expect(r.per_cung.every((x: any) => x.mode === "llm")).toBe(true);
    expect(r.billing).toMatchObject({ charged: true, credits_left: 0 });
    expect(llmCalls - before).toBe(12);

    const again = (await req("POST", "/v1/luan-giai", token, { ...BASE, use_llm: true })).json();
    expect(again.billing).toMatchObject({ charged: false, da_mo_khoa: true, credits_left: 0 });
    expect(again.markdown).toBe(r.markdown);
    expect(llmCalls - before).toBe(12);

    // streaming đọc lại bản đã lưu
    const s = await req("POST", "/v1/luan-giai/stream", token, { ...BASE, use_llm: true });
    expect(s.statusCode).toBe(200);
    expect(s.body.split("\n\n").filter((b) => b.startsWith("event: cung"))).toHaveLength(12);
    expect(llmCalls - before).toBe(12);

    // lá số khác: hết lượt
    expect((await req("POST", "/v1/luan-giai", token, { ...KHAC, use_llm: true })).statusCode).toBe(402);
    const c = (await req("GET", "/v1/me/credits", token)).json();
    expect(c.unlocked_reports).toBe(1);
  });

  it("AI lỗi thì trả bản tổng hợp và không trừ lượt", async () => {
    const ad = await admin();
    const u = (await req("GET", "/admin/users?q=mua@example", ad)).json().items[0];
    expect((await req("POST", `/admin/users/${u.id}/credits`, ad, { credits: 2, note: "Bù lỗi" })).statusCode).toBe(201);
    llmMode = "fail";
    const r = (await req("POST", "/v1/luan-giai", token, { ...KHAC, use_llm: true })).json();
    llmMode = "ok";
    expect(r.billing).toMatchObject({ charged: false, credits_left: 2 });
    expect(r.billing.ly_do).toBeTruthy();
    // lần sau AI chạy được thì mới trừ
    expect((await req("POST", "/v1/luan-giai", token, { ...KHAC, use_llm: true })).json().billing).toMatchObject({ charged: true, credits_left: 1 });
  });
});

describe("admin thanh toán", () => {
  it("xác nhận tay, huỷ đơn, thống kê, giao dịch cần xem", async () => {
    const ad = await admin();
    const t = await user("tay@example.com");
    const o1 = (await req("POST", "/v1/orders", t, { plan_code: "GOI_5" })).json();
    const o2 = (await req("POST", "/v1/orders", t, { plan_code: "GOI_15" })).json();
    expect((await req("POST", `/admin/orders/${o1.id}/mark-paid`, ad, { note: "Khách ghi sai nội dung" })).json().status).toBe("paid");
    expect((await req("POST", `/admin/orders/${o1.id}/mark-paid`, ad, {})).statusCode).toBe(409);
    expect((await req("GET", "/v1/me/credits", t)).json().credits_left).toBe(5);
    expect((await req("POST", `/admin/orders/${o2.id}/cancel`, ad, {})).json().status).toBe("cancelled");
    // tiền về sau khi đơn đã huỷ → không cộng
    await webhook({ content: o2.code, transferAmount: 299000 });
    expect((await req("GET", "/v1/me/credits", t)).json().credits_left).toBe(5);

    const s = (await req("GET", "/admin/billing/stats", ad)).json();
    expect(s.doanh_thu).toBe(49000 + 149000);
    expect(s.don_da_tra).toBe(2);
    const tx = (await req("GET", "/admin/payment-transactions?can_xem=true", ad)).json();
    expect(tx.items.map((x: any) => x.match_status)).toEqual(expect.arrayContaining(["don_da_huy", "thieu_tien", "don_da_thanh_toan", "khong_co_ma_don"]));
    expect((await req("GET", "/admin/orders?status=paid", ad)).json().total).toBe(2);
    expect((await req("GET", "/admin/orders/x", t)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await req("GET", "/admin/orders", t)).statusCode).toBe(403);
  });

  it("sửa gói chỉ áp dụng cho đơn mới", async () => {
    const ad = await admin();
    const t = await user("gia@example.com");
    const cu = (await req("POST", "/v1/orders", t, { plan_code: "MO_KHOA_1" })).json();
    const p = await req("PUT", "/admin/plans/MO_KHOA_1", ad, { name: "Mở khoá 1 lá số", price: 59000, credits: 1, valid_days: 365, active: true, sort: 1 });
    expect(p.json().price).toBe(59000);
    expect((await req("GET", `/v1/orders/${cu.id}`, t)).json().amount).toBe(49000);
    // đơn cũ khác giá không được dùng lại
    expect((await req("POST", "/v1/orders", t, { plan_code: "MO_KHOA_1" })).json().amount).toBe(59000);
    await req("PUT", "/admin/plans/GOI_15", ad, { name: "Gói 15 lá số", price: 299000, credits: 15, valid_days: 365, active: false, sort: 3 });
    expect((await req("GET", "/v1/plans")).json().items.map((x: any) => x.code)).not.toContain("GOI_15");
    expect((await req("PUT", "/admin/plans/MO_KHOA_1", ad, { name: "x", price: 5, credits: 1, valid_days: 1, active: true })).statusCode).toBe(422);
  });
});

it("X-API-Key nội bộ dùng AI không cần lượt", async () => {
  process.env.API_KEY = "noi-bo";
  const r = await req("POST", "/v1/luan-giai", undefined, { ...KHAC, use_llm: true }, { "x-api-key": "noi-bo" });
  delete process.env.API_KEY;
  expect(r.statusCode).toBe(200);
  expect(r.json().billing).toBeUndefined();
});
