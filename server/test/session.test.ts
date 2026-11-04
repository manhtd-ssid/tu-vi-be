/** Test email (xác thực, quên mật khẩu, biên nhận), phiên cookie + CSRF, giới hạn request, chi phí LLM. */
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { createDb, type Db } from "../src/db/index.js";
import type { Mail, Mailer } from "../src/email/mailer.js";

const ENV = {
  ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "admin-pass-123", APP_URL: "https://tuvi.example",
  SEPAY_BANK: "MBBank", SEPAY_ACCOUNT_NUMBER: "0123456789", SEPAY_WEBHOOK_KEY: "whk", API_KEY: "noi-bo",
};
let app: FastifyInstance;
let db: Db;
const sent: Mail[] = [];
const mailer: Mailer = { send: async (m) => void sent.push(m) };
const BASE = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };

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
    db, mailer, rateLimit: false,
    llm: async (p) => {
      const m = p.user.match(/'## (Cung [^']+)'/);
      return { text: `## ${m?.[1] ?? "Cung"}\nĐoạn luận AI [S1].`, model: "claude-sonnet-5-5", input_tokens: 1000, output_tokens: 500 };
    },
  });
});
afterAll(async () => {
  for (const k of [...Object.keys(ENV), "LLM_DAILY_BUDGET_USD"]) delete process.env[k];
  await app.close();
  await db.close();
});

type M = "GET" | "POST" | "PATCH";
const req = (method: M, url: string, opts: { token?: string; cookie?: string; csrf?: boolean; body?: object; headers?: Record<string, string> } = {}) =>
  app.inject({
    method, url, payload: opts.body,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: `tuvi_session=${opts.cookie}` } : {}),
      ...(opts.csrf ? { "x-tuvi-csrf": "1" } : {}),
      ...opts.headers,
    },
  });
const linkToken = (m: Mail) => decodeURIComponent(m.text.match(/token=([^\s]+)/)![1]);
const cookieOf = (r: LightMyRequestResponse) => r.cookies.find((c) => c.name === "tuvi_session");

describe("xác thực email", () => {
  it("đăng ký gửi email xác nhận; chưa xác nhận thì không mua được", async () => {
    sent.length = 0;
    const r = await req("POST", "/v1/auth/register", { body: { email: "moi@example.com", password: "12345678" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.email_verified).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "moi@example.com", kind: "verify" });
    expect(sent[0].text).toContain("https://tuvi.example/xac-thuc-email?token=");
    const token = r.json().token;
    const o = await req("POST", "/v1/orders", { token, body: { plan_code: "MO_KHOA_1" } });
    expect(o.statusCode).toBe(403);

    // gửi lại ngay → chặn 60 giây
    expect((await req("POST", "/v1/auth/resend-verification", { token })).statusCode).toBe(429);

    const v = await req("POST", "/v1/auth/verify-email", { body: { token: linkToken(sent[0]) } });
    expect(v.json()).toEqual({ ok: true });
    expect((await req("GET", "/v1/auth/me", { token })).json().email_verified).toBe(true);
    expect((await req("POST", "/v1/auth/verify-email", { body: { token: linkToken(sent[0]) } })).statusCode).toBe(400);
    expect((await req("POST", "/v1/orders", { token, body: { plan_code: "MO_KHOA_1" } })).statusCode).toBe(201);
    // DB chỉ lưu bản băm của token
    const [row] = await db.query("SELECT token_hash FROM email_tokens LIMIT 1");
    expect(row.token_hash).not.toBe(linkToken(sent[0]));
  });

  it("thanh toán xong gửi email biên nhận", async () => {
    sent.length = 0;
    const token = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "12345678" } })).json().token;
    const o = (await req("POST", "/v1/orders", { token, body: { plan_code: "MO_KHOA_1" } })).json();
    await req("POST", "/v1/payments/sepay/webhook", {
      headers: { authorization: "Apikey whk" },
      body: { id: 9001, transferType: "in", transferAmount: o.amount, content: o.code },
    });
    const bn = sent.find((m) => m.kind === "receipt");
    expect(bn?.to).toBe("moi@example.com");
    expect(bn?.subject).toContain(o.code);
    expect(bn?.text).toContain("49.000");
  });
});

describe("quên / đặt lại / đổi mật khẩu", () => {
  it("quên mật khẩu: trả lời giống nhau, chỉ gửi khi email tồn tại, 60 giây một lần", async () => {
    sent.length = 0;
    const a = await req("POST", "/v1/auth/forgot", { body: { email: "khong-co@example.com" } });
    const b = await req("POST", "/v1/auth/forgot", { body: { email: "MOI@example.com" } });
    expect(a.json()).toEqual(b.json());
    expect(sent.map((m) => m.kind)).toEqual(["reset"]);
    await req("POST", "/v1/auth/forgot", { body: { email: "moi@example.com" } });
    expect(sent).toHaveLength(1);
  });

  it("đặt lại: mật khẩu mới dùng được, phiên cũ hết hiệu lực, link chỉ dùng một lần", async () => {
    const old = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "12345678" } })).json().token;
    const tok = linkToken(sent[0]);
    expect((await req("POST", "/v1/auth/reset", { body: { token: tok, password: "ngan" } })).statusCode).toBe(422);
    const r = await req("POST", "/v1/auth/reset", { body: { token: tok, password: "mat-khau-moi-1" } });
    expect(r.statusCode).toBe(200);
    expect(cookieOf(r)?.httpOnly).toBe(true);
    expect((await req("GET", "/v1/auth/me", { token: old })).statusCode).toBe(401);
    expect((await req("GET", "/v1/auth/me", { token: r.json().token })).statusCode).toBe(200);
    expect((await req("POST", "/v1/auth/reset", { body: { token: tok, password: "mat-khau-moi-2" } })).statusCode).toBe(400);
    expect((await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "12345678" } })).statusCode).toBe(401);
    expect((await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-1" } })).statusCode).toBe(200);
  });

  it("đổi mật khẩu: sai mật khẩu cũ bị từ chối; đổi xong các phiên khác bị đăng xuất", async () => {
    const t1 = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-1" } })).json().token;
    const t2 = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-1" } })).json().token;
    expect((await req("POST", "/v1/auth/change-password", { token: t1, body: { current_password: "sai", new_password: "mat-khau-moi-3" } })).statusCode).toBe(400);
    const r = await req("POST", "/v1/auth/change-password", { token: t1, body: { current_password: "mat-khau-moi-1", new_password: "mat-khau-moi-3" } });
    expect(r.statusCode).toBe(200);
    expect((await req("GET", "/v1/auth/me", { token: t2 })).statusCode).toBe(401);
    expect((await req("GET", "/v1/auth/me", { token: r.json().token })).statusCode).toBe(200);
    expect((await req("PATCH", "/v1/auth/me", { token: r.json().token, body: { name: "Thu Hà" } })).json().name).toBe("Thu Hà");
  });
});

