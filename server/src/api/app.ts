/**
 * HTTP API tử vi (Fastify) — port từ src/service/api.py, giữ nguyên hợp đồng:
 *   GET  /health, GET /v1/meta
 *   POST /v1/la-so, /v1/luu-nien, /v1/luan-giai
 *   POST /chart, /interpret, GET /viewer   (tương thích laso_viewer.html)
 * Lỗi kiểu dữ liệu → 422 {detail: [...]}; lỗi giá trị (ngày không tồn tại...) → 400 {error}.
 */
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import * as ia from "../agents/interpretation.js";
import { loadKb, type KB } from "../agents/kb.js";
import { buildReport, luanCung, type Report } from "../agents/orchestrator.js";
import { nhanDienCachCuc } from "../engine/cachCuc.js";
import { CHI, KINH_DO_TINH, chiCuaGio, quyDoiGio, type HieuChinhGio } from "../engine/thoiGian.js";
import { InputError, lapLaSo, type Chart } from "../engine/tuviEngine.js";
import * as vanHan from "../engine/vanHan.js";
import { pysorted } from "../lib/py.js";
import { LruCache } from "../lib/lru.js";
import { BIRTH_KEYS, BirthInput, InterpretInput, ReportInput, YearInput } from "./schemas.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWER = join(HERE, "..", "..", "data", "laso_viewer.html");

class ValidationError extends Error {
  constructor(public detail: unknown[]) {
    super("validation error");
  }
}

class HttpError extends Error {
  constructor(public statusCode: number, public detail: string) {
    super(detail);
  }
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => ({
      type: i.code, loc: ["body", ...i.path], msg: i.message,
    })));
  }
  return r.data;
}

function chartKey(body: BirthInput): string {
  const o: Record<string, unknown> = {};
  for (const k of BIRTH_KEYS) o[k] = body[k];
  return JSON.stringify(o);
}

function apiKeyHopLe(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AppOptions {
  kb?: KB;
  llm?: ia.LlmFn;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const kb = opts.kb ?? loadKb();
  const llm = opts.llm ?? ia.generateLlm;
  const chartCache = new LruCache<string, string>(2048);
  const reportCache = new LruCache<string, Promise<Report>>(512);

  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
      .split(",").map((o) => o.trim()).filter(Boolean),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: "*",
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.status(422).send({ detail: err.detail });
    if (err instanceof InputError) return reply.status(400).send({ error: err.message });
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ detail: err.detail });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ detail: e.message });
    app.log.error(err);
    return reply.status(500).send({ detail: "Internal Server Error" });
  });

  function tinhLaSo(body: BirthInput): Chart {
    const key = chartKey(body);
    const hit = chartCache.get(key);
    if (hit) return JSON.parse(hit);
    let hieuChinh: HieuChinhGio | null = null;
    let { ngay, thang, nam, gio_sinh: gioSinh } = body;
    if (body.gio !== null) {
      if (body.duong_lich) {
        const kd = body.tinh ? KINH_DO_TINH[body.tinh] : body.kinh_do;
        const [q, hc] = quyDoiGio(ngay, thang, nam, body.gio, body.phut, kd, body.utc_offset_phut, body.quy_tac_ty);
        hieuChinh = hc;
        ({ ngay, thang, nam, gio_sinh: gioSinh } = q);
      } else {
        gioSinh = chiCuaGio(body.gio, body.phut);
      }
    }
    const chart = lapLaSo(ngay, thang, nam, gioSinh as number, body.gioi_tinh, {
      duongLich: body.duong_lich, thangNhuan: body.thang_nhuan, nhuanPolicy: body.nhuan_policy,
    });
    chart.hieu_chinh_gio = hieuChinh;
    const s = JSON.stringify(chart);
    chartCache.set(key, s);
    return JSON.parse(s);
  }

  function baoCao(body: BirthInput, useLlm: boolean): Promise<Report> {
    const key = chartKey(body) + "|" + useLlm;
    let p = reportCache.get(key);
    if (!p) {
      p = buildReport(tinhLaSo(body), kb, useLlm, llm);
      // không giữ lại kết quả lỗi trong cache
      p.catch(() => reportCache.delete(key));
      reportCache.set(key, p);
    }
    return p;
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/v1/meta", async () => ({
    gio: CHI.map((c, i) => ({ gio_sinh: i + 1, chi: c })),
    tinh: pysorted(Object.keys(KINH_DO_TINH)),
  }));

  app.post("/v1/la-so", async (req) => {
    const c = tinhLaSo(parse(BirthInput, req.body));
    return { chart: c, dai_han: vanHan.danhSachDaiHan(c), cach_cuc: nhanDienCachCuc(c) };
  });

  app.post("/v1/luu-nien", async (req) => {
    const body = parse(YearInput, req.body);
    const c = tinhLaSo(body);
    return { luu_nien: vanHan.luuNien(c, body.nam_xem), luu_nguyet: vanHan.luuNguyet(c, body.nam_xem) };
  });

  app.post("/v1/luan-giai", async (req) => {
    const body = parse(ReportInput, req.body);
    if (body.use_llm) {
      // chỉ bản LLM tốn tiền
      const can = process.env.API_KEY;
      const given = req.headers["x-api-key"];
      if (can && !apiKeyHopLe(typeof given === "string" ? given : undefined, can)) throw new HttpError(401, "Sai API key");
    }
    tinhLaSo(body);
    return baoCao(body, body.use_llm);
  });

  // ---- Tương thích laso_viewer.html ----
  app.post("/chart", async (req) => tinhLaSo(parse(BirthInput, req.body)));

  app.post("/interpret", async (req) => {
    const body = parse(InterpretInput, req.body);
    const c = tinhLaSo(body);
    const pal = c.palaces.find((p) => ia.norm(String(p.cung)) === ia.norm(body.cung));
    if (!pal) throw new InputError("Không có cung " + body.cung);
    const k = await luanCung(pal, kb, nhanDienCachCuc(c));
    const g = k.guardrail;
    return {
      interpretation: k.text,
      sources: k.chunks.map((x) => ({ id: x.id, label: x.source + " — " + x.field })),
      guardrail: { passed: g.passed, fail: g.fail, verdict: g.passed === g.total ? "ĐẠT" : "CẢNH BÁO" },
    };
  });

  app.get("/viewer", async (_req, reply) => reply.type("text/html; charset=utf-8").send(readFileSync(VIEWER)));

  return app;
}
