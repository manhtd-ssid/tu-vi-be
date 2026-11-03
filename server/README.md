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
npm test             # 72 test
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
| `API_KEY`, `LLM_ALLOW_USERS` | Bảo vệ luận giải LLM: cần `X-API-Key`, hoặc (khi `LLM_ALLOW_USERS=1`) người dùng đã đăng nhập. |
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
| `src/agents/` | `agents/*.py` | RAG trên `data/kb.json`, gọi LLM, Guardrail 6 kiểm tra, ghép báo cáo 12 cung |
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
| `POST /v1/luan-giai/stream` | Như trên nhưng dạng Server-Sent Events: `cach_cuc` → 12 × `cung` (mỗi cung đã qua Guardrail) → `done` |
| `GET /health` | `{"status":"ok"}` |
| `POST /v1/auth/register`, `POST /v1/auth/login`, `GET /v1/auth/me` | Tài khoản email + mật khẩu, trả JWT (`Authorization: Bearer ...`) |
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
