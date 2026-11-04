/** Test luận giải vận năm: bản tổng hợp, bản AI, tính lượt, Guardrail. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKb } from "../src/agents/kb.js";
import { luanVanNam } from "../src/agents/vanNam.js";
import { buildApp } from "../src/api/app.js";
import { createDb, type Db } from "../src/db/index.js";
import { lapLaSo } from "../src/engine/tuviEngine.js";

const BASE = { ngay: 15, thang: 8, nam: 1990, gio_sinh: 7, gioi_tinh: 1 };
const kb = loadKb();
const chart = lapLaSo(15, 8, 1990, 7, 1);

/** LLM giả: viết đúng khuôn, trích dẫn [S1]. `xau` = phán định mệnh để bị Guardrail chặn. */
function fakeLlm(xau = false) {
  let calls = 0;
  const fn = async () => {
    calls++;
    const thang = Array.from({ length: 12 }, (_, i) => `- Tháng ${i + 1}: nên giữ nhịp đều [S1].`).join("\n");
    return `## Vận năm 2026 — Bính Ngọ\nNăm nay tiểu hạn đi qua cung Quan lộc, hợp củng cố công việc [S1].\n\n### Từng tháng\n${thang}\n\n` +
      (xau ? "Tháng 7 chắc chắn sẽ gặp hoạ [S1].\n" : "") + "*Nội dung mang tính tham khảo.*";
  };
  return { fn, calls: () => calls };
}

describe("luanVanNam (tầng agent)", () => {
  it("bản tổng hợp: đủ 12 tháng, mọi ý có nguồn, qua Guardrail", async () => {
    const r = await luanVanNam(chart, 2026, kb, false);
    expect(r).toMatchObject({ nam: 2026, can_chi: "Bính Ngọ", tuoi_am: 37, mode: "offline" });
    expect(r.guardrail.passed).toBe(r.guardrail.total);
    expect(r.chunks.filter((c) => c.source.startsWith("Tháng "))).toHaveLength(12);
    expect(r.markdown).toContain("### Từng tháng");
    expect(r.markdown).toContain("Tiểu hạn — cung");
    for (const line of r.markdown.split("\n").filter((l) => l.startsWith("- "))) expect(line).toMatch(/\[S\d+\]/);
  });

  it("bản AI qua Guardrail thì dùng; phán định mệnh thì về bản tổng hợp", async () => {
    expect((await luanVanNam(chart, 2026, kb, true, fakeLlm().fn)).mode).toBe("llm");
    const xau = await luanVanNam(chart, 2026, kb, true, fakeLlm(true).fn);
    expect(xau.mode).toBe("offline_sau_khi_llm_truot_guardrail");
    expect(xau.markdown).not.toContain("chắc chắn sẽ gặp hoạ");
  });

  it("năm trước năm sinh bị từ chối", async () => {
    await expect(luanVanNam(chart, 1980, kb, false)).rejects.toThrow();
  });
});

describe("POST /v1/luan-giai/nam", () => {
  let app: FastifyInstance;
  let db: Db;
  const llm = fakeLlm();
  beforeAll(async () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.ADMIN_PASSWORD = "admin-pass-123";
    db = await createDb("");
    app = await buildApp({ db, llm: llm.fn, rateLimit: false, mailer: { send: async () => undefined } });
  });
  afterAll(async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    await app.close();
    await db.close();
  });
  const post = (url: string, body: object, token?: string) =>
    app.inject({ method: "POST", url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("bản tổng hợp miễn phí, không cần đăng nhập", async () => {
    const r = await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 2026 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ mode: "offline", can_chi: "Bính Ngọ" });
    expect((await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 1980 })).statusCode).toBe(400);
  });

  it("bản AI: 1 lượt cho mỗi (lá số, năm); đọc lại không tốn; năm khác tốn thêm", async () => {
    const reg = (await post("/v1/auth/register", { email: "nam@example.com", password: "12345678" })).json();
    const token = reg.token;
    expect((await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 2026, use_llm: true })).statusCode).toBe(401);
    expect((await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 2026, use_llm: true }, token)).statusCode).toBe(402);

    const ad = (await post("/v1/auth/login", { email: "admin@example.com", password: "admin-pass-123" })).json().token;
    await post(`/admin/users/${reg.user.id}/credits`, { credits: 1, note: "test" }, ad);

    const truoc = llm.calls();
    const r = (await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 2026, use_llm: true }, token)).json();
    expect(r).toMatchObject({ mode: "llm", billing: { charged: true, credits_left: 0 } });
    const lai = (await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 2026, use_llm: true }, token)).json();
    expect(lai.billing).toMatchObject({ charged: false, da_mo_khoa: true });
    expect(lai.markdown).toBe(r.markdown);
    expect(llm.calls() - truoc).toBe(1);
    // năm khác là lần mở khoá khác → hết lượt
    expect((await post("/v1/luan-giai/nam", { ...BASE, nam_xem: 2027, use_llm: true }, token)).statusCode).toBe(402);
    // lượt năm và lượt lá số độc lập: lá số chưa mở khoá
    expect((await post("/v1/luan-giai", { ...BASE, use_llm: true }, token)).statusCode).toBe(402);

    await new Promise((res) => setTimeout(res, 50));
    const [log] = await db.query("SELECT loai, llm_calls FROM luan_giai_logs WHERE loai = 'nam' AND use_llm ORDER BY id DESC LIMIT 1");
    expect(log).toMatchObject({ loai: "nam", llm_calls: 1 });
  });
});
