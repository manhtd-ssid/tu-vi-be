# PROJECT_MAP — tu-vi-be

Bản đồ để tìm đường, lập lần đầu ngày 2026-11-04 từ code nhánh `feat/manh-lap` (sau merge `feat/manh-cloud`).
Code là nguồn sự thật: map lệch code thì tin code rồi sửa map. Chi tiết API đầy đủ: [`server/README.md`](../server/README.md).

## Hệ thống gồm 3 repo

| Repo | Vai trò | Gọi tới |
|---|---|---|
| **tu-vi-be** (repo này) | API + engine lá số + luận giải AI + tài khoản + thanh toán | PostgreSQL, Claude/OpenAI, SMTP, Google OAuth, SePay (webhook vào) |
| tu-vi-fe | Trang công khai (Next.js 15 static export) | `/v1/*`, `/s/*` |
| tu-vi-admin-fe | Trang quản trị (Next.js 16) | `/admin/*`, `/v1/auth/*` |

## Thư mục gốc

| Đường dẫn | Nội dung |
|---|---|
| `server/` | Toàn bộ code backend (package riêng, `npm` chạy trong thư mục này) |
| `docker-compose.yml`, `server/Dockerfile` | PostgreSQL + API |
| `.env.example` | Mọi biến môi trường, có chú thích (backend đọc `.env` ở gốc repo) |
| `.github/workflows/server.yml` | CI: typecheck, test, test trên Postgres, build; push `dev`/`master` → image `ghcr.io/<owner>/tu-vi-be` |
| `third_party/` | Giấy phép ziwei-doushu (MIT) |

## Module trong `server/src/`

| Module | File chính | Việc |
|---|---|---|
| Khởi động | `index.ts`, `api/app.ts` | Nạp `.env` (`lib/env.ts`), mở DB + migrate, CORS, cookie, rate-limit, CSRF hook, JWT, Swagger `/docs`, error handler, đăng ký route |
| HTTP dùng chung | `api/http.ts` | `HttpError`, `ValidationError` (422), `parse` (zod), `currentUser`, `requireAdmin`, `canCsrfHeader`, `SESSION_COOKIE` |
| Nghiệp vụ lá số | `api/service.ts` (`ChartService`) | Lập lá số có cache LRU, luận giải có cache, ghi `luan_giai_logs` |
| Engine (tất định) | `engine/tuviEngine.ts` (`lapLaSo`) | Lá số có cấu trúc. Lõi `engine/lasotuvi/` (âm lịch HND, can chi, 109 sao, địa bàn); `tuHoa.ts`, `vanHan.ts` (đại/tiểu hạn, lưu niên/nguyệt), `cachCuc.ts` (41 quy tắc), `thoiGian.ts` (giờ âm, Chân Thái Dương, kinh độ 63 tỉnh) |
| Luận giải AI | `agents/orchestrator.ts` (`buildReport`) | 12 cung: retrieve KB → LLM/offline → Guardrail từng cung. LLM ở `agents/interpretation.ts` (Claude → OpenAI → offline; `fakeLlm`; `chiPhiUsd`) |
| Guardrail | `agents/guardrail.ts` | 6 kiểm tra C1–C6 (trích dẫn, độ phủ, miếu/hãm, sao ngoài nguồn, disclaimer, không định mệnh) |
| Vận năm | `agents/vanNam.ts` | Tổng quan năm + 12 tháng; bản tổng hợp / bản AI |
| Hỏi đáp AI | `agents/hoiDap.ts` | Trả lời câu hỏi tự do theo lá số, từ chối chủ đề cấm, Guardrail |
| Kho luận giải | `agents/kbStore.ts`, `agents/kb.ts`, `data/kb.json` | Bảng `kb_entries` (seed từ `kb.json` lần đầu), nạp vào bộ nhớ, `version` tăng khi admin sửa |
| Thanh toán | `billing/billing.ts` (`Billing`) | Gói, đơn `TUVIxxxxxxxx`, VietQR, webhook SePay, cộng/trừ/thu hồi lượt, mở khoá báo cáo |
| Mã giảm giá | `billing/coupons.ts` | `apDungMa`, `tinhGiam`, giữ chỗ lượt dùng |
| Giới thiệu bạn bè | `billing/referral.ts` | Mã `BANxxxxxx`, `apDungMaBatKy` (mã giảm giá hoặc mã giới thiệu), `thuongGioiThieu`, `thuHoiThuong` |
| Tài khoản | `api/routes/auth.ts`, `lib/password.ts` (scrypt), `auth/google.ts` | Email + mật khẩu, JWT có `token_version`, xác thực email, quên mật khẩu, Google OAuth |
| Email | `email/mailer.ts`, `email/templates.ts` | SMTP (chưa cấu hình thì in log), ghi `email_outbox` (không lưu nội dung) |
| Chia sẻ | `api/routes/share.ts`, `share/og.ts` | `share_token`, trang `/s/:token` có Open Graph, ảnh PNG vẽ bằng resvg |
| Phễu | `analytics/events.ts` | `track`, `phieu`; cookie ẩn danh `tuvi_vid`; không ghi dữ liệu cá nhân |
| Nhật ký admin | `admin/audit.ts` | `ghiNhatKy` — gọi trong cùng transaction |
| Database | `db/index.ts`, `db/migrations.ts` | `createDb` (pg hoặc PGlite), `migrate` tự chạy khi khởi động |
| Tiện ích | `lib/py.ts`, `lib/text.ts`, `lib/lru.ts` | Mô phỏng ngữ nghĩa Python cho engine port, chuẩn hoá chuỗi, cache |

