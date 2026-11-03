# -*- coding: utf-8 -*-
"""Nhận diện cách cục — 41 quy tắc port từ ziwei-doushu (lib/ziwei/patterns.ts, MIT).

Mỗi cách có ba tầng: điều kiện bắt buộc / điểm cộng / yếu tố phá cách, kèm thư tịch.
Khác bản gốc:
  * Đọc lá số lasotuvi: tên sao Việt, độ sáng từ `dacTinh` (M/V/Đ = sáng, H = hãm),
    Tứ Hóa từ trường `hoa` (bảng trường phái Việt).
  * Câu chữ định mệnh trong cổ thư (tai ách, thọ yểu) được viết lại thành lưu ý, vì
    đây là nội dung hiển thị cho người dùng cuối.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Set

DAI_CAT, CAT, TRUNG, LUU_Y = "dai_cat", "cat", "trung_binh", "can_luu_y"

TOAN_THU = "Tử Vi Đẩu Số Toàn Thư"
TOAN_TAP = "Tử Vi Đẩu Số Toàn Tập"
COT_TUY = "Cốt Tủy Phú"

SAT_CUNG = {"kình dương", "đà la", "hỏa tinh", "linh tinh"}
KHONG_KIEP = {"địa không", "địa kiếp"}
TAT_CA_SAT = SAT_CUNG | KHONG_KIEP
BIG = ("tử vi", "thiên cơ", "thái dương", "vũ khúc", "thiên đồng", "liêm trinh", "thiên phủ",
       "thái âm", "tham lang", "cự môn", "thiên tướng", "thiên lương", "thất sát", "phá quân")


class P:
    """Cung trên lá số với truy vấn sao theo tên thường."""

    def __init__(self, raw: Dict[str, Any]):
        self.i = raw["index"]
        self.cung = raw["cung"]
        self.branch = raw["branch"]
        self.stars = {(s["name"] or "").lower(): s for s in raw["stars"]}

    def has(self, *names: str) -> bool:
        return all(n in self.stars for n in names)

    def any_of(self, names) -> bool:
        return any(n in self.stars for n in names)

    def dem(self, names) -> int:
        return sum(1 for n in names if n in self.stars)

    def hoa(self, name: str) -> Optional[str]:
        s = self.stars.get(name)
        return s.get("hoa") if s else None

    def co_hoa(self, loai: str, chinh: bool = False) -> Optional[str]:
        for n, s in self.stars.items():
            if s.get("hoa") == loai and (not chinh or n in BIG):
                return n
        return None

    def sang(self, name: str) -> bool:
        s = self.stars.get(name)
        return bool(s) and s.get("dacTinh") in ("M", "V", "Đ")

    def ham(self, name: str) -> bool:
        s = self.stars.get(name)
        return bool(s) and s.get("dacTinh") == "H"

    def chinh(self) -> List[str]:
        return [n for n in self.stars if n in BIG]


class Ctx:
    def __init__(self, chart: Dict[str, Any]):
        self.ps = {p["index"]: P(p) for p in chart["palaces"]}
        self.m = chart["menh_index"]
        self.t = chart["than_index"]
        self.menh = self.ps[self.m]
        self.than = self.ps[self.t]
        self.tam = [self.at(self.m + d) for d in (0, 4, 8, 6)]
        self.sf: Set[str] = {n for p in self.tam for n in p.stars}
        self.truoc, self.sau = self.at(self.m - 1), self.at(self.m + 1)
        self.out: List[Dict[str, Any]] = []

    def at(self, idx: int) -> P:
        return self.ps[(idx - 1) % 12 + 1]

    def find(self, name: str) -> Optional[P]:
        return next((p for p in self.ps.values() if name in p.stars), None)

    def by_cung(self, ten: str) -> Optional[P]:
        return next((p for p in self.ps.values() if (p.cung or "").lower() == ten), None)

    def in_tam(self, p: P) -> bool:
        return (p.i - self.m) % 12 in (0, 4, 6, 8)

    def sat_tam(self, names=SAT_CUNG) -> int:
        return sum(p.dem(names) for p in self.tam)

    def hoa_tam(self, loai: str) -> bool:
        return any(p.co_hoa(loai) for p in self.tam)

    def kep_menh(self, a: str, b: str) -> bool:
        return (self.truoc.has(a) and self.sau.has(b)) or (self.truoc.has(b) and self.sau.has(a))

    def add(self, ten, muc, mo_ta, cung, bat_buoc, cong=(), pha=(), nguon=TOAN_THU):
        self.out.append({
            "ten": ten, "muc": muc, "mo_ta": mo_ta,
            "cung": [c for c in dict.fromkeys(cung) if c],
            "dieu_kien": {"bat_buoc": list(bat_buoc), "diem_cong": list(cong), "pha_cach": list(pha)},
            "nguon": nguon,
        })


def _f(*items):
    return [text for cond, text in items if cond]


def _hoa_ten(n: str) -> str:
    return n.title()


def _quan_than(c: Ctx):
    sf = c.sf
    if not (c.menh.has("tử vi") and {"tả phù", "hữu bật"} <= sf):
        return
    pha = _f((c.sat_tam(KHONG_KIEP) >= 2, "Không Kiếp cùng hội (Tử Vi kỵ Không Kiếp)"))
    c.add("Quân Thần Khánh Hội", CAT if pha else DAI_CAT,
          "Tử Vi thủ Mệnh có Tả Hữu hội về, như vua được hiền thần phò tá. Thường có người nâng đỡ, hợp vai trò lãnh đạo, quản trị.",
          ["Mệnh"], ["Tử Vi thủ Mệnh", "Tả Phù, Hữu Bật hội tam phương tứ chính"],
          _f(("văn xương" in sf or "văn khúc" in sf, "hội thêm Xương hoặc Khúc"),
             ("thiên khôi" in sf or "thiên việt" in sf, "Khôi Việt quý nhân chiếu"),
             (c.menh.hoa("tử vi") == "Quyền", "Tử Vi hóa Quyền")), pha)


def _tu_phu(c: Ctx):
    tv, tp = c.find("tử vi"), c.find("thiên phủ")
    if not tv or tv is not tp:
        return
    o_menh = tv.i == c.m
    pha = _f((tv.any_of(KHONG_KIEP), "cung có Không Kiếp"), (tv.dem(SAT_CUNG) >= 2, "cung có từ hai sát tinh"))
    c.add("Tử Phủ Đồng Cung", DAI_CAT if o_menh and not pha else CAT,
          "Tử Vi, Thiên Phủ cùng thủ Mệnh, tôn quý, ổn định, có tài tổ chức; cần Tả Hữu phối hợp mới trọn."
          if o_menh else "Tử Phủ đồng cung nhưng không thủ Mệnh, có chỗ dựa quý nhân, mức độ phú quý còn tùy cát sát hội chiếu.",
          [tv.cung], ["Tử Vi, Thiên Phủ đồng cung"] if not o_menh else ["Tử Vi, Thiên Phủ đồng thủ Mệnh"],
          _f(({"tả phù", "hữu bật"} <= c.sf, "Tả Hữu cùng hội"),
             ("văn xương" in c.sf or "văn khúc" in c.sf, "hội Xương Khúc")), pha)


def _phu_tuong(c: Ctx):
    p, t = c.find("thiên phủ"), c.find("thiên tướng")
    if not p or not t or p is t or not (c.in_tam(p) and c.in_tam(t)):
        return
    pha = _f((c.menh.any_of(SAT_CUNG), "Mệnh có sát tinh"), (c.sat_tam() >= 3, "tam phương nhiều sát tinh"))
    c.add("Phủ Tướng Triều Viên", CAT if pha else DAI_CAT,
          "Thiên Phủ, Thiên Tướng cùng ở tam phương tứ chính của Mệnh, văn võ kiêm toàn, có quyền có ấn, đời sống đủ đầy.",
          [p.cung, t.cung], ["Thiên Phủ, Thiên Tướng ở tam phương Mệnh, không đồng cung"],
          _f((c.menh.has("lộc tồn") or c.menh.co_hoa("Lộc"), "Mệnh có Lộc"), ("tả phù" in c.sf, "hội Tả Phù")), pha)


def _duong_luong(c: Ctx):
    if not {"thái dương", "thiên lương", "văn xương", "lộc tồn"} <= c.sf:
        return
    d, l = c.find("thái dương"), c.find("thiên lương")
    pha = _f((d.ham("thái dương"), "Thái Dương hãm địa"), (c.sat_tam() >= 2, "tam phương sát nặng"))
    c.add("Dương Lương Xương Lộc", CAT if pha else DAI_CAT,
          "Thái Dương, Thiên Lương, Văn Xương, Lộc Tồn cùng hội, thuận đường học vấn, thi cử, nghiên cứu và chuyên môn.",
          [d.cung, l.cung], ["Bốn sao Nhật, Lương, Xương, Lộc hội tam phương Mệnh"],
          _f((d.sang("thái dương"), "Thái Dương sáng"), (l.sang("thiên lương"), "Thiên Lương sáng"),
             (c.hoa_tam("Khoa"), "hội Hóa Khoa")), pha)


def _hoa_tham(c: Ctx):
    th = c.find("tham lang")
    if not th or not c.in_tam(th):
        return
    for ten_sao, sao, ten in (("Hỏa Tinh", "hỏa tinh", "Hỏa Tham"), ("Linh Tinh", "linh tinh", "Linh Tham")):
        p = c.find(sao)
        if not p or (p.i - th.i) % 12 not in (0, 4, 6, 8):
            continue
        dong = p is th
        pha = _f((th.any_of(("kình dương", "đà la")), "cung Tham Lang có Kình Đà"),
                 (th.any_of(KHONG_KIEP), "Tham Lang gặp Không Kiếp"))
        c.add(ten, CAT if pha else DAI_CAT,
              "Tham Lang gặp %s (%s), dễ có cơ hội đến nhanh, bứt phá đột ngột; nên giữ thành quả vì được nhanh cũng dễ mất nhanh."
              % (ten_sao, "đồng cung" if dong else "hội chiếu"),
              [th.cung, p.cung], ["Tham Lang %s %s" % ("đồng cung" if dong else "hội chiếu", ten_sao), "Tham Lang ở tam phương Mệnh"],
              _f((th.sang("tham lang"), "Tham Lang sáng"), (th.hoa("tham lang") in ("Lộc", "Quyền"), "Tham Lang hóa Lộc/Quyền")),
              pha, COT_TUY)


def _vu_tham(c: Ctx):
    v, t = c.find("vũ khúc"), c.find("tham lang")
    if not v or not t or (v.i - t.i) % 12 not in (0, 6) or not (c.in_tam(v) or c.in_tam(t)):
        return
    pha = _f((v.any_of(("kình dương", "đà la")), "cung Vũ Khúc có Kình Đà"), (v.any_of(KHONG_KIEP), "gặp Không Kiếp"))
    c.add("Vũ Tham", CAT if pha else DAI_CAT,
          "Tài tinh gặp Tham Lang; cổ thư nói “Vũ Tham bất phát thiếu niên nhân”, thường tích lũy và thành tựu từ trung niên.",
          [v.cung, t.cung], ["Vũ Khúc, Tham Lang %s" % ("đồng cung" if v is t else "đối cung"), "hội tam phương Mệnh"],
          _f(("hỏa tinh" in c.sf or "linh tinh" in c.sf, "gặp thêm Hỏa/Linh"), (v.hoa("vũ khúc") == "Lộc", "Vũ Khúc hóa Lộc")),
          pha, COT_TUY)


def _sat_pha_tham(c: Ctx):
    if not {"thất sát", "phá quân", "tham lang"} <= c.sf:
        return
    pha = _f((c.sat_tam() >= 3, "sát tinh quá nặng"), (c.menh.any_of(KHONG_KIEP), "Mệnh có Không Kiếp"))
    cung = [p.cung for p in c.tam if p.any_of(("thất sát", "phá quân", "tham lang"))]
    c.add("Sát Phá Tham", LUU_Y if pha else CAT,
          "Bộ Sát Phá Tham hội Mệnh: tính khai phá, không chịu yên, đời nhiều thay đổi. Hợp khởi nghiệp, kinh doanh, môi trường cạnh tranh; thường ổn định từ trung niên.",
          cung, ["Thất Sát, Phá Quân, Tham Lang ở tam phương tứ chính"],
          _f((c.hoa_tam("Lộc") or c.hoa_tam("Quyền"), "có Hóa Lộc/Quyền"),
             ({"tả phù", "hữu bật"} <= c.sf, "Tả Hữu cùng hội")), pha)


def _co_nguyet(c: Ctx):
    bo = ["thiên cơ", "thái âm", "thiên đồng", "thiên lương"]
    co = [s for s in bo if s in c.sf]
    cung = [p.cung for p in c.tam if p.any_of(co)]
    if len(co) == 4:
        pha = _f((c.sat_tam() >= 3, "nhiều sát tinh"), (c.menh.any_of(SAT_CUNG), "Mệnh có sát tinh"))
        c.add("Cơ Nguyệt Đồng Lương", CAT if pha else DAI_CAT,
              "Bốn sao Cơ, Nguyệt, Đồng, Lương hội Mệnh: nho nhã, cẩn trọng, giỏi mưu tính; hợp công chức, học thuật, y tế, dịch vụ, ngành cần tích lũy bền.",
              cung, ["Bốn sao hội đủ tam phương tứ chính"],
              _f(("văn xương" in c.sf or "văn khúc" in c.sf, "hội Xương Khúc"), (c.hoa_tam("Khoa"), "hội Hóa Khoa")), pha)
    elif len(co) == 3:
        thieu = [s for s in bo if s not in co][0]
        c.add("Cơ Nguyệt Đồng Lương (chưa đủ)", TRUNG,
              "Bộ bốn sao mới hội ba, thiếu %s; có khuynh hướng nhưng không tính là chân cách." % _hoa_ten(thieu),
              cung, ["Tam phương có %s" % ", ".join(_hoa_ten(s) for s in co)])


def _liem_tuong(c: Ctx):
    l, t = c.find("liêm trinh"), c.find("thiên tướng")
    if not l or l is not t:
        return
    pha = _f((l.has("kình dương"), "có Kình Dương"), (l.hoa("liêm trinh") == "Kỵ", "Liêm Trinh hóa Kỵ"))
    c.add("Liêm Tướng", LUU_Y if pha else (CAT if l.i == c.m else TRUNG),
          "Liêm Trinh, Thiên Tướng đồng cung, làm việc có nguyên tắc; hợp hành chính, pháp chế, quản lý. Gặp Kình, Kỵ nên cẩn trọng giấy tờ, pháp lý.",
          [l.cung], ["Liêm Trinh, Thiên Tướng đồng cung"],
          _f((l.has("lộc tồn") or l.hoa("liêm trinh") == "Lộc", "có Lộc"), ("tả phù" in c.sf, "hội Tả Phù")), pha)


def _vu_sat(c: Ctx):
    v, s = c.find("vũ khúc"), c.find("thất sát")
    if not v or v is not s:
        return
    pha = _f((v.hoa("vũ khúc") == "Kỵ", "Vũ Khúc hóa Kỵ"), (v.any_of(SAT_CUNG), "có sát tinh đồng cung"))
    c.add("Vũ Sát", LUU_Y if pha else (DAI_CAT if v.i == c.m else CAT),
          "Vũ Khúc, Thất Sát đồng cung, quyết đoán, giỏi xoay xở tài chính; hợp tài chính, kỹ thuật, khởi nghiệp. Đời phải tự lực nhiều.",
          [v.cung], ["Vũ Khúc, Thất Sát đồng cung"],
          _f((v.hoa("vũ khúc") == "Quyền", "Vũ Khúc hóa Quyền"), (v.hoa("vũ khúc") == "Lộc", "Vũ Khúc hóa Lộc")), pha)


def _dong_luong(c: Ctx):
    d, l = c.find("thiên đồng"), c.find("thiên lương")
    if not d or d is not l:
        return
    pha = _f((d.any_of(SAT_CUNG), "có sát tinh đồng cung"))
    c.add("Đồng Lương", TRUNG if pha else CAT,
          "Phúc tinh gặp ấm tinh, hiền hòa, thích giúp người; hợp y tế, giáo dục, công tác xã hội. Tính ôn hòa, ít mạo hiểm.",
          [d.cung], ["Thiên Đồng, Thiên Lương đồng cung"],
          _f(("văn xương" in c.sf, "Văn Xương chiếu"), (d.hoa("thiên đồng") == "Lộc", "Thiên Đồng hóa Lộc")), pha)


def _nhat_nguyet(c: Ctx):
    d, a = c.find("thái dương"), c.find("thái âm")
    if d and d is a and d.branch in ("Sửu", "Mùi"):
        pha = _f((d.any_of(SAT_CUNG), "có sát tinh đồng cung"))
        c.add("Nhật Nguyệt Đồng Cung", CAT if pha or d.i != c.m else DAI_CAT,
              "Nhật Nguyệt cùng ở %s, âm dương quân bình, văn võ kiêm toàn, dễ có tiếng tăm và nhân duyên." % d.branch,
              [d.cung], ["Thái Dương, Thái Âm đồng cung tại %s" % d.branch],
              _f(({"văn xương", "văn khúc"} <= c.sf, "hội Xương Khúc")), pha)
    if c.kep_menh("thái dương", "thái âm"):
        pd, pa = c.find("thái dương"), c.find("thái âm")
        pha = _f((pd.ham("thái dương") or pa.ham("thái âm"), "Nhật Nguyệt hãm địa"))
        c.add("Nhật Nguyệt Giáp Mệnh", CAT if pha else DAI_CAT,
              "Nhật Nguyệt kẹp hai bên Mệnh, sáng sủa, được người nâng đỡ. Nhật Nguyệt không hãm mới là chân cách.",
              ["Mệnh", pd.cung, pa.cung], ["Thái Dương, Thái Âm ở hai cung kề Mệnh"],
              _f((pd.sang("thái dương"), "Thái Dương sáng"), (pa.sang("thái âm"), "Thái Âm sáng")), pha)


def _cu_nhat(c: Ctx):
    j, d = c.find("cự môn"), c.find("thái dương")
    if not j or j is not d or j.branch not in ("Dần", "Thân"):
        return
    hoa = j.hoa("cự môn")
    pha = _f((hoa == "Kỵ", "Cự Môn hóa Kỵ"), (j.branch == "Thân", "Thái Dương ở Thân đã xế, ám khí Cự Môn rõ hơn"))
    c.add("Cự Nhật Đồng Cung", LUU_Y if pha else (DAI_CAT if j.i == c.m else CAT),
          "Thái Dương giải ám khí của Cự Môn; lập nghiệp bằng lời nói, truyền thông, ngoại ngữ, chuyên môn. Ở Dần tốt hơn Thân.",
          [j.cung], ["Cự Môn, Thái Dương đồng cung tại %s" % j.branch],
          _f((hoa in ("Lộc", "Quyền"), "Cự Môn hóa Lộc/Quyền")), pha)


def _thach_trung(c: Ctx):
    m = c.menh
    if not m.has("cự môn") or m.branch not in ("Tý", "Ngọ"):
        return
    pha = _f((m.hoa("cự môn") == "Kỵ", "Cự Môn hóa Kỵ"), (m.any_of(SAT_CUNG), "Mệnh có sát tinh"))
    c.add("Thạch Trung Ẩn Ngọc", LUU_Y if pha else DAI_CAT,
          "Cự Môn thủ Mệnh tại Tý/Ngọ, ngoài bình dị mà trong có thực tài; thường hiển đạt từ trung niên.",
          ["Mệnh"], ["Cự Môn thủ Mệnh tại %s" % m.branch],
          _f((m.hoa("cự môn") in ("Lộc", "Quyền"), "Cự Môn hóa Lộc/Quyền"), ("văn xương" in c.sf, "hội Văn Xương")), pha, COT_TUY)


def _minh_chau(c: Ctx):
    if c.menh.branch != "Mùi" or c.menh.chinh():
        return
    doi = c.at(c.m + 6)
    if not doi.has("thái dương", "thái âm"):
        return
    pha = _f((c.sat_tam() >= 2, "sát tinh hội chiếu"))
    c.add("Minh Châu Xuất Hải", CAT if pha else DAI_CAT,
          "Mệnh vô chính diệu tại Mùi, Nhật Nguyệt ở Sửu chiếu về. Khởi đầu bình thường, nhờ tự thân vươn lên; xa quê hoặc môi trường lớn dễ phát huy.",
          ["Mệnh", doi.cung], ["Mệnh vô chính diệu tại Mùi", "đối cung Sửu có Nhật Nguyệt"],
          _f(("văn xương" in c.sf or "văn khúc" in c.sf, "hội Xương Khúc"),
             ("tả phù" in c.sf or "hữu bật" in c.sf, "có Tả/Hữu")), pha, TOAN_TAP)


def _tu_vi_menh(c: Ctx):
    if not c.menh.has("tử vi") or c.menh.has("thiên phủ"):
        return
    co_ta = "tả phù" in c.sf
    co_huu = "hữu bật" in c.sf
    pha = _f((not co_ta and not co_huu, "không có Tả Hữu (cô quân)"), (c.menh.any_of(KHONG_KIEP), "Tử Vi gặp Không Kiếp"))
    cong = _f((co_ta and co_huu, "Tả Hữu cùng hội"), ({"văn xương", "văn khúc"} <= c.sf, "Xương Khúc cùng hội"))
    c.add("Tử Vi Thủ Mệnh", LUU_Y if pha else (DAI_CAT if cong else CAT),
          "Đế tinh thủ Mệnh, tự tôn cao, có sức hút lãnh đạo; thiếu người phò tá thì dễ cô độc, khó nghe góp ý.",
          ["Mệnh"], ["Tử Vi thủ Mệnh, không đồng cung Thiên Phủ"], cong, pha)


def _giap_menh(c: Ctx):
    for a, b, ten, muc, mo_ta in (
        ("tả phù", "hữu bật", "Tả Hữu Giáp Mệnh", DAI_CAT, "Tả Hữu kẹp Mệnh, được quý nhân, có sức tổ chức; hợp quản lý, doanh nghiệp lớn."),
        ("văn xương", "văn khúc", "Xương Khúc Giáp Mệnh", DAI_CAT, "Xương Khúc kẹp Mệnh, thông minh, có văn tài; thuận thi cử, học thuật, viết lách."),
        ("thiên khôi", "thiên việt", "Khôi Việt Giáp Mệnh", CAT, "Khôi Việt kẹp Mệnh, lúc quan trọng thường có quý nhân nâng đỡ."),
        ("hỏa tinh", "linh tinh", "Hỏa Linh Giáp Mệnh", LUU_Y, "Hỏa Linh kẹp Mệnh, tính nóng vội; nên rèn kiên nhẫn, tránh quyết định bốc đồng."),
        ("địa không", "địa kiếp", "Không Kiếp Giáp Mệnh", LUU_Y, "Không Kiếp kẹp Mệnh, tiền bạc khó tụ, tư duy khác thường; hợp kỹ nghệ, nghiên cứu, nên có kỷ luật tài chính."),
    ):
        if c.kep_menh(a, b):
            c.add(ten, muc, mo_ta, ["Mệnh", c.truoc.cung, c.sau.cung],
                  ["%s, %s ở hai cung kề Mệnh" % (_hoa_ten(a), _hoa_ten(b))])


def _song_loc(c: Ctx):
    if not (c.hoa_tam("Lộc") and "lộc tồn" in c.sf):
        return
    c.add("Song Lộc Triều Viên", DAI_CAT,
          "Hóa Lộc và Lộc Tồn cùng hội, nguồn tài lộc dồi dào, ít lo thiếu thốn.",
          [p.cung for p in c.tam], ["Hóa Lộc hội tam phương", "Lộc Tồn hội tam phương"], (),
          _f((c.menh.any_of(KHONG_KIEP), "Mệnh có Không Kiếp: tiền đến rồi đi")))


def _tam_ky(c: Ctx):
    if c.hoa_tam("Lộc") and c.hoa_tam("Quyền") and c.hoa_tam("Khoa"):
        c.add("Tam Kỳ Gia Hội", DAI_CAT, "Lộc, Quyền, Khoa cùng hội tam phương tứ chính, một trong những cách cát cao nhất: có tiền tài, quyền hành và danh tiếng.",
              [p.cung for p in c.tam], ["Hóa Lộc, Quyền, Khoa hội đủ tam phương tứ chính"])
    elif any(p.co_hoa("Khoa", True) for p in c.tam) and any(p.co_hoa("Quyền", True) for p in c.tam):
        c.add("Khoa Quyền Song Hội", CAT, "Khoa và Quyền cùng hội, vừa có học thức danh tiếng vừa có năng lực nắm việc; hợp hướng chuyên gia.",
              ["Mệnh"], ["Hóa Khoa, Hóa Quyền hội tam phương tứ chính"])


def _hoa_nhap(c: Ctx):
    s = c.menh.co_hoa("Lộc", True)
    if s:
        c.add("%s Hóa Lộc Thủ Mệnh" % _hoa_ten(s), CAT, "Hóa Lộc tại Mệnh, nhiều cơ duyên, nhân duyên tốt, kiếm tiền thuận hơn.", ["Mệnh"], ["%s hóa Lộc tại Mệnh" % _hoa_ten(s)])
    for p, nhan in ((c.menh, "Mệnh"), (c.at(c.m + 6), "Thiên Di")):
        s = p.co_hoa("Kỵ", True)
        if s:
            c.add("%s Hóa Kỵ tại %s" % (_hoa_ten(s), nhan), LUU_Y,
                  "Hóa Kỵ tại Mệnh: dễ cố chấp, tự tạo áp lực; nên nhường một bước, chú ý nghỉ ngơi." if nhan == "Mệnh"
                  else "Hóa Kỵ tại Thiên Di: đi xa, giao tế dễ gặp trục trặc; nên chuẩn bị kỹ, thận trọng khi mở rộng.",
                  [p.cung], ["%s hóa Kỵ tại %s" % (_hoa_ten(s), nhan)])
    if c.menh.co_hoa("Kỵ") and c.kep_menh("kình dương", "đà la"):
        c.add("Kình Đà Giáp Kỵ", LUU_Y, "Hóa Kỵ tại Mệnh lại bị Kình Đà kẹp, dễ vất vả, nhiều trắc trở; nên chậm mà chắc, tránh quá sức, chủ động tìm hỗ trợ.",
              ["Mệnh", c.truoc.cung, c.sau.cung], ["Hóa Kỵ tại Mệnh", "Kình Dương, Đà La ở hai cung kề Mệnh"], nguon=COT_TUY)
    tb, ql = c.by_cung("tài bạch"), c.by_cung("quan lộc")
    s = tb.co_hoa("Lộc", True) if tb else None
    if s:
        c.add("Hóa Lộc Nhập Tài", CAT, "%s hóa Lộc tại Tài Bạch, nguồn thu thông suốt." % _hoa_ten(s), ["Tài Bạch"], ["%s hóa Lộc tại Tài Bạch" % _hoa_ten(s)])
    s = ql.co_hoa("Quyền", True) if ql else None
    if s:
        c.add("Hóa Quyền Nhập Quan", CAT, "%s hóa Quyền tại Quan Lộc, công việc có quyền chủ động, gánh được vai trò độc lập." % _hoa_ten(s), ["Quan Lộc"], ["%s hóa Quyền tại Quan Lộc" % _hoa_ten(s)])
    for p, nhan in ((c.menh, "Mệnh"), (c.than, "Thân")):
        s = p.co_hoa("Khoa", True)
        if s:
            c.add("Hóa Khoa Nhập %s" % nhan, CAT, "%s hóa Khoa tại %s, thuận danh tiếng, giấy tờ, học thuật." % (_hoa_ten(s), nhan), [p.cung], ["%s hóa Khoa tại %s" % (_hoa_ten(s), nhan)])
            break


def _sat_cach(c: Ctx):
    sf = c.sf
    for bo, ten, nguon in (
        ({"liêm trinh", "thất sát", "kình dương"}, "Liêm Sát Dương", TOAN_THU),
        ({"cự môn", "hỏa tinh", "kình dương"}, "Cự Hỏa Dương", COT_TUY),
        ({"linh tinh", "văn xương", "đà la", "vũ khúc"}, "Linh Xương Đà Vũ", COT_TUY),
    ):
        if bo <= sf:
            c.add(ten, LUU_Y,
                  "Tổ hợp cổ thư lưu ý, thường ứng khi hạn kích hoạt. Không phải định mệnh: nên giữ cân bằng tâm lý, tránh quyết định lớn lúc áp lực và chủ động tìm hỗ trợ khi cần.",
                  ["Mệnh"], ["%s hội tam phương tứ chính" % ", ".join(sorted(_hoa_ten(s) for s in bo))], nguon=nguon)


def _ma_dau(c: Ctx):
    m = c.menh
    if m.branch != "Ngọ" or not m.has("kình dương"):
        return
    cong = _f(("thất sát" in c.sf or "phá quân" in c.sf, "hội Sát/Phá"), ("thiên khôi" in c.sf or "thiên việt" in c.sf, "Khôi Việt chiếu"))
    c.add("Mã Đầu Đới Tiễn", CAT if cong else LUU_Y,
          "Kình Dương thủ Mệnh tại Ngọ, quyết liệt, có tinh thần cạnh tranh; hợp môi trường cần hành động mạnh, nhưng nên kiềm chế nóng nảy.",
          ["Mệnh"], ["Kình Dương thủ Mệnh tại Ngọ"], cong, nguon=COT_TUY)


def _loc_ma(c: Ctx):
    p = c.find("lộc tồn")
    if p and p.i in (c.m, c.t):
        o_menh = p.i == c.m
        c.add("Lộc Tồn Thủ %s" % ("Mệnh" if o_menh else "Thân"), CAT,
              "Lộc Tồn tại %s, tài lộc ổn định, giỏi tích lũy, tính thận trọng." % ("Mệnh" if o_menh else "Thân"),
              [p.cung], ["Lộc Tồn tại %s" % ("Mệnh" if o_menh else "Thân")])
    p = c.find("thiên mã")
    if p and (p.i - c.m) % 12 in (0, 6):
        o_menh = p.i == c.m
        c.add("Thiên Mã %s" % ("Thủ Mệnh" if o_menh else "Tại Thiên Di"), TRUNG,
              "Thiên Mã tại Mệnh, đời nhiều di chuyển, trong động có tài; gặp Lộc càng tốt." if o_menh
              else "Thiên Mã tại Thiên Di, đi xa có lợi, hợp phát triển ở nơi khác.",
              [p.cung], ["Thiên Mã tại %s" % ("Mệnh" if o_menh else "Thiên Di")])


def _dong_hoi(c: Ctx):
    sf = c.sf
    if {"văn xương", "văn khúc"} <= sf:
        o = c.menh.has("văn xương", "văn khúc")
        c.add("Xương Khúc %s" % ("Thủ Mệnh" if o else "Đồng Hội"), CAT, "Xương Khúc hội Mệnh, có tài ăn nói, văn chương; hợp nghề cần biểu đạt.", ["Mệnh"], ["Văn Xương, Văn Khúc hội tam phương tứ chính"])
    if {"tả phù", "hữu bật"} <= sf:
        c.add("Tả Hữu Đồng Hội", CAT, "Tả Hữu hội Mệnh, được nhiều người giúp, nhân duyên tốt; hợp vai trò dẫn dắt và làm việc nhóm.", ["Mệnh"], ["Tả Phù, Hữu Bật hội tam phương tứ chính"])
    if {"thiên khôi", "thiên việt"} <= sf:
        c.add("Khôi Việt Đồng Hội", CAT, "Khôi Việt hội Mệnh, lúc then chốt thường có quý nhân nâng đỡ.", ["Mệnh"], ["Thiên Khôi, Thiên Việt hội tam phương tứ chính"])


_QUY_TAC: List[Callable[[Ctx], None]] = [
    _quan_than, _tu_phu, _phu_tuong, _duong_luong, _hoa_tham, _vu_tham, _sat_pha_tham, _co_nguyet,
    _liem_tuong, _vu_sat, _dong_luong, _nhat_nguyet, _cu_nhat, _thach_trung, _minh_chau, _tu_vi_menh,
    _giap_menh, _song_loc, _tam_ky, _hoa_nhap, _sat_cach, _ma_dau, _loc_ma, _dong_hoi,
]


def nhan_dien_cach_cuc(chart: Dict[str, Any]) -> List[Dict[str, Any]]:
    c = Ctx(chart)
    for rule in _QUY_TAC:
        rule(c)
    return c.out
