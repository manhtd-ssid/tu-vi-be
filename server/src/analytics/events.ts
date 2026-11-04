/**
 * Đo hành trình người dùng (phễu chuyển đổi) — ghi ngay ở backend, không dùng dịch vụ ngoài.
 *
 * Mỗi trình duyệt có một mã ẩn danh ngẫu nhiên trong cookie httpOnly `tuvi_vid` (1 năm), nhờ đó đếm được cùng
 * một khách qua các bước kể cả trước khi đăng nhập. KHÔNG ghi ngày giờ sinh, tên, email vào sự kiện; props chỉ
 * gồm thông tin sản phẩm (gói, mã giảm giá, số tiền, id đơn).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { currentUser } from "../api/http.js";

export const VISITOR_COOKIE = "tuvi_vid";

/** Các bước phễu, theo thứ tự. */
export const BUOC = [
  { key: "lap_la_so", ten: "Lập lá số" },
  { key: "ai_bam", ten: "Bấm luận giải AI" },
  { key: "thay_goi", ten: "Thấy bảng gói" },
  { key: "don_tao", ten: "Tạo đơn" },
  { key: "don_tra", ten: "Thanh toán" },
] as const;

/** Sự kiện trang web được phép gửi lên (POST /v1/events). Các sự kiện khác do backend tự ghi. */
export const SU_KIEN_TU_TRANG = ["xem_goi", "mo_thanh_toan", "xem_la_so"] as const;

function visitorOf(req: FastifyRequest, reply: FastifyReply): string {
  const v = req.cookies?.[VISITOR_COOKIE];
  if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
  const moi = randomBytes(16).toString("base64url");
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : process.env.NODE_ENV === "production";
  const sameSite = (process.env.COOKIE_SAMESITE as "lax" | "none" | "strict" | undefined) || "lax";
  reply.setCookie(VISITOR_COOKIE, moi, {
    httpOnly: true, secure: secure || sameSite === "none", sameSite, path: "/", maxAge: 365 * 86400,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  // Ghi nhớ trong request để các sự kiện sau cùng request dùng cùng mã
  (req.cookies as Record<string, string>)[VISITOR_COOKIE] = moi;
  return moi;
}

/** Ghi một sự kiện (không chờ, lỗi không ảnh hưởng request). */
export function track(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, name: string, props: Record<string, unknown> = {}): void {
  if (process.env.ANALYTICS === "0") return;
  const visitor = visitorOf(req, reply);
  currentUser(req, false).catch(() => null).then((u) =>
    app.db.query("INSERT INTO events (name, visitor, user_id, props) VALUES ($1, $2, $3, $4)",
      [name, visitor, u?.id ?? null, JSON.stringify(props)]),
  ).catch((e) => app.log.error({ err: e }, "ghi events lỗi"));
}

/** Biểu thức SQL: sự kiện thuộc bước phễu nào. */
const SQL_BUOC = {
  lap_la_so: "e.name = 'lap_la_so'",
  ai_bam: "e.name = 'ai_bam'",
  thay_goi: "e.name IN ('ai_het_luot', 'xem_goi', 'mo_thanh_toan')",
  don_tao: "e.name = 'don_tao'",
  // Thanh toán: đơn do khách tạo (sự kiện don_tao) nay đã trả (hoặc đã trả rồi hoàn)
  don_tra: "e.name = 'don_tao' AND o.status IN ('paid', 'refunded')",
} as const;

/**
 * Phễu trong `days` ngày gần nhất. Mỗi bước đếm số khách (mã ẩn danh) đã đi tới ÍT NHẤT bước đó — khách mua
 * thẳng từ bảng giá không qua bước "Bấm luận giải AI" vẫn được tính ở các bước trước.
 */
export async function phieu(app: FastifyInstance, days: number) {
  const tu = `now() - make_interval(days => ${Math.floor(days)})`;
  const cols = BUOC.map((b) => `bool_or(${SQL_BUOC[b.key]}) AS ${b.key}`).join(", ");
  const [r] = await app.db.query<Record<string, number>>(
    `WITH v AS (
       SELECT e.visitor, ${cols}
       FROM events e LEFT JOIN orders o ON e.name = 'don_tao' AND o.id = (e.props->>'order_id')::int
       WHERE e.created_at > ${tu}
       GROUP BY e.visitor
     )
     SELECT ${BUOC.map((b, i) => `count(*) FILTER (WHERE ${BUOC.slice(i).map((x) => x.key).join(" OR ")})::int AS ${b.key}`).join(", ")}
     FROM v`);
  const buoc = BUOC.map((b, i) => {
    const so = r[b.key];
    const truoc = i ? r[BUOC[i - 1].key] : so;
    return { key: b.key, ten: b.ten, so_khach: so, ti_le_tu_buoc_truoc: truoc ? so / truoc : null, ti_le_tu_dau: r[BUOC[0].key] ? so / r[BUOC[0].key] : null };
  });

  // Theo ngày (giờ Việt Nam): số khách ở mỗi bước
  const theoNgay = await app.db.query(
    `SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS ngay,
            ${BUOC.map((b) => `count(DISTINCT e.visitor) FILTER (WHERE ${SQL_BUOC[b.key]})::int AS ${b.key}`).join(", ")}
     FROM events e LEFT JOIN orders o ON e.name = 'don_tao' AND o.id = (e.props->>'order_id')::int
     WHERE e.created_at > ${tu}
     GROUP BY 1 ORDER BY 1 DESC`);

  // Đơn và doanh thu theo gói / mã giảm giá (trong khoảng thời gian)
  const theoGoi = await app.db.query(
    `SELECT o.plan_code, coalesce(o.coupon_code, CASE WHEN o.referral_code IS NOT NULL THEN 'GIỚI THIỆU' END, '') AS coupon_code, count(*)::int AS don_tao,
            count(*) FILTER (WHERE o.status IN ('paid', 'refunded'))::int AS don_tra,
            coalesce(sum(CASE WHEN o.status = 'paid' THEN o.amount WHEN o.status = 'refunded' THEN o.amount - coalesce(o.refund_amount, 0) END), 0)::bigint AS doanh_thu,
            coalesce(sum(o.discount_amount) FILTER (WHERE o.status IN ('paid', 'refunded')), 0)::bigint AS tong_giam
     FROM orders o WHERE o.created_at > ${tu}
     GROUP BY 1, 2 ORDER BY doanh_thu DESC, don_tao DESC`);

  const [phu] = await app.db.query<{ dang_ky: number; xac_nhan_email: number; chia_se: number; xem_chia_se: number; cau_hoi_ai: number; khach_hoi_ai: number; khach: number }>(
    `SELECT count(DISTINCT visitor) FILTER (WHERE name = 'dang_ky')::int AS dang_ky,
            count(DISTINCT visitor) FILTER (WHERE name = 'xac_nhan_email')::int AS xac_nhan_email,
            count(*) FILTER (WHERE name = 'chia_se')::int AS chia_se,
            count(DISTINCT visitor) FILTER (WHERE name = 'xem_chia_se')::int AS xem_chia_se,
            count(*) FILTER (WHERE name = 'hoi_dap')::int AS cau_hoi_ai,
            count(DISTINCT visitor) FILTER (WHERE name = 'hoi_dap')::int AS khach_hoi_ai,
            count(DISTINCT visitor)::int AS khach
     FROM events WHERE created_at > ${tu}`);
  return {
    days, buoc, theo_ngay: theoNgay,
    theo_goi: theoGoi.map((x) => ({ ...x, doanh_thu: Number(x.doanh_thu), tong_giam: Number(x.tong_giam) })),
    phu,
  };
}
