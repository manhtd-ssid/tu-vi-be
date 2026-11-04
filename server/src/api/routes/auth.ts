/**
 * Tài khoản: đăng ký, đăng nhập/đăng xuất, xác thực email, quên/đặt lại/đổi mật khẩu.
 *
 * Phiên đăng nhập: JWT đặt trong cookie httpOnly `tuvi_session` (trình duyệt) và cũng trả trong body
 * (`token`) cho client gọi API bằng header Bearer. JWT mang `tv` = token_version của người dùng;
 * đổi/đặt lại mật khẩu hoặc "đăng xuất mọi nơi" tăng token_version nên mọi phiên cũ hết hiệu lực.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { resetPassword, verifyEmail } from "../../email/templates.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
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
  email_verified: boolean; token_version: number;
}
const USER_COLS = "id, email, name, role, created_at, last_login_at, (email_verified_at IS NOT NULL) AS email_verified, token_version";

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
    return reply.status(201).send(capPhien(reply, u));
  });

  app.post("/v1/auth/login", { schema: { ...tag, body: jsonSchema(Login) }, ...app.limit(20, "10 minutes") }, async (req, reply) => {
    const b = parse(Login, req.body);
    const [u] = await db.query<UserRow & { password_hash: string }>(
      `SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email) = lower($1)`, [b.email.trim()]);
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
    const [cur] = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [me.id]);
    if (!(await verifyPassword(b.current_password, cur.password_hash))) throw new HttpError(400, "Mật khẩu hiện tại không đúng");
    const [u] = await db.query<UserRow>(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING ${USER_COLS}`,
      [me.id, await hashPassword(b.new_password)]);
    return capPhien(reply, u); // các phiên khác bị đăng xuất, phiên này nhận token mới
  });

  // ---- Xác thực email ----
  app.post("/v1/auth/verify-email", { schema: { ...tag, body: jsonSchema(Token) }, ...app.limit(20, "10 minutes") }, async (req) => {
    const { token } = parse(Token, req.body);
    const userId = await dungToken(token, "verify");
    if (!userId) throw new HttpError(400, "Liên kết xác nhận không hợp lệ hoặc đã hết hạn");
    await db.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId]);
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
}
