# -*- coding: utf-8 -*-
"""Vận hạn tất định: Đại hạn, Tiểu hạn, Lưu niên, Lưu nguyệt.

Khung phân tầng (bản mệnh → đại hạn → lưu niên → lưu nguyệt, mỗi tầng có Tứ Hóa theo
can của tầng đó; tuổi tính theo tuổi mụ âm lịch) học từ ziwei-doushu
(lib/ziwei/sihua.ts, yunxian-context.ts, MIT). Vị trí Đại hạn, Tiểu hạn và cách an
Đẩu quân lấy từ lasotuvi để nhất quán với lá số.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from tu_hoa import tu_hoa_theo_can
from tuvi_engine import CAN_TEN, CHI_TEN, can_cung

# Can → cung Lộc tồn (index địa bàn 1..12), theo vitriDiaBan của lasotuvi
_LOC_TON = [None, 3, 4, 6, 7, 6, 7, 9, 10, 12, 1]


def can_nam(nam: int) -> int:
    return (nam + 6) % 10 + 1


def chi_nam(nam: int) -> int:
    return (nam + 8) % 12 + 1


def _pal_by_index(chart: Dict[str, Any], idx: int) -> Dict[str, Any]:
    return next(p for p in chart["palaces"] if p["index"] == (idx - 1) % 12 + 1)


def _vi_tri_sao(chart: Dict[str, Any], ten: str) -> Optional[Dict[str, Any]]:
    k = ten.lower()
    return next((p for p in chart["palaces"]
                 if any((s["name"] or "").lower() == k for s in p["stars"])), None)


def _tu_hoa_dinh_vi(chart: Dict[str, Any], can: int) -> List[Dict[str, str]]:
    """Tứ Hóa của can + cung mà mỗi sao hóa đang đóng trên lá số."""
    out = []
    for loai, sao in tu_hoa_theo_can(can).items():
        p = _vi_tri_sao(chart, sao)
        out.append({"hoa": loai, "sao": sao,
                    "branch": p["branch"] if p else None,
                    "cung": p["cung"] if p else None})
    return out


def _sao_loc(chart: Dict[str, Any], can: int) -> List[Dict[str, str]]:
    loc = _LOC_TON[can]
    rows = []
    for ten, idx in (("Lưu Lộc tồn", loc), ("Lưu Kình dương", loc + 1), ("Lưu Đà la", loc - 1)):
        p = _pal_by_index(chart, idx)
        rows.append({"sao": ten, "branch": p["branch"], "cung": p["cung"]})
    return rows


def danh_sach_dai_han(chart: Dict[str, Any]) -> List[Dict[str, Any]]:
    can_sinh = chart["can_chi"]["can_nam"]
    rows = []
    for p in sorted(chart["palaces"], key=lambda x: x["dai_han"]):
        can = can_cung(can_sinh, p["index"])
        rows.append({
            "tuoi_tu": p["dai_han"], "tuoi_den": p["dai_han"] + 9,
            "branch": p["branch"], "cung": p["cung"], "can": CAN_TEN[can],
            "nam_tu": chart["am_lich"]["nam"] + p["dai_han"] - 1,
            "tu_hoa": _tu_hoa_dinh_vi(chart, can),
        })
    return rows


def dai_han_tai_tuoi(chart: Dict[str, Any], tuoi: int) -> Optional[Dict[str, Any]]:
    return next((d for d in danh_sach_dai_han(chart)
                 if d["tuoi_tu"] <= tuoi <= d["tuoi_den"]), None)


def luu_nien(chart: Dict[str, Any], nam: int) -> Dict[str, Any]:
    """Tổng hợp vận năm âm lịch `nam`."""
    can, chi = can_nam(nam), chi_nam(nam)
    tuoi = nam - chart["am_lich"]["nam"] + 1
    if tuoi < 1:
        raise ValueError("Năm xem phải từ năm sinh trở đi")
    ten_chi = CHI_TEN[chi]
    tieu_han = next(p for p in chart["palaces"] if p["tieu_han"] == ten_chi)
    thai_tue = _pal_by_index(chart, chi)
    return {
        "nam": nam, "can_chi": CAN_TEN[can] + " " + ten_chi, "tuoi_am": tuoi,
        "dai_han": dai_han_tai_tuoi(chart, tuoi),
        "tieu_han": {"branch": tieu_han["branch"], "cung": tieu_han["cung"]},
        "luu_thai_tue": {"branch": thai_tue["branch"], "cung": thai_tue["cung"]},
        "tu_hoa": _tu_hoa_dinh_vi(chart, can),
        "sao_luu": _sao_loc(chart, can),
    }


def luu_nguyet(chart: Dict[str, Any], nam: int) -> List[Dict[str, Any]]:
    """12 tháng âm của năm `nam`: tháng Giêng khởi tại cung Lưu Đẩu quân, đi thuận."""
    can_n, chi = can_nam(nam), chi_nam(nam)
    khoi = chi - chart["am_lich"]["thang"] + chart["input"]["gio_sinh"]
    rows = []
    for thang in range(1, 13):
        p = _pal_by_index(chart, khoi + thang - 1)
        # Can tháng: Ngũ Hổ Độn, tháng Giêng là tháng Dần (index 3)
        can = can_cung(can_n, thang + 2)
        rows.append({"thang": thang, "can_chi": CAN_TEN[can] + " " + CHI_TEN[(thang + 1) % 12 + 1],
                     "branch": p["branch"], "cung": p["cung"],
                     "tu_hoa": _tu_hoa_dinh_vi(chart, can)})
    return rows
