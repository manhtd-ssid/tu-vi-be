/** Migration theo thứ tự; chỉ THÊM phần tử mới vào cuối, không sửa phần tử đã chạy. */
export const MIGRATIONS: string[] = [
  `
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE saved_charts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT '',
  input      JSONB NOT NULL,
  summary    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX saved_charts_user ON saved_charts (user_id, created_at DESC);

CREATE TABLE kb_entries (
  kind       TEXT NOT NULL CHECK (kind IN ('cung', 'chinhTinh', 'meta')),
  key        TEXT NOT NULL,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (kind, key)
);

CREATE TABLE luan_giai_logs (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  input          JSONB NOT NULL,
  use_llm        BOOLEAN NOT NULL,
  verdict        TEXT NOT NULL,
  guardrail_tong TEXT NOT NULL,
  blocked        BOOLEAN NOT NULL,
  per_cung       JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX luan_giai_logs_created ON luan_giai_logs (created_at DESC);
CREATE INDEX luan_giai_logs_blocked ON luan_giai_logs (blocked, created_at DESC);
`,
];
