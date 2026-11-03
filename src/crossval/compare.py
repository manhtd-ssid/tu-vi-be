# -*- coding: utf-8 -*-
"""
Cross-validation: Engine Python (lasotuvi) vs Engine TS (tuvi.ts của tuvi-ai).

Ý tưởng: hai engine có cách đánh số cung/hướng khác nhau, nhưng ĐỊA CHI
(Tý..Hợi) mà mỗi CHÍNH TINH rơi vào là bất biến chuẩn hoá được.
-> So sánh vị trí (theo tên địa chi) của 14 chính tinh giữa 2 engine.

Chạy:
    node_modules/.bin/tsx run_ts.ts > ts_charts.json
    python compare.py
(engine lasotuvi đã vendor trong ../../vendor/ — tuvi_engine.py tự nạp, không cần PYTHONPATH)
"""
import json
import os
import sys
import unicodedata

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tuvi_engine import lap_la_so  # noqa: E402

BRANCH = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ",
          "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"]

# 14 chính tinh — dạng chuẩn hoá (không dấu, thường) để so khớp 2 engine
CHINH_TINH = ["Tử vi", "Thiên cơ", "Thái dương", "Vũ khúc", "Thiên đồng",
              "Liêm trinh", "Thiên phủ", "Thái âm", "Tham lang", "Cự môn",
              "Thiên tướng", "Thiên lương", "Thất sát", "Phá quân"]

SAMPLES = [
    dict(ngay=15, thang=8,  nam=1990, gio_sinh=7,  gioi_tinh=1,  duong_lich=True),
    dict(ngay=1,  thang=1,  nam=2000, gio_sinh=1,  gioi_tinh=-1, duong_lich=True),
    dict(ngay=29, thang=12, nam=1985, gio_sinh=12, gioi_tinh=1,  duong_lich=True),
    dict(ngay=10, thang=6,  nam=1975, gio_sinh=5,  gioi_tinh=-1, duong_lich=True),
    dict(ngay=20, thang=3,  nam=2010, gio_sinh=9,  gioi_tinh=1,  duong_lich=True),
]


def norm(s: str) -> str:
    """Bỏ dấu + lowercase để so khớp tên sao giữa 2 engine."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().replace("đ", "d").strip()


NORM_CT = {norm(c) for c in CHINH_TINH}


def python_placement(sample):
    """{chính_tinh_chuẩn: tên_địa_chi} từ engine Python."""
    chart = lap_la_so(**sample)
    out = {}
    for p in chart["palaces"]:
        for s in p["stars"]:
            n = norm(s["name"])
            if n in NORM_CT:
                out[n] = p["branch"]
    return out, chart["menh_index"], chart["palaces"]


def ts_placement(ts_chart):
    """{chính_tinh_chuẩn: tên_địa_chi} từ engine TS (position 0=Tý)."""
    out = {}
    menh_branch = None
    for p in ts_chart["palaces"]:
        branch = BRANCH[p["position"] % 12]
        if norm(p["name"]) == norm("Mệnh"):
            menh_branch = branch
        for name in p["main"]:
            n = norm(name)
            if n in NORM_CT:
                out[n] = branch
    return out, menh_branch


def main():
    here = os.path.dirname(__file__)
    with open(os.path.join(here, "ts_charts.json"), encoding="utf-8") as f:
        ts_charts = {c["key"]: c for c in json.load(f)}

    report = []
    total_stars = total_match = 0
    menh_match = 0

    for s in SAMPLES:
        key = f"{s['ngay']}/{s['thang']}/{s['nam']}-g{s['gio_sinh']}"
        py, py_menh_idx, py_pal = python_placement(s)
        ts, ts_menh_branch = ts_placement(ts_charts[key])

        # địa chi cung Mệnh theo Python
        py_menh_branch = next(
            (p["branch"] for p in py_pal if norm(str(p["cung"])) == norm("Mệnh")), None)

        star_rows = []
        matched = 0
        for ct in CHINH_TINH:
            n = norm(ct)
            pb, tb = py.get(n), ts.get(n)
            ok = pb is not None and pb == tb
            matched += ok
            star_rows.append({"sao": ct, "python": pb, "ts": tb, "khớp": ok})

        mm = py_menh_branch == ts_menh_branch
        menh_match += mm
        total_stars += len(CHINH_TINH)
        total_match += matched

        report.append({
            "sample": key,
            "menh_python": py_menh_branch, "menh_ts": ts_menh_branch, "menh_khớp": mm,
            "chinh_tinh_khớp": f"{matched}/{len(CHINH_TINH)}",
            "chi_tiet": star_rows,
        })

    summary = {
        "so_ca": len(SAMPLES),
        "menh_khớp": f"{menh_match}/{len(SAMPLES)}",
        "chinh_tinh_khớp_tổng": f"{total_match}/{total_stars}",
        "tỉ_lệ_khớp_chinh_tinh": round(100 * total_match / total_stars, 1),
    }

    # in báo cáo gọn
    print("=" * 64)
    print("CROSS-VALIDATION: lasotuvi (Python)  vs  tuvi.ts (TS)")
    print("=" * 64)
    for r in report:
        print(f"\n▶ {r['sample']}  | Mệnh: PY={r['menh_python']} TS={r['menh_ts']} "
              f"{'✓' if r['menh_khớp'] else '✗ LỆCH'}  | Chính tinh khớp: {r['chinh_tinh_khớp']}")
        for row in r["chi_tiet"]:
            if not row["khớp"]:
                print(f"    ✗ {row['sao']:12} PY={str(row['python']):5} TS={row['ts']}")
    print("\n" + "-" * 64)
    print("TỔNG KẾT:", json.dumps(summary, ensure_ascii=False))
    print("-" * 64)

    with open(os.path.join(here, "cross_validation_report.json"), "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "report": report}, f, ensure_ascii=False, indent=2)
    print("→ Đã ghi cross_validation_report.json")


if __name__ == "__main__":
    main()
