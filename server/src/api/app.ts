/**
 * HTTP API tử vi (Fastify).
 *
 * Nhóm route:
 *   core   (routes/core.ts)   — lá số, lưu niên, luận giải (+ streaming), meta, viewer. Hợp đồng
 *                               giữ nguyên bản Python src/service/api.py.
 *   auth   (routes/auth.ts)   — đăng ký, đăng nhập (JWT), thông tin tài khoản.
 *   charts (routes/charts.ts) — lá số đã lưu của người dùng.
 *   admin  (routes/admin.ts)  — thống kê, người dùng, lá số, kho luận giải, log luận giải.
 *   billing (routes/billing.ts, routes/adminBilling.ts) — gói, đơn hàng, webhook SePay, lượt AI.
 * Tài liệu OpenAPI: GET /docs.
 * Lỗi kiểu dữ liệu → 422 {detail: [...]}; lỗi giá trị → 400 {error}; lỗi khác → {detail}.
 */
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import * as ia from "../agents/interpretation.js";
import type { KB } from "../agents/kb.js";
import { KbStore } from "../agents/kbStore.js";
import { createDb, type Db } from "../db/index.js";
import { InputError } from "../engine/tuviEngine.js";
import { hashPassword } from "../lib/password.js";
import { createMailer, type Mailer } from "../email/mailer.js";
import { googleFromEnv, type GoogleOAuth } from "../auth/google.js";
import { HttpError, ValidationError, canCsrfHeader } from "./http.js";
import { Billing } from "../billing/billing.js";
import { adminBillingRoutes } from "./routes/adminBilling.js";
import { adminRoutes } from "./routes/admin.js";
import { billingRoutes } from "./routes/billing.js";
import { authRoutes } from "./routes/auth.js";
import { chartRoutes } from "./routes/charts.js";
import { coreRoutes } from "./routes/core.js";
import { ChartService } from "./service.js";

export interface AppOptions {
  /** Database đã mở sẵn (test). Mặc định mở theo DATABASE_URL. */
  db?: Db;
  /** Dữ liệu seed kho luận giải khi database trống (mặc định data/kb.json). */
  kbSeed?: () => KB;
  llm?: ia.LlmFn;
  logger?: boolean;
  /** Bật giới hạn số request (mặc định bật; test tắt để không vướng giới hạn). */
  rateLimit?: boolean;
  mailer?: Mailer;
  /** Đăng nhập Google (test truyền bản giả lập). Mặc định đọc GOOGLE_CLIENT_ID/SECRET hoặc GOOGLE_OAUTH=fake. */
  google?: GoogleOAuth | null;
}

declare module "fastify" {
  interface FastifyInstance {
    svc: ChartService;
    db: Db;
    billing: Billing;
    mailer: Mailer;
    google: GoogleOAuth | null;
    /** Cấu hình giới hạn request cho route; trả {} khi tắt giới hạn. */
    limit: (max: number, timeWindow: string, theoNguoiDung?: boolean) => object;
  }
}

function jwtSecret(log: FastifyInstance["log"]): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("Thiếu JWT_SECRET trong môi trường production");
  log.warn("JWT_SECRET chưa đặt — dùng khoá ngẫu nhiên, token mất hiệu lực khi khởi động lại");
  return randomBytes(32).toString("hex");
}

/** Tạo/cập nhật tài khoản admin từ ADMIN_EMAIL + ADMIN_PASSWORD (nếu có). */
async function bootstrapAdmin(db: Db): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return;
  const hash = await hashPassword(pw);
  await db.query(
    `INSERT INTO users (email, name, password_hash, role, email_verified_at) VALUES ($1, 'Admin', $2, 'admin', now())
     ON CONFLICT ((lower(email))) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash,
       email_verified_at = coalesce(users.email_verified_at, now())`,
    [email, hash]);
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  // TRUST_PROXY=1 khi chạy sau load balancer/reverse proxy để lấy đúng IP người dùng (giới hạn request theo IP)
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1 << 20, trustProxy: process.env.TRUST_PROXY === "1" });
  const db = opts.db ?? (await createDb());
  const kb = await KbStore.open(db, opts.kbSeed);
  await bootstrapAdmin(db);
  app.decorate("db", db);
  app.decorate("billing", new Billing(db));
  app.decorate("mailer", opts.mailer ?? (await createMailer(db, app.log)));
  app.decorate("google", opts.google === undefined ? googleFromEnv() : opts.google);
  app.decorate("svc", new ChartService(db, kb, opts.llm ?? ia.generateLlm, app.log));
  if (!opts.db) app.addHook("onClose", async () => db.close());

  await app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
      .split(",").map((o) => o.trim()).filter(Boolean),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Tuvi-Csrf"],
    credentials: true, // cookie phiên đăng nhập
  });
  await app.register(cookie);
  const coGioiHan = opts.rateLimit ?? process.env.RATE_LIMIT !== "0";
  await app.register(rateLimit, { global: false });
  app.decorate("limit", (max: number, timeWindow: string, theoNguoiDung = false) => (coGioiHan ? {
    config: {
      rateLimit: {
        max, timeWindow,
        // theo người dùng: lấy id từ phiên nếu có (không xác thực lại ở đây, chỉ để chia "xô"), nếu không thì theo IP
        keyGenerator: (req: { ip: string; cookies?: Record<string, string | undefined>; headers: Record<string, unknown> }) => {
          if (!theoNguoiDung) return req.ip;
          const tok = (req.headers.authorization as string | undefined)?.replace(/^Bearer /, "") ?? req.cookies?.tuvi_session;
          try {
            return tok ? "u:" + (app.jwt.decode<{ sub: string }>(tok)?.sub ?? req.ip) : req.ip;
          } catch {
            return req.ip;
          }
        },
        errorResponseBuilder: (_r: unknown, ctx: { after: string }) => ({
          statusCode: 429, detail: `Bạn thao tác quá nhanh, thử lại sau ${ctx.after}.`,
        }),
      },
    },
  } : {}));
  app.addHook("onRequest", async (req) => {
    if (canCsrfHeader(req)) throw new HttpError(403, "Thiếu header X-Tuvi-Csrf (chống CSRF cho phiên cookie)");
  });
  await app.register(fastifyJwt, { secret: jwtSecret(app.log), sign: { expiresIn: process.env.JWT_EXPIRES_IN || "7d" } });

  // Schema trên route chỉ để sinh tài liệu; validate thật do zod làm (lỗi 422 giống FastAPI).
  app.setValidatorCompiler(() => (data) => ({ value: data }));
  await app.register(swagger, {
    openapi: {
      info: { title: "Tử Vi API", version: "2.0.0", description: "Backend Tử Vi (Node.js). Lá số tất định, luận giải grounded + Guardrail." },
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer" },
          cookie: { type: "apiKey", in: "cookie", name: "tuvi_session" },
          apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.status(422).send({ detail: err.detail });
    if (err instanceof InputError) return reply.status(400).send({ error: err.message });
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ detail: err.detail });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) return reply.status(429).send(err);
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ detail: e.message });
    app.log.error(err);
    return reply.status(500).send({ detail: "Internal Server Error" });
  });

  await app.register(coreRoutes);
  await app.register(authRoutes);
  await app.register(chartRoutes);
  await app.register(adminRoutes);
  await app.register(billingRoutes);
  await app.register(adminBillingRoutes);
  return app;
}
