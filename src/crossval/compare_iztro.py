# -*- coding: utf-8 -*-
"""Đối chiếu lasotuvi ⇄ iztro (engine nền của ziwei-doushu) trên N ca ngẫu nhiên.

Chạy:  npm i iztro && python compare_iztro.py --n 2000
Hai phép so:
  --tz 8 (mặc định): lasotuvi dùng lịch UTC+8 như iztro → chỉ đo khác biệt THUẬT TOÁN.
  --tz 7           : lịch Việt Nam → đo thêm các ngày âm lịch VN/TQ lệch nhau.
"""
import argparse, collections, json, os, random, subprocess, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tuvi_engine import lap_la_so  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CHI = {"子": "Tý", "丑": "Sửu", "寅": "Dần", "卯": "Mão", "辰": "Thìn", "巳": "Tỵ", "午": "Ngọ",
       "未": "Mùi", "申": "Thân", "酉": "Dậu", "戌": "Tuất", "亥": "Hợi"}
CAN = dict(zip("甲乙丙丁戊己庚辛壬癸", ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"]))
SAO = {"紫微": "tử vi", "天机": "thiên cơ", "太阳": "thái dương", "武曲": "vũ khúc", "天同": "thiên đồng",
       "廉贞": "liêm trinh", "天府": "thiên phủ", "太阴": "thái âm", "贪狼": "tham lang", "巨门": "cự môn",
       "天相": "thiên tướng", "天梁": "thiên lương", "七杀": "thất sát", "破军": "phá quân",
       "左辅": "tả phù", "右弼": "hữu bật", "文昌": "văn xương", "文曲": "văn khúc", "天魁": "thiên khôi",
       "天钺": "thiên việt", "禄存": "lộc tồn", "擎羊": "kình dương", "陀罗": "đà la", "火星": "hỏa tinh",
       "铃星": "linh tinh", "地空": "địa không", "地劫": "địa kiếp", "天马": "thiên mã"}
CUC = {"水二局": 2, "木三局": 3, "金四局": 4, "土五局": 5, "火六局": 6}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--tz", type=int, default=8)
    a = ap.parse_args()
    random.seed(2026)
    cases = [dict(y=random.randint(1930, 2030), m=random.randint(1, 12), d=random.randint(1, 28),
                  gio=random.randint(1, 12), gt=random.choice((1, -1))) for _ in range(a.n)]
    env = dict(os.environ, NODE_PATH=os.path.join(HERE, "node_modules"))
    iz = json.loads(subprocess.run(["node", "iztro_batch.mjs"], cwd=HERE, input=json.dumps(cases),
                                   capture_output=True, text=True, check=True, env=env).stdout)
    ok = collections.Counter(); tong = collections.Counter(); lech = collections.Counter(); mau = []
    for c, z in zip(cases, iz):
        lst = lap_la_so(c["d"], c["m"], c["y"], c["gio"], c["gt"], time_zone=a.tz)
        def cmp(k, x, y):
            tong[k] += 1
            ok[k] += x == y
            if x != y and len(mau) < 12:
                mau.append((c, k, x, y))
            return x == y
        by_b = {p["branch"]: p for p in lst["palaces"]}
        menh_z = next(CHI[p["branch"]] for p in z["palaces"] if p["name"] == "命宫")
        cmp("menh", lst["palaces"][lst["menh_index"] - 1]["branch"], menh_z)
        cmp("cuc", lst["cuc"]["so"], CUC[z["ju"]])
        cmp("than", lst["palaces"][lst["than_index"] - 1]["branch"], next(CHI[p["branch"]] for p in z["palaces"] if p["isBody"]))
        for p in z["palaces"]:
            b = CHI[p["branch"]]
            cmp("can_cung", by_b[b]["can"], CAN[p["stem"]])
            cmp("dai_han", by_b[b]["dai_han"], p["decadal"][0])
            for s in p["stars"]:
                vn = SAO.get(s["name"])
                if not vn:
                    continue
                pos = next((q["branch"] for q in lst["palaces"]
                            if any(x["name"].lower() == vn for x in q["stars"])), None)
                k = "chinh_tinh" if vn in list(SAO.values())[:14] else "phu_tinh"
                if not cmp(k, pos, b):
                    lech[vn] += 1
    print("Số ca:", a.n, "| lịch lasotuvi UTC+%d" % a.tz)
    for k in tong:
        print("  %-11s %d/%d = %.2f%%" % (k, ok[k], tong[k], 100 * ok[k] / tong[k]))
    print("Sao lệch:", lech.most_common())
    for m in mau[:6]:
        print("  mẫu:", m)


if __name__ == "__main__":
    main()
