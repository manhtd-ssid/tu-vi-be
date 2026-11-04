/** Test đăng nhập Google (giả lập OAuth) và giới thiệu bạn bè (giảm giá, thưởng lượt, chống lạm dụng, hoàn tiền). */
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { fakeGoogle, realGoogle } from "../src/auth/google.js";
import { createDb, type Db } from "../src/db/index.js";

const ENV = {
  ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "admin-pass-123",
  SEPAY_BANK: "MBBank", SEPAY_ACCOUNT_NUMBER: "0123456789", SEPAY_WEBHOOK_KEY: "whk",
  APP_URL: "http://web.test",
};
let app: FastifyInstance;
let db: Db;
let ad: string;

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
  app = await buildApp({ db, rateLimit: false, mailer: { send: async () => undefined }, google: fakeGoogle() });
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
const cookieOf = (r: LightMyRequestResponse, name: string) =>
  (r.cookies as { name: string; value: string }[]).find((c) => c.name === name)?.value;

async function khach(email: string) {
  const r = (await req("POST", "/v1/auth/register", undefined, { email, password: "12345678" })).json();
  await db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [r.user.id]);
  return r.token as string;
}
const webhook = (content: string, amount: number) => req("POST", "/v1/payments/sepay/webhook", undefined,
  { id: Math.floor(Math.random() * 1e9), transferType: "in", transferAmount: amount, content }, { authorization: "Apikey whk" });
const credits = async (t: string) => (await req("GET", "/v1/me/credits", t)).json().credits_left as number;

/** Đi hết luồng Google giả lập: start → callback (mang cookie state) → trả response callback. */
async function googleLogin(email: string, next = "/la-so?x=1") {
  const start = await req("GET", `/v1/auth/google/start?next=${encodeURIComponent(next)}&hint=${encodeURIComponent(email)}`);
  expect(start.statusCode).toBe(302);
  const loc = new URL(start.headers.location as string);
  const st = cookieOf(start, "tuvi_oauth")!;
  return req("GET", loc.pathname + loc.search, undefined, undefined, { cookie: `tuvi_oauth=${st}` });
}

