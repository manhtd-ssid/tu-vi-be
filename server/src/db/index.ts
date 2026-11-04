/**
 * Lớp truy cập PostgreSQL tối giản.
 *  - DATABASE_URL=postgres://...  → node-postgres (production, docker-compose)
 *  - DATABASE_URL=pglite://<thư mục> hoặc để trống → PGlite (Postgres chạy trong tiến trình,
 *    dùng cho dev và test; để trống = trong bộ nhớ, mất dữ liệu khi tắt server).
 * Truy vấn viết SQL thuần với tham số $1, $2... nên chạy giống hệt trên cả hai.
 */
import { MIGRATIONS } from "./migrations.js";

export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Chạy fn trong một transaction (BEGIN/COMMIT, lỗi thì ROLLBACK). */
  tx<T>(fn: (q: Db["query"]) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "pg" | "pglite";
}

export async function createDb(url = process.env.DATABASE_URL ?? ""): Promise<Db> {
  const db = url.startsWith("postgres://") || url.startsWith("postgresql://") ? await pgDb(url) : await pgliteDb(url);
  await migrate(db);
  return db;
}

async function pgDb(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10) });
  return {
    kind: "pg",
    async query(sql, params = []) {
      return (await pool.query(sql, params as any[])).rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = await fn(async (sql, params = []) => (await client.query(sql, params as any[])).rows);
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pgliteDb(url: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = url.replace(/^pglite:\/\//, "");
  const pg = dir ? new PGlite(dir) : new PGlite();
  // PGlite chỉ có một kết nối: tuần tự hoá để transaction không xen nhau.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
  const raw = async (sql: string, params: unknown[] = []) => (await pg.query(sql, params as any[])).rows as any[];
  return {
    kind: "pglite",
    query: (sql, params) => serial(() => raw(sql, params)),
    tx: (fn) => serial(() => pg.transaction(async (t) => fn(async (sql, params = []) => (await t.query(sql, params as any[])).rows as any[]))),
    close: () => pg.close(),
  };
}

async function migrate(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => r.version));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (done.has(version)) continue;
    await db.tx(async (q) => {
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await q(stmt);
      await q("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    });
  }
}
