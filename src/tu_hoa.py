# -*- coding: utf-8 -*-
"""Bảng Tứ Hóa theo Thiên can — dùng chung cho Bản mệnh, Đại hạn, Lưu niên, Lưu nguyệt.

Khung tính "tứ hóa theo can của từng tầng vận" học từ ziwei-doushu (lib/ziwei/sihua.ts,
MIT). BẢNG can → sao giữ theo trường phái Việt của lasotuvi (cụ Thiên Lương) để cả lá
số nhất quán. Khác biệt so với bảng Trung Châu trong ziwei-doushu:
  Canh: Khoa Thiên đồng, Kỵ Thái âm   (ziwei: Khoa Thái âm, Kỵ Thiên đồng)
  Nhâm: Khoa Thiên phủ                (ziwei: Khoa Tả phù)
"""
from __future__ import annotations

from typing import Dict, List

LOAI_HOA = ("Lộc", "Quyền", "Khoa", "Kỵ")

# index 1..10 = Giáp..Quý → [Lộc, Quyền, Khoa, Kỵ]
_BANG = [
    None,
    ["Liêm trinh", "Phá quân", "Vũ khúc", "Thái Dương"],
    ["Thiên cơ", "Thiên lương", "Tử vi", "Thái âm"],
    ["Thiên đồng", "Thiên cơ", "Văn xương", "Liêm trinh"],
    ["Thái âm", "Thiên đồng", "Thiên cơ", "Cự môn"],
    ["Tham lang", "Thái âm", "Hữu bật", "Thiên cơ"],
    ["Vũ khúc", "Tham lang", "Thiên lương", "Văn Khúc"],
    ["Thái Dương", "Vũ khúc", "Thiên đồng", "Thái âm"],
    ["Cự môn", "Thái Dương", "Văn Khúc", "Văn xương"],
    ["Thiên lương", "Tử vi", "Thiên phủ", "Vũ khúc"],
    ["Phá quân", "Cự môn", "Thái âm", "Tham lang"],
]


def bang_tu_hoa(can: int) -> List[str]:
    return list(_BANG[can])


def tu_hoa_theo_can(can: int) -> Dict[str, str]:
    return dict(zip(LOAI_HOA, _BANG[can]))