## Route → file

| File | Endpoint |
|---|---|
| `api/routes/core.ts` | `GET /health`, `GET /v1/meta`, `GET /v1/kb/public`, `POST /v1/la-so`, `/v1/luu-nien`, `/v1/luan-giai`, `/v1/luan-giai/stream` (SSE), `/v1/luan-giai/nam`; tương thích cũ `POST /chart`, `/interpret`, `GET /viewer` |
| `api/routes/auth.ts` | `/v1/auth/*`: register, login, logout, logout-all, me (GET/PATCH), change-password, verify-email, resend-verification, forgot, reset, providers, google/start, google/callback |
| `api/routes/charts.ts` | `/v1/la-so-da-luu` (GET/POST), `/v1/la-so-da-luu/:id` (GET/DELETE) |
| `api/routes/share.ts` | `/v1/la-so-da-luu/:id/chia-se` (GET/POST/DELETE), `GET /v1/chia-se/:token`, `GET /s/:token`, `GET /s/:token/og.png` |
| `api/routes/hoiDap.ts` | `POST /v1/hoi-dap`, `POST /v1/hoi-dap/lich-su` |
| `api/routes/billing.ts` | `GET /v1/plans`, `/v1/me/credits`, `/v1/me/referral`, `/v1/orders` (GET/POST), `/v1/orders/:id`, `POST /v1/coupons/check`, `POST /v1/events`, `POST /v1/payments/sepay/webhook` |
| `api/routes/admin.ts` | `/admin/stats`, `/admin/users` (+PATCH `:id`), `/admin/la-so`, `/admin/kb` (+GET/PUT `:kind/:key`), `/admin/audit`, `/admin/emails`, `/admin/luan-giai-logs` |
| `api/routes/adminBilling.ts` | `/admin/billing/stats`, `/admin/plans` (+PUT `:code`), `/admin/orders` (+`:id/mark-paid`, `cancel`, `refund`), `/admin/payment-transactions` (+`:id/resolve`), `/admin/users/:id/credits` (GET/POST), `/admin/coupons` (+PUT `:code`), `/admin/funnel`, `/admin/referrals`, `PUT /admin/referral-settings` |

## Database (`server/src/db/migrations.ts`)

Version = vị trí trong mảng `MIGRATIONS`. Hiện có **7** migration (số lớn nhất: 7); bảng `schema_migrations` lưu version đã chạy.

| # | Nội dung |
|---|---|
| 1 | `users`, `saved_charts`, `kb_entries`, `luan_giai_logs` |
| 2 | `plans`, `orders`, `payment_transactions`, `credit_grants`, `unlocked_reports` |
| 3 | `users.email_verified_at`, `token_version`; `email_tokens`, `email_outbox`; cột chi phí LLM trong `luan_giai_logs` |
| 4 | `admin_audit`; đơn `refunded` + cột hoàn tiền; `credit_grants.revoked_*`; `payment_transactions.resolved_*` |
| 5 | `coupons`; `orders.original_amount`, `discount_amount`, `coupon_code`; `events` |
| 6 | Google (`users.google_sub`, `password_hash` cho phép NULL), `users.referral_code`, `app_settings`, `orders.referral_code`/`referrer_id`, `credit_grants.referral_order_id` |
| 7 | Chia sẻ (`saved_charts.share_*`), `hoi_dap_threads`, `hoi_dap_messages` |

## Test (`server/test/`)

| File | Phạm vi |
|---|---|
| `pythonGolden.test.ts`, `engine.test.ts`, `ketHop.test.ts` | Engine: khớp bản Python, các trường hợp đặc biệt, kết hợp module |
| `api.test.ts` | Hợp đồng HTTP lá số / luận giải |
| `account.test.ts`, `session.test.ts` | Tài khoản, cookie phiên, CSRF, token_version |
| `billing.test.ts`, `couponFunnel.test.ts`, `googleReferral.test.ts` | Thanh toán, mã giảm giá + phễu, Google + giới thiệu |
| `adminAudit.test.ts` | Nhật ký admin, hoàn tiền, xử lý giao dịch |
| `vanNam.test.ts`, `shareHoiDap.test.ts` | Vận năm, chia sẻ + hỏi đáp |

## Biến môi trường

Danh sách đầy đủ có chú thích ở `.env.example`. Bắt buộc ở production: `DATABASE_URL`, `JWT_SECRET`.
Nhóm khác: CORS/cookie, admin bootstrap, LLM + ngân sách, SMTP, Google, SePay, hỏi đáp, analytics.

## Tài liệu sâu hơn

Chưa có: `ARCHITECTURE.md`, `API_MAP.md`, `DATA_FLOW.md`, `DATABASE_MAP.md`, `LOCAL_TEST.md`, `DEPLOY.md`, `docs/spec/`, `docs/futures/`.
Tạm thời: `server/README.md` (API, tài khoản, thanh toán, kiểm thử), `README.md` (nguồn gốc engine, trường phái).

## Lệch so với quy ước — Cần chủ sản phẩm quyết

- Quy ước mới: lỗi API dạng `{ error, code? }`. Hiện trạng: `HttpError` trả `{ detail }`, lỗi kiểu dữ liệu trả
  `422 { detail: [...] }`, chỉ `InputError` (ngày sai…) trả `{ error }`. Client tu-vi-fe và tu-vi-admin-fe đọc được cả hai.
  Chưa đổi; cần quyết có chuyển hết sang `{ error, code }` không.
- Không có lệnh `db:migrate` riêng: migration tự chạy khi server khởi động.
