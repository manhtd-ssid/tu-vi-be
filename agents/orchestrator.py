# -*- coding: utf-8 -*-
"""Orchestrator / Report Composer — Horoscope Agents.
Điều phối luận giải TOÀN BỘ 12 cung (không chỉ Mệnh) thành báo cáo tổng hợp,
chạy Guardrail cho từng cung. Đây là tầng "Orchestrator + Report Composer"
trong sơ đồ kiến trúc: khép kín hệ đa tác tử.

Luồng: chart (engine tất định) -> với mỗi cung: retrieve KB -> compose (LLM/offline)
       -> Guardrail C1..C4 mỗi cung -> ghép báo cáo -> C5 disclaimer toàn cục.

Chạy: python orchestrator.py            # dùng ../sample_chart.json
"""
from __future__ import annotations
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import interpretation_agent as ia
import guardrail_agent as ga

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from cach_cuc import nhan_dien_cach_cuc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# Thứ tự trình bày chuẩn
CANON = ["Mệnh", "Phụ Mẫu", "Phúc Đức", "Điền Trạch", "Quan Lộc", "Nô Bộc",
         "Thiên Di", "Tật Ách", "Tài Bạch", "Tử Nữ", "Phu Thê", "Huynh Đệ"]
# alias tên cung: engine lasotuvi -> khoá KB
ALIAS = {"tu tuc": "Tử Nữ"}


def resolve_kb_cung(chart_cung: str, kb: Dict[str, Any]):
    n = ia.norm(str(chart_cung))
    for key in kb["cung"]:
        if ia.norm(key) == n:
            return key
    return ALIAS.get(n)


DAC_TINH = {"M": "Miếu địa — sao phát huy mạnh", "V": "Vượng địa — sao phát huy mạnh",
            "Đ": "Đắc địa — sao có lực khá", "B": "Bình hòa — sao ở mức trung bình",
            "H": "Hãm địa — sao bị chiết giảm, cần nỗ lực nhiều hơn"}


