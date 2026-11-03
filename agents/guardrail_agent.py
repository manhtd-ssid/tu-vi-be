# -*- coding: utf-8 -*-
"""Guardrail / QA Agent — kiểm chất lượng đầu ra Interpretation Agent.
5 kiểm tra tất định (dùng làm cổng chặn trước khi hiển thị):
 C1 trích dẫn hợp lệ · C2 độ phủ trích dẫn · C3 không mâu thuẫn miếu/hãm
 C4 không bịa sao ngoài nguồn · C5 có disclaimer."""
from __future__ import annotations
import json, os, re, sys, unicodedata
from typing import Any, Dict

HERE = os.path.dirname(os.path.abspath(__file__))

def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().replace("đ", "d")

def load(path_md, path_dbg):
    with open(path_md, encoding="utf-8") as f:
        text = f.read()
    with open(path_dbg, encoding="utf-8") as f:
        dbg = json.load(f)
    return text, dbg["retrieved"]["chunks"]

def c1_citations_valid(text, chunks):
    valid = {c["id"] for c in chunks}
    cited = set(re.findall(r"\[(S\d+)\]", text))
    bad = sorted(cited - valid, key=lambda x: int(x[1:]))
    return {"check": "C1 · trích dẫn hợp lệ", "pass": not bad,
            "detail": "%d trích dẫn, %d không hợp lệ" % (len(cited), len(bad)) + ((": %s" % bad) if bad else "")}

def c2_citation_coverage(text, chunks):
    # \#\#(?!\#) : chỉ tách ở tiêu đề "## " (đúng 2 dấu #) — "### phụ đề" (3 dấu #,
    # LLM hay dùng làm dòng phụ đề tên/ngày sinh dưới tiêu đề chính) không bị tách
    # thành 1 "mục nội dung" riêng rồi bị chấm oan là thiếu trích dẫn.
    sections = re.split(r"\n(?=\*\*\d\)|\#\#(?!\#)|\*\*\d\.)", text)
    uncited = []; checked = 0
    for sec in sections:
        body = sec.strip()
        if len(body) < 60:
            continue
        first = body.splitlines()[0].strip()
        if first.startswith("# "):
            continue
        if norm("tham khảo") in norm(body) or norm("nguồn grounding") in norm(body):
            continue
        checked += 1
        if not re.search(r"\[S\d+\]", body):
            uncited.append(re.sub(r"\s+", " ", body[:40]))
    return {"check": "C2 · độ phủ trích dẫn", "pass": not uncited,
            "detail": "%d mục nội dung, %d mục thiếu trích dẫn" % (checked, len(uncited)) + ((": %s" % uncited) if uncited else "")}

def c3_no_mieu_ham_contradiction(text, chunks):
    # nguồn cho biết mỗi sao MIẾU hay HÃM, VÀ tại địa chi nào (branch)
    status = {}
    for c in chunks:
        if "Miếu/Vượng/Hãm" in c["field"]:
            st = norm(c["source"])
            branch = norm(c["field"].split("cung")[-1])  # địa chi thực của sao
            if "ham dia" in norm(c["text"]):
                status[st] = ("ham", branch)
            elif "mieu" in norm(c["text"]) or "vuong" in norm(c["text"]):
                status[st] = ("mieu", branch)
    n = norm(text); problems = []
    for star, (stt, branch) in status.items():
        for m in re.finditer(re.escape(star), n):
            w = n[max(0, m.start()-45): m.end()+45]
            cm = any(k in w for k in ["mieu", "vuong", "dac dia"]); ch = "ham" in w
            near_branch = bool(branch) and branch in w  # chỉ xét khi bàn về ĐÚNG địa chi của sao
            if stt == "ham" and cm and near_branch and not ch:
                problems.append("'%s' nguồn=hãm tại %s nhưng bài ngụ ý miếu/vượng" % (star, branch))
            if stt == "mieu" and ch and near_branch and not cm:
                problems.append("'%s' nguồn=miếu tại %s nhưng bài ngụ ý hãm" % (star, branch))
    problems = sorted(set(problems))
    return {"check": "C3 · không mâu thuẫn miếu/hãm", "pass": not problems,
            "detail": "không phát hiện mâu thuẫn" if not problems else "; ".join(problems)}

def c4_no_out_of_source_stars(text, chunks):
    CT14 = ["Tử Vi","Thiên Cơ","Thái Dương","Vũ Khúc","Thiên Đồng","Liêm Trinh","Thiên Phủ",
            "Thái Âm","Tham Lang","Cự Môn","Thiên Tướng","Thiên Lương","Thất Sát","Phá Quân"]
    src = norm(" ".join(c["source"] + " " + c["field"] + " " + c["text"] for c in chunks))
    # bỏ dòng disclaimer khỏi phần quét: "Tử vi" (bộ môn) không phải sao Tử Vi
    body = " ".join(ln for ln in text.splitlines() if norm("tham khảo") not in norm(ln))
    n = norm(body)
    out = [s for s in CT14 if norm(s) in n and norm(s) not in src]
    return {"check": "C4 · không bịa sao ngoài nguồn", "pass": not out,
            "detail": "mọi chính tinh nêu ra đều có trong nguồn" if not out else "sao ngoài nguồn: %s" % out}

def c5_has_disclaimer(text, chunks):
    ok = norm("tham khảo") in norm(text)
    return {"check": "C5 · có disclaimer", "pass": ok,
            "detail": "có nhắc tính tham khảo" if ok else "THIẾU disclaimer"}

# Lá số không được dùng để phán sinh tử hay khẳng định tai hoạ chắc chắn xảy ra.
_DINH_MENH = [r"\bchet\b", r"\bqua doi\b", r"\btu vong\b", r"\byeu menh\b", r"\bdoan tho\b",
              r"\btu tu\b", r"\btu van\b", r"khong the tranh", r"chac chan (se )?(gap|mac|bi|mat)"]

def c6_no_fatalism(text, chunks):
    n = norm(text)
    hits = sorted({p for p in _DINH_MENH if re.search(p, n)})
    return {"check": "C6 · không phán định mệnh", "pass": not hits,
            "detail": "không có câu phán sinh tử/tai hoạ" if not hits else "cụm vi phạm: %s" % hits}

def run(text, chunks):
    checks = [c1_citations_valid(text, chunks), c2_citation_coverage(text, chunks),
              c3_no_mieu_ham_contradiction(text, chunks), c4_no_out_of_source_stars(text, chunks),
              c5_has_disclaimer(text, chunks), c6_no_fatalism(text, chunks)]
    passed = sum(c["pass"] for c in checks)
    verdict = "ĐẠT — cho phép hiển thị" if passed == len(checks) else "CHẶN — cần sửa"
    return {"verdict": verdict, "passed": "%d/%d" % (passed, len(checks)), "checks": checks}

def main():
    md = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "sample_interpretation.md")
    dbg = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "retrieval_debug.json")
    text, chunks = load(md, dbg)
    rep = run(text, chunks)
    print("=" * 64); print("GUARDRAIL / QA AGENT"); print("=" * 64)
    for c in rep["checks"]:
        print("  [%s] %s: %s" % ("✓" if c["pass"] else "✗", c["check"], c["detail"]))
    print("-" * 64); print("KẾT LUẬN: %s  (%s kiểm tra đạt)" % (rep["verdict"], rep["passed"])); print("-" * 64)
    with open(os.path.join(HERE, "qa_report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)
    a, b = rep["passed"].split("/")
    sys.exit(0 if a == b else 1)

if __name__ == "__main__":
    main()
