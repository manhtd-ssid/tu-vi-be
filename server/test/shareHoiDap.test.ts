/** Test chia sẻ lá số (link, ẩn tên, tắt, trang Open Graph, ảnh PNG) và hỏi đáp AI (tính câu, từ chối chủ đề, Guardrail, giới hạn). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tuChoi } from "../src/agents/hoiDap.js";
import type { LlmFn } from "../src/agents/interpretation.js";
import { buildApp } from "../src/api/app.js";
import { createDb, type Db } from "../src/db/index.js";

const ENV = {
  ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "admin-pass-123",
  SEPAY_BANK: "MBBank", SEPAY_ACCOUNT_NUMBER: "0123456789", SEPAY_WEBHOOK_KEY: "whk",
  APP_URL: "http://web.test", PUBLIC_API_URL: "http://api.test", HOI_DAP_MAX_NGAY: "8",
};
let app: FastifyInstance;
let db: Db;
let ad: string;
/** LLM giả: mặc định trả lời đúng khuôn; đặt `xau = true` để trả câu không có trích dẫn (trượt Guardrail). */
let xau = false;
const prompts: string[] = [];
const llm: LlmFn = async (p) => {
  prompts.push(p.user);
  if (xau) return "Câu trả lời không dẫn nguồn.";
  if (p.user.includes("CÂU HỎI:")) return { text: "Cung Mệnh cho thấy bạn bền bỉ [S1]. Năm nay nên giữ nhịp [S2].\n\n*Nội dung mang tính tham khảo.*", model: "fake", input_tokens: 10, output_tokens: 5 };
  return `## ${p.user.match(/'## (Cung [^']+)'/)?.[1] ?? "Cung"}\nĐoạn AI [S1].`;
};
const BIRTH = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };

beforeAll(async () => {
  Object.assign(process.env, ENV);
  const url = process.env.TEST_DATABASE_URL ?? "";
  if (url) {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await c.end();
  }
  db = await createDb(url);
  app = await buildApp({ db, rateLimit: false, mailer: { send: async () => undefined }, llm });
  ad = (await req("POST", "/v1/auth/login", undefined, { email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD })).json().token;
});
afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await app.close();
  await db.close();
});

type M = "GET" | "POST" | "PUT" | "DELETE";
const req = (method: M, url: string, token?: string, body?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

async function khach(email: string, luot = 0) {
  const r = (await req("POST", "/v1/auth/register", undefined, { email, password: "12345678", name: email.split("@")[0] })).json();
  await db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [r.user.id]);
  if (luot) await req("POST", `/admin/users/${r.user.id}/credits`, ad, { credits: luot, valid_days: 30, note: "test" });
  return r.token as string;
}

