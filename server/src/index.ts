/** Điểm chạy server. `npm run dev` → http://127.0.0.1:8973 (giao diện thử: /viewer) */
import { loadEnv } from "./lib/env.js";

loadEnv();
const { buildApp } = await import("./api/app.js");
const app = await buildApp({ logger: true });
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8973);
await app.listen({ host, port });
