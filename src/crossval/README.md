# Cross-validation: Engine Python (lasotuvi) ⇄ Engine TS (tuvi.ts)

Lớp C của bộ test độ tin cậy — đối chiếu **hai cài đặt an sao độc lập** trên cùng bộ input để phát hiện lệch. Đây là bước mà đề xuất kiến trúc gọi là *cross-validate engine*.

## Phát hiện quan trọng trước khi so sánh

Repo `tuvi-ai` có **hai** file engine, dễ nhầm:

| File | Bản chất | Dùng được? |
|---|---|---|
| `server/services/tuvi-exact.ts` | **Dữ liệu tĩnh (mock)** — 12 cung + sao hardcode "matching the image"; các biến `yearBranch/monthBranch/hourBranch` được tính nhưng **không dùng** để đặt sao → mọi input trả về CÙNG một lá số. | ❌ Không |
| `server/services/tuvi.ts` | **Engine thật** — dùng `lunar-javascript`, tính Cục, `placeTuVi`, an sao theo can/chi/giờ. | ⚠️ Có, nhưng chưa chuẩn (xem dưới) |

→ Cross-validation thực hiện với **`tuvi.ts`** (engine thật).

## Cách làm

Hai engine đánh số cung/hướng khác nhau, nhưng **địa chi (Tý…Hợi) mà mỗi chính tinh rơi vào** là bất biến chuẩn hoá được. Script `compare.py`:

1. Chạy engine Python cho 5 ca mẫu (trùng bộ SAMPLES của `test_engine.py`).
2. Chạy engine TS (`run_ts.ts` qua `tsx`) cho đúng 5 ca đó.
3. Chuẩn hoá tên sao (bỏ dấu, lowercase) rồi so vị trí **14 chính tinh** theo địa chi, cộng vị trí **cung Mệnh**.

```bash
npm install                                   # lunar-javascript + tsx
node_modules/.bin/tsx run_ts.ts > ts_charts.json
python compare.py
```

## Kết quả

| | Kết quả |
|---|---|
| **Cung Mệnh khớp** | **5/5 (100%)** — hai engine luôn đồng ý vị trí Mệnh |
| **Chính tinh khớp** | **28/70 (40%)** |
| **Phân bố** | Nhị phân rõ rệt: **2/5 ca khớp 14/14 tuyệt đối**, **3/5 ca lệch 0/14 hoàn toàn** |

Mẫu "được ăn cả, ngã về không" (14/14 hoặc 0/14) **không phải nhiễu ngẫu nhiên** — đó là dấu hiệu **lỗi hệ thống**, không phải sai lệch lặt vặt.

## Nguyên nhân gốc

Trong Tử Vi, toàn bộ 14 chính tinh được an **tương đối theo vị trí sao Tử Vi**. Vị trí Tử Vi = `placeTuVi(ngày_âm, Cục)`. Do đó:

> Nếu **Cục** (hoặc **ngày âm lịch**) mà `tuvi.ts` tính khác lasotuvi → Tử Vi lệch cung → **cả 14 chính tinh lệch dây chuyền** → 0/14. Khi hai bên ra cùng Cục và cùng ngày âm → 14/14.

Củng cố thêm: `tuvi.ts` có **6 ghi chú tự nhận "approx / simplified / check logic"** (ví dụ Hỏa–Linh Tinh, Đường Phù, Thai Phụ), tức tác giả biết một số quy tắc chưa chuẩn.

## Kết luận & khuyến nghị (đưa vào quyết định kiến trúc)

1. **Chọn `lasotuvi` (Python) làm nguồn chân lý.** Nó có unit test, đã được cộng đồng dùng lâu; `tuvi.ts` lệch 60% số ca so với nó.
2. **Không dùng `tuvi-exact.ts`** cho tính toán — chỉ là dữ liệu demo.
3. **`tuvi.ts` cần sửa `calculateCuc`/`placeTuVi` (và các sao "approx")** trước khi tin dùng; hoặc bỏ, gọi thẳng service lasotuvi.
4. **Biến harness này thành cổng CI:** mỗi lần đổi engine, chạy `compare.py`; ngưỡng khớp chính tinh phải = 100% mới cho merge. Nhờ nó mà lỗi Cục lộ ra ngay trong vài giây thay vì để người dùng phát hiện lá số sai.

## File

| File | Vai trò |
|---|---|
| `tuvi_engine_ts.ts` | Bản sao `tuvi.ts` (đã gỡ import type để chạy standalone) |
| `run_ts.ts` | Runner xuất `ts_charts.json` cho 5 ca mẫu |
| `compare.py` | So sánh Python ⇄ TS, in báo cáo + ghi `cross_validation_report.json` |
| `cross_validation_report.json` | Kết quả chi tiết từng sao từng ca |

> Engine tham chiếu: `lasotuvi` (MIT). Engine đối chiếu: `tuvi.ts` từ `tuvi-ai` (MIT).
