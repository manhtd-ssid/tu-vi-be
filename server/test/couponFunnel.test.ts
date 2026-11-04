/** Test mã giảm giá (áp dụng, giới hạn, giữ chỗ, đơn 0đ, admin) và phễu chuyển đổi. */
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { tinhGiam } from "../src/billing/coupons.js";
import { createDb, type Db } from "../src/db/index.js";
import type { Mail } from "../src/email/mailer.js";

const ENV = {
  ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "admin-pass-123",
  SEPAY_BANK: "MBBank", SEPAY_ACCOUNT_NUMBER: "0123456789", SEPAY_WEBHOOK_KEY: "whk",
};
let app: FastifyInstance;
let db: Db;
let ad: string;
const sent: Mail[] = [];
const BASE = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };

beforeAll(async () => {
  Object.assign(process.env, ENV);
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
  ad = (await req("POST", "/v1/auth/login", undefined, { email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD })).json().token;
});
afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await app.close();
  await db.close();
});

type M = "GET" | "POST" | "PUT";
const req = (method: M, url: string, token?: string, body?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

async function khach(email: string) {
  const r = (await req("POST", "/v1/auth/register", undefined, { email, password: "12345678" })).json();
  await db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [r.user.id]);
  return r.token as string;
}
const taoMa = (code: string, body: object) => req("PUT", `/admin/coupons/${code}`, ad, { kind: "percent", value: 10, ...body });
const webhook = (content: string, amount: number) => req("POST", "/v1/payments/sepay/webhook", undefined,
  { id: Math.floor(Math.random() * 1e9), transferType: "in", transferAmount: amount, content }, { authorization: "Apikey whk" });

it("tính tiền giảm: %, có trần, số tiền, không vượt giá", () => {
  expect(tinhGiam({ kind: "percent", value: 20, max_discount: null }, 149000)).toBe(29800);
  expect(tinhGiam({ kind: "percent", value: 50, max_discount: 30000 }, 149000)).toBe(30000);
  expect(tinhGiam({ kind: "amount", value: 20000, max_discount: null }, 49000)).toBe(20000);
  expect(tinhGiam({ kind: "amount", value: 90000, max_discount: null }, 49000)).toBe(49000);
  expect(tinhGiam({ kind: "percent", value: 100, max_discount: null }, 49000)).toBe(49000);
});

