# tu-vi-be — Backend Tử Vi

Backend của Tử Vi Vi Tinh (Tử Vi Đẩu Số), viết bằng **Node.js/TypeScript** trong [`server/`](server/README.md):
engine an sao tất định, luận giải grounded + Guardrail (tuỳ chọn LLM), tài khoản, thanh toán SePay, API admin.

```bash
cd server && npm install && npm run dev     # http://127.0.0.1:8973 — tài liệu API: /docs
docker compose up --build                    # PostgreSQL + API
```

Cấu hình: `.env` ở gốc repo (xem `.env.example`). Chi tiết API, kiến trúc, kiểm thử: [`server/README.md`](server/README.md).

## Nguồn gốc engine

Engine an sao port 1-1 từ [`lasotuvi`](https://github.com/doanguyen/lasotuvi) (Python, MIT) cùng các phần học từ
[ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu) (MIT): Tứ Hóa theo tầng vận, cách cục, Chân Thái Dương.
Bản Python gốc đã được gỡ khỏi repo; trước khi gỡ, kết quả của nó trên 1.000 ca ngẫu nhiên được lưu thành
fixture (`server/test/fixtures/python-golden.json.gz`) và test `pythonGolden.test.ts` đòi bản Node khớp 100%.
Bản Python vẫn xem được trong lịch sử git (trước commit gỡ bỏ).

## Trường phái

Vị trí sao, bảng Tứ Hóa theo `lasotuvi` (trường phái Việt). Khi còn bản Python, đã đối chiếu 2.000 ca với
[iztro](https://github.com/SylarLong/iztro) cùng lịch UTC+8: Mệnh, Thân, Cục, can cung, đại hạn, 14 chính tinh khớp
100%. Khác biệt có chủ đích hoặc chờ chốt:

- Tứ Hóa: Canh (Khoa Đồng, Kỵ Âm), Nhâm (Khoa Phủ) khác bảng Trung Châu.
- Hỏa Tinh, Linh Tinh: công thức an khác nhau.
- Khôi, Việt: năm Đinh, Mậu, Canh, Nhâm hai sao đổi chỗ cho nhau so với iztro.
- Lịch: dùng UTC+7. Lịch VN và TQ lệch nhau ở một số ngày, nên không dùng lịch TQ.

## Giới hạn

- Chưa có: hợp lá số, cổ thư, kho 518.400 mẫu luận giải.
- Kho luận giải chỉ có 12 cung và 14 chính tinh; phụ tinh chưa có luận giải riêng.
- Nếu dùng bộ mẫu 518.400 của ziwei-doushu, phải ghi nguồn theo yêu cầu của tác giả.
