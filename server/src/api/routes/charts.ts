/** Lá số đã lưu của người dùng (cần đăng nhập). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, currentUser, jsonSchema, parse } from "../http.js";
import { BirthInput } from "../schemas.js";
import { birthOnly, tomTat } from "../service.js";

const SaveChart = z.object({ label: z.string().trim().max(120).default(""), input: z.unknown() });
const IdParam = z.object({ id: z.coerce.number().int().positive() });
const sec = { tags: ["lá số đã lưu"], security: [{ bearer: [] }] };
const COLS = "id, label, input, summary, created_at, (share_token IS NOT NULL) AS shared, share_an_ten, share_views";

export async function chartRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get("/v1/la-so-da-luu", { schema: sec }, async (req) => {
    const me = await currentUser(req, true);
    return { items: await db.query(`SELECT ${COLS} FROM saved_charts WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [me.id]) };
  });

  app.post("/v1/la-so-da-luu", {
    schema: { ...sec, body: { type: "object", properties: { label: { type: "string" }, input: jsonSchema(BirthInput) }, required: ["input"] } },
  }, async (req, reply) => {
    const me = await currentUser(req, true);
    const b = parse(SaveChart, req.body);
    const input = birthOnly(parse(BirthInput, b.input, "input"));
    const summary = tomTat(app.svc.tinhLaSo(input)); // lập thử: ngày không tồn tại → 400
    const [n] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM saved_charts WHERE user_id = $1", [me.id]);
    if (n.n >= Number(process.env.MAX_SAVED_CHARTS || 200)) throw new HttpError(409, "Đã đạt giới hạn số lá số được lưu");
    const [row] = await db.query(
      `INSERT INTO saved_charts (user_id, label, input, summary) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
      [me.id, b.label, JSON.stringify(input), JSON.stringify(summary)]);
    return reply.status(201).send(row);
  });

  app.get("/v1/la-so-da-luu/:id", { schema: sec }, async (req) => {
    const me = await currentUser(req, true);
    const { id } = parse(IdParam, req.params, "path");
    const [row] = await db.query(`SELECT ${COLS} FROM saved_charts WHERE id = $1 AND user_id = $2`, [id, me.id]);
    if (!row) throw new HttpError(404, "Không tìm thấy lá số");
    return row;
  });

  app.delete("/v1/la-so-da-luu/:id", { schema: sec }, async (req, reply) => {
    const me = await currentUser(req, true);
    const { id } = parse(IdParam, req.params, "path");
    const rows = await db.query("DELETE FROM saved_charts WHERE id = $1 AND user_id = $2 RETURNING id", [id, me.id]);
    if (!rows.length) throw new HttpError(404, "Không tìm thấy lá số");
    return reply.status(204).send();
  });
}
