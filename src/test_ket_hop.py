# -*- coding: utf-8 -*-
"""Test các phần thêm khi kết hợp ziwei-doushu vào engine lasotuvi."""
import os
import random
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agents"))

import guardrail_agent as ga  # noqa: E402
import orchestrator as orch  # noqa: E402
import van_han  # noqa: E402
from cach_cuc import nhan_dien_cach_cuc  # noqa: E402
from thoi_gian import chi_cua_gio, quy_doi_gio  # noqa: E402
from tu_hoa import tu_hoa_theo_can  # noqa: E402
from tuvi_engine import lap_la_so  # noqa: E402

CHART = dict(ngay=15, thang=8, nam=1990, gio_sinh=7, gioi_tinh=1)


def test_dac_tinh_khong_ro_ri_giua_cac_la_so():
    """lasotuvi dùng sao singleton: lá số xen giữa không được làm đổi kết quả."""
    goc = lap_la_so(**CHART)
    for i in range(30):
        lap_la_so(1 + i % 28, 1 + i % 12, 1950 + i, 1 + i % 12, 1 if i % 2 else -1)
    assert lap_la_so(**CHART) == goc


def test_moi_nam_du_tu_hoa_gan_dung_sao():
    for y in range(1984, 1994):
        c = lap_la_so(15, 8, y, 3, 1)
        hoa = {s["name"]: s["hoa"] for p in c["palaces"] for s in p["stars"] if s["hoa"]}
        assert sorted(hoa.values()) == sorted(["Lộc", "Quyền", "Khoa", "Kỵ"])
        for loai, sao in tu_hoa_theo_can(c["can_chi"]["can_nam"]).items():
            assert hoa[sao] == loai
            # sao gốc và sao "Hóa x" của lasotuvi phải cùng cung
            pal = next(p for p in c["palaces"] if any(s["name"] == sao for s in p["stars"]))
            assert any(s["name"].lower() == "hóa " + loai.lower() for s in pal["stars"])


def test_thang_nhuan_chia_doi():
    # 2023 có tháng 2 nhuận; 2023-04-10 dương = 20/2 nhuận âm
    a = lap_la_so(10, 4, 2023, 1, 1)
    b = lap_la_so(10, 4, 2023, 1, 1, nhuan_policy="chia_doi")
    assert a["am_lich"] == {"ngay": 20, "thang": 2, "nam": 2023, "nhuan": True}
    assert a["menh_index"] != b["menh_index"]


@pytest.mark.parametrize("h,m,chi", [(23, 0, 1), (0, 59, 1), (1, 0, 2), (12, 30, 7), (22, 59, 12)])
def test_chi_cua_gio(h, m, chi):
    assert chi_cua_gio(h, m) == chi


def test_ty_muon_doi_ngay():
    q, tt = quy_doi_gio(31, 12, 1999, 23, 30)
    assert (q["ngay"], q["thang"], q["nam"], q["gio_sinh"]) == (1, 1, 2000, 1) and tt["doi_ngay"]
    q, _ = quy_doi_gio(31, 12, 1999, 23, 30, quy_tac_ty="ngay_hien_tai")
    assert (q["ngay"], q["gio_sinh"]) == (31, 1)


def test_chan_thai_duong_doi_chi():
    # Điện Biên 103.02°: chậm ~8 phút so với kinh tuyến 105°, 01:05 lùi về giờ Tý
    q, tt = quy_doi_gio(15, 6, 1990, 1, 5, kinh_do=103.02)
    assert q["gio_sinh"] == 1 and tt["hieu_chinh_phut"] < -7


def test_dai_han_10_nam_lien_tuc():
    d = van_han.danh_sach_dai_han(lap_la_so(**CHART))
    assert len(d) == 12 and {x["cung"] for x in d} == {p["cung"] for p in lap_la_so(**CHART)["palaces"]}
    assert all(b["tuoi_tu"] == a["tuoi_den"] + 1 for a, b in zip(d, d[1:]))


def test_luu_nien_tu_hoa_va_tieu_han():
    r = van_han.luu_nien(lap_la_so(**CHART), 2026)
    assert r["can_chi"] == "Bính Ngọ" and r["tuoi_am"] == 37
    assert r["tieu_han"]["branch"] == "Thìn"        # tuổi Ngọ khởi Thìn, nam đi thuận
    assert r["dai_han"]["tuoi_tu"] == 36
    assert {x["sao"] for x in r["tu_hoa"]} == {"Thiên đồng", "Thiên cơ", "Văn xương", "Liêm trinh"}
    assert all(x["branch"] for x in r["tu_hoa"])


def test_luu_nien_truoc_nam_sinh_bi_tu_choi():
    with pytest.raises(ValueError):
        van_han.luu_nien(lap_la_so(**CHART), 1980)


def test_luu_nguyet_du_12_cung_thuan():
    r = van_han.luu_nguyet(lap_la_so(**CHART), 2026)
    assert [x["thang"] for x in r] == list(range(1, 13))
    assert len({x["branch"] for x in r}) == 12
    assert r[0]["can_chi"] == "Canh Dần"     # Bính niên khởi Canh Dần


def test_cach_cuc_co_cau_truc_va_khong_dinh_menh():
    random.seed(7)
    for _ in range(600):
        c = lap_la_so(random.randint(1, 28), random.randint(1, 12), random.randint(1930, 2025),
                      random.randint(1, 12), random.choice((1, -1)))
        for x in nhan_dien_cach_cuc(c):
            assert x["muc"] in ("dai_cat", "cat", "trung_binh", "can_luu_y")
            assert x["dieu_kien"]["bat_buoc"] and x["nguon"]
            assert ga.c6_no_fatalism(x["mo_ta"], [])["pass"]


def test_sat_pha_tham_dung_tam_hop():
    # Lá số mẫu: Mệnh có Phá quân → Sát Phá Tham phải hội
    assert "Sát Phá Tham" in [x["ten"] for x in nhan_dien_cach_cuc(lap_la_so(**CHART))]


def test_bao_cao_offline_qua_guardrail():
    r = orch.build_report(lap_la_so(**CHART))
    assert r["verdict"] == "ĐẠT", r["per_cung"]
    assert "Cách cục nổi bật" in r["markdown"]
    assert all(q["mode"] == "offline" for q in r["per_cung"])


def test_llm_truot_guardrail_thi_ve_offline(monkeypatch):
    import interpretation_agent as ia
    monkeypatch.setattr(ia, "generate_llm", lambda p: "## Cung X\nBạn chắc chắn sẽ gặp hoạ [S99]")
    c = lap_la_so(**CHART)
    k = orch.luan_cung(c["palaces"][1], ia.load_kb(), [], use_llm=True)
    assert k["mode"] == "offline_sau_khi_llm_truot_guardrail" and "[S99]" not in k["text"]


def test_c6_bat_cau_phan_sinh_tu():
    assert not ga.c6_no_fatalism("Năm này đương số sẽ qua đời", [])["pass"]
    assert ga.c6_no_fatalism("Năm nay nên giữ sức khoẻ, tham khảo thêm.", [])["pass"]
