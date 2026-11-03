# -*- coding: utf-8 -*-
"""Oracle Python cho scripts/crossval.ts: đọc mảng ca từ stdin, in kết quả engine Python.

Chỉ dùng trong giai đoạn chuyển đổi — khi bản Node đã thay hẳn, xoá cùng src/ Python.
"""
import json, os, sys, warnings

warnings.filterwarnings("ignore")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "src"))
sys.path.insert(0, os.path.join(ROOT, "agents"))

import cach_cuc, thoi_gian, van_han  # noqa: E402
from tuvi_engine import lap_la_so  # noqa: E402

KB = None


def run(case):
    global KB
    out = {}
    try:
        if "gio" in case:
            q, hc = thoi_gian.quy_doi_gio(case["ngay"], case["thang"], case["nam"], case["gio"], case["phut"],
                                          case.get("kinh_do"), case.get("utc_offset_phut", 420),
                                          case.get("quy_tac_ty", "ngay_sau"))
            out["quy_doi"] = [q, hc]
            return out
        c = lap_la_so(case["ngay"], case["thang"], case["nam"], case["gio_sinh"], case["gioi_tinh"],
                      case["duong_lich"], thang_nhuan=case["thang_nhuan"], nhuan_policy=case["nhuan_policy"])
        out["chart"] = c
        out["dai_han"] = van_han.danh_sach_dai_han(c)
        out["cach_cuc"] = cach_cuc.nhan_dien_cach_cuc(c)
        try:
            out["luu_nien"] = van_han.luu_nien(c, case["nam_xem"])
            out["luu_nguyet"] = van_han.luu_nguyet(c, case["nam_xem"])
        except ValueError as e:
            out["luu_nien_error"] = True
        if case.get("report"):
            import orchestrator as orch
            import interpretation_agent as ia
            KB = KB or ia.load_kb()
            out["report"] = orch.build_report(c, KB, False)
    except ValueError as e:
        out["error"] = True
    return out


cases = json.load(sys.stdin)
json.dump([run(c) for c in cases], sys.stdout, ensure_ascii=False)
