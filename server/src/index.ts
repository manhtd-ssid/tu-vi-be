/** Điểm chạy server. `npm run dev` → http://127.0.0.1:8973 (tài liệu API: /docs, giao diện thử: /viewer) */
import { loadEnv } from "./lib/env.js";

loadEnv();
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  console.error("Thiếu DATABASE_URL trong môi trường production (postgres://... hoặc pglite://<thư mục>)");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.LLM_PROVIDER === "fake") {
  console.error("LLM_PROVIDER=fake chỉ dùng cho test, không được bật ở production");
  process.exit(1);
}
const { buildApp } = await import("./api/app.js");
const app = await buildApp({ logger: true });
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8973);
await app.listen({ host, port });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    app.log.info(`Nhận ${sig}, đang tắt server`);
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}
