# -*- coding: utf-8 -*-
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "service"))
import api as svc  # noqa: E402

client = TestClient(svc.app)
BASE = dict(ngay=15, thang=8, nam=1990, gio_sinh=7, gioi_tinh=1)


def test_health_meta():
    assert client.get("/health").json() == {"status": "ok"}
    assert len(client.get("/v1/meta").json()["tinh"]) == 63


def test_la_so():
    d = client.post("/v1/la-so", json=BASE).json()
    assert len(d["chart"]["palaces"]) == 12 and len(d["dai_han"]) == 12 and d["cach_cuc"]


def test_gio_dong_ho_va_noi_sinh():
    b = {k: v for k, v in BASE.items() if k != "gio_sinh"}
    d = client.post("/v1/la-so", json={**b, "gio": 12, "phut": 0, "tinh": "Hà Nội"}).json()
    assert d["chart"]["hieu_chinh_gio"]["chan_thai_duong"] and d["chart"]["input"]["gio_sinh"] == 7


@pytest.mark.parametrize("body", [
    {**BASE, "gio": 12},                                    # vừa gio_sinh vừa gio
    {k: v for k, v in BASE.items() if k != "gio_sinh"},     # thiếu giờ
    {**BASE, "tinh": "Atlantis"},
    {**BASE, "gioi_tinh": 0},
    {**BASE, "gio_sinh": 13},
])
def test_input_sai_bi_chan(body):
    assert client.post("/v1/la-so", json=body).status_code == 422


def test_ngay_khong_ton_tai():
    r = client.post("/v1/la-so", json={**BASE, "ngay": 31, "thang": 2})
    assert r.status_code == 400 and "error" in r.json()


def test_luu_nien():
    d = client.post("/v1/luu-nien", json={**BASE, "nam_xem": 2026}).json()
    assert d["luu_nien"]["can_chi"] == "Bính Ngọ" and len(d["luu_nguyet"]) == 12


def test_luan_giai_offline():
    d = client.post("/v1/luan-giai", json=BASE).json()
    assert d["verdict"] == "ĐẠT" and "BÁO CÁO" in d["markdown"]


def test_llm_can_api_key(monkeypatch):
    monkeypatch.setenv("API_KEY", "k")
    assert client.post("/v1/luan-giai", json={**BASE, "use_llm": True}).status_code == 401


def test_viewer_compat():
    c = client.post("/chart", json=BASE).json()
    d = client.post("/interpret", json={**BASE, "cung": c["palaces"][1]["cung"]}).json()
    assert d["guardrail"]["verdict"] == "ĐẠT" and d["sources"]
