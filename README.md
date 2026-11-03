# tu-vi-be — Backend Tử Vi

Phần tử vi (Tử Vi Đẩu Số) tách từ dự án Horoscope Agents.

> **Server chính là bản Node.js/TypeScript trong [`server/`](server/README.md).** Bản Python
> bên dưới (`src/`, `agents/`) giữ lại làm engine đối chiếu (`npm run crossval`) trong giai
> đoạn chuyển đổi; khi đã chốt bản Node thì có thể xoá.

## Thành phần

Backend gồm engine an sao `lasotuvi` (nguồn chân lý) cộng các phần lấy từ
[ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu):

| File | Chức năng |
|---|---|
| `src/tuvi_engine.py` | An sao. Thêm: can cung, miếu/hãm, Tứ Hóa, Tuần/Triệt, Cục, Bản mệnh, Mệnh/Thân chủ, tháng nhuận. Output cũ giữ nguyên, chỉ thêm trường |
| `src/tu_hoa.py` | Bảng Tứ Hóa theo can (trường phái Việt) |
| `src/van_han.py` | Đại hạn, Tiểu hạn, Lưu niên, Lưu nguyệt, sao lưu |
| `src/cach_cuc.py` | 41 quy tắc cách cục: điều kiện / điểm cộng / phá cách, có thư tịch |
| `src/thoi_gian.py` | Giờ đồng hồ → giờ âm, Chân Thái Dương, Tý muộn, kinh độ 63 tỉnh |
| `src/service/api.py` | FastAPI |
| `agents/` | RAG + LLM + Guardrail 6 kiểm tra; LLM trượt Guardrail thì tự về bản offline |
| `src/crossval/compare_iztro.py` | Đối chiếu ngẫu nhiên với iztro |

## Chạy

```bash
pip install -r requirements-dev.txt
python src/service/api.py        # http://127.0.0.1:8973/docs , giao diện thử: /viewer
pytest src --ignore=src/crossval --ignore=src/vendor
```

Cấu hình trong `.env` (xem `.env.example`). Không có key LLM thì luận giải chạy offline.

## API

| Endpoint | Nội dung |
|---|---|
| `POST /v1/la-so` | Lá số + đại hạn + cách cục |
| `POST /v1/luu-nien` | Thêm `nam_xem`: vận năm + 12 tháng |
| `POST /v1/luan-giai` | Báo cáo 12 cung; `use_llm: true` cần header `X-API-Key` nếu đặt `API_KEY` |
| `GET /v1/meta` | Danh sách giờ, tỉnh |

```json
{"ngay":15,"thang":8,"nam":1990,"gio":12,"phut":30,"tinh":"Hà Nội","gioi_tinh":1}
```

Giờ sinh gửi `gio_sinh` (1=Tý..12=Hợi) hoặc `gio`+`phut`. Có `tinh`/`kinh_do` thì tính Chân
Thái Dương. Tuỳ chọn: `quy_tac_ty` (`ngay_sau`|`ngay_hien_tai`), `nhuan_policy`
(`thang_nay`|`chia_doi`). Lỗi nhập liệu trả 400/422.

## Trường phái

Vị trí sao, bảng Tứ Hóa theo `lasotuvi` (Việt). Đối chiếu 2.000 ca với iztro cùng lịch UTC+8:
Mệnh, Thân, Cục, can cung, đại hạn, 14 chính tinh khớp 100%. Khác biệt có chủ đích hoặc chờ chốt:

- Tứ Hóa: Canh (Khoa Đồng, Kỵ Âm), Nhâm (Khoa Phủ) khác bảng Trung Châu.
- Hỏa Tinh, Linh Tinh: công thức an khác nhau.
- Khôi, Việt: năm Đinh, Mậu, Canh, Nhâm hai sao đổi chỗ cho nhau so với iztro.
- Lịch: dùng UTC+7. Lịch VN và TQ lệch nhau ở một số ngày, nên không dùng lịch TQ.

## Giới hạn

- Chưa port: hợp lá số, cổ thư, kho 518.400 mẫu luận giải.
- `kb.json` chỉ có 12 cung và 14 chính tinh; phụ tinh chưa có luận giải riêng.
- Cache nằm trong tiến trình, chưa có rate limit: cần thêm trước khi mở LLM ra public.
- Nếu dùng bộ mẫu 518.400 của ziwei-doushu, phải ghi nguồn theo yêu cầu của tác giả.
