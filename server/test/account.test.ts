/** Test tài khoản, lá số đã lưu, admin, log luận giải, streaming, tài liệu OpenAPI (PGlite trong bộ nhớ). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { createDb, type Db } from "../src/db/index.js";

let app: FastifyInstance;
let db: Db;
const BASE = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };

beforeAll(async () => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "admin-pass-123";
  // TEST_DATABASE_URL=postgres://... để chạy trên PostgreSQL thật (schema bị xoá sạch trước khi chạy).
  const url = process.env.TEST_DATABASE_URL ?? "";
  if (url) {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await c.end();
  }
  db = await createDb(url);
  app = await buildApp({ db, llm: async () => null, rateLimit: false });
});
afterAll(async () => {
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  await app.close();
  await db.close();
});

const req = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, token?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(email: string, password: string) {
  return (await req("POST", "/v1/auth/login", undefined, { email, password })).json().token as string;
}

describe("tài khoản", () => {
  it("đăng ký, đăng nhập, me", async () => {
    const r = await req("POST", "/v1/auth/register", undefined, { email: "Ha@Example.com", password: "12345678", name: "Hà" });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.role).toBe("user");
    // email không phân biệt hoa thường
    expect((await req("POST", "/v1/auth/register", undefined, { email: "ha@example.com", password: "12345678" })).statusCode).toBe(409);
    const token = await login("ha@example.com", "12345678");
    const me = (await req("GET", "/v1/auth/me", token)).json();
    expect(me.name).toBe("Hà");
    expect(me).not.toHaveProperty("password_hash");
  });

  it("sai mật khẩu, mật khẩu ngắn, token giả", async () => {
    expect((await req("POST", "/v1/auth/login", undefined, { email: "ha@example.com", password: "sai-roi" })).statusCode).toBe(401);
    expect((await req("POST", "/v1/auth/register", undefined, { email: "x@example.com", password: "123" })).statusCode).toBe(422);
    expect((await req("GET", "/v1/auth/me", "abc.def.ghi")).statusCode).toBe(401);
    expect((await req("GET", "/v1/auth/me")).statusCode).toBe(401);
  });
});

describe("lá số đã lưu", () => {
  it("lưu, liệt kê, xem, xoá — và không xem được của người khác", async () => {
    await req("POST", "/v1/auth/register", undefined, { email: "a@example.com", password: "12345678" });
    await req("POST", "/v1/auth/register", undefined, { email: "b@example.com", password: "12345678" });
    const a = await login("a@example.com", "12345678");
    const b = await login("b@example.com", "12345678");

    const r = await req("POST", "/v1/la-so-da-luu", a, { label: "Của tôi", input: { ...BASE, nam_xem: 2026 } });
    expect(r.statusCode).toBe(201);
    const saved = r.json();
    expect(saved.input).not.toHaveProperty("nam_xem");
    expect(saved.summary).toMatchObject({ menh: "Sửu", can_chi_nam: "Canh Ngọ" });

    expect((await req("GET", "/v1/la-so-da-luu", a)).json().items).toHaveLength(1);
    expect((await req("GET", "/v1/la-so-da-luu", b)).json().items).toHaveLength(0);
    expect((await req("GET", `/v1/la-so-da-luu/${saved.id}`, b)).statusCode).toBe(404);
    expect((await req("DELETE", `/v1/la-so-da-luu/${saved.id}`, b)).statusCode).toBe(404);
    expect((await req("DELETE", `/v1/la-so-da-luu/${saved.id}`, a)).statusCode).toBe(204);
    expect((await req("GET", "/v1/la-so-da-luu", a)).json().items).toHaveLength(0);
  });

  it("input sai → 422/400, chưa đăng nhập → 401", async () => {
    const a = await login("a@example.com", "12345678");
    expect((await req("POST", "/v1/la-so-da-luu", a, { input: { ...BASE, gio_sinh: 13 } })).statusCode).toBe(422);
    expect((await req("POST", "/v1/la-so-da-luu", a, { input: { ...BASE, ngay: 31, thang: 2 } })).statusCode).toBe(400);
    expect((await req("POST", "/v1/la-so-da-luu", undefined, { input: BASE })).statusCode).toBe(401);
  });
});

describe("admin", () => {
  it("người dùng thường bị chặn 403, admin vào được", async () => {
    const u = await login("a@example.com", "12345678");
    expect((await req("GET", "/admin/stats", u)).statusCode).toBe(403);
    expect((await req("GET", "/admin/stats")).statusCode).toBe(401);
    const ad = await login("admin@example.com", "admin-pass-123");
    const s = (await req("GET", "/admin/stats", ad)).json();
    expect(s.users).toBeGreaterThanOrEqual(4);
  });

  it("tìm người dùng, đổi quyền, không tự bỏ quyền", async () => {
    const ad = await login("admin@example.com", "admin-pass-123");
    const r = (await req("GET", "/admin/users?q=example.com&limit=2", ad)).json();
    expect(r.items).toHaveLength(2);
    expect(r.total).toBeGreaterThanOrEqual(4);
    const b = (await req("GET", "/admin/users?q=b@example", ad)).json().items[0];
    expect((await req("PATCH", `/admin/users/${b.id}`, ad, { role: "admin" })).json().role).toBe("admin");
    const me = (await req("GET", "/v1/auth/me", ad)).json();
    expect((await req("PATCH", `/admin/users/${me.id}`, ad, { role: "user" })).statusCode).toBe(400);
  });

  it("xem lá số người dùng theo email", async () => {
    const a = await login("a@example.com", "12345678");
    await req("POST", "/v1/la-so-da-luu", a, { label: "Lá số A", input: BASE });
    const ad = await login("admin@example.com", "admin-pass-123");
    const r = (await req("GET", "/admin/la-so?q=a@example", ad)).json();
    expect(r.total).toBe(1);
    expect(r.items[0].user_email).toBe("a@example.com");
  });

  it("sửa kho luận giải → báo cáo dùng nội dung mới", async () => {
    const ad = await login("admin@example.com", "admin-pass-123");
    const list = (await req("GET", "/admin/kb", ad)).json();
    expect(list.items.filter((x: any) => x.kind === "cung")).toHaveLength(12);
    expect(list.items.filter((x: any) => x.kind === "chinhTinh")).toHaveLength(14);

    const before = (await req("POST", "/v1/luan-giai", undefined, BASE)).json();
    const menh = (await req("GET", "/admin/kb/cung/Mệnh".replace("Mệnh", encodeURIComponent("Mệnh")), ad)).json();
    const data = { ...menh.data, overview: { ...menh.data.overview, detailed: "NỘI DUNG MỚI cho cung Mệnh, đủ dài để hiển thị trong báo cáo." } };
    expect((await req("PUT", `/admin/kb/cung/${encodeURIComponent("Mệnh")}`, ad, { data: { foo: 1 } })).statusCode).toBe(422);
    const r = await req("PUT", `/admin/kb/cung/${encodeURIComponent("Mệnh")}`, ad, { data });
    expect(r.statusCode).toBe(200);
    expect(r.json().updated_by).toBeTypeOf("number");
    const after = (await req("POST", "/v1/luan-giai", undefined, BASE)).json();
    expect(before.markdown).not.toContain("NỘI DUNG MỚI");
    expect(after.markdown).toContain("NỘI DUNG MỚI");
    expect((await req("GET", "/admin/kb/cung/Khong-co", ad)).statusCode).toBe(404);
  });

  it("log luận giải ghi lại, lọc được bản bị chặn", async () => {
    const ad = await login("admin@example.com", "admin-pass-123");
    await new Promise((r) => setTimeout(r, 50)); // log ghi bất đồng bộ
    const all = (await req("GET", "/admin/luan-giai-logs", ad)).json();
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.items[0]).toMatchObject({ verdict: "ĐẠT", blocked: false, use_llm: false });
    expect((await req("GET", "/admin/luan-giai-logs?blocked=true", ad)).json().total).toBe(0);
  });
});

it("LLM trượt Guardrail được log là bị chặn", async () => {
  const db2 = await createDb("");
  const app2 = await buildApp({ db: db2, rateLimit: false, llm: async () => "## Cung X\nBạn chắc chắn sẽ gặp hoạ [S99]" });
  process.env.API_KEY = "k";
  const r = (await app2.inject({ method: "POST", url: "/v1/luan-giai", payload: { ...BASE, use_llm: true }, headers: { "x-api-key": "k" } })).json();
  delete process.env.API_KEY;
  expect(r.per_cung.every((x: any) => x.mode === "offline_sau_khi_llm_truot_guardrail")).toBe(true);
  await new Promise((res) => setTimeout(res, 50));
  const [row] = await db2.query("SELECT blocked FROM luan_giai_logs");
  expect(row.blocked).toBe(true);
  await app2.close();
  await db2.close();
});

it("luận giải streaming (SSE): cach_cuc → 12 cung → done", async () => {
  const r = await app.inject({ method: "POST", url: "/v1/luan-giai/stream", payload: BASE, headers: { origin: "http://localhost:3000" } });
  expect(r.statusCode).toBe(200);
  expect(r.headers["content-type"]).toContain("text/event-stream");
  expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  const events = r.body.split("\n\n").filter(Boolean).map((b) => b.split("\n")[0].replace("event: ", ""));
  expect(events[0]).toBe("cach_cuc");
  expect(events.filter((e) => e === "cung")).toHaveLength(12);
  expect(events.at(-1)).toBe("done");
  expect((await app.inject({ method: "POST", url: "/v1/luan-giai/stream", payload: { ...BASE, ngay: 31, thang: 2 } })).statusCode).toBe(400);
});

it("tài liệu OpenAPI", async () => {
  const spec = (await app.inject("/docs/json")).json();
  expect(spec.paths).toHaveProperty("/v1/la-so");
  expect(spec.paths["/v1/la-so"].post.requestBody).toBeTruthy();
  expect((await app.inject("/docs")).statusCode).toBeLessThan(400);
});
