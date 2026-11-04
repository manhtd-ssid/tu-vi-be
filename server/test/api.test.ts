/** Test HTTP API — port từ src/test_api.py. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/api/app.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ llm: async () => null, rateLimit: false });
});
afterEach(() => {
  delete process.env.API_KEY;
});

const BASE = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };
const { gio_sinh: _g, ...NO_GIO } = BASE;
const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload, headers });

it("health, meta", async () => {
  expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
  expect((await app.inject("/v1/meta")).json().tinh).toHaveLength(63);
});

it("lá số", async () => {
  const d = (await post("/v1/la-so", BASE)).json();
  expect(d.chart.palaces).toHaveLength(12);
  expect(d.dai_han).toHaveLength(12);
  expect(d.cach_cuc.length).toBeGreaterThan(0);
});

it("giờ đồng hồ và nơi sinh", async () => {
  const d = (await post("/v1/la-so", { ...NO_GIO, gio: 12, phut: 0, tinh: "Hà Nội" })).json();
  expect(d.chart.hieu_chinh_gio.chan_thai_duong).toBe(true);
  expect(d.chart.input.gio_sinh).toBe(7);
});

describe("input sai bị chặn (422)", () => {
  it.each([
    ["vừa gio_sinh vừa gio", { ...BASE, gio: 12 }],
    ["thiếu giờ", NO_GIO],
    ["tỉnh lạ", { ...BASE, tinh: "Atlantis" }],
    ["giới tính 0", { ...BASE, gioi_tinh: 0 }],
    ["gio_sinh 13", { ...BASE, gio_sinh: 13 }],
  ])("%s", async (_t, body) => {
    expect((await post("/v1/la-so", body)).statusCode).toBe(422);
  });
});

it("ngày không tồn tại → 400", async () => {
  const r = await post("/v1/la-so", { ...BASE, ngay: 31, thang: 2 });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toHaveProperty("error");
});

it("lưu niên", async () => {
  const d = (await post("/v1/luu-nien", { ...BASE, nam_xem: 2026 })).json();
  expect(d.luu_nien.can_chi).toBe("Bính Ngọ");
  expect(d.luu_nguyet).toHaveLength(12);
});

it("luận giải offline", async () => {
  const d = (await post("/v1/luan-giai", BASE)).json();
  expect(d.verdict).toBe("ĐẠT");
  expect(d.markdown).toContain("BÁO CÁO");
});

it("LLM cần API key", async () => {
  process.env.API_KEY = "k";
  expect((await post("/v1/luan-giai", { ...BASE, use_llm: true })).statusCode).toBe(401);
  expect((await post("/v1/luan-giai", { ...BASE, use_llm: true }, { "x-api-key": "k" })).statusCode).toBe(200);
});

it("tương thích viewer", async () => {
  const c = (await post("/chart", BASE)).json();
  const d = (await post("/interpret", { ...BASE, cung: c.palaces[1].cung })).json();
  expect(d.guardrail.verdict).toBe("ĐẠT");
  expect(d.sources.length).toBeGreaterThan(0);
  expect((await app.inject("/viewer")).statusCode).toBe(200);
});

it("CORS cho origin trong danh sách", async () => {
  const r = await app.inject({ method: "OPTIONS", url: "/v1/la-so", headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" } });
  expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
});
