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

export interface AuthUser { id: number; role: "user" | "admin"; email: string }

/** Đọc user từ header Authorization: Bearer <jwt>. required=false thì trả null khi không có token. */
export async function currentUser(req: FastifyRequest, required: true): Promise<AuthUser>;
export async function currentUser(req: FastifyRequest, required?: false): Promise<AuthUser | null>;
export async function currentUser(req: FastifyRequest, required = false): Promise<AuthUser | null> {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    if (required) throw new HttpError(401, "Cần đăng nhập");
    return null;
  }
  try {
    const p = await req.jwtVerify<{ sub: string; role: AuthUser["role"]; email: string }>();
    return { id: Number(p.sub), role: p.role, email: p.email };
  } catch {
    throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn");
  }
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
