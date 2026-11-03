# PoC — Interpretation Agent + RAG + Guardrail (luận cung Mệnh)

Hiện thực **tầng agent luận giải grounded** trong đề xuất kiến trúc: engine tất định an sao → agent RAG luận giải (LLM chỉ *diễn giải*, không tự sinh lá số) → **Guardrail/QA agent** kiểm chất lượng trước khi hiển thị. Chống bịa (hallucination), bắt buộc trích dẫn thư tịch.

## Luồng xử lý

```
sample_chart.json (engine lasotuvi, tất định)
        │  tìm cung Mệnh + chính tinh toạ Mệnh
        ▼
   RETRIEVE ──► lọc trong kb.json:
        │        • vai trò cung Mệnh
        │        • mỗi chính tinh: tổng quan, ưu/nhược, sự nghiệp,
        │          tình cảm, sức khoẻ, cách cục
        │        • PHÁT HIỆN Miếu/Vượng/Hãm tại địa chi toạ Mệnh
        │        • NGỮ CẢNH: Tam Hợp (Tài Bạch + Quan Lộc) + đối cung Thiên Di
        ▼
   BUILD PROMPT ──► persona "Quốc Sư" + context đánh số [S1..Sn]
        │            + ràng buộc "chỉ dùng context, phải trích [Sx]"
        ▼
   GENERATE ──► OpenAI nếu có OPENAI_API_KEY, ngược lại OFFLINE COMPOSE
        ▼
   GUARDRAIL / QA ──► 6 kiểm tra tất định → ĐẠT (hiển thị) hoặc CHẶN (sửa)
```

## File

| File | Vai trò |
|---|---|
| `kb.json` | Kho luận giải 12 cung + 14 chính tinh — **nội dung tự biên của dự án** |
| `kb.json` | Kho tri thức: 12 cung + 14 chính tinh (~106KB) |
| `interpretation_agent.py` | Agent: retrieve (mở rộng Tam Hợp/đối cung) → prompt → generate |
| `guardrail_agent.py` | QA agent: 5 kiểm tra chặn đầu ra kém chất lượng |
| `sample_interpretation.md` | **Đầu ra mẫu** văn phong Quốc Sư, grounded, 20 trích dẫn [Sx] |
| `retrieval_debug.json` | 20 chunk đã truy xuất + prompt gửi LLM (minh bạch) |
| `qa_report.json` | Kết quả Guardrail trên bản mẫu (5/5 đạt) |
| `orchestrator.py` | **Report Composer**: điều phối luận 12 cung + Guardrail từng cung |
| `full_report.md` | Báo cáo tổng hợp 12 cung (đầu ra Orchestrator) |
| `report_qa.json` | Guardrail toàn báo cáo (48/48 đạt) |

## Chạy

```bash
# kb.json đã kèm sẵn (tự biên) — không cần bước tạo
python interpretation_agent.py          # offline nếu chưa có key
# Bật LLM viết văn: điền OPENAI_API_KEY vào file .env ở gốc repo (tự nạp khi chạy)
python guardrail_agent.py               # kiểm bản mẫu → exit 0 nếu ĐẠT
```

## Kết quả PoC (lá số mẫu: Tử Vi · Phá Quân toạ Sửu)

**Retrieval:** truy xuất **20 mẩu tri thức** (17 về Mệnh + chính tinh, cộng 3 cung ngữ cảnh Tam Hợp Tài–Quan & đối cung Thiên Di).

- **Tự phát hiện Miếu/Hãm từ thư tịch:** Tử Vi tại Sửu = **Hãm địa**; Phá Quân tại Sửu = thư tịch chưa bàn → agent nói thẳng thay vì bịa.
- **Bắt đúng cách "Tử Phá" hai chiều:** Tử Vi coi Phá Quân là *khó cách* (đế tinh gặp hung tinh) [S9] nhưng Phá Quân được Tử Vi là *hợp cách* (đế tinh kiểm soát phá hoại) [S17].
- **Ngữ cảnh Tam Hợp/đối cung:** Tài Bạch (Dậu: Vũ Khúc, Thất Sát), Quan Lộc (Tỵ: Liêm Trinh, Tham Lang), Thiên Di (Mùi: Thiên Tướng) — đúng cổ pháp "Mệnh không luận đơn độc".

**Guardrail (6 kiểm tra tất định):**

| Kiểm tra | Ý nghĩa |
|---|---|
| C1 trích dẫn hợp lệ | mọi [Sx] phải tồn tại trong nguồn |
| C2 độ phủ trích dẫn | mỗi mục luận điểm có ≥1 trích dẫn |
| C3 không mâu thuẫn miếu/hãm | không khẳng định "miếu" cho sao mà thư tịch ghi "hãm" |
| C4 không bịa sao ngoài nguồn | mọi chính tinh nêu ra đều có trong nguồn |
| C5 có disclaimer | nhắc tính tham khảo |

- Bản mẫu: **ĐẠT 5/5** → cho phép hiển thị.
- Test âm tính (đầu ra cố tình tệ: trích dẫn giả [S99], nói Tử Vi Sửu là "miếu vượng", thiếu disclaimer): **CHẶN 2/5** — chứng minh Guardrail không đóng dấu vô điều kiện.

## Orchestrator / Report Composer (12 cung)

`orchestrator.py` tổng quát hoá agent luận giải từ **một cung Mệnh** ra **cả 12 cung**, ghép thành báo cáo hoàn chỉnh và chạy **Guardrail cho từng cung**. Đây là tầng "Orchestrator + Report Composer" trong sơ đồ kiến trúc.

```bash
python orchestrator.py      # -> full_report.md + report_qa.json
```

Kết quả trên lá số mẫu: **12/12 cung đạt Guardrail (48/48 kiểm tra), verdict ĐẠT**. Xử lý đúng cung **vô chính diệu** (Phụ Mẫu, Phu Thê) và alias tên cung (`Tử tức`↔`Tử Nữ`). Một lỗi thú vị đã bắt được khi phát triển: văn bản KB có sẵn các tiêu đề đánh số kiểu `**1. …**` khiến bộ tách đoạn của Guardrail hiểu nhầm là mục thiếu trích dẫn → đã sửa ở khâu Composer (gộp mỗi chunk về một dòng). Đây chính là giá trị của việc có tầng QA tự động.

## Vì sao đây là "Agent" đúng nghĩa (khác 3 repo gốc)

- 3 repo gốc gọi LLM **một lần, tự do** → dễ bịa, không trích nguồn, không kiểm hậu kỳ.
- Ở đây: **tách tính/luận**, **RAG bắt buộc + ngữ cảnh Tam Hợp/đối cung**, **ràng buộc trích dẫn**, **nói rõ khi thư tịch thiếu**, và **Guardrail chặn** đầu ra sai. Đây là khung để lắp tiếp **Report Composer** (ghép 12 cung) như sơ đồ kiến trúc.

## Bước tiếp theo

1. Mở retrieve sang **phụ tinh** và **tứ hoá** (đã có cấu trúc trong KB).
2. Thêm bước **Guardrail dùng LLM** (kiểm mâu thuẫn ngữ nghĩa sâu hơn 5 luật tất định).
3. Nhúng vào backend tRPC (`tuvi.analyzePalace`) + cache theo (lá số, cung); chạy Guardrail như middleware trước khi trả response.

> KB nguồn: `co-hoc-tinh-hoa/src/data/tuViMeanings` (repo chưa có license → cần xin phép tác giả trước khi dùng chính thức; ở PoC chỉ dùng minh hoạ).
