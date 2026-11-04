# CLAUDE.md — tu-vi-be

Backend của Tử Vi Vi Tinh: Node 22 + TypeScript + Fastify 5, zod 4, PostgreSQL (dev/test dùng PGlite), vitest.
Code nằm trong `server/`. Bản đồ code: [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) — đọc trước khi code.

## Riêng repo này

### Lệnh kiểm tra (bước 3)
```
cd server
npm ci                 # lần đầu / khi package-lock đổi
npm run typecheck
npm test
```
CI (`.github/workflows/server.yml`) chạy thêm: test database trên PostgreSQL thật, `npm run build`.

### Quy tắc riêng
- Engine an sao (`server/src/engine/`) được khoá bằng `test/pythonGolden.test.ts` (1.000 ca khớp 100% với bản Python gốc).
  Test này đỏ thì dừng lại hỏi Manh; chỉ sinh lại fixture khi Manh xác nhận thay đổi là cố ý, và ghi lý do trong commit.
- Migration: `server/src/db/migrations.ts`, mảng `MIGRATIONS`; số version = vị trí trong mảng (phần tử đầu là 1).
  Chỉ thêm phần tử mới vào **cuối** mảng, không sửa phần tử cũ. Hai nhánh cùng thêm phần tử → nhánh merge sau đặt
  phần tử của mình phía sau (tức là đổi số).
- Mọi API `/admin/*` có ghi dữ liệu phải gọi `ghiNhatKy` (`src/admin/audit.ts`) trong **cùng transaction** với thao tác.
- Analytics (`src/analytics/events.ts`): không ghi ngày giờ sinh, tên, email vào bảng `events`.
- Route trong `src/api/routes/` giữ mỏng: parse bằng zod (`parse` trong `src/api/http.ts`) → gọi nghiệp vụ trong
  `src/billing/`, `src/agents/`, `src/api/service.ts`… → trả kết quả.
- Chế độ giả cho test: `LLM_PROVIDER=fake`, `GOOGLE_OAUTH=fake` — bị cấm khi `NODE_ENV=production`.

## Quy tắc làm việc chung (giống nhau ở cả 3 repo tu-vi-be, tu-vi-fe, tu-vi-admin-fe)

### Bối cảnh
- Manh code trên 2 máy, mỗi máy một tài khoản Claude. Thỉnh thoảng có thêm phiên Claude chạy trên cloud.
- Mỗi nơi code trên một nhánh riêng:
  - laptop: `feat/manh-lap`
  - PC: `feat/manh-pc`
  - mỗi phiên cloud một nhánh riêng: `feat/manh-cloud`, `feat/manh-cloud2`…
- Nhánh chung là `dev` (tích hợp) → `master` (bản chạy thật). Không ai commit thẳng vào `dev` hay `master`, mọi thay đổi đều qua PR.

### 1. Bản đồ code — đọc trước khi code
- `docs/PROJECT_MAP.md` là bản đồ để tìm đường. Code mới là nguồn sự thật cuối cùng: map lệch code thì tin code, rồi sửa lại map.
- Trước mỗi việc, đi theo thứ tự: PROJECT_MAP → module → file → hàm → code. Không quét cả repo.
- Cần sâu hơn thì chỉ mở đúng tài liệu cần dùng: ARCHITECTURE / API_MAP / DATA_FLOW / DATABASE_MAP / LOCAL_TEST / DEPLOY (trong `docs/`), yêu cầu sản phẩm ở `docs/spec/`, spec từng tính năng ở `docs/futures/<tên>.md`.
- Sau khi đổi module, API, schema DB, luồng dữ liệu hoặc tích hợp ngoài: cập nhật tài liệu tương ứng trong cùng commit.
- Mỗi spec tính năng phải ghi rõ: "Đã làm (ngày)" / "Chưa làm" / "Cần chủ sản phẩm quyết". Spec đã lỗi thời thì sửa lại, hoặc ghi "ĐÃ THAY THẾ" ở đầu file.

