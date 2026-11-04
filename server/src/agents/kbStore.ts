/**
 * Kho tri thức lưu trong database (bảng kb_entries), nạp vào bộ nhớ để luận giải.
 * Lần chạy đầu (bảng trống) tự seed từ data/kb.json. Mỗi lần admin sửa, `version`
 * tăng lên để cache báo cáo luận giải không trả nội dung cũ.
 */
import type { Db } from "../db/index.js";
import { loadKb, type KB } from "./kb.js";

export type KbKind = "cung" | "chinhTinh";
export interface KbEntry { kind: KbKind; key: string; data: any; updated_at: string; updated_by: number | null }

export class KbStore {
  private kb: KB = { cung: {}, chinhTinh: {} };
  version = 0;

  constructor(private db: Db) {}

  static async open(db: Db, seed: () => KB = () => loadKb()): Promise<KbStore> {
    const s = new KbStore(db);
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM kb_entries");
    if (n === 0) {
      const kb = seed();
      await db.tx(async (q) => {
        if (kb._nguon) {
          await q("INSERT INTO kb_entries (kind, key, data) VALUES ('meta', '_nguon', $1)", [JSON.stringify(kb._nguon)]);
        }
        for (const kind of ["cung", "chinhTinh"] as const) {
          for (const [key, data] of Object.entries(kb[kind])) {
            await q("INSERT INTO kb_entries (kind, key, data) VALUES ($1, $2, $3)", [kind, key, JSON.stringify(data)]);
          }
        }
      });
    }
    await s.reload();
    return s;
  }

  async reload(): Promise<void> {
    const rows = await this.db.query<{ kind: string; key: string; data: any }>(
      "SELECT kind, key, data FROM kb_entries ORDER BY kind, key");
    const kb: KB = { cung: {}, chinhTinh: {} };
    for (const r of rows) {
      if (r.kind === "meta" && r.key === "_nguon") kb._nguon = r.data;
      else if (r.kind === "cung" || r.kind === "chinhTinh") kb[r.kind][r.key] = r.data;
    }
    this.kb = kb;
    this.version += 1;
  }

  get(): KB {
    return this.kb;
  }

  async list(): Promise<KbEntry[]> {
    return this.db.query<KbEntry>(
      "SELECT kind, key, data, updated_at, updated_by FROM kb_entries WHERE kind <> 'meta' ORDER BY kind, key");
  }

  async getEntry(kind: KbKind, key: string): Promise<KbEntry | undefined> {
    const [r] = await this.db.query<KbEntry>(
      "SELECT kind, key, data, updated_at, updated_by FROM kb_entries WHERE kind = $1 AND key = $2", [kind, key]);
    return r;
  }

  async update(kind: KbKind, key: string, data: unknown, userId: number | null): Promise<KbEntry | undefined> {
    const r = await KbStore.updateIn(this.db.query.bind(this.db), kind, key, data, userId);
    if (r) await this.reload();
    return r;
  }

  /** Cập nhật trong một transaction có sẵn; người gọi tự reload() sau khi commit. */
  static async updateIn(q: Db["query"], kind: KbKind, key: string, data: unknown, userId: number | null): Promise<KbEntry | undefined> {
    const [r] = await q<KbEntry>(
      `UPDATE kb_entries SET data = $3, updated_at = now(), updated_by = $4
       WHERE kind = $1 AND key = $2 RETURNING kind, key, data, updated_at, updated_by`,
      [kind, key, JSON.stringify(data), userId]);
    return r;
  }
}