describe("phiên cookie + CSRF", () => {
  it("đăng nhập đặt cookie httpOnly; đọc được bằng cookie; ghi dữ liệu cần header CSRF", async () => {
    const r = await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-3" } });
    const c = cookieOf(r)!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect((await req("GET", "/v1/auth/me", { cookie: c.value })).json().email).toBe("moi@example.com");
    const body = { label: "x", input: BASE };
    expect((await req("POST", "/v1/la-so-da-luu", { cookie: c.value, body })).statusCode).toBe(403);
    expect((await req("POST", "/v1/la-so-da-luu", { cookie: c.value, csrf: true, body })).statusCode).toBe(201);
    // Bearer không cần header CSRF (trình duyệt không tự gửi Bearer)
    expect((await req("POST", "/v1/la-so-da-luu", { token: c.value, body })).statusCode).toBe(201);
    const out = await req("POST", "/v1/auth/logout", { cookie: c.value, csrf: true });
    expect(cookieOf(out)?.value).toBe("");
  });

  it("đăng xuất mọi nơi; thu hồi quyền admin có hiệu lực ngay", async () => {
    const t = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-3" } })).json().token;
    expect((await req("POST", "/v1/auth/logout-all", { token: t })).statusCode).toBe(200);
    expect((await req("GET", "/v1/auth/me", { token: t })).statusCode).toBe(401);

    const ad = (await req("POST", "/v1/auth/login", { body: { email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD } })).json();
    expect(ad.user.email_verified).toBe(true);
    const t2 = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-3" } })).json();
    await req("PATCH", `/admin/users/${t2.user.id}`, { token: ad.token, body: { role: "admin" } });
    expect((await req("GET", "/admin/stats", { token: t2.token })).statusCode).toBe(200);
    await req("PATCH", `/admin/users/${t2.user.id}`, { token: ad.token, body: { role: "user" } });
    expect((await req("GET", "/admin/stats", { token: t2.token })).statusCode).toBe(403);
  });
});

describe("chi phí LLM", () => {
  it("ghi token + chi phí mỗi lần luận giải AI; vượt ngân sách ngày thì dừng AI, không trừ lượt", async () => {
    const r = await req("POST", "/v1/luan-giai", { headers: { "x-api-key": "noi-bo" }, body: { ...BASE, use_llm: true } });
    expect(r.statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 50));
    const [log] = await db.query("SELECT llm_calls, input_tokens, output_tokens, cost_usd::float AS cost, llm_model FROM luan_giai_logs WHERE use_llm ORDER BY id DESC LIMIT 1");
    // 12 cung × (1000 × $2 + 500 × $10) / 1e6
    expect(log).toMatchObject({ llm_calls: 12, input_tokens: 12000, output_tokens: 6000, llm_model: "claude-sonnet-5-5" });
    expect(log.cost).toBeCloseTo(0.084, 6);

    const ad = (await req("POST", "/v1/auth/login", { body: { email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD } })).json().token;
    const s = (await req("GET", "/admin/billing/stats", { token: ad })).json();
    expect(s.chi_phi_llm_hom_nay).toBeCloseTo(0.084, 6);

    process.env.LLM_DAILY_BUDGET_USD = "0.05";
    const u = (await req("POST", "/v1/auth/login", { body: { email: "moi@example.com", password: "mat-khau-moi-3" } })).json().token;
    const truoc = (await req("GET", "/v1/me/credits", { token: u })).json().credits_left;
    const chan = await req("POST", "/v1/luan-giai", { token: u, body: { ngay: 1, thang: 2, nam: 2000, gio_sinh: 3, gioi_tinh: -1, use_llm: true } });
    expect(chan.statusCode).toBe(503);
    expect((await req("GET", "/v1/me/credits", { token: u })).json().credits_left).toBe(truoc);
    delete process.env.LLM_DAILY_BUDGET_USD;
  });
});

it("giới hạn request: đăng nhập sai liên tục bị chặn 429", async () => {
  const db2 = await createDb("");
  const app2 = await buildApp({ db: db2, mailer, rateLimit: true });
  let last = 0;
  for (let i = 0; i < 21; i++) {
    last = (await app2.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "x@example.com", password: "sai" } })).statusCode;
  }
  expect(last).toBe(429);
  const r = await app2.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "x@example.com", password: "sai" } });
  expect(r.json().detail).toContain("thử lại sau");
  await app2.close();
  await db2.close();
});