describe("chia sẻ lá số", () => {
  let t: string;
  let id: number;
  let token: string;
  beforeAll(async () => {
    t = await khach("chiase@example.com");
    id = (await req("POST", "/v1/la-so-da-luu", t, { label: "Thu Hà", input: BIRTH })).json().id;
  });

  it("bật chia sẻ → link /s/ (có ảnh xem trước) và link web kèm mã giới thiệu; bật lại giữ nguyên mã", async () => {
    const r = (await req("POST", `/v1/la-so-da-luu/${id}/chia-se`, t, {})).json();
    expect(r).toMatchObject({ shared: true, an_ten: false, views: 0 });
    token = r.token;
    expect(r.url).toBe(`http://api.test/s/${token}`);
    expect(r.web_url).toMatch(new RegExp(`^http://web.test/chia-se\\?t=${token}&ref=BAN[A-Z0-9]{6}$`));
    expect((await req("POST", `/v1/la-so-da-luu/${id}/chia-se`, t, { an_ten: false })).json().token).toBe(token);
    const list = (await req("GET", "/v1/la-so-da-luu", t)).json().items;
    expect(list[0]).toMatchObject({ shared: true, share_an_ten: false });
  });

  it("người khác xem không cần đăng nhập; tăng lượt xem; không lộ email chủ", async () => {
    const r = await req("GET", `/v1/chia-se/${token}`);
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ label: "Thu Hà", input: BIRTH });
    expect(j.summary.can_chi_nam).toBe("Canh Ngọ");
    expect(JSON.stringify(j)).not.toContain("chiase@example.com");
    expect((await req("GET", `/v1/la-so-da-luu/${id}/chia-se`, t)).json().views).toBe(1);
  });

  it("trang /s/: thẻ Open Graph + chuyển hướng; tên được escape", async () => {
    await db.query("UPDATE saved_charts SET label = $2 WHERE id = $1", [id, `Hà <script>"x"`]);
    const r = await req("GET", `/s/${token}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.body).toContain(`<meta property="og:image" content="http://api.test/s/${token}/og.png">`);
    expect(r.body).toContain("Lá số tử vi của Hà &lt;script&gt;&quot;x&quot;");
    expect(r.body).not.toContain("<script>\"x\"");
    expect(r.body).toMatch(/http-equiv="refresh" content="0;url=http:\/\/web.test\/chia-se\?t=/);
    expect(r.body).toContain("Canh Ngọ");
  });

  it("ảnh og.png 1200×630", async () => {
    const r = await req("GET", `/s/${token}/og.png`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    const b = r.rawPayload;
    expect(b.subarray(1, 4).toString()).toBe("PNG");
    expect(b.readUInt32BE(16)).toBe(1200);
    expect(b.readUInt32BE(20)).toBe(630);
  });

  it("ẩn tên → không trả nhãn; tắt chia sẻ → link cũ 404; chỉ chủ mới bật/tắt được", async () => {
    await req("POST", `/v1/la-so-da-luu/${id}/chia-se`, t, { an_ten: true });
    expect((await req("GET", `/v1/chia-se/${token}`)).json().label).toBeNull();
    expect((await req("GET", `/s/${token}`)).body).toContain("Lá số tử vi được chia sẻ");

    const khac = await khach("khac@example.com");
    expect((await req("DELETE", `/v1/la-so-da-luu/${id}/chia-se`, khac)).statusCode).toBe(404);
    expect((await req("DELETE", `/v1/la-so-da-luu/${id}/chia-se`, t)).json()).toEqual({ shared: false });
    expect((await req("GET", `/v1/chia-se/${token}`)).statusCode).toBe(404);
    expect((await req("GET", `/s/${token}`)).statusCode).toBe(404);
    const moi = (await req("POST", `/v1/la-so-da-luu/${id}/chia-se`, t, {})).json().token;
    expect(moi).not.toBe(token);
  });

  it("kho luận giải công khai cho trang SEO", async () => {
    const r = (await req("GET", "/v1/kb/public")).json();
    expect(Object.keys(r.chinhTinh)).toHaveLength(14);
    expect(Object.keys(r.cung)).toContain("Mệnh");
  });
});

describe("hỏi đáp AI", () => {
  it("lọc chủ đề cấm", () => {
    expect(tuChoi("Khi nào tôi chết?")).toMatch(/sinh tử/);
    expect(tuChoi("Tôi bị ung thư thì uống thuốc gì")).toMatch(/bác sĩ/);
    expect(tuChoi("Có nên mua cổ phiếu FPT không?")).toMatch(/cổ phiếu/);
    expect(tuChoi("Số nào may mắn để đánh lô đề?")).toBeTruthy();
    expect(tuChoi("Có nên kiện công ty cũ ra toà án?")).toMatch(/luật sư/);
    expect(tuChoi("Năm nay có nên đổi việc không?")).toBeNull();
    expect(tuChoi("Chuyện tình cảm của tôi thế nào?")).toBeNull();
  });

  it("cần đăng nhập; hết lượt → 402", async () => {
    expect((await req("POST", "/v1/hoi-dap", undefined, { ...BIRTH, question: "Sự nghiệp thế nào?" })).statusCode).toBe(401);
    const t = await khach("hoi-0@example.com");
    const r = await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: "Sự nghiệp thế nào?" });
    expect(r.statusCode).toBe(402);
    expect(r.json().detail).toMatch(/5 câu/);
  });

  it("1 lượt = 5 câu cho một lá số; câu thứ 6 trừ lượt tiếp; lịch sử lưu lại; prompt có nguồn lá số + câu trước", async () => {
    const t = await khach("hoi-1@example.com", 2);
    const hoi = (q: string) => req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: q, nam_xem: 2026 });
    const a = (await hoi("Năm nay có nên đổi việc không?")).json();
    expect(a).toMatchObject({ charged_credit: true, questions_left: 4, credits_left: 1, cau_moi_luot: 5 });
    expect(a.message).toMatchObject({ mode: "llm", counted: true, question: "Năm nay có nên đổi việc không?" });
    expect(a.message.answer).toContain("[S1]");
    for (let i = 0; i < 4; i++) expect((await hoi(`Câu ${i}`)).json().charged_credit).toBe(false);
    const p = prompts.at(-1)!;
    expect(p).toContain("Cung Mệnh");
    expect(p).toContain("Năm 2026 (Bính Ngọ)");
    expect(p).toContain("Hỏi: Câu 2");
    const sau = (await hoi("Câu 6")).json();
    expect(sau).toMatchObject({ charged_credit: true, questions_left: 4, credits_left: 0 });

    // Lá số khác: tính riêng
    const khac = await req("POST", "/v1/hoi-dap", t, { ...BIRTH, ngay: 16, question: "Tài lộc ra sao?" });
    expect(khac.statusCode).toBe(402);

    const ls = (await req("POST", "/v1/hoi-dap/lich-su", t, BIRTH)).json();
    expect(ls).toMatchObject({ questions_left: 4, credits_left: 0, cau_moi_luot: 5 });
    expect(ls.messages).toHaveLength(6);
    expect(ls.messages[0].question).toBe("Năm nay có nên đổi việc không?");
  });

  it("chủ đề cấm → từ chối, không gọi AI, không tính câu", async () => {
    const t = await khach("hoi-2@example.com", 1);
    const n = prompts.length;
    const r = (await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: "Bao giờ tôi chết?" })).json();
    expect(r.message).toMatchObject({ mode: "tu_choi", counted: false });
    expect(r).toMatchObject({ charged_credit: false, credits_left: 1, questions_left: 0 });
    expect(prompts.length).toBe(n);
  });

  it("AI trượt Guardrail → trả lại câu, không hiện nội dung AI", async () => {
    const t = await khach("hoi-3@example.com", 1);
    xau = true;
    const r = (await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: "Tình duyên thế nào?" })).json();
    xau = false;
    expect(r.message.mode).toBe("loi");
    expect(r.message.answer).not.toContain("không dẫn nguồn");
    expect(r).toMatchObject({ charged_credit: true, questions_left: 5, credits_left: 0 }); // lượt đã đổi thành 5 câu, câu lỗi được trả lại
    const ok = (await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: "Tình duyên thế nào?" })).json();
    expect(ok).toMatchObject({ charged_credit: false, questions_left: 4 });
    // log chi phí ghi loại hoi_dap
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM luan_giai_logs WHERE loai = 'hoi_dap' AND user_id IS NOT NULL");
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("giới hạn số câu mỗi ngày; câu quá dài → 422", async () => {
    const t = await khach("hoi-4@example.com", 2);
    expect((await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: "x".repeat(501) })).statusCode).toBe(422);
    for (let i = 0; i < 8; i++) expect((await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: `Câu số ${i}` })).statusCode).toBe(200);
    const r = await req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: "Câu thứ chín" });
    expect(r.statusCode).toBe(429);
  });

  it("đồng thời: nhiều câu cùng lúc khi còn 1 lượt → không âm lượt, đúng số câu", async () => {
    const t = await khach("hoi-5@example.com", 1);
    const rs = await Promise.all(Array.from({ length: 7 }, (_, i) => req("POST", "/v1/hoi-dap", t, { ...BIRTH, question: `Song song ${i}` })));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(5);
    expect(rs.filter((r) => r.statusCode === 402)).toHaveLength(2);
    const ls = (await req("POST", "/v1/hoi-dap/lich-su", t, BIRTH)).json();
    expect(ls).toMatchObject({ questions_left: 0, credits_left: 0 });
  });
});
