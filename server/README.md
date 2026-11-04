# tu-vi-be/server — Backend Tử Vi (Node.js + TypeScript)

Bản Node của backend Tử Vi, port 1-1 từ engine Python (`src/`, `agents/`). Hợp đồng
HTTP giữ nguyên, frontend không phải sửa gì.

Công nghệ: Node ≥ 20, TypeScript, Fastify 5, zod 4, PostgreSQL (`pg`, PGlite cho dev/test),
JWT, vitest, `@anthropic-ai/sdk` + `openai` (tuỳ chọn).

## Chạy

```bash
cd server
npm install
npm run dev          # http://127.0.0.1:8973 — tài liệu API: /docs, giao diện thử: /viewer
npm test             # 103 test
npm run build && npm start
```

Hoặc chạy đủ bộ (PostgreSQL + API) bằng Docker, ở gốc repo:

```bash
docker compose up --build
```

Cấu hình đọc từ `.env` ở gốc repo, xem `../.env.example` (biến môi trường thật được ưu tiên).
Quan trọng:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | `postgres://...` (production). `pglite://<thư mục>` hoặc để trống: Postgres nhúng cho dev (để trống = trong bộ nhớ). Bắt buộc khi `NODE_ENV=production`. |
| `JWT_SECRET` | Khoá ký token đăng nhập. Bắt buộc khi `NODE_ENV=production`. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Tạo/cập nhật tài khoản admin khi khởi động. |
| `API_KEY` | Header `X-API-Key` khớp giá trị này thì dùng luận giải AI nội bộ, không tính lượt. |
| `SEPAY_BANK`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`, `SEPAY_WEBHOOK_KEY` | Thanh toán SePay, xem mục Thanh toán. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Không có thì luận giải chạy offline. |

Schema database tự migrate khi khởi động (`src/db/migrations.ts`). Lần đầu, kho luận giải
được seed từ `data/kb.json` vào bảng `kb_entries`; sau đó sửa qua API admin.

## Cấu trúc

| Thư mục / file | Port từ | Chức năng |
|---|---|---|
| `src/engine/lasotuvi/` | `src/vendor/lasotuvi/` | Lõi an sao: âm lịch Hồ Ngọc Đức, can chi, ngũ hành, 109 sao, địa bàn |
| `src/engine/tuviEngine.ts` | `tuvi_engine.py` | `lapLaSo()`: lá số có cấu trúc (can cung, miếu/hãm, Tứ Hóa, Tuần/Triệt, Cục...) |
| `src/engine/tuHoa.ts` | `tu_hoa.py` | Bảng Tứ Hóa trường phái Việt |
| `src/engine/vanHan.ts` | `van_han.py` | Đại hạn, tiểu hạn, lưu niên, lưu nguyệt |
| `src/engine/cachCuc.ts` | `cach_cuc.py` | 41 quy tắc cách cục (24 nhóm) |
| `src/engine/thoiGian.ts` | `thoi_gian.py` | Giờ đồng hồ → giờ âm, Chân Thái Dương, Tý muộn, kinh độ 63 tỉnh |
| `src/agents/` | `agents/*.py` | RAG trên kho luận giải, gọi LLM, Guardrail 6 kiểm tra, ghép báo cáo 12 cung; `vanNam.ts` (mới): luận giải vận năm |
| `src/api/` | `service/api.py` | Fastify: route, schema zod, cache LRU, OpenAPI |
| `src/db/` | (mới) | Kết nối PostgreSQL/PGlite, migration |
| `scripts/crossval.ts` + `oracle.py` | (mới) | Đối chiếu toàn bộ output Node ⇄ Python |

## API

| Endpoint | Nội dung |
|---|---|
| `POST /v1/la-so` | Lá số + đại hạn + cách cục |
| `POST /v1/luu-nien` | Thêm `nam_xem`: vận năm + 12 tháng |
| `POST /v1/luan-giai` | Báo cáo 12 cung; `use_llm: true` cần header `X-API-Key` nếu đặt `API_KEY` |
| `GET /v1/meta` | Danh sách giờ, tỉnh |
| `POST /v1/luan-giai/nam` | Luận giải vận năm `nam_xem`: tổng quan (đại hạn, tiểu hạn, Thái Tuế, Tứ Hóa lưu niên) + 12 tháng. Bản tổng hợp miễn phí; `use_llm: true` là bản AI, 1 lượt cho mỗi (lá số, năm) |
| `POST /v1/luan-giai/stream` | Như trên nhưng dạng Server-Sent Events: `cach_cuc` → 12 × `cung` (mỗi cung đã qua Guardrail) → `done` |
| `GET /health` | `{"status":"ok"}` |
| `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `POST /v1/auth/logout-all` | Tài khoản email + mật khẩu. Phiên: cookie httpOnly `tuvi_session` (trình duyệt) hoặc header `Authorization: Bearer <token>` |
| `GET/PATCH /v1/auth/me`, `POST /v1/auth/change-password` | Thông tin tài khoản, đổi tên, đổi mật khẩu (các phiên khác bị đăng xuất) |
| `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification` | Xác thực email (link 24 giờ) |
| `POST /v1/auth/forgot`, `POST /v1/auth/reset` | Quên / đặt lại mật khẩu (link dùng một lần, 30 phút) |
| `GET/POST /v1/la-so-da-luu`, `GET/DELETE /v1/la-so-da-luu/:id` | Lá số đã lưu của người dùng |
| `GET /admin/stats` | Thống kê (cần role admin) |
| `GET /admin/users`, `PATCH /admin/users/:id` | Tìm người dùng, đổi quyền |
| `GET /admin/la-so` | Lá số người dùng đã lưu (tìm theo email, nhãn) |
| `GET /admin/kb`, `GET/PUT /admin/kb/:kind/:key` | Kho luận giải (12 cung, 14 chính tinh); sửa xong báo cáo dùng nội dung mới ngay |
| `GET /admin/luan-giai-logs` | Log luận giải, lọc `blocked=true` để xem bản bị Guardrail chặn |
| `POST /chart`, `POST /interpret`, `GET /viewer` | Tương thích `laso_viewer.html` |

Body giống bản Python, ví dụ:
`{"ngay":15,"thang":8,"nam":1990,"gio":12,"phut":30,"tinh":"Hà Nội","gioi_tinh":1}`.
Sai kiểu/thiếu trường → `422 {"detail":[...]}`; ngày không tồn tại, năm xem trước năm sinh → `400 {"error": ...}`.

Khác bản Python (có chủ đích):
- Schema chặt hơn pydantic: số phải là số JSON (`"15"` dạng chuỗi bị từ chối), boolean phải là `true/false`.
- Lỗi 422 có cùng khung `{"detail":[{type, loc, msg}]}` nhưng câu chữ `msg` lấy từ zod.

## Tài khoản, phiên đăng nhập, email

- **Phiên**: JWT trong cookie httpOnly `tuvi_session` (SameSite=Lax, Secure khi production) và cũng trả trong body
  cho client dùng Bearer. JWT mang `token_version`; đổi/đặt lại mật khẩu hoặc "đăng xuất mọi nơi" làm mọi phiên cũ
  hết hiệu lực. Quyền admin đọc từ database ở mỗi request nên thu hồi có hiệu lực ngay.
- **CSRF**: request ghi dữ liệu xác thực bằng cookie phải có header `X-Tuvi-Csrf: 1` (trang lạ không gửi được header
  này qua CORS). Frontend phải gọi API với `credentials: "include"`.
- **Email** qua SMTP (`SMTP_URL`), chưa cấu hình thì in ra log. Gửi: xác nhận email khi đăng ký, đặt lại mật khẩu,
  biên nhận khi đơn được thanh toán. Mỗi email ghi vào bảng `email_outbox` (không lưu nội dung). Token trong link
  chỉ lưu bản băm SHA-256. Phải xác thực email mới mua được gói (`REQUIRE_EMAIL_VERIFIED`).
- **Giới hạn request** (`@fastify/rate-limit`, lưu trong bộ nhớ — chạy nhiều instance thì cần Redis): đăng nhập 20/10 phút/IP,
  đăng ký 10/giờ/IP, quên mật khẩu 5/15 phút/IP, luận giải 60/giờ/người, tạo đơn 20/giờ/người.

## Nhật ký thao tác admin

Mọi API `/admin/*` có ghi dữ liệu ghi một dòng `admin_audit` (admin, thao tác, đối tượng, dữ liệu trước/sau, ghi chú, IP)
trong **cùng transaction** với thao tác: thao tác thất bại thì không có nhật ký, và không có thao tác nào thành công mà
thiếu nhật ký. Các thao tác: `user.role`, `credits.grant`, `plan.create`, `plan.update`, `kb.update`, `order.mark_paid`,
`order.cancel`, `order.refund`, `payment.resolve`.

Doanh thu trong thống kê là tiền thực thu (đơn đã hoàn chỉ tính phần không hoàn).

## Chi phí LLM

Mỗi lần luận giải ghi số lần gọi, token vào/ra, model và chi phí ước tính (USD) vào `luan_giai_logs`
(giá có sẵn cho claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5, gpt-4o-mini; ghi đè bằng `LLM_PRICE_*`).
`LLM_DAILY_BUDGET_USD`: chạm ngưỡng trong ngày (giờ VN) thì luận giải AI trả 503, không trừ lượt; đọc lại lá số đã
mở khoá vẫn được. Admin xem chi phí hôm nay, 30 ngày và chi phí trung bình mỗi lần mở khoá ở `GET /admin/billing/stats`.

## Thanh toán (SePay) và lượt luận giải AI

Người dùng mua gói → nhận lượt; mỗi lượt mở khoá luận giải AI cho **một lá số**. Báo cáo đã mở khoá được
lưu lại: đọc lại không tốn lượt, không gọi LLM. Nếu AI viết được ít hơn `MIN_CUNG_AI` cung qua Guardrail
(lỗi LLM, chưa có key...) thì trả bản tổng hợp và **không trừ lượt**.

Luồng thanh toán:
1. `POST /v1/orders {plan_code}` → đơn mã `TUVIxxxxxxxx` + thông tin chuyển khoản và ảnh VietQR (`qr.sepay.vn`).
   Tải lại trang thì dùng lại đơn đang chờ cùng gói.
2. Khách chuyển khoản với nội dung là mã đơn. SePay gọi `POST /v1/payments/sepay/webhook`
   (header `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`).
3. Backend tìm mã đơn trong `code`/`content`, đủ tiền thì đánh dấu đã trả và cộng lượt (cùng một transaction).
   Mỗi giao dịch SePay (theo `id`) chỉ xử lý một lần nên SePay gửi lại không cộng trùng.
4. Trang web hỏi `GET /v1/orders/:id` mỗi vài giây tới khi `status = paid`.

Giao dịch không khớp vẫn trả `200 {"success": true}` (để SePay không gửi lại) và được lưu với `match_status`:
`thieu_tien`, `khong_co_ma_don`, `khong_tim_thay_don`, `don_da_thanh_toan` (khách trả hai lần), `don_da_huy`, `tien_ra`.
Admin xem ở `GET /admin/payment-transactions?can_xem=true` và xác nhận tay bằng `POST /admin/orders/:id/mark-paid`.
Đơn quá `ORDER_EXPIRES_MIN` phút hiển thị "hết hạn" nhưng tiền về muộn vẫn được nhận.

Cấu hình trên SePay: my.sepay.vn → Webhooks → Thêm webhook, URL `https://<api>/v1/payments/sepay/webhook`,
kiểu chứng thực **API Key**, khoá = `SEPAY_WEBHOOK_KEY`. Định dạng webhook và QR lấy theo gói tích hợp chính thức
`sepayvn/laravel-sepay` (trang docs.sepay.vn không truy cập được từ môi trường phát triển) — nên bấm
"Gửi thử" trên SePay một lần sau khi deploy để xác nhận.

| Endpoint | Nội dung |
|---|---|
| `GET /v1/plans` | Các gói đang bán |
| `GET /v1/me/credits` | Lượt còn lại, các lần cộng lượt, số lá số đã mở khoá |
| `GET/POST /v1/orders`, `GET /v1/orders/:id` | Đơn của người dùng |
| `POST /v1/payments/sepay/webhook` | Webhook SePay |
| `GET /admin/billing/stats` | Doanh thu, đơn, lượt đã dùng, giao dịch cần xem |
| `GET /admin/plans`, `PUT /admin/plans/:code` | Sửa/thêm gói (chỉ áp dụng cho đơn mới) |
| `GET /admin/orders`, `POST /admin/orders/:id/mark-paid`, `POST /admin/orders/:id/cancel` | Đơn hàng |
| `GET /admin/payment-transactions` | Giao dịch SePay đã nhận |
| `GET/POST /admin/users/:id/credits` | Xem / cộng lượt thủ công (ghi lý do) |
| `POST /admin/orders/:id/refund {amount, note}` | Ghi nhận hoàn tiền đơn đã trả (chuyển tiền làm ngoài hệ thống): thu hồi lượt chưa dùng, giữ lá số đã mở khoá, gửi email báo khách |
| `POST /admin/payment-transactions/:id/resolve {note}` | Đánh dấu giao dịch không khớp đã xử lý (rời danh sách cần xem) |
| `GET /admin/audit` | Nhật ký thao tác admin (lọc `action` theo tiền tố, `admin_id`, `target_type`, `target_id`) |
| `GET /admin/emails` | Hộp thư đi: người nhận, loại, trạng thái gửi, lỗi (không lưu nội dung) |

## Kiểm thử

- `npm test`: engine, API, tài khoản/admin (PGlite trong bộ nhớ).
- `TEST_DATABASE_URL=postgres://... npx vitest run test/account.test.ts`: chạy phần database trên PostgreSQL
  thật (schema `public` của database đó bị **xoá sạch**, dùng database riêng cho test).
- CI (`.github/workflows/server.yml`): typecheck, test, test trên Postgres, crossval 2000 ca, build;
  push lên `dev`/`master` thì build và đẩy image lên `ghcr.io/<owner>/tu-vi-be`.

## Độ tin cậy của bản port

`npm run crossval -- --n 3000 --seed 42` chạy cùng bộ ca ngẫu nhiên qua cả hai engine
(năm 1850–2150, âm/dương lịch, tháng nhuận, cả hai `nhuan_policy`, quy đổi giờ có/không
kinh độ) và so **toàn bộ** JSON: mọi sao, đặc tính, Tứ Hóa, Tuần/Triệt, đại/tiểu hạn,
cách cục, lưu niên/lưu nguyệt, báo cáo luận giải offline. Kết quả hiện tại: 3.750/3.750 ca
khớp (thêm 2.500/2.500 với seed 7). Cần `python3` để chạy (chỉ thư viện chuẩn).

Ghi chú khi port: các chỗ Python và JS khác ngữ nghĩa (`%` với số âm, `int()` cắt về 0,
`round` kiểu banker, `str.title()`, `sorted` theo code point, `repr` list) được mô phỏng
trong `src/lib/py.ts`. Bản Python dùng sao singleton nên phải khoá và reset giữa các
lá số; bản Node tạo sao mới cho mỗi lá số nên an toàn khi chạy song song.
