/**
 * Tài khoản: đăng ký, đăng nhập/đăng xuất, xác thực email, quên/đặt lại/đổi mật khẩu.
 *
 * Phiên đăng nhập: JWT đặt trong cookie httpOnly `tuvi_session` (trình duyệt) và cũng trả trong body
 * (`token`) cho client gọi API bằng header Bearer. JWT mang `tv` = token_version của người dùng;
 * đổi/đặt lại mật khẩu hoặc "đăng xuất mọi nơi" tăng token_version nên mọi phiên cũ hết hiệu lực.
 *
 * Đăng nhập Google: GET /v1/auth/google/start → Google → GET /v1/auth/google/callback → đặt cookie phiên rồi
 * chuyển về trang web `/dang-nhap/google?next=...`. Tài khoản Google không có mật khẩu (password_hash NULL)
 * cho tới khi người dùng tự đặt. Email đã có tài khoản → gắn Google vào tài khoản đó (Google đã xác thực email).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resetPassword, verifyEmail } from "../../email/templates.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { track } from "../../analytics/events.js";
import { appUrl } from "../../email/templates.js";
import { GoogleError } from "../../auth/google.js";
import { HttpError, SESSION_COOKIE, currentUser, jsonSchema, parse } from "../http.js";

const MatKhau = z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(200);
const Register = z.object({ email: z.email().max(254), password: MatKhau, name: z.string().trim().max(100).default("") });
const Login = z.object({ email: z.string().max(254), password: z.string().max(200) });
const Token = z.object({ token: z.string().min(20).max(200) });
const Reset = Token.extend({ password: MatKhau });
const ChangePassword = z.object({ current_password: z.string().max(200), new_password: MatKhau });
const UpdateMe = z.object({ name: z.string().trim().max(100) });

export interface UserRow {
  id: number; email: string; name: string; role: "user" | "admin"; created_at: string; last_login_at: string | null;
  email_verified: boolean; token_version: number; has_password: boolean;
}
const USER_COLS = "id, email, name, role, created_at, last_login_at, (email_verified_at IS NOT NULL) AS email_verified, token_version, (password_hash IS NOT NULL) AS has_password";
const OAUTH_COOKIE = "tuvi_oauth";
/** Chỉ cho chuyển về đường dẫn nội bộ của trang web. */
const safeNext = (n: unknown) => (typeof n === "string" && /^\/(?![\/\\])/.test(n) ? n.slice(0, 500) : "/la-so-cua-toi");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HAN = { verify: "24 hours", reset: "30 minutes" } as const;
const sessionDays = () => Number((process.env.JWT_EXPIRES_IN || "7d").replace(/d$/, "")) || 7;

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;
  const tag = { tags: ["tài khoản"] };

  function public_(u: UserRow) {
    const { token_version: _tv, ...rest } = u;
    return rest;
  }

  /** Cấp phiên: đặt cookie + trả token. */
  function capPhien(reply: FastifyReply, u: UserRow) {
    const token = app.jwt.sign({ sub: String(u.id), tv: u.token_version });
    const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : process.env.NODE_ENV === "production";
    const sameSite = (process.env.COOKIE_SAMESITE as "lax" | "none" | "strict" | undefined) || "lax";
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: secure || sameSite === "none", sameSite, path: "/",
      maxAge: sessionDays() * 86400, ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    });
    return { token, user: public_(u) };
  }

  /** Tạo token email dùng một lần (chỉ lưu bản băm). */
  async function taoToken(userId: number, purpose: "verify" | "reset"): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + $4::interval)`,
      [userId, purpose, sha256(token), HAN[purpose]]);
    return token;
  }

  /** Lấy và đánh dấu đã dùng token còn hạn; trả user_id hoặc null. */
  async function dungToken(token: string, purpose: "verify" | "reset", q = db.query.bind(db)): Promise<number | null> {
    const rows = await q<{ user_id: number }>(
      `UPDATE email_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token), purpose]);
    return rows[0]?.user_id ?? null;
  }

  /** Mỗi người dùng chỉ nhận một email cùng loại mỗi 60 giây. */
  async function vuaGui(userId: number, purpose: "verify" | "reset"): Promise<boolean> {
    const [r] = await db.query("SELECT 1 FROM email_tokens WHERE user_id = $1 AND purpose = $2 AND created_at > now() - interval '60 seconds'", [userId, purpose]);
    return Boolean(r);
  }

  app.post("/v1/auth/register", { schema: { ...tag, body: jsonSchema(Register) }, ...app.limit(10, "1 hour") }, async (req, reply) => {
    const b = parse(Register, req.body);
    const hash = await hashPassword(b.password);
    const rows = await db.query<UserRow>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO NOTHING RETURNING ${USER_COLS}`, [b.email.trim(), b.name, hash]);
    if (!rows.length) throw new HttpError(409, "Email đã được đăng ký");
    const u = rows[0];
    await app.mailer.send(verifyEmail(u.email, await taoToken(u.id, "verify")));
    track(app, req, reply, "dang_ky");
    return reply.status(201).send(capPhien(reply, u));
  });

  app.post("/v1/auth/login", { schema: { ...tag, body: jsonSchema(Login) }, ...app.limit(20, "10 minutes") }, async (req, reply) => {
    const b = parse(Login, req.body);
    const [u] = await db.query<UserRow & { password_hash: string }>(
      `SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email) = lower($1)`, [b.email.trim()]);
    if (u && !u.password_hash) {
      throw new HttpError(401, "Tài khoản này đăng nhập bằng Google. Bấm “Tiếp tục với Google”, hoặc dùng “Quên mật khẩu” để đặt mật khẩu.");
    }
    if (!u || !(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, "Email hoặc mật khẩu không đúng");
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
    const { password_hash: _p, ...user } = u;
    return capPhien(reply, user);
  });

  app.post("/v1/auth/logout", { schema: { ...tag, summary: "Xoá cookie phiên trên trình duyệt này" } }, async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/", ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}) });
    return { ok: true };
  });

  app.post("/v1/auth/logout-all", { schema: { ...tag, summary: "Đăng xuất mọi thiết bị" } }, async (req, reply) => {
    const me = await currentUser(req, true);
    await db.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [me.id]);
    reply.clearCookie(SESSION_COOKIE, { path: "/", ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}) });
    return { ok: true };
  });

  app.get("/v1/auth/me", { schema: { ...tag, security: [{ bearer: [] }, { cookie: [] }] } }, async (req) => {
    const me = await currentUser(req, true);
    const [u] = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [me.id]);
    if (!u) throw new HttpError(401, "Tài khoản không còn tồn tại");
    return public_(u);
  });

  app.patch("/v1/auth/me", { schema: { ...tag, body: jsonSchema(UpdateMe) } }, async (req) => {
    const me = await currentUser(req, true);
    const { name } = parse(UpdateMe, req.body);
    const [u] = await db.query<UserRow>(`UPDATE users SET name = $2 WHERE id = $1 RETURNING ${USER_COLS}`, [me.id, name]);
    return public_(u);
  });

  app.post("/v1/auth/change-password", { schema: { ...tag, body: jsonSchema(ChangePassword) }, ...app.limit(10, "10 minutes", true) }, async (req, reply) => {
    const me = await currentUser(req, true);
    const b = parse(ChangePassword, req.body);
    const [cur] = await db.query<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = $1", [me.id]);
    // Tài khoản Google chưa có mật khẩu: đặt mật khẩu lần đầu không cần mật khẩu cũ
    if (cur.password_hash && !(await verifyPassword(b.current_password, cur.password_hash))) throw new HttpError(400, "Mật khẩu hiện tại không đúng");
    const [u] = await db.query<UserRow>(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING ${USER_COLS}`,
      [me.id, await hashPassword(b.new_password)]);
    return capPhien(reply, u); // các phiên khác bị đăng xuất, phiên này nhận token mới
  });

  // ---- Xác thực email ----
  app.post("/v1/auth/verify-email", { schema: { ...tag, body: jsonSchema(Token) }, ...app.limit(20, "10 minutes") }, async (req, reply) => {
    const { token } = parse(Token, req.body);
    const userId = await dungToken(token, "verify");
    if (!userId) throw new HttpError(400, "Liên kết xác nhận không hợp lệ hoặc đã hết hạn");
    await db.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId]);
    track(app, req, reply, "xac_nhan_email");
    return { ok: true };
  });

  app.post("/v1/auth/resend-verification", { schema: tag, ...app.limit(5, "1 hour", true) }, async (req) => {
    const me = await currentUser(req, true);
    if (me.email_verified) return { ok: true, da_xac_thuc: true };
    if (await vuaGui(me.id, "verify")) throw new HttpError(429, "Email vừa được gửi, bạn đợi một phút rồi thử lại nhé");
    await app.mailer.send(verifyEmail(me.email, await taoToken(me.id, "verify")));
    return { ok: true };
  });

  // ---- Quên / đặt lại mật khẩu ----
  // Luôn trả cùng một câu, dù email có tồn tại hay không (không để lộ ai đã đăng ký).
  const DA_GUI = { ok: true, message: "Nếu email đã đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu trong vài phút." };

  app.post("/v1/auth/forgot", { schema: { ...tag, body: jsonSchema(z.object({ email: z.string().max(254) })) }, ...app.limit(5, "15 minutes") }, async (req) => {
    const { email } = parse(z.object({ email: z.string().max(254) }), req.body);
    const [u] = await db.query<{ id: number; email: string }>("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email.trim()]);
    if (u && !(await vuaGui(u.id, "reset"))) {
      await app.mailer.send(resetPassword(u.email, await taoToken(u.id, "reset")));
    }
    return DA_GUI;
  });

  app.post("/v1/auth/reset", { schema: { ...tag, body: jsonSchema(Reset) }, ...app.limit(10, "15 minutes") }, async (req, reply) => {
    const b = parse(Reset, req.body);
    const hash = await hashPassword(b.password);
    const u = await db.tx(async (q) => {
      const userId = await dungToken(b.token, "reset", q);
      if (!userId) return null;
      // Đặt lại qua email cũng chứng minh người dùng giữ hộp thư → coi như đã xác thực email.
      const [row] = await q<UserRow>(
        `UPDATE users SET password_hash = $2, token_version = token_version + 1,
           email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1 RETURNING ${USER_COLS}`, [userId, hash]);
      await q("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL", [userId]);
      return row;
    });
    if (!u) throw new HttpError(400, "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn");
    return capPhien(reply, u);
  });

  // ---- Đăng nhập Google ----
  app.get("/v1/auth/providers", { schema: { ...tag, summary: "Cách đăng nhập đang bật" } }, async () => ({ google: Boolean(app.google) }));

  /** Địa chỉ callback: PUBLIC_API_URL nếu đặt, nếu không thì lấy từ request (cần TRUST_PROXY sau reverse proxy). */
  const callbackUrl = (req: { protocol: string; host: string }) =>
    `${(process.env.PUBLIC_API_URL || `${req.protocol}://${req.host}`).replace(/\/$/, "")}/v1/auth/google/callback`;
  const oauthCookie = {
    httpOnly: true, sameSite: "lax" as const, path: "/v1/auth/google", maxAge: 600,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : process.env.NODE_ENV === "production",
  };
  const veTrangWeb = (reply: FastifyReply, path: string, q: Record<string, string>) =>
    reply.redirect(`${appUrl()}${path}?${new URLSearchParams(q)}`);

  app.get("/v1/auth/google/start", { schema: { ...tag, summary: "Chuyển sang trang đăng nhập Google" }, ...app.limit(30, "10 minutes") }, async (req, reply) => {
    if (!app.google) throw new HttpError(404, "Chưa bật đăng nhập Google");
    const q = parse(z.object({ next: z.string().max(500).optional(), hint: z.string().max(254).optional() }), req.query, "query");
    const state = randomBytes(24).toString("base64url");
    reply.setCookie(OAUTH_COOKIE, app.jwt.sign({ st: state, next: safeNext(q.next) }, { expiresIn: "10m" }), oauthCookie);
    return reply.redirect(app.google.authUrl(state, callbackUrl(req), q.hint));
  });

  app.get("/v1/auth/google/callback", { schema: { ...tag, summary: "Google gọi lại sau khi đăng nhập" }, ...app.limit(30, "10 minutes") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    let next = "/la-so-cua-toi";
    const loi = (msg: string) => veTrangWeb(reply, "/dang-nhap", { loi: msg, next });
    const raw = req.cookies?.[OAUTH_COOKIE] ?? "";
    reply.clearCookie(OAUTH_COOKIE, { path: oauthCookie.path });
    let st: string;
    try {
      const c = app.jwt.verify<{ st: string; next: string }>(raw);
      st = c.st;
      next = safeNext(c.next);
    } catch {
      return loi("Phiên đăng nhập Google đã hết hạn, bạn thử lại nhé");
    }
    const a = Buffer.from(st);
    const b = Buffer.from(String(q.state ?? ""));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return loi("Yêu cầu đăng nhập không hợp lệ, bạn thử lại nhé");
    if (q.error || !q.code) return loi(q.error === "access_denied" ? "Bạn đã huỷ đăng nhập Google" : "Google không cho đăng nhập, bạn thử lại nhé");
    if (!app.google) return loi("Chưa bật đăng nhập Google");

    let p;
    try {
      p = await app.google.exchange(q.code, callbackUrl(req));
    } catch (e) {
      req.log.warn({ err: e }, "google oauth exchange");
      return loi(e instanceof GoogleError ? "Không xác thực được với Google, bạn thử lại nhé" : "Lỗi kết nối Google, bạn thử lại nhé");
    }
    if (!p.email_verified) return loi("Email Google chưa được xác minh");
    const prof = p;

    const kq = await db.tx(async (tq) => {
      const [bySub] = await tq<UserRow>(`SELECT ${USER_COLS} FROM users WHERE google_sub = $1`, [prof.sub]);
      if (bySub) return { u: bySub, moi: false, xacNhan: false };
      const [byEmail] = await tq<UserRow>(`SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1) FOR UPDATE`, [prof.email]);
      if (byEmail) {
        const [u] = await tq<UserRow>(
          `UPDATE users SET google_sub = $2, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1 RETURNING ${USER_COLS}`,
          [byEmail.id, prof.sub]);
        return { u, moi: false, xacNhan: !byEmail.email_verified };
      }
      const [u] = await tq<UserRow>(
        `INSERT INTO users (email, name, password_hash, google_sub, email_verified_at) VALUES ($1, $2, NULL, $3, now())
         RETURNING ${USER_COLS}`, [prof.email, prof.name.slice(0, 100), prof.sub]);
      return { u, moi: true, xacNhan: true };
    });
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [kq.u.id]);
    if (kq.moi) track(app, req, reply, "dang_ky", { cach: "google" });
    if (kq.xacNhan) track(app, req, reply, "xac_nhan_email", { cach: "google" });
    capPhien(reply, kq.u);
    return veTrangWeb(reply, "/dang-nhap/google", { next, ...(kq.moi ? { moi: "1" } : {}) });
  });
}