describe("áp dụng mã", () => {
  it("kiểm tra mã, tạo đơn có giảm giá, webhook khớp số tiền sau giảm", async () => {
    expect((await taoMa("TET2027", { value: 20, note: "Khuyến mãi Tết" })).statusCode).toBe(200);
    const t = await khach("tet@example.com");
    const chk = (await req("POST", "/v1/coupons/check", t, { plan_code: "GOI_5", code: " tet2027 " })).json();
    expect(chk).toMatchObject({ code: "TET2027", original: 149000, discount: 29800, amount: 119200, note: "Khuyến mãi Tết" });

    const o = (await req("POST", "/v1/orders", t, { plan_code: "GOI_5", coupon_code: "tet2027" })).json();
    expect(o).toMatchObject({ amount: 119200, original_amount: 149000, discount_amount: 29800, coupon_code: "TET2027", status: "pending" });
    expect(new URL(o.payment.qr_url).searchParams.get("amount")).toBe("119200");
    // tải lại trang: dùng lại đơn
    expect((await req("POST", "/v1/orders", t, { plan_code: "GOI_5", coupon_code: "TET2027" })).json().id).toBe(o.id);
    // không mã → đơn khác, giá gốc
    expect((await req("POST", "/v1/orders", t, { plan_code: "GOI_5" })).json().amount).toBe(149000);

    await webhook(o.code, 119200);
    expect((await req("GET", `/v1/orders/${o.id}`, t)).json().status).toBe("paid");
    expect((await req("GET", "/v1/me/credits", t)).json().credits_left).toBe(5);
    // mỗi người 1 lần
    expect((await req("POST", "/v1/coupons/check", t, { plan_code: "GOI_5", code: "TET2027" })).json().detail).toBe("Bạn đã dùng mã này rồi");
    expect((await req("POST", "/v1/orders", t, { plan_code: "MO_KHOA_1", coupon_code: "TET2027" })).statusCode).toBe(400);
  });

  it("mã sai, tắt, chưa tới hạn, hết hạn, sai gói, dưới giá tối thiểu", async () => {
    const t = await khach("dk@example.com");
    const loi = async (code: string, plan = "GOI_5") => (await req("POST", "/v1/coupons/check", t, { plan_code: plan, code })).json().detail;
    expect(await loi("KHONGCO")).toMatch(/không tồn tại/);
    await taoMa("TAT", { active: false });
    expect(await loi("TAT")).toMatch(/ngừng áp dụng/);
    await taoMa("SAPTOI", { starts_at: new Date(Date.now() + 86400e3).toISOString() });
    expect(await loi("SAPTOI")).toMatch(/chưa đến thời gian/);
    await taoMa("HETHAN", { starts_at: "2020-01-01T00:00:00Z", ends_at: "2020-02-01T00:00:00Z" });
    expect(await loi("HETHAN")).toMatch(/hết hạn/);
    await taoMa("CHIGOI15", { plan_codes: ["GOI_15"] });
    expect(await loi("CHIGOI15")).toMatch(/không áp dụng cho gói/);
    expect((await req("POST", "/v1/coupons/check", t, { plan_code: "GOI_15", code: "CHIGOI15" })).statusCode).toBe(200);
    await taoMa("TU100K", { min_amount: 100000 });
    expect(await loi("TU100K", "MO_KHOA_1")).toMatch(/từ 100.000đ/);
  });

  it("giới hạn tổng lượt: đơn chờ giữ chỗ, đơn huỷ trả lại chỗ", async () => {
    await taoMa("CHI2", { max_uses: 2, kind: "amount", value: 10000 });
    const a = await khach("g1@example.com");
    const b = await khach("g2@example.com");
    const c = await khach("g3@example.com");
    const oa = (await req("POST", "/v1/orders", a, { plan_code: "MO_KHOA_1", coupon_code: "CHI2" })).json();
    expect(oa.amount).toBe(39000);
    expect((await req("POST", "/v1/orders", b, { plan_code: "MO_KHOA_1", coupon_code: "CHI2" })).statusCode).toBe(201);
    const het = await req("POST", "/v1/orders", c, { plan_code: "MO_KHOA_1", coupon_code: "CHI2" });
    expect(het.statusCode).toBe(400);
    expect(het.json().detail).toMatch(/hết lượt/);
    // huỷ đơn chờ của A → C dùng được
    await req("POST", `/admin/orders/${oa.id}/cancel`, ad, {});
    expect((await req("POST", "/v1/orders", c, { plan_code: "MO_KHOA_1", coupon_code: "CHI2" })).statusCode).toBe(201);
  });

  it("tạo đơn đồng thời không vượt giới hạn lượt", async () => {
    await taoMa("DUY1", { max_uses: 1 });
    const ts = await Promise.all(Array.from({ length: 5 }, (_, i) => khach(`ss${i}@example.com`)));
    const rs = await Promise.all(ts.map((t) => req("POST", "/v1/orders", t, { plan_code: "MO_KHOA_1", coupon_code: "DUY1" })));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 400)).toHaveLength(4);
  });

  it("mã giảm 100%: đơn 0đ được thanh toán ngay, cộng lượt, gửi biên nhận, không cần chuyển khoản", async () => {
    await taoMa("QUATANG", { value: 100, plan_codes: ["MO_KHOA_1"], note: "Quà tặng KOL" });
    const t = await khach("free@example.com");
    sent.length = 0;
    const o = (await req("POST", "/v1/orders", t, { plan_code: "MO_KHOA_1", coupon_code: "QUATANG" })).json();
    expect(o).toMatchObject({ amount: 0, discount_amount: 49000, status: "paid", payment: null, paid_by: "coupon:QUATANG" });
    expect((await req("GET", "/v1/me/credits", t)).json().credits_left).toBe(1);
    expect(sent.some((m) => m.kind === "receipt" && m.to === "free@example.com")).toBe(true);
  });
});