### 2. Quy trình Git (Manh tự chạy, Claude chỉ nhắc)
- Alias chạy một lần trên mỗi máy:
  `git config --global alias.sync '!git fetch origin && git rebase origin/dev'`
- Bước 1 — trước khi bắt đầu việc mới:
  ```
  git switch feat/manh-lap   (hoặc feat/manh-pc)
  git sync
  ```
- Bước 2 — code, commit với message dạng `[Task] …` / `[Fix] …` / `[Docs] …`
- Bước 3 — làm xong, trước khi mở PR:
  ```
  git fetch origin
  git rebase origin/dev
  <typecheck + test của repo — xem mục "Lệnh kiểm tra" bên dưới>
  git push --force-with-lease
  ```
- Bước 4 — mở PR từ nhánh của mình vào `dev`; CI xanh mới merge.
  - Kiểu merge: "Create a merge commit" hoặc "Rebase and merge".
  - Lỡ chọn Squash thì chạy: `git fetch origin && git reset --hard origin/dev && git push --force-with-lease`
- Bước 5 — quay lại bước 1 cho việc tiếp theo.
- Luôn push bằng `--force-with-lease`. Không bao giờ dùng `--force` trần, không bao giờ force-push `dev` hay `master`.

### 3. Phối hợp 2 máy / nhiều phiên
- Hai nơi không sửa cùng một vùng code cùng lúc. Trước khi giao việc, xem `git log origin/dev` để chắc việc đó chưa có ai làm.
- Một nhánh vừa merge xong thì các máy và phiên còn lại phải `git sync` trước khi code tiếp.
- Luôn đọc code mới nhất (sau khi sync) trước khi sửa, không dựa vào bản nhớ từ phiên trước.
- Migration DB:
  - chỉ thêm; DROP hoặc xoá dữ liệu phải hỏi Manh và nhắc sao lưu DB;
  - đánh số tiếp theo số lớn nhất đang có trên `dev`;
  - hai nhánh trùng số thì nhánh merge sau đổi số.
- CI phải xanh mới merge. Khi review PR, xem kỹ danh sách file bị xoá.
- File chỉ khác ký tự xuống dòng (CRLF/LF) thì `git restore` file đó trước khi commit.
- Phiên cloud chạy một mình: chỉ commit và push nhánh của chính phiên đó, không merge, không đụng `dev`/`master`. Chỗ nào cần quyết định sản phẩm thì ghi vào mục "Cần chủ sản phẩm quyết", không tự quyết.

### 4. Vai trò của Claude
- Git là việc của Manh (add/commit/switch/push/merge/PR). Claude chỉ sửa code, không chạy lệnh git ghi, không nói "đã commit".
- Thấy file khác với bản Claude nhớ thì hỏi Manh lý do. Giữ các chỉnh sửa tay của Manh, không bao giờ trả code đã commit về bản cũ.
- Không tự tạo file preview hay render khi Manh không yêu cầu.
- Không tạo pull request khi chưa được yêu cầu.
- Nhắc Manh chạy bước 1 khi bắt đầu việc mới và bước 3 khi làm xong.
- Mỗi lần xong việc, báo đủ 5 mục:
  1. đã làm gì;
  2. kết quả typecheck/test, và cái gì đã thử thật, cái gì chưa;
  3. danh sách file đổi theo từng repo, kèm migration mới nếu có;
  4. commit message gợi ý cho từng repo;
  5. nhắc bước 3, cùng việc cần làm khi deploy (migration, biến môi trường, sao lưu DB…).

### 5. Quy ước chung
- Commit theo dạng `[Task]` / `[Fix]` / `[Docs]`, viết tiếng Việt.
- Trả lời, giao diện, thông báo lỗi cho người dùng viết bằng tiếng Việt; API trả lỗi dạng `{ error: '<tiếng Việt>', code?: '<mã>' }`.
- Logic nghiệp vụ phải có test; route/controller giữ mỏng.
- Không lưu ngày sinh, tên hay email vào sự kiện analytics.
- File trong repo dùng xuống dòng CRLF (checkout trên Windows): khi sửa file thì giữ nguyên kiểu xuống dòng đang có.
