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
  `
CREATE TABLE plans (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price > 0),
  credits     INTEGER NOT NULL CHECK (credits > 0),
  valid_days  INTEGER NOT NULL CHECK (valid_days > 0),
  active      BOOLEAN NOT NULL DEFAULT true,
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO plans (code, name, description, price, credits, valid_days, sort) VALUES
  ('MO_KHOA_1', 'Mở khoá 1 lá số', 'Luận giải chuyên sâu bằng AI cho một lá số, đọc lại không giới hạn.', 49000, 1, 365, 1),
  ('GOI_5', 'Gói gia đình 5 lá số', 'Mở khoá luận giải chuyên sâu cho 5 lá số (bản thân, người thân).', 149000, 5, 365, 2),
  ('GOI_15', 'Gói 15 lá số', 'Cho người hay xem cho bạn bè, khách hàng: 15 lá số.', 299000, 15, 365, 3);

CREATE TABLE orders (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code   TEXT NOT NULL REFERENCES plans(code),
  amount      INTEGER NOT NULL,
  credits     INTEGER NOT NULL,
  valid_days  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  paid_at     TIMESTAMPTZ,
  paid_by     TEXT,
  note        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX orders_user ON orders (user_id, created_at DESC);
CREATE INDEX orders_status ON orders (status, created_at DESC);

CREATE TABLE payment_transactions (
  id               BIGINT PRIMARY KEY,
  gateway          TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL DEFAULT '',
  account_number   TEXT NOT NULL DEFAULT '',
  code             TEXT,
  content          TEXT NOT NULL DEFAULT '',
  transfer_type    TEXT NOT NULL,
  transfer_amount  BIGINT NOT NULL,
  reference_code   TEXT,
  order_id         INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  match_status     TEXT NOT NULL,
  raw              JSONB NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_transactions_status ON payment_transactions (match_status, received_at DESC);

CREATE TABLE credit_grants (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id      INTEGER UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  credits_total INTEGER NOT NULL CHECK (credits_total > 0),
  credits_left  INTEGER NOT NULL CHECK (credits_left >= 0),
  expires_at    TIMESTAMPTZ NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credit_grants_user ON credit_grants (user_id, expires_at);

CREATE TABLE unlocked_reports (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chart_key   TEXT NOT NULL,
  input       JSONB NOT NULL,
  grant_id    INTEGER REFERENCES credit_grants(id) ON DELETE SET NULL,
  report      JSONB NOT NULL,
  sections    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chart_key)
);
`,
];
