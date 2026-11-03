# -*- coding: utf-8 -*-
"""
Horoscope Agents — Engine an sao (Chart Agent, tất định / deterministic)
=========================================================================

Bọc engine `lasotuvi` (doanguyen, MIT) thành một hàm sạch, trả về lá số
dưới dạng dict/JSON có cấu trúc để backend tRPC và các AI agent tiêu thụ.

NGUYÊN TẮC: Đây là tầng TẤT ĐỊNH. LLM KHÔNG bao giờ được tự sinh lá số.
LLM chỉ nhận output của module này rồi *diễn giải*.

Cài đặt:
    Engine `lasotuvi` đã được vendor sẵn trong repo tại `vendor/lasotuvi/`
    (không cần pip install, không cần PYTHONPATH).
    Chạy thử: python tuvi_engine.py   # in ra 1 lá số mẫu (JSON)
"""
from __future__ import annotations

import datetime
import json
import os
import sys
from typing import Any, Dict, List

# Bootstrap: thêm vendor/ (chứa package lasotuvi) vào sys.path — đường dẫn
# tương đối theo vị trí file này nên chạy được ở mọi máy, không cần PYTHONPATH.
_VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Code lasotuvi viết cho Python cũ, phát SyntaxWarning vô hại trên 3.8+ — ẩn đi
import warnings
warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"lasotuvi.*")

import threading

import lasotuvi.Sao as _sao_module
from lasotuvi.AmDuong import (diaChi, dichCung, nguHanh, nguHanhNapAm, thienCan,
                              timCuc)
from lasotuvi.App import lapDiaBan
from lasotuvi.DiaBan import diaBan
from lasotuvi.Lich_HND import S2L

# 14 Chính tinh — dùng để kiểm chứng bất biến (mỗi lá số phải đủ, không thiếu)
CHINH_TINH_14 = [
    "Tử vi", "Thiên cơ", "Thái Dương", "Vũ khúc", "Thiên đồng", "Liêm trinh",
    "Thiên phủ", "Thái âm", "Tham lang", "Cự môn", "Thiên tướng", "Thiên lương",
    "Thất sát", "Phá quân",
]


CAN_TEN = [c["tenCan"] for c in thienCan]      # index 1..10
CHI_TEN = [c["tenChi"] for c in diaChi]        # index 1..12

# Mệnh chủ theo địa chi cung Mệnh, Thân chủ theo địa chi năm sinh (index 1..12)
MENH_CHU = [None, "Tham lang", "Cự môn", "Lộc tồn", "Văn khúc", "Liêm trinh", "Vũ khúc",
            "Phá quân", "Vũ khúc", "Liêm trinh", "Văn khúc", "Lộc tồn", "Cự môn"]
THAN_CHU = [None, "Hỏa tinh", "Thiên tướng", "Thiên lương", "Thiên đồng", "Văn xương",
            "Thiên cơ", "Linh tinh", "Thiên tướng", "Thiên lương", "Thiên đồng",
            "Văn xương", "Thiên cơ"]

# lasotuvi giữ các sao là singleton cấp module rồi append thẳng `__dict__` vào cung,
# và anDacTinh() không xoá giá trị cũ ở ô None → dacTinh của lá số TRƯỚC rò sang lá
# số SAU, đồng thời không an toàn đa luồng. Vì "vendor nguyên trạng, không sửa code",
# xử lý tại đây: khoá toàn cục, reset đặc tính, chụp dữ liệu ra bản sao trong khoá.
_ENGINE_LOCK = threading.Lock()
_ALL_SAO = [v for v in vars(_sao_module).values() if isinstance(v, _sao_module.Sao)]

NHUAN_THANG_NAY = "thang_nay"   # tháng nhuận tính như tháng thường cùng số (lasotuvi)
NHUAN_CHIA_DOI = "chia_doi"     # mùng 1–15 tính tháng này, 16 trở đi tính tháng sau


def can_cung(can_nam: int, cung_so: int) -> int:
    """Thiên can của cung (Ngũ Hổ Độn, cùng công thức timCuc của lasotuvi)."""
    can_thang_gieng = (can_nam * 2 + 1) % 10
    return ((cung_so - 3) % 12 + can_thang_gieng - 1) % 10 + 1



def _doi_lich(ngay, thang, nam, duong_lich, time_zone, thang_nhuan, nhuan_policy):
    """Trả (ngày, tháng, năm âm dùng để an sao, thông tin âm lịch gốc)."""
    if duong_lich:
        d, m, y, leap = S2L(ngay, thang, nam, timeZone=time_zone)
    else:
        d, m, y, leap = ngay, thang, nam, 1 if thang_nhuan else 0
    goc = {"ngay": d, "thang": m, "nam": y, "nhuan": bool(leap)}
    if leap and nhuan_policy == NHUAN_CHIA_DOI and d > 15:
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return d, m, y, goc


