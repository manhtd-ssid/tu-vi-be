/** Test nhật ký thao tác admin, hoàn tiền, đánh dấu giao dịch đã xử lý, hộp thư đi. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { createDb, type Db } from "../src/db/index.js";
import type { Mail } from "../src/email/mailer.js";

const ENV = {
  ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "admin-pass-123",
  SEPAY_BANK: "MBBank", SEPAY_ACCOUNT_NUMBER: "0123456789", SEPAY_WEBHOOK_KEY: "whk",
};
let app: FastifyInstance;
let db: Db;
const sent: Mail[] = [];
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
    db, rateLimit: false, mailer: { send: async (m) => void sent.push(m) },
    llm: async (p) => `## ${p.user.match(/'## (Cung [^']+)'/)?.[1] ?? "Cung"}\nĐoạn AI [S1].`,
  });
});
afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await app.close();
  await db.close();
});

type M = "GET" | "POST" | "PUT" | "PATCH";
const req = (method: M, url: string, token?: string, body?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const login = async (email: string, password: string) => (await req("POST", "/v1/auth/login", undefined, { email, password })).json().token as string;
const admin = () => login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);

async function khachDaMua(email: string, plan = "GOI_5") {
  const r = (await req("POST", "/v1/auth/register", undefined, { email, password: "12345678" })).json();
  await db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [r.user.id]);
  const o = (await req("POST", "/v1/orders", r.token, { plan_code: plan })).json();
  await req("POST", "/v1/payments/sepay/webhook", undefined,
    { id: Math.floor(Math.random() * 1e9), transferType: "in", transferAmount: o.amount, content: o.code },
    { authorization: "Apikey whk" });
  return { token: r.token as string, userId: r.user.id as number, order: o };
}

describe("hoàn tiền", () => {
  it("thu hồi lượt chưa dùng, giữ lá số đã mở khoá, gửi email, trừ doanh thu, ghi nhật ký", async () => {
    const ad = await admin();
    const k = await khachDaMua("hoan@example.com"); // 5 lượt
    // dùng 2 lượt
    expect((await req("POST", "/v1/luan-giai", k.token, { ...BASE, use_llm: true })).json().billing.charged).toBe(true);
    expect((await req("POST", "/v1/luan-giai", k.token, { ...KHAC, use_llm: true })).json().billing.charged).toBe(true);
    expect((await req("GET", "/v1/me/credits", k.token)).json().credits_left).toBe(3);
    const truoc = (await req("GET", "/admin/billing/stats", ad)).json();

    expect((await req("POST", `/admin/orders/${k.order.id}/refund`, ad, { amount: 999999, note: "x" })).statusCode).toBe(400);
    expect((await req("POST", `/admin/orders/${k.order.id}/refund`, ad, { amount: 100000 })).statusCode).toBe(422);
    sent.length = 0;
    const r = await req("POST", `/admin/orders/${k.order.id}/refund`, ad, { amount: 100000, note: "Khách đổi ý, hoàn một phần" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "refunded", refund_amount: 100000, luot_thu_hoi: 3, luot_da_dung: 2 });

    // lượt chưa dùng bị thu hồi; lá số đã mở khoá vẫn đọc lại được, không tốn lượt
    expect((await req("GET", "/v1/me/credits", k.token)).json().credits_left).toBe(0);
    const lai = (await req("POST", "/v1/luan-giai", k.token, { ...BASE, use_llm: true })).json();
    expect(lai.billing).toMatchObject({ da_mo_khoa: true, charged: false });

    // email báo khách
    const mail = sent.find((m) => m.kind === "refund");
    expect(mail?.to).toBe("hoan@example.com");
    expect(mail?.text).toContain("100.000");
    expect(mail?.text).toContain("3 lượt chưa dùng");

    // doanh thu trừ phần hoàn; lượt đã dùng không tính lượt thu hồi
    const sau = (await req("GET", "/admin/billing/stats", ad)).json();
    expect(truoc.doanh_thu - sau.doanh_thu).toBe(100000);
    expect(sau.da_hoan).toBe(100000);
    expect(sau.luot_da_dung).toBe(truoc.luot_da_dung);

    // không hoàn hai lần, không hoàn đơn chưa trả
    expect((await req("POST", `/admin/orders/${k.order.id}/refund`, ad, { amount: 1000, note: "lần 2" })).statusCode).toBe(409);
    const cho = (await req("POST", "/v1/orders", k.token, { plan_code: "MO_KHOA_1" })).json();
    expect((await req("POST", `/admin/orders/${cho.id}/refund`, ad, { amount: 1000, note: "x" })).statusCode).toBe(409);

    // nhật ký
    const log = (await req("GET", `/admin/audit?target_type=order&target_id=${k.order.id}`, ad)).json();
    expect(log.items[0]).toMatchObject({
      action: "order.refund", admin_email: ENV.ADMIN_EMAIL, note: "Khách đổi ý, hoàn một phần",
      before: { status: "paid", credits_left: 3 }, after: { status: "refunded", refund_amount: 100000, luot_thu_hoi: 3 },
    });
    // khách thấy trạng thái đơn
    expect((await req("GET", `/v1/orders/${k.order.id}`, k.token)).json().status).toBe("refunded");
  });
});

describe("nhật ký thao tác admin", () => {
  it("ghi mọi thao tác ghi dữ liệu kèm dữ liệu trước/sau", async () => {
    const ad = await admin();
    const k = await khachDaMua("nk@example.com", "MO_KHOA_1");
    await req("PATCH", `/admin/users/${k.userId}`, ad, { role: "admin" });
    await req("PATCH", `/admin/users/${k.userId}`, ad, { role: "user" });
    await req("POST", `/admin/users/${k.userId}/credits`, ad, { credits: 2, note: "Bù lỗi" });
    await req("PUT", "/admin/plans/GOI_5", ad, { name: "Gói gia đình 5 lá số", price: 159000, credits: 5, valid_days: 365, active: true, sort: 2 });
    await req("PUT", "/admin/plans/KM_TET", ad, { name: "Khuyến mãi Tết", price: 39000, credits: 1, valid_days: 30, active: false, sort: 9 });
    const menh = encodeURIComponent("Mệnh");
    const e = (await req("GET", `/admin/kb/cung/${menh}`, ad)).json();
    await req("PUT", `/admin/kb/cung/${menh}`, ad, { data: { ...e.data, overview: { ...e.data.overview, short: "Tóm tắt mới" } } });
    const o2 = (await req("POST", "/v1/orders", k.token, { plan_code: "MO_KHOA_1" })).json();
    await req("POST", `/admin/orders/${o2.id}/cancel`, ad, { note: "khách nhờ huỷ" });
    const o3 = (await req("POST", "/v1/orders", k.token, { plan_code: "GOI_15" })).json();
    await req("POST", `/admin/orders/${o3.id}/mark-paid`, ad, { note: "CK sai nội dung" });

    const all = (await req("GET", "/admin/audit?limit=200", ad)).json().items;
    const actions = all.map((x: any) => x.action);
    for (const a of ["user.role", "credits.grant", "plan.update", "plan.create", "kb.update", "order.cancel", "order.mark_paid"]) {
      expect(actions).toContain(a);
    }
    const role = all.filter((x: any) => x.action === "user.role" && x.target_id === String(k.userId));
    expect(role.map((x: any) => x.after.role)).toEqual(["user", "admin"]); // mới nhất trước
    const plan = all.find((x: any) => x.action === "plan.update");
    expect(plan.before.price).toBe(149000);
    expect(plan.after.price).toBe(159000);
    const kb = all.find((x: any) => x.action === "kb.update");
    expect(kb.after.overview.short).toBe("Tóm tắt mới");
    expect(kb.before.overview.short).not.toBe("Tóm tắt mới");
    expect(all.find((x: any) => x.action === "credits.grant").note).toBe("Bù lỗi");

    // lọc theo tiền tố thao tác
    const orders = (await req("GET", "/admin/audit?action=order.", ad)).json().items;
    expect(orders.every((x: any) => x.action.startsWith("order."))).toBe(true);
    // người dùng thường không xem được
    expect((await req("GET", "/admin/audit", k.token)).statusCode).toBe(403);
  });

  it("thao tác thất bại không để lại nhật ký", async () => {
    const ad = await admin();
    const truoc = (await req("GET", "/admin/audit", ad)).json().total;
    await req("POST", "/admin/orders/999999/refund", ad, { amount: 1000, note: "x" });
    await req("POST", "/admin/orders/999999/cancel", ad, {});
    await req("PUT", "/admin/kb/cung/Khong-co", ad, { data: { overview: {} } });
    expect((await req("GET", "/admin/audit", ad)).json().total).toBe(truoc);
  });
});

describe("giao dịch SePay cần xem", () => {
  it("đánh dấu đã xử lý thì rời khỏi danh sách cần xem, có nhật ký", async () => {
    const ad = await admin();
    await req("POST", "/v1/payments/sepay/webhook", undefined,
      { id: 424242, transferType: "in", transferAmount: 50000, content: "chuyen nham" }, { authorization: "Apikey whk" });
    const truoc = (await req("GET", "/admin/billing/stats", ad)).json().giao_dich_can_xem;
    expect((await req("POST", "/admin/payment-transactions/424242/resolve", ad, {})).statusCode).toBe(422);
    const r = await req("POST", "/admin/payment-transactions/424242/resolve", ad, { note: "Đã hoàn 50.000đ cho khách qua MB" });
    expect(r.json()).toMatchObject({ resolved_by: ENV.ADMIN_EMAIL });
    expect((await req("GET", "/admin/billing/stats", ad)).json().giao_dich_can_xem).toBe(truoc - 1);
    const ds = (await req("GET", "/admin/payment-transactions?can_xem=true", ad)).json().items;
    expect(ds.map((x: any) => x.id)).not.toContain(424242);
    expect((await req("POST", "/admin/payment-transactions/424242/resolve", ad, { note: "lại" })).statusCode).toBe(409);
    const log = (await req("GET", "/admin/audit?target_type=payment_transaction&target_id=424242", ad)).json();
    expect(log.items[0].action).toBe("payment.resolve");
  });
});

it("hộp thư đi: liệt kê email đã gửi (không có nội dung)", async () => {
  const ad = await admin();
  // mailer giả trong test không ghi email_outbox → tự ghi vài dòng như mailer thật
  await db.query("INSERT INTO email_outbox (to_email, kind, subject, status, error) VALUES ('a@x.com','verify','Xác nhận','sent',NULL), ('b@x.com','reset','Đặt lại','failed','ECONNREFUSED')");
  const r = (await req("GET", "/admin/emails?status=failed", ad)).json();
  expect(r.total).toBe(1);
  expect(r.loi_24h).toBe(1);
  expect(r.items[0]).toMatchObject({ to_email: "b@x.com", error: "ECONNREFUSED" });
  expect(r.items[0]).not.toHaveProperty("text");
  expect((await req("GET", "/admin/emails?q=a@x", ad)).json().total).toBe(1);
});