describe("admin mã giảm giá", () => {
  it("danh sách có số lần dùng, doanh thu, tổng giảm; sửa mã ghi nhật ký; dữ liệu sai bị chặn", async () => {
    const ds = (await req("GET", "/admin/coupons", ad)).json().items;
    const tet = ds.find((x: any) => x.code === "TET2027");
    expect(tet).toMatchObject({ so_lan_dung: 1, doanh_thu: 119200, tong_giam: 29800 });
    expect(ds.find((x: any) => x.code === "QUATANG")).toMatchObject({ so_lan_dung: 1, doanh_thu: 0, tong_giam: 49000 });

    expect((await taoMa("TET2027", { value: 15, note: "Giảm còn 15%" })).json().value).toBe(15);
    const log = (await req("GET", "/admin/audit?target_type=coupon&target_id=TET2027", ad)).json().items;
    expect(log.map((x: any) => x.action)).toEqual(["coupon.update", "coupon.create"]);
    expect(log[0].before.value).toBe(20);

    expect((await taoMa("SAI", { value: 150 })).statusCode).toBe(422); // % > 100
    expect((await taoMa("X", {})).statusCode).toBe(422); // mã quá ngắn
    expect((await taoMa("GOISAI", { plan_codes: ["KHONG_CO"] })).statusCode).toBe(400);
    expect((await req("GET", "/admin/coupons", await khach("u@example.com"))).statusCode).toBe(403);
  });
});

describe("phễu chuyển đổi", () => {
  it("đếm khách qua các bước theo cookie ẩn danh, không lưu dữ liệu ngày sinh", async () => {
    await db.query("DELETE FROM events");
    const cookieOf = (r: LightMyRequestResponse) => r.cookies.find((c) => c.name === "tuvi_vid")?.value;

    // Khách 1: lập lá số → đăng ký → bấm AI → hết lượt → tạo đơn → trả tiền
    const r1 = await req("POST", "/v1/la-so", undefined, BASE);
    const vid = cookieOf(r1)!;
    expect(vid).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const ck = { cookie: `tuvi_vid=${vid}` };
    const reg = await req("POST", "/v1/auth/register", undefined, { email: "phieu@example.com", password: "12345678" }, ck);
    expect(cookieOf(reg)).toBeUndefined(); // giữ nguyên mã khách cũ
    const t = reg.json().token;
    await db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [reg.json().user.id]);
    expect((await req("POST", "/v1/luan-giai", t, { ...BASE, use_llm: true }, ck)).statusCode).toBe(402);
    const o = (await req("POST", "/v1/orders", t, { plan_code: "MO_KHOA_1" }, ck)).json();
    await webhook(o.code, o.amount);

    // Khách 2: chỉ lập lá số và xem bảng giá
    const r2 = await req("POST", "/v1/la-so", undefined, BASE);
    const vid2 = cookieOf(r2)!;
    expect(vid2).not.toBe(vid);
    expect((await req("POST", "/v1/events", undefined, { name: "xem_goi" }, { cookie: `tuvi_vid=${vid2}` })).statusCode).toBe(204);
    // Khách 3: chỉ lập lá số
    await req("POST", "/v1/la-so", undefined, BASE);
    // sự kiện lạ bị chặn
    expect((await req("POST", "/v1/events", undefined, { name: "hack" })).statusCode).toBe(422);

    await new Promise((res) => setTimeout(res, 100));
    const f = (await req("GET", "/admin/funnel?days=7", ad)).json();
    // Mỗi bước đếm khách đã đi tới ÍT NHẤT bước đó (phễu không bao giờ tăng ở bước sau):
    // khách 2 vào thẳng bảng giá (bước 3) nên cũng được tính ở bước 2.
    expect(f.buoc.map((b: any) => [b.key, b.so_khach])).toEqual([
      ["lap_la_so", 3], ["ai_bam", 2], ["thay_goi", 2], ["don_tao", 1], ["don_tra", 1],
    ]);
    expect(f.buoc[4].ti_le_tu_dau).toBeCloseTo(1 / 3);
    expect(f.phu).toMatchObject({ dang_ky: 1, khach: 3 });
    expect(f.theo_ngay[0]).toMatchObject({ lap_la_so: 3, don_tra: 1 });
    expect(f.theo_goi.find((x: any) => x.plan_code === "MO_KHOA_1" && x.coupon_code === "")).toBeTruthy();

    // không có ngày sinh / email trong sự kiện
    const raw = JSON.stringify(await db.query("SELECT name, props FROM events"));
    expect(raw).not.toMatch(/1990|phieu@example/);
  });
});
