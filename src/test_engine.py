# -*- coding: utf-8 -*-
"""
Test harness cho Engine an sao — nền tảng độ tin cậy của Horoscope Agents.

Hai lớp kiểm thử:
  A. INVARIANTS (bất biến): đúng với MỌI lá số hợp lệ, không cần engine thứ 2.
     -> phát hiện lỗi an sao ngay từ đầu.
  B. GOLDEN SNAPSHOT (regression): khoá kết quả của các ca mẫu.
     -> phát hiện khi refactor engine làm đổi output ngoài ý muốn.

Chạy:
    pip install pytest lasotuvi
    pytest test_engine.py -v

Mở rộng (Pha 3): thêm lớp C — đối chiếu với engine TS `tuvi-exact.ts`
của repo tuvi-ai để cross-validate hai trường phái cài đặt.
"""
import json
import os

import pytest

from tuvi_engine import lap_la_so, all_star_names, CHINH_TINH_14

# Bộ ca mẫu đa dạng: nam/nữ, các giờ, âm & dương lịch
SAMPLES = [
    dict(ngay=15, thang=8, nam=1990, gio_sinh=7, gioi_tinh=1, duong_lich=True),
    dict(ngay=1,  thang=1, nam=2000, gio_sinh=1, gioi_tinh=-1, duong_lich=True),
    dict(ngay=29, thang=12, nam=1985, gio_sinh=12, gioi_tinh=1, duong_lich=True),
    dict(ngay=10, thang=6, nam=1975, gio_sinh=5, gioi_tinh=-1, duong_lich=True),
    dict(ngay=20, thang=3, nam=2010, gio_sinh=9, gioi_tinh=1, duong_lich=True),
]

BRANCHES_12 = {"Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ",
               "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"}

GOLDEN_PATH = os.path.join(os.path.dirname(__file__), "golden_charts.json")


@pytest.fixture(params=SAMPLES, ids=lambda s: f"{s['ngay']}/{s['thang']}/{s['nam']}")
def chart(request):
    return lap_la_so(**request.param)


# ---------- A. INVARIANTS ----------

def test_co_du_12_cung(chart):
    assert len(chart["palaces"]) == 12


def test_12_dia_chi_khong_trung(chart):
    branches = [p["branch"] for p in chart["palaces"]]
    assert set(branches) == BRANCHES_12
    assert len(branches) == len(set(branches))  # không lặp


def test_du_12_cung_chu(chart):
    """12 cung chức (Mệnh, Phụ mẫu, ... Huynh đệ) phải xuất hiện đúng 1 lần."""
    cung_chu = [p["cung"] for p in chart["palaces"]]
    assert len(set(cung_chu)) == 12, f"Trùng/thiếu cung chủ: {cung_chu}"


def test_du_14_chinh_tinh(chart):
    """14 chính tinh phải có mặt, mỗi sao đúng 1 lần (bất biến cốt lõi)."""
    names = all_star_names(chart)
    for ct in CHINH_TINH_14:
        assert names.count(ct) == 1, f"Chính tinh '{ct}' xuất hiện {names.count(ct)} lần"


def test_co_dung_1_cung_than(chart):
    than = [p for p in chart["palaces"] if p["is_than"]]
    assert len(than) == 1, "Phải có đúng 1 cung an Thân"


def test_menh_than_index_hop_le(chart):
    assert 1 <= chart["menh_index"] <= 12
    assert 1 <= chart["than_index"] <= 12


def test_output_serialize_duoc_json(chart):
    # Hợp đồng API: luôn serialize được để trả qua tRPC
    json.dumps(chart, ensure_ascii=False)


# ---------- B. GOLDEN SNAPSHOT (regression) ----------

def _fingerprint(c):
    """Rút gọn lá số thành dấu vân tay ổn định để so sánh regression."""
    return {
        "menh": c["menh_index"], "than": c["than_index"],
        "palaces": {p["branch"]: sorted(s["name"] for s in p["stars"])
                    for p in c["palaces"]},
    }


def test_golden_snapshot():
    current = {
        f"{s['ngay']}/{s['thang']}/{s['nam']}-g{s['gio_sinh']}": _fingerprint(lap_la_so(**s))
        for s in SAMPLES
    }
    if not os.path.exists(GOLDEN_PATH):
        with open(GOLDEN_PATH, "w", encoding="utf-8") as f:
            json.dump(current, f, ensure_ascii=False, indent=2)
        pytest.skip("Đã tạo golden_charts.json lần đầu — chạy lại để so khớp.")
    with open(GOLDEN_PATH, encoding="utf-8") as f:
        golden = json.load(f)
    assert current == golden, "Output engine đã thay đổi so với golden snapshot!"