def lap_la_so(
    ngay: int,
    thang: int,
    nam: int,
    gio_sinh: int,        # 1..12 (1=Tý, 2=Sửu, ... theo lasotuvi)
    gioi_tinh: int,       # 1 = Nam, -1 = Nữ (theo lasotuvi)
    duong_lich: bool = True,
    time_zone: int = 7,
    thang_nhuan: bool = False,          # chỉ dùng khi duong_lich=False
    nhuan_policy: str = NHUAN_THANG_NAY,
) -> Dict[str, Any]:
    """Trả về lá số Tử Vi có cấu trúc.

    Cấu trúc output (ổn định — hợp đồng API cho backend/agents; chỉ THÊM trường):
    {
      "input": {...},
      "menh_index": int, "than_index": int,
      "am_lich": {"ngay","thang","nam","nhuan"},
      "can_chi": {"nam","gio"...}, "cuc": {"so","ten"}, "ban_menh": str,
      "menh_chu": str, "than_chu": str, "am_duong_nam_nu": "Dương Nam"|...,
      "dai_han_thuan": bool,
      "palaces": [
        {
          "branch": "Sửu", "cung": "Mệnh",
          "is_than": bool, "am_duong": 1|-1, "index": 1..12,
          "can": "Kỷ", "hanh": "Thổ", "dai_han": 6, "tieu_han": "Tý",
          "tuan": bool, "triet": bool,
          "stars": [{"name","nguHanh","loai","amDuong","dacTinh","hoa"}...]
        }, ... (12 cung, Tý → Hợi)
      ]
    }
    """
    if duong_lich:
        datetime.date(nam, thang, ngay)   # ValueError nếu ngày không tồn tại
    elif not 1 <= ngay <= 30:
        raise ValueError("Ngày âm lịch phải trong khoảng 1..30")
    if gioi_tinh not in (1, -1):
        raise ValueError("gioi_tinh phải là 1 (Nam) hoặc -1 (Nữ)")
    if not 1 <= gio_sinh <= 12:
        raise ValueError("gio_sinh phải trong khoảng 1..12")
    if nhuan_policy not in (NHUAN_THANG_NAY, NHUAN_CHIA_DOI):
        raise ValueError("nhuan_policy không hợp lệ")

    d, m, y, am_goc = _doi_lich(ngay, thang, nam, duong_lich, time_zone,
                                thang_nhuan, nhuan_policy)
    with _ENGINE_LOCK:
        for sao in _ALL_SAO:
            sao.saoDacTinh = None
        db = lapDiaBan(diaBan, d, m, y, gio_sinh, gioi_tinh, False, time_zone)
        cac_cung = [
            (c, [dict(s) for s in c.cungSao]) for c in db.thapNhiCung[1:]
        ]

    can_nam = (y + 6) % 10 + 1
    chi_nam = (y + 8) % 12 + 1
    hoa_map = {s: k for k, s in zip(("Lộc", "Quyền", "Khoa", "Kỵ"), _bang_tu_hoa(can_nam))}

    palaces: List[Dict[str, Any]] = []
    for cung, sao_list in cac_cung:
        stars = [
            {
                "name": s.get("saoTen"),
                "nguHanh": s.get("saoNguHanh"),
                "loai": s.get("saoLoai"),
                "amDuong": s.get("saoAmDuong"),
                "dacTinh": s.get("saoDacTinh"),
                "hoa": hoa_map.get(s.get("saoTen", "").lower()),
            }
            for s in sao_list
        ]
        palaces.append({
            "branch": cung.cungTen,
            "cung": getattr(cung, "cungChu", None),
            "is_than": bool(cung.cungThan),
            "am_duong": cung.cungAmDuong,
            "index": cung.cungSo,
            "can": CAN_TEN[can_cung(can_nam, cung.cungSo)],
            "hanh": cung.hanhCung,
            "dai_han": cung.cungDaiHan,
            "tieu_han": cung.cungTieuHan,
            "tuan": bool(getattr(cung, "tuanTrung", False)),
            "triet": bool(getattr(cung, "trietLo", False)),
            "stars": stars,
        })

    hanh_cuc = timCuc(db.cungMenh, can_nam)
    cuc = nguHanh(hanh_cuc)
    duong_nam_sinh = thienCan[can_nam]["amDuong"] == 1
    am_duong_nam_nu = ("Dương" if duong_nam_sinh else "Âm") + (" Nam" if gioi_tinh == 1 else " Nữ")

    return {
        "input": {
            "ngay": ngay, "thang": thang, "nam": nam,
            "gio_sinh": gio_sinh, "gioi_tinh": gioi_tinh,
            "duong_lich": duong_lich, "time_zone": time_zone,
        },
        "menh_index": db.cungMenh,
        "than_index": db.cungThan,
        "am_lich": am_goc,
        "can_chi": {
            "nam": CAN_TEN[can_nam] + " " + CHI_TEN[chi_nam],
            "can_nam": can_nam, "chi_nam": chi_nam,
            "gio": CHI_TEN[gio_sinh],
        },
        "cuc": {"so": cuc["cuc"], "ten": cuc["tenCuc"]},
        "ban_menh": nguHanhNapAm(chi_nam, can_nam, True).capitalize(),
        "menh_chu": MENH_CHU[db.cungMenh],
        "than_chu": THAN_CHU[chi_nam],
        "am_duong_nam_nu": am_duong_nam_nu,
        "dai_han_thuan": (gioi_tinh == 1) == (diaChi[chi_nam]["amDuong"] == 1),
        "palaces": palaces,
    }


def _bang_tu_hoa(can_nam: int):
    from tu_hoa import bang_tu_hoa
    return [s.lower() for s in bang_tu_hoa(can_nam)]


def all_star_names(chart: Dict[str, Any]) -> List[str]:
    """Gộp tên tất cả sao trong lá số (dùng cho kiểm chứng)."""
    return [s["name"] for p in chart["palaces"] for s in p["stars"]]


if __name__ == "__main__":
    demo = lap_la_so(15, 8, 1990, gio_sinh=7, gioi_tinh=1)
    print(json.dumps(demo, ensure_ascii=False, indent=2))