def retrieve_palace(palace: Dict[str, Any], kb: Dict[str, Any],
                    cach_cuc: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """RAG cho MỘT cung bất kỳ. Miếu/hãm lấy từ engine, không suy từ văn bản KB."""
    branch = palace["branch"]
    stars_all = [s["name"] for s in palace["stars"]]
    chinh = [s for s in stars_all if ia.norm(s) in ia.NORM_CT]
    star_by_norm = {ia.norm(s["name"]): s for s in palace["stars"]}
    id_map = ia.star_name_to_kb_id(kb)
    chunks: List[Dict[str, str]] = []

    def add(source, field, text):
        if text and text.strip():
            chunks.append({"id": "S%d" % (len(chunks) + 1), "source": source,
                           "field": field, "text": text.strip()})

    kb_key = resolve_kb_cung(palace["cung"], kb)
    cm = kb["cung"].get(kb_key, {}) if kb_key else {}
    add("Cung " + str(palace["cung"]), "vai trò",
        cm.get("overview", {}).get("detailed", "") or cm.get("overview", {}).get("short", ""))

    for s in chinh:
        kid = id_map.get(ia.norm(s))
        star = kb["chinhTinh"].get(kid, {}) if kid else {}
        if not star:
            continue
        nm = star["name"]; ov = star.get("overview", {})
        add(nm, "tổng quan", ov.get("short", "") or ov.get("detailed", ""))
        dt = star_by_norm[ia.norm(s)].get("dacTinh")
        if dt in DAC_TINH:
            add(nm, "Miếu/Vượng/Hãm tại cung " + branch, DAC_TINH[dt])
        hoa = star_by_norm[ia.norm(s)].get("hoa")
        if hoa:
            add(nm, "Tứ Hóa bản mệnh", nm + " hóa " + hoa + " tại cung này.")
        comb = star.get("combinations", {})
        if comb and comb.get("notes"):
            add(nm, "cách cục", comb["notes"])
    if palace.get("tuan") or palace.get("triet"):
        ten = " và ".join(t for t, on in (("Tuần", palace.get("tuan")), ("Triệt", palace.get("triet"))) if on)
        add("Cung " + str(palace["cung"]), "Tuần/Triệt", ten + " án ngữ tại cung này.")
    ten_cung = ia.norm(str(palace["cung"]))
    for cc in cach_cuc or []:
        if ten_cung in {ia.norm(str(x)) for x in cc["cung"]}:
            add("Cách " + cc["ten"], cc["nguon"], cc["mo_ta"])
    return {"branch": branch, "cung": palace["cung"], "stars_all": stars_all,
            "chinh_tinh": chinh, "is_than": palace.get("is_than", False), "chunks": chunks}


def prompt_section(r: Dict[str, Any]) -> Dict[str, str]:
    ctx = "\n".join("[%s] (%s — %s)\n%s" % (c["id"], c["source"], c["field"], c["text"])
                    for c in r["chunks"])
    user = ("Luận cung %s (toạ %s%s).\nSao trong cung: %s\n\nNGUỒN THAM CHIẾU:\n%s\n\n"
            "YÊU CẦU: 2–4 đoạn, bắt đầu bằng tiêu đề '## Cung %s — %s'. Mỗi đoạn có chú dẫn [Sx]. "
            "Không phán sinh tử, không khẳng định tai hoạ chắc chắn xảy ra."
            % (r["cung"], r["branch"], ", an Thân" if r["is_than"] else "",
               ", ".join(r["stars_all"]) or "(không có)", ctx, r["cung"], r["branch"]))
    return {"system": ia.SYSTEM, "user": user}


def compose_section(r: Dict[str, Any]) -> str:
    """Ghép offline một mục cung (bản LLM sẽ thay chỗ này bằng văn Quốc Sư)."""
    than = " · **Thân**" if r["is_than"] else ""
    head = ("\n## Cung %s — %s%s\n*Chính tinh: %s*\n"
            % (r["cung"], r["branch"], than,
               ", ".join(r["chinh_tinh"]) or "vô chính diệu"))
    lines = [head]
    for c in r["chunks"]:
        flat = " ".join(c["text"].split())  # gộp về 1 dòng, tránh Guardrail hiểu nhầm
        lines.append("- **%s** (%s) [%s]: %s"
                     % (c["source"], c["field"], c["id"],
                        flat[:220] + ("…" if len(flat) > 220 else "")))
    return "\n".join(lines)


def guardrail_section(text: str, chunks) -> Dict[str, Any]:
    """C1..C4 + C6 cho từng cung (C5 disclaimer kiểm ở cấp báo cáo)."""
    checks = [ga.c1_citations_valid(text, chunks), ga.c2_citation_coverage(text, chunks),
              ga.c3_no_mieu_ham_contradiction(text, chunks),
              ga.c4_no_out_of_source_stars(text, chunks), ga.c6_no_fatalism(text, chunks)]
    passed = sum(c["pass"] for c in checks)
    return {"passed": passed, "total": len(checks),
            "fail": [c["check"] for c in checks if not c["pass"]]}


DISCLAIMER = "*Tử vi mang tính tham khảo văn hoá, không thay thế quyết định cá nhân.*"


def luan_cung(palace: Dict[str, Any], kb: Dict[str, Any], cach_cuc=None,
              use_llm: bool = False) -> Dict[str, Any]:
    """Luận một cung. Bản LLM không qua Guardrail thì rơi về bản ghép offline."""
    r = retrieve_palace(palace, kb, cach_cuc)
    section = compose_section(r)
    g = guardrail_section(section, r["chunks"])
    mode = "offline"
    if use_llm:
        text = ia.generate_llm(prompt_section(r))
        if text:
            g_llm = guardrail_section(text, r["chunks"])
            if g_llm["passed"] == g_llm["total"]:
                section, g, mode = text, g_llm, "llm"
            else:
                mode = "offline_sau_khi_llm_truot_guardrail"
    return {"cung": palace["cung"], "branch": r["branch"], "chinh_tinh": r["chinh_tinh"],
            "text": section, "chunks": r["chunks"], "guardrail": g, "mode": mode}


def _tim_cung(chart: Dict[str, Any], ten: str) -> Optional[Dict[str, Any]]:
    by_cung = {ia.norm(str(p["cung"])): p for p in chart["palaces"]}
    pal = by_cung.get(ia.norm(ten))
    return pal if pal is not None or ten != "Tử Nữ" else by_cung.get("tu tuc")


def build_report(chart: Dict[str, Any], kb: Optional[Dict[str, Any]] = None,
                 use_llm: bool = False) -> Dict[str, Any]:
    """Luận 12 cung, trả {markdown, verdict, per_cung,...} — dùng chung cho CLI và API."""
    kb = kb or ia.load_kb()
    cach_cuc = nhan_dien_cach_cuc(chart) if "cuc" in chart else []
    cac_cung = [(c, _tim_cung(chart, c)) for c in CANON]
    cac_cung = [(c, p) for c, p in cac_cung if p is not None]
    with ThreadPoolExecutor(max_workers=6 if use_llm else 1) as ex:
        ket_qua = list(ex.map(lambda x: luan_cung(x[1], kb, cach_cuc, use_llm), cac_cung))

    menh = _tim_cung(chart, "Mệnh")
    than_cung = next((p["cung"] for p in chart["palaces"] if p.get("is_than")), "?")
    inp = chart.get("input", {})
    CHI_GIO = ["", "Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"]
    gio = CHI_GIO[inp.get("gio_sinh", 0)] if inp.get("gio_sinh", 0) < len(CHI_GIO) else "?"
    sinh = "%s/%s/%s · giờ %s · %s · %s" % (
        inp.get("ngay"), inp.get("thang"), inp.get("nam"), gio,
        "Nam" if inp.get("gioi_tinh") == 1 else "Nữ",
        "dương lịch" if inp.get("duong_lich") else "âm lịch")
    report = ["# BÁO CÁO TỬ VI TỔNG HỢP (12 cung)",
              "*Sinh: %s | Mệnh an tại %s, Thân tại cung %s*"
              % (sinh, menh["branch"] if menh else "?", than_cung),
              "\n> Lá số an bằng engine tất định (lasotuvi); phần luận do agent tổng "
              "hợp, grounded trên kho tri thức, đã qua Guardrail từng cung.\n"]
    if cach_cuc:
        report.append("## Cách cục nổi bật")
        report += ["- **%s** (%s): %s" % (c["ten"], c["nguon"], c["mo_ta"]) for c in cach_cuc]
    report += [k["text"] for k in ket_qua]
    report.append("\n---\n" + DISCLAIMER)
    full = "\n".join(report)

    total_pass = sum(k["guardrail"]["passed"] for k in ket_qua)
    total_chk = sum(k["guardrail"]["total"] for k in ket_qua)
    c5 = ga.c5_has_disclaimer(full, [])
    return {
        "markdown": full,
        "verdict": "ĐẠT" if (total_pass == total_chk and c5["pass"]) else "CÓ CẢNH BÁO",
        "guardrail_tong": "%d/%d" % (total_pass, total_chk),
        "disclaimer": c5["pass"], "cach_cuc": cach_cuc,
        "per_cung": [{k: v for k, v in x.items() if k != "text"} for x in ket_qua],
    }


def main():
    kb = ia.load_kb()
    chart = ia.load_chart(sys.argv[1] if len(sys.argv) > 1 else None)
    r = build_report(chart, kb, use_llm=bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY")))
    with open(os.path.join(HERE, "full_report.md"), "w", encoding="utf-8") as f:
        f.write(r["markdown"])
    qa = {k: r[k] for k in ("verdict", "guardrail_tong", "disclaimer")}
    qa["per_cung"] = [{k: q[k] for k in ("cung", "branch", "chinh_tinh", "guardrail", "mode")}
                      for q in r["per_cung"]]
    with open(os.path.join(HERE, "report_qa.json"), "w", encoding="utf-8") as f:
        json.dump(qa, f, ensure_ascii=False, indent=2)
    print("ORCHESTRATOR — 12 cung | Guardrail: %s | KẾT LUẬN: %s" % (r["guardrail_tong"], r["verdict"]))
    for q in r["per_cung"]:
        g = q["guardrail"]
        print("  [%s] %-10s @%-4s %d/%d %s" % ("✓" if g["passed"] == g["total"] else "✗", q["cung"],
                                                q["branch"], g["passed"], g["total"], g["fail"] or ""))


if __name__ == "__main__":
    main()
