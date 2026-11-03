/** Đăng ký / đăng nhập bằng email + mật khẩu, trả JWT (Bearer). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";

const Register = z.object({
  email: z.email().max(254),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(200),
  name: z.string().trim().max(100).default(""),
});
const Login = z.object({ email: z.string().max(254), password: z.string().max(200) });

export interface UserRow { id: number; email: string; name: string; role: "user" | "admin"; created_at: string; last_login_at: string | null }
const USER_COLS = "id, email, name, role, created_at, last_login_at";

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;
  const sign = (u: UserRow) => app.jwt.sign({ sub: String(u.id), role: u.role, email: u.email });

  app.post("/v1/auth/register", { schema: { tags: ["tài khoản"], body: jsonSchema(Register) } }, async (req, reply) => {
    const b = parse(Register, req.body);
    const hash = await hashPassword(b.password);
    const rows = await db.query<UserRow>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO NOTHING RETURNING ${USER_COLS}`, [b.email.trim(), b.name, hash]);
    if (!rows.length) throw new HttpError(409, "Email đã được đăng ký");
    return reply.status(201).send({ token: sign(rows[0]), user: rows[0] });
  });

  app.post("/v1/auth/login", { schema: { tags: ["tài khoản"], body: jsonSchema(Login) } }, async (req) => {
    const b = parse(Login, req.body);
    const [u] = await db.query<UserRow & { password_hash: string }>(
      `SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email) = lower($1)`, [b.email.trim()]);
    if (!u || !(await verifyPassword(b.password, u.password_hash))) throw new HttpError(401, "Email hoặc mật khẩu không đúng");
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
    const { password_hash: _p, ...user } = u;
    return { token: sign(user), user };
  });

  app.get("/v1/auth/me", { schema: { tags: ["tài khoản"], security: [{ bearer: [] }] } }, async (req) => {
    const me = await currentUser(req, true);
    const [u] = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [me.id]);
    if (!u) throw new HttpError(401, "Tài khoản không còn tồn tại");
    return u;
  });
}
