# vendor/ — Thư viện bên thứ ba vendor vào repo

| Thư mục | Nguồn | License | Ghi chú |
|---|---|---|---|
| `lasotuvi/` | https://github.com/doanguyen/lasotuvi | MIT (LICENSE gốc kèm trong thư mục) | Engine an sao Tử Vi — nguồn chân lý của Chart Agent. Vendor nguyên trạng, **không sửa code**. |

Lý do vendor thay vì `pip install` / clone riêng:

- Gói PyPI `lasotuvi` kéo dep cũ (`typed-ast`) build lỗi trên Python 3.10+.
- Không phụ thuộc `PYTHONPATH` với đường dẫn tuyệt đối theo từng máy — repo tự chạy được ngay sau khi clone, kể cả khi deploy.
- `poc_engine/tuvi_engine.py` tự thêm thư mục này vào `sys.path` theo đường dẫn tương đối.

Cập nhật phiên bản: copy đè package `lasotuvi/` từ repo gốc, giữ lại file `LICENSE`, rồi chạy `pytest poc_engine/test_engine.py` để xác nhận không hồi quy.
