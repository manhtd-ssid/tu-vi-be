/** Tiện ích HTTP dùng chung: lỗi, parse body bằng zod, schema OpenAPI, xác thực. */
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

/** 422 {detail: [...]}, cùng khung với FastAPI. */
export class ValidationError extends Error {
  constructor(public detail: unknown[]) {
    super("validation error");
  }
}

/** Lỗi HTTP có mã, trả {detail}. */
export class HttpError extends Error {
  constructor(public statusCode: number, public detail: string) {
    super(detail);
  }
}

export function parse<S extends z.ZodType>(schema: S, data: unknown, where = "body"): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => ({ type: i.code, loc: [where, ...i.path], msg: i.message })));
  }
  return r.data;
}

/** JSON Schema (phía input) cho tài liệu OpenAPI; validate thật vẫn do zod làm. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
}

export interface AuthUser { id: number; role: "user" | "admin"; email: string; email_verified: boolean }

export const SESSION_COOKIE = "tuvi_session";

/** Lấy JWT: ưu tiên header Bearer (client API), sau đó cookie phiên (trình duyệt). */
function layToken(req: FastifyRequest): { token: string; quaCookie: boolean } | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return { token: h.slice(7), quaCookie: false };
  const c = req.cookies?.[SESSION_COOKIE];
  return c ? { token: c, quaCookie: true } : null;
}

const CACHE = Symbol("authUser");

/**
 * Người dùng hiện tại. Quyền (role) và trạng thái phiên lấy từ database ở mỗi request:
 * đổi mật khẩu / đăng xuất mọi nơi (token_version tăng) hay bị thu hồi quyền admin có hiệu lực ngay.
 * required=false thì trả null khi không có token.
 */
export async function currentUser(req: FastifyRequest, required: true): Promise<AuthUser>;
export async function currentUser(req: FastifyRequest, required?: false): Promise<AuthUser | null>;
export async function currentUser(req: FastifyRequest, required = false): Promise<AuthUser | null> {
  const r = req as FastifyRequest & { [CACHE]?: AuthUser | null };
  if (r[CACHE] !== undefined) {
    if (!r[CACHE] && required) throw new HttpError(401, "Cần đăng nhập");
    return r[CACHE];
  }
  const t = layToken(req);
  if (!t) {
    if (required) throw new HttpError(401, "Cần đăng nhập");
    return null;
  }
  let p: { sub: string; tv?: number };
  try {
    p = req.server.jwt.verify<{ sub: string; tv?: number }>(t.token);
  } catch {
    throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn");
  }
  const [u] = await req.server.db.query<{ id: number; role: AuthUser["role"]; email: string; email_verified_at: string | null; token_version: number }>(
    "SELECT id, role, email, email_verified_at, token_version FROM users WHERE id = $1", [Number(p.sub)]);
  if (!u || (p.tv ?? 0) !== u.token_version) throw new HttpError(401, "Phiên đăng nhập đã hết hiệu lực, bạn đăng nhập lại nhé");
  const user: AuthUser = { id: u.id, role: u.role, email: u.email, email_verified: Boolean(u.email_verified_at) };
  r[CACHE] = user;
  return user;
}

/** Request ghi dữ liệu xác thực bằng cookie phải có header chống CSRF (trang lạ không gửi được qua CORS). */
export function canCsrfHeader(req: FastifyRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const t = layToken(req);
  return Boolean(t?.quaCookie) && req.headers["x-tuvi-csrf"] !== "1";
}

export async function requireAdmin(req: FastifyRequest): Promise<AuthUser> {
  const u = await currentUser(req, true);
  if (u.role !== "admin") throw new HttpError(403, "Chỉ admin được dùng chức năng này");
  return u;
}

export const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Reply = FastifyReply;
