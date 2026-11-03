# -*- coding: utf-8 -*-
"""Quy đổi giờ đồng hồ → giờ âm (chi), có Chân Thái Dương Thì và quy tắc Tý muộn.

Port từ ziwei-doushu (lib/ziwei/true-solar-time.ts, MIT): giờ mặt trời thực =
giờ đồng hồ + hiệu chỉnh kinh độ + phương trình thời gian (công thức NOAA).
Mặc định theo Việt Nam: UTC+7, kinh tuyến chuẩn 105°.
"""
from __future__ import annotations

import datetime as dt
import math
from typing import Any, Dict, Optional, Tuple

TY_NGAY_SAU = "ngay_sau"        # 23:00–23:59 tính sang ngày hôm sau
TY_NGAY_HIEN_TAI = "ngay_hien_tai"  # 23:00–23:59 vẫn là ngày hiện tại

CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"]

# Kinh độ gần đúng tại trung tâm 63 tỉnh/thành (đơn vị hành chính trước sáp nhập 2025,
# vì nơi sinh thường ghi theo tên cũ). Sai 0,1° chỉ lệch 24 giây.
KINH_DO_TINH: Dict[str, float] = {
    "An Giang": 105.13, "Bà Rịa - Vũng Tàu": 107.17, "Bắc Giang": 106.20, "Bắc Kạn": 105.83,
    "Bạc Liêu": 105.72, "Bắc Ninh": 106.07, "Bến Tre": 106.38, "Bình Định": 109.00,
    "Bình Dương": 106.65, "Bình Phước": 106.90, "Bình Thuận": 108.10, "Cà Mau": 105.15,
    "Cần Thơ": 105.78, "Cao Bằng": 106.25, "Đà Nẵng": 108.21, "Đắk Lắk": 108.05,
    "Đắk Nông": 107.69, "Điện Biên": 103.02, "Đồng Nai": 106.85, "Đồng Tháp": 105.63,
    "Gia Lai": 108.00, "Hà Giang": 104.98, "Hà Nam": 105.92, "Hà Nội": 105.85,
    "Hà Tĩnh": 105.90, "Hải Dương": 106.33, "Hải Phòng": 106.68, "Hậu Giang": 105.47,
    "Hòa Bình": 105.34, "Hưng Yên": 106.05, "Khánh Hòa": 109.19, "Kiên Giang": 105.08,
    "Kon Tum": 108.00, "Lai Châu": 103.47, "Lâm Đồng": 108.44, "Lạng Sơn": 106.76,
    "Lào Cai": 103.97, "Long An": 106.41, "Nam Định": 106.17, "Nghệ An": 105.68,
    "Ninh Bình": 105.97, "Ninh Thuận": 108.99, "Phú Thọ": 105.40, "Phú Yên": 109.32,
    "Quảng Bình": 106.62, "Quảng Nam": 108.33, "Quảng Ngãi": 108.80, "Quảng Ninh": 107.08,
    "Quảng Trị": 107.09, "Sóc Trăng": 105.97, "Sơn La": 103.91, "Tây Ninh": 106.10,
    "Thái Bình": 106.34, "Thái Nguyên": 105.85, "Thanh Hóa": 105.78, "Thừa Thiên Huế": 107.59,
    "Tiền Giang": 106.36, "TP. Hồ Chí Minh": 106.66, "Trà Vinh": 106.34, "Tuyên Quang": 105.22,
    "Vĩnh Long": 105.97, "Vĩnh Phúc": 105.60, "Yên Bái": 104.87,
}


def phuong_trinh_thoi_gian(nam: int, thang: int, ngay: int) -> float:
    """Phương trình thời gian (phút) theo xấp xỉ NOAA; dương = mặt trời nhanh hơn đồng hồ."""
    so_ngay = 366 if (nam % 4 == 0 and (nam % 100 != 0 or nam % 400 == 0)) else 365
    n = dt.date(nam, thang, ngay).timetuple().tm_yday
    g = 2 * math.pi / so_ngay * (n - 1)
    return 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                     - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))


def chi_cua_gio(gio: int, phut: int = 0) -> int:
    """Giờ:phút → số giờ âm lasotuvi 1..12 (1=Tý 23:00–00:59)."""
    return ((gio * 60 + phut + 60) // 120) % 12 + 1


def quy_doi_gio(
    ngay: int, thang: int, nam: int, gio: int, phut: int = 0,
    kinh_do: Optional[float] = None, utc_offset_phut: int = 420,
    quy_tac_ty: str = TY_NGAY_SAU,
) -> Tuple[Dict[str, int], Dict[str, Any]]:
    """Trả ({ngay, thang, nam, gio_sinh}, thông tin hiệu chỉnh) để đưa vào lap_la_so."""
    if quy_tac_ty not in (TY_NGAY_SAU, TY_NGAY_HIEN_TAI):
        raise ValueError("quy_tac_ty không hợp lệ")
    goc = dt.datetime(nam, thang, ngay, gio, phut)  # ValueError nếu ngày/giờ sai
    hc_kinh_do = hc_pttg = 0.0
    if kinh_do is not None:
        hc_kinh_do = (kinh_do - utc_offset_phut / 4.0) * 4.0
        hc_pttg = phuong_trinh_thoi_gian(nam, thang, ngay)
    mat_troi = goc + dt.timedelta(minutes=hc_kinh_do + hc_pttg)

    ngay_tinh = mat_troi.date()
    ty_muon = mat_troi.hour == 23
    if ty_muon and quy_tac_ty == TY_NGAY_SAU:
        ngay_tinh += dt.timedelta(days=1)
    gio_sinh = chi_cua_gio(mat_troi.hour, mat_troi.minute)
    return (
        {"ngay": ngay_tinh.day, "thang": ngay_tinh.month, "nam": ngay_tinh.year,
         "gio_sinh": gio_sinh},
        {"gio_mat_troi": mat_troi.strftime("%Y-%m-%d %H:%M"),
         "hieu_chinh_phut": round(hc_kinh_do + hc_pttg, 1),
         "chan_thai_duong": kinh_do is not None,
         "gio_chi": CHI[gio_sinh - 1], "ty_muon": ty_muon,
         "doi_ngay": ngay_tinh != goc.date()},
    )
