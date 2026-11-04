/**
 * Nhật ký thao tác admin (bảng admin_audit): ai, lúc nào, làm gì, với đối tượng nào, dữ liệu trước/sau.
 * Mọi API /admin/* có ghi dữ liệu đều gọi ghiNhatKy; ghi trong cùng transaction với thao tác khi có thể,
 * để không có thao tác nào thành công mà thiếu nhật ký.
 */
import type { FastifyRequest } from "fastify";
import type { Db } from "../db/index.js";
import type { AuthUser } from "../api/http.js";

export type AuditTarget = "user" | "order" | "plan" | "kb" | "payment_transaction" | "credits";

export interface AuditEntry {
  action: string;
  target_type: AuditTarget;
  target_id: string | number;
  before?: unknown;
  after?: unknown;
  note?: string;
}

export async function ghiNhatKy(q: Db["query"], req: FastifyRequest, admin: AuthUser, e: AuditEntry): Promise<void> {
  await q(
    `INSERT INTO admin_audit (admin_id, admin_email, action, target_type, target_id, before, after, note, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [admin.id, admin.email, e.action, e.target_type, String(e.target_id),
      e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after),
      e.note ?? "", req.ip]);
}
