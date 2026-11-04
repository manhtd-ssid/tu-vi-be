/**
 * Chia sẻ lá số đã lưu.
 *
 * Chủ lá số bật chia sẻ → sinh mã ngẫu nhiên (share_token); tắt → xoá mã, link cũ hết hiệu lực. Có tuỳ chọn ẩn tên.
 *   GET /v1/chia-se/:token   — dữ liệu công khai cho trang web /chia-se?t=... (ngày giờ sinh để lập lá số, nhãn nếu không ẩn)
 *   GET /s/:token            — trang HTML ngắn có thẻ Open Graph (Facebook/Zalo đọc được), rồi chuyển sang trang web
 *   GET /s/:token/og.png     — ảnh xem trước 1200×630
 * Link chia sẻ mang mã giới thiệu của chủ lá số (nếu chương trình đang bật): bạn bè mua qua link thì chủ được thưởng.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { track } from "../../analytics/events.js";
import { caiDatGioiThieu, maGioiThieuCua } from "../../billing/referral.js";
import { appUrl } from "../../email/templates.js";
import { LruCache } from "../../lib/lru.js";
import { ogPng } from "../../share/og.js";
import { HttpError, currentUser, parse } from "../http.js";
import type { BirthInput } from "../schemas.js";

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const TokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/) });
const sec = { tags: ["chia sẻ"], security: [{ bearer: [] }] };
const BRAND = () => process.env.BRAND_NAME || "Tử Vi Vi Tinh";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Row {
  id: number; user_id: number; label: string; input: BirthInput; summary: Record<string, any>;
  share_token: string | null; share_an_ten: boolean; share_views: number;
}

export async function shareRoutes(app: FastifyInstance) {
  const db = app.db;
  const apiBase = (req: FastifyRequest) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.host}`).replace(/\/$/, "");

  async function maGioiThieu(userId: number): Promise<string | null> {
    const q = db.query.bind(db);
    return (await caiDatGioiThieu(q)).enabled ? maGioiThieuCua(q, userId) : null;
  }

  async function thongTin(req: FastifyRequest, r: Row) {
    if (!r.share_token) return { shared: false };
    const ref = await maGioiThieu(r.user_id);
    return {
      shared: true, token: r.share_token, an_ten: r.share_an_ten, views: r.share_views,
      /** Link nên gửi đi: có ảnh xem trước khi dán vào Facebook/Zalo. */
      url: `${apiBase(req)}/s/${r.share_token}`,
      /** Link thẳng tới trang web (không có ảnh xem trước). */
      web_url: `${appUrl()}/chia-se?t=${r.share_token}${ref ? `&ref=${ref}` : ""}`,
    };
  }

  async function cuaToi(req: FastifyRequest): Promise<Row> {
    const me = await currentUser(req, true);
    const { id } = parse(IdParam, req.params, "path");
    const [r] = await db.query<Row>("SELECT * FROM saved_charts WHERE id = $1 AND user_id = $2", [id, me.id]);
    if (!r) throw new HttpError(404, "Không tìm thấy lá số");
    return r;
  }

  app.get("/v1/la-so-da-luu/:id/chia-se", { schema: sec }, async (req) => thongTin(req, await cuaToi(req)));

  app.post("/v1/la-so-da-luu/:id/chia-se", { schema: { ...sec, summary: "Bật chia sẻ (hoặc đổi tuỳ chọn ẩn tên)" } }, async (req, reply) => {
    const r = await cuaToi(req);
    const { an_ten } = parse(z.object({ an_ten: z.boolean().default(false) }), req.body ?? {});
    const moi = !r.share_token;
    const [row] = await db.query<Row>(
      `UPDATE saved_charts SET share_token = coalesce(share_token, $2), share_an_ten = $3, shared_at = coalesce(shared_at, now())
       WHERE id = $1 RETURNING *`, [r.id, randomBytes(9).toString("base64url"), an_ten]);
    if (moi) track(app, req, reply, "chia_se");
    return thongTin(req, row);
  });

  app.delete("/v1/la-so-da-luu/:id/chia-se", { schema: { ...sec, summary: "Tắt chia sẻ: link cũ hết hiệu lực" } }, async (req) => {
    const r = await cuaToi(req);
    await db.query("UPDATE saved_charts SET share_token = NULL, shared_at = NULL, share_views = 0 WHERE id = $1", [r.id]);
    return { shared: false };
  });

  async function theoMa(token: string): Promise<Row | undefined> {
    const [r] = await db.query<Row>("SELECT * FROM saved_charts WHERE share_token = $1", [token]);
    return r;
  }
  const tieuDe = (r: Row) => (r.share_an_ten || !r.label ? "được chia sẻ" : `của ${r.label}`);
  const moTa = (r: Row) => {
    const s = r.summary;
    return `Năm ${s.can_chi_nam} · ${s.cuc} · Mệnh tại ${s.menh}` +
      `${s.chinh_tinh_menh?.length ? ` (${s.chinh_tinh_menh.join(", ")})` : " (vô chính diệu)"}. Lập lá số của bạn miễn phí.`;
  };

  app.get("/v1/chia-se/:token", { schema: { tags: ["chia sẻ"], summary: "Lá số được chia sẻ (công khai)" }, ...app.limit(120, "10 minutes") }, async (req, reply) => {
    const { token } = parse(TokenParam, req.params, "path");
    const r = await theoMa(token);
    if (!r) throw new HttpError(404, "Link chia sẻ không còn hiệu lực");
    await db.query("UPDATE saved_charts SET share_views = share_views + 1 WHERE id = $1", [r.id]);
    track(app, req, reply, "xem_chia_se");
    return {
      label: r.share_an_ten ? null : r.label || null,
      input: r.input, summary: r.summary,
      ref: await maGioiThieu(r.user_id),
    };
  });

  // ---- Trang cho trình thu thập liên kết (Facebook, Zalo...) ----
  app.get("/s/:token", { schema: { tags: ["chia sẻ"], summary: "Trang chia sẻ có thẻ Open Graph" }, ...app.limit(120, "10 minutes") }, async (req, reply) => {
    const { token } = parse(TokenParam, req.params, "path");
    const r = await theoMa(token);
    reply.type("text/html; charset=utf-8").header("Cache-Control", "public, max-age=300");
    if (!r) {
      return reply.status(404).send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(BRAND())}</title></head>` +
        `<body style="font-family:sans-serif;padding:40px">Link chia sẻ không còn hiệu lực. <a href="${esc(appUrl())}/">Lập lá số của bạn</a></body></html>`);
    }
    const ref = await maGioiThieu(r.user_id);
    const dich = `${appUrl()}/chia-se?t=${token}${ref ? `&ref=${ref}` : ""}`;
    const title = `Lá số tử vi ${tieuDe(r)} — ${BRAND()}`;
    const desc = moTa(r);
    const img = `${apiBase(req)}/s/${token}/og.png`;
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(BRAND())}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(dich)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(dich)}">
<link rel="canonical" href="${esc(dich)}">
</head><body style="font-family:sans-serif;padding:40px"><p>Đang mở lá số… <a href="${esc(dich)}">Bấm vào đây nếu trang không tự chuyển</a>.</p>
<script>location.replace(${JSON.stringify(dich).replace(/</g, "\\u003c")})</script></body></html>`;
  });

  const anh = new LruCache<string, Buffer>(200);
  app.get("/s/:token/og.png", { schema: { tags: ["chia sẻ"], summary: "Ảnh xem trước 1200×630" }, ...app.limit(120, "10 minutes") }, async (req, reply) => {
    const { token } = parse(TokenParam, req.params, "path");
    const r = await theoMa(token);
    if (!r) throw new HttpError(404, "Link chia sẻ không còn hiệu lực");
    const title = r.share_an_ten || !r.label ? "được chia sẻ" : `của ${r.label}`;
    const key = `${token}|${title}`;
    let png = anh.get(key);
    if (!png) {
      png = ogPng(app.svc.tinhLaSo(r.input), { title, site: new URL(appUrl()).host });
      anh.set(key, png);
    }
    return reply.type("image/png").header("Cache-Control", "public, max-age=86400").send(png);
  });
}
