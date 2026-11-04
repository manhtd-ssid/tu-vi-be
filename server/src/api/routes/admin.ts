/** API quản trị (role = admin): thống kê, người dùng, lá số, kho luận giải, log luận giải. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KbStore, type KbKind } from "../../agents/kbStore.js";
import { ghiNhatKy } from "../../admin/audit.js";
import { HttpError, Paging, parse, requireAdmin } from "../http.js";

const sec = { tags: ["admin"], security: [{ bearer: [] }] };
const Q = Paging.extend({ q: z.string().trim().max(200).default("") });
const IdParam = z.object({ id: z.coerce.number().int().positive() });
const KbParam = z.object({ kind: z.enum(["cung", "chinhTinh"]), key: z.string().min(1).max(100) });

/** Kiểm tra khung tối thiểu mà agent luận giải cần đọc (chính tinh cần thêm `name`). */
const Overview = z.object({ short: z.string().optional(), detailed: z.string().optional() }).loose();
const KB_DATA = {
  cung: z.object({ overview: Overview }).loose(),
  chinhTinh: z.object({ name: z.string().min(1), overview: Overview }).loose(),
};

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

export async function adminRoutes(app: FastifyInstance) {
  const db = app.db;
  const kb = app.svc.kb;
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/admin/")) await requireAdmin(req);
  });

  app.get("/admin/stats", { schema: sec }, async () => {
    const [r] = await db.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_7d,
      (SELECT count(*)::int FROM saved_charts) AS saved_charts,
      (SELECT count(*)::int FROM luan_giai_logs) AS luan_giai,
      (SELECT count(*)::int FROM luan_giai_logs WHERE use_llm) AS luan_giai_llm,
      (SELECT count(*)::int FROM luan_giai_logs WHERE blocked) AS luan_giai_bi_chan,
      (SELECT count(*)::int FROM luan_giai_logs WHERE created_at > now() - interval '24 hours') AS luan_giai_24h`);
    return { ...r, kb_version: kb.version };
  });

  // ---- Người dùng ----
  app.get("/admin/users", { schema: sec }, async (req) => {
    const { q, limit, offset } = parse(Q, req.query, "query");
    const where = q ? "WHERE u.email ILIKE $1 OR u.name ILIKE $1" : "WHERE $1::text IS NULL";
    const p = q ? like(q) : null;
    const items = await db.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at, (u.email_verified_at IS NOT NULL) AS email_verified, (u.google_sub IS NOT NULL) AS google,
              (SELECT count(*)::int FROM saved_charts c WHERE c.user_id = u.id) AS saved_charts
       FROM users u ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT $2 OFFSET $3`, [p, limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM users u ${where}`, [p]);
    return { items, total };
  });

  app.patch("/admin/users/:id", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { id } = parse(IdParam, req.params, "path");
    const { role } = parse(z.object({ role: z.enum(["user", "admin"]) }), req.body);
    if (id === me.id && role !== "admin") throw new HttpError(400, "Không thể tự bỏ quyền admin của chính mình");
    const u = await db.tx(async (q) => {
      const [truoc] = await q<{ role: string }>("SELECT role FROM users WHERE id = $1 FOR UPDATE", [id]);
      if (!truoc) return null;
      const [sau] = await q("UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, name, role, created_at, last_login_at", [id, role]);
      if (truoc.role !== role) {
        await ghiNhatKy(q, req, me, { action: "user.role", target_type: "user", target_id: id, before: { role: truoc.role }, after: { role } });
      }
      return sau;
    });
    if (!u) throw new HttpError(404, "Không tìm thấy người dùng");
    return u;
  });

  // ---- Lá số người dùng đã lưu ----
  app.get("/admin/la-so", { schema: sec }, async (req) => {
    const { q, limit, offset, user_id } = parse(Q.extend({ user_id: z.coerce.number().int().optional() }), req.query, "query");
    const cond: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(like(q));
      cond.push(`(u.email ILIKE $${params.length} OR c.label ILIKE $${params.length})`);
    }
    if (user_id !== undefined) {
      params.push(user_id);
      cond.push(`c.user_id = $${params.length}`);
    }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const items = await db.query(
      `SELECT c.id, c.label, c.input, c.summary, c.created_at, c.user_id, u.email AS user_email
       FROM saved_charts c JOIN users u ON u.id = c.user_id ${where}
       ORDER BY c.created_at DESC, c.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM saved_charts c JOIN users u ON u.id = c.user_id ${where}`, params);
    return { items, total };
  });

  // ---- Kho luận giải ----
  app.get("/admin/kb", { schema: sec }, async () => ({
    version: kb.version,
    items: (await kb.list()).map((e) => ({ kind: e.kind, key: e.key, name: e.data?.name ?? e.key, updated_at: e.updated_at, updated_by: e.updated_by })),
  }));

  app.get("/admin/kb/:kind/:key", { schema: sec }, async (req) => {
    const { kind, key } = parse(KbParam, req.params, "path");
    const e = await kb.getEntry(kind as KbKind, key);
    if (!e) throw new HttpError(404, "Không có mục này trong kho luận giải");
    return e;
  });

  app.put("/admin/kb/:kind/:key", { schema: sec }, async (req) => {
    const me = await requireAdmin(req);
    const { kind, key } = parse(KbParam, req.params, "path");
    const { data } = parse(z.object({ data: KB_DATA[kind] }), req.body);
    const e = await db.tx(async (q) => {
      const [truoc] = await q<{ data: unknown }>("SELECT data FROM kb_entries WHERE kind = $1 AND key = $2 FOR UPDATE", [kind, key]);
      if (!truoc) return undefined;
      const sau = await KbStore.updateIn(q, kind as KbKind, key, data, me.id);
      await ghiNhatKy(q, req, me, { action: "kb.update", target_type: "kb", target_id: `${kind}/${key}`, before: truoc.data, after: data });
      return sau;
    });
    if (!e) throw new HttpError(404, "Không có mục này trong kho luận giải");
    await kb.reload();
    return e;
  });

  // ---- Nhật ký thao tác admin ----
  app.get("/admin/audit", { schema: sec }, async (req) => {
    const { limit, offset, action, admin_id, target_type, target_id } = parse(Paging.extend({
      action: z.string().max(50).optional(), admin_id: z.coerce.number().int().optional(),
      target_type: z.string().max(50).optional(), target_id: z.string().max(100).optional(),
    }), req.query, "query");
    const cond: string[] = [];
    const params: unknown[] = [];
    const them = (sql: string, v: unknown) => {
      params.push(v);
      cond.push(sql.replace("?", `$${params.length}`));
    };
    if (action) them("action LIKE ?", action.replace(/[%_]/g, "") + "%");
    if (admin_id !== undefined) them("admin_id = ?", admin_id);
    if (target_type) them("target_type = ?", target_type);
    if (target_id) them("target_id = ?", target_id);
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const items = await db.query(
      `SELECT * FROM admin_audit ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM admin_audit ${where}`, params);
    return { items, total };
  });

  // ---- Hộp thư đi (không lưu nội dung email) ----
  app.get("/admin/emails", { schema: sec }, async (req) => {
    const { limit, offset, status, q } = parse(Paging.extend({
      status: z.enum(["sent", "failed", "logged"]).optional(), q: z.string().trim().max(200).default(""),
    }), req.query, "query");
    const cond: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      cond.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(like(q));
      cond.push(`to_email ILIKE $${params.length}`);
    }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const items = await db.query(
      `SELECT * FROM email_outbox ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM email_outbox ${where}`, params);
    const [{ loi_24h }] = await db.query<{ loi_24h: number }>(
      "SELECT count(*)::int AS loi_24h FROM email_outbox WHERE status = 'failed' AND created_at > now() - interval '24 hours'");
    return { items, total, loi_24h };
  });

  // ---- Log luận giải ----
  app.get("/admin/luan-giai-logs", { schema: sec }, async (req) => {
    const { limit, offset, blocked, use_llm } = parse(Paging.extend({
      blocked: z.enum(["true", "false"]).optional(), use_llm: z.enum(["true", "false"]).optional(),
    }), req.query, "query");
    const cond: string[] = [];
    const params: unknown[] = [];
    if (blocked) { params.push(blocked === "true"); cond.push(`l.blocked = $${params.length}`); }
    if (use_llm) { params.push(use_llm === "true"); cond.push(`l.use_llm = $${params.length}`); }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const items = await db.query(
      `SELECT l.id, l.user_id, u.email AS user_email, l.input, l.use_llm, l.verdict, l.guardrail_tong, l.blocked, l.per_cung, l.created_at,
              l.loai, l.llm_model, l.llm_calls, l.input_tokens, l.output_tokens, l.cost_usd::float AS cost_usd
       FROM luan_giai_logs l LEFT JOIN users u ON u.id = l.user_id ${where}
       ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]);
    const [{ total }] = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM luan_giai_logs l ${where}`, params);
    return { items, total };
  });
}