describe("đăng nhập Google", () => {
  it("providers báo đã bật", async () => {
    expect((await req("GET", "/v1/auth/providers")).json()).toEqual({ google: true });
  });

  it("tài khoản mới: tạo user đã xác nhận email, không có mật khẩu, đặt cookie phiên, quay về trang web", async () => {
    const cb = await googleLogin("Moi.Google@gmail.com");
    expect(cb.statusCode).toBe(302);
    const to = new URL(cb.headers.location as string);
    expect(to.origin + to.pathname).toBe("http://web.test/dang-nhap/google");
    expect(to.searchParams.get("next")).toBe("/la-so?x=1");
    expect(to.searchParams.get("moi")).toBe("1");
    const ses = cookieOf(cb, "tuvi_session")!;
    const me = (await req("GET", "/v1/auth/me", undefined, undefined, { cookie: `tuvi_session=${ses}` })).json();
    expect(me).toMatchObject({ email: "Moi.Google@gmail.com", email_verified: true, has_password: false });

    // Đăng nhập lần 2: cùng tài khoản, không phải "mới"
    const cb2 = await googleLogin("moi.google@gmail.com");
    expect(new URL(cb2.headers.location as string).searchParams.get("moi")).toBeNull();
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE lower(email) = 'moi.google@gmail.com'");
    expect(n).toBe(1);

    // Đăng nhập mật khẩu: báo rõ là tài khoản Google
    const lg = await req("POST", "/v1/auth/login", undefined, { email: "moi.google@gmail.com", password: "bat-ky-123" });
    expect(lg.statusCode).toBe(401);
    expect(lg.json().detail).toMatch(/đăng nhập bằng Google/);

    // Đặt mật khẩu lần đầu không cần mật khẩu cũ, sau đó đăng nhập mật khẩu được
    const set = await req("POST", "/v1/auth/change-password", undefined, { current_password: "", new_password: "matkhau-moi-1" },
      { cookie: `tuvi_session=${ses}`, "x-tuvi-csrf": "1" });
    expect(set.statusCode).toBe(200);
    expect(set.json().user.has_password).toBe(true);
    expect((await req("POST", "/v1/auth/login", undefined, { email: "moi.google@gmail.com", password: "matkhau-moi-1" })).statusCode).toBe(200);
  });

  it("email đã đăng ký bằng mật khẩu (chưa xác nhận) → gắn Google vào tài khoản cũ, coi như đã xác nhận", async () => {
    const r = (await req("POST", "/v1/auth/register", undefined, { email: "cu@example.com", password: "12345678" })).json();
    expect(r.user.email_verified).toBe(false);
    const cb = await googleLogin("cu@example.com");
    const ses = cookieOf(cb, "tuvi_session")!;
    const me = (await req("GET", "/v1/auth/me", undefined, undefined, { cookie: `tuvi_session=${ses}` })).json();
    expect(me).toMatchObject({ id: r.user.id, email_verified: true, has_password: true });
  });

  it("state sai hoặc thiếu cookie → về trang đăng nhập với lỗi, không cấp phiên", async () => {
    const start = await req("GET", "/v1/auth/google/start?hint=x@example.com");
    const loc = new URL(start.headers.location as string);
    const noCookie = await req("GET", loc.pathname + loc.search);
    expect(new URL(noCookie.headers.location as string).pathname).toBe("/dang-nhap");
    expect(cookieOf(noCookie, "tuvi_session")).toBeUndefined();

    const st = cookieOf(start, "tuvi_oauth")!;
    loc.searchParams.set("state", "khac");
    const bad = await req("GET", loc.pathname + loc.search, undefined, undefined, { cookie: `tuvi_oauth=${st}` });
    const to = new URL(bad.headers.location as string);
    expect(to.pathname).toBe("/dang-nhap");
    expect(to.searchParams.get("loi")).toMatch(/không hợp lệ/);
    expect(cookieOf(bad, "tuvi_session")).toBeUndefined();
  });

  it("next ra ngoài trang (//evil.com) bị thay bằng trang mặc định", async () => {
    const cb = await googleLogin("next@example.com", "//evil.com/x");
    expect(new URL(cb.headers.location as string).searchParams.get("next")).toBe("/la-so-cua-toi");
  });

  it("Google thật: kiểm aud/iss/exp của id_token", async () => {
    const tok = (p: object) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.s`;
    const ok = { aud: "cid", iss: "https://accounts.google.com", exp: Date.now() / 1000 + 600, sub: "1", email: "a@b.c", email_verified: true, name: "A" };
    const g = (p: object) => realGoogle("cid", "sec", (async () => new Response(JSON.stringify({ id_token: tok(p) }))) as typeof fetch);
    await expect(g(ok).exchange("c", "r")).resolves.toMatchObject({ sub: "1", email: "a@b.c", email_verified: true });
    await expect(g({ ...ok, aud: "khac" }).exchange("c", "r")).rejects.toThrow(/không dành cho/);
    await expect(g({ ...ok, iss: "evil" }).exchange("c", "r")).rejects.toThrow(/nơi phát hành/);
    await expect(g({ ...ok, exp: 1 }).exchange("c", "r")).rejects.toThrow(/hết hạn/);
    expect(g(ok).authUrl("s", "http://api/cb", "h@x")).toContain("login_hint=h%40x");
  });
});

describe("giới thiệu bạn bè", () => {
  let a: string;
  let maA: string;
  beforeAll(async () => {
    a = await khach("gioithieu-a@example.com");
    const r = (await req("GET", "/v1/me/referral", a)).json();
    maA = r.code;
    expect(r).toMatchObject({ enabled: true, percent: 20, reward_credits: 1, ban_da_mua: 0, luot_da_nhan: 0 });
    expect(r.link).toBe(`http://web.test/?ref=${maA}`);
    expect(maA).toMatch(/^BAN[A-Z0-9]{6}$/);
    expect((await req("GET", "/v1/me/referral", a)).json().code).toBe(maA); // ổn định
  });

  it("không dùng được mã của chính mình", async () => {
    const r = await req("POST", "/v1/coupons/check", a, { plan_code: "GOI_5", code: maA });
    expect(r.statusCode).toBe(400);
    expect(r.json().detail).toMatch(/chính mình/);
  });

  it("bạn dùng mã → giảm 20%, thanh toán → người giới thiệu +1 lượt; dùng lần 2 bị chặn", async () => {
    const b = await khach("gioithieu-b@example.com");
    const chk = (await req("POST", "/v1/coupons/check", b, { plan_code: "GOI_5", code: maA.toLowerCase() })).json();
    expect(chk).toMatchObject({ loai: "referral", code: maA, discount: 29800, amount: 119200 });
    expect(chk.note).not.toMatch(/gioithieu-a/); // không lộ email người giới thiệu

    const o = (await req("POST", "/v1/orders", b, { plan_code: "GOI_5", coupon_code: maA })).json();
    expect(o).toMatchObject({ amount: 119200, discount_amount: 29800, referral_code: maA, coupon_code: null });
    // Tạo lại: dùng lại đơn chờ, không báo "đã dùng"
    expect((await req("POST", "/v1/orders", b, { plan_code: "GOI_5", coupon_code: maA })).json().id).toBe(o.id);
    expect(await credits(a)).toBe(0);
    await webhook(o.code, 119200);
    expect(await credits(a)).toBe(1);
    expect(await credits(b)).toBe(5);
    expect((await req("GET", "/v1/me/referral", a)).json()).toMatchObject({ ban_da_mua: 1, luot_da_nhan: 1 });

    const lai = await req("POST", "/v1/coupons/check", b, { plan_code: "MO_KHOA_1", code: maA });
    expect(lai.statusCode).toBe(400);
    expect(lai.json().detail).toMatch(/lần đầu|đã dùng/);
  });

  it("chỉ khách mua lần đầu (mặc định); tắt điều kiện thì khách cũ dùng được một lần", async () => {
    const c = await khach("gioithieu-c@example.com");
    const o = (await req("POST", "/v1/orders", c, { plan_code: "MO_KHOA_1" })).json();
    await webhook(o.code, o.amount);
    const r = await req("POST", "/v1/coupons/check", c, { plan_code: "GOI_5", code: maA });
    expect(r.json().detail).toMatch(/lần đầu/);

    const cfg = (await req("GET", "/admin/referrals", ad)).json().settings;
    expect((await req("PUT", "/admin/referral-settings", ad, { ...cfg, chi_khach_moi: false, percent: 30, reward_credits: 2 })).statusCode).toBe(200);
    const r2 = (await req("POST", "/v1/coupons/check", c, { plan_code: "GOI_5", code: maA })).json();
    expect(r2.discount).toBe(44700);
    const o2 = (await req("POST", "/v1/orders", c, { plan_code: "GOI_5", coupon_code: maA })).json();
    await webhook(o2.code, o2.amount);
    expect(await credits(a)).toBe(3); // 1 + 2

    // Nhật ký admin ghi thay đổi cấu hình
    const au = (await req("GET", "/admin/audit?action=referral.settings", ad)).json();
    expect(au.items[0]).toMatchObject({ target_type: "setting", target_id: "referral" });
    expect(au.items[0].before.percent).toBe(20);
    expect(au.items[0].after.percent).toBe(30);
    await req("PUT", "/admin/referral-settings", ad, cfg);
  });

  it("hoàn tiền đơn của bạn → thu hồi lượt thưởng chưa dùng", async () => {
    const d = await khach("gioithieu-d@example.com");
    const o = (await req("POST", "/v1/orders", d, { plan_code: "MO_KHOA_1", coupon_code: maA })).json();
    await webhook(o.code, o.amount);
    expect(await credits(a)).toBe(4);
    const rf = await req("POST", `/admin/orders/${o.id}/refund`, ad, { amount: o.amount, note: "khách đổi ý" });
    expect(rf.statusCode).toBe(200);
    expect(await credits(a)).toBe(3);
    const au = (await req("GET", `/admin/audit?action=order.refund&target_id=${o.id}`, ad)).json();
    expect(au.items[0].after.luot_thuong_gioi_thieu_thu_hoi).toBe(1);
  });

  it("tắt chương trình → mã giới thiệu không dùng được; giới hạn số lần thưởng", async () => {
    const cfg = (await req("GET", "/admin/referrals", ad)).json().settings;
    await req("PUT", "/admin/referral-settings", ad, { ...cfg, enabled: false });
    const e = await khach("gioithieu-e@example.com");
    const r = await req("POST", "/v1/coupons/check", e, { plan_code: "GOI_5", code: maA });
    expect(r.json().detail).toMatch(/tạm dừng/);

    await req("PUT", "/admin/referral-settings", ad, { ...cfg, enabled: true, max_rewards_per_referrer: 1 });
    const truoc = await credits(a);
    const o = (await req("POST", "/v1/orders", e, { plan_code: "MO_KHOA_1", coupon_code: maA })).json();
    await webhook(o.code, o.amount);
    expect(await credits(a)).toBe(truoc); // A đã được thưởng nhiều lần hơn giới hạn → không thưởng thêm
    await req("PUT", "/admin/referral-settings", ad, cfg);
  });

  it("đồng thời: một người tạo nhiều đơn cùng lúc với mã giới thiệu → chỉ một đơn giữ mã", async () => {
    const f = await khach("gioithieu-f@example.com");
    const rs = await Promise.all(["GOI_5", "GOI_15", "MO_KHOA_1"].map((p) => req("POST", "/v1/orders", f, { plan_code: p, coupon_code: maA })));
    expect(rs.filter((r) => r.statusCode === 201 || r.statusCode === 200).length).toBe(1);
  });

  it("admin: thống kê + bảng xếp hạng; không tạo được mã giảm giá trùng mã giới thiệu", async () => {
    const r = (await req("GET", "/admin/referrals", ad)).json();
    expect(r.tong.nguoi_gioi_thieu).toBe(1);
    expect(r.top[0]).toMatchObject({ email: "gioithieu-a@example.com", referral_code: maA });
    expect(r.top[0].don_tra).toBeGreaterThanOrEqual(3);
    const dup = await req("PUT", `/admin/coupons/${maA}`, ad, { kind: "percent", value: 10 });
    expect(dup.statusCode).toBe(409);
    // Phễu gom đơn giới thiệu thành một dòng
    const f = (await req("GET", "/admin/funnel?days=30", ad)).json();
    expect(f.theo_goi.some((x: { coupon_code: string }) => x.coupon_code === "GIỚI THIỆU")).toBe(true);
  });
});
