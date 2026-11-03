# -*- coding: utf-8 -*-
"""Interpretation Agent + RAG — luận CUNG MỆNH (Horoscope Agents).
Nhận lá số đã an chuẩn (engine tất định) -> luận cung Mệnh, grounded trên
kho tuViMeanings. Retrieve (cung Mệnh + chính tinh + miếu/hãm + cách cục +
Tam Hợp Tài-Quan + đối cung Thiên Di) -> build prompt Quốc Sư -> generate
(OpenAI nếu có key, ngược lại OFFLINE COMPOSE)."""
from __future__ import annotations
import json, os, re, sys, unicodedata
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))

# Nạp .env ở gốc repo (OPENAI_API_KEY, OPENAI_MODEL, ...) — không cần export thủ công
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import env_loader  # noqa: F401, E402

def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().replace("đ", "d").strip()

def load_kb() -> Dict[str, Any]:
    with open(os.path.join(HERE, "kb.json"), encoding="utf-8") as f:
        return json.load(f)

def load_chart(path: Optional[str] = None) -> Dict[str, Any]:
    path = path or os.path.join(HERE, "..", "src", "sample_chart.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)

CHINH_TINH_14 = ["Tử vi","Thiên cơ","Thái dương","Vũ khúc","Thiên đồng","Liêm trinh",
    "Thiên phủ","Thái âm","Tham lang","Cự môn","Thiên tướng","Thiên lương","Thất sát","Phá quân"]
NORM_CT = {norm(c) for c in CHINH_TINH_14}

def star_name_to_kb_id(kb):
    return {norm(v["name"]): k for k, v in kb["chinhTinh"].items()}

def detect_mieu_ham(detailed: str, branch: str) -> str:
    b = norm(branch)
    m = re.search(r"mi[ếe]u[^.]*?v[ợu]ng[^.]*?(?:t[ạa]i|cung)([^.]*)", norm(detailed))
    h = re.search(r"h[ãa]m[^.]*?(?:[d]?[ịi]a|t[ạa]i)([^.]*)", norm(detailed))
    in_mieu = bool(m and b in m.group(1))
    in_ham = bool(h and b in h.group(1))
    if in_mieu and not in_ham:
        return "Miếu/Vượng (đắc địa) — sao phát huy mạnh"
    if in_ham and not in_mieu:
        return "Hãm địa — sao bị chiết giảm, cần nỗ lực nhiều hơn"
    return "Bình thường / không xác định rõ trong thư tịch"

def retrieve(chart, kb):
    menh = next((p for p in chart["palaces"] if norm(str(p.get("cung"))) == norm("Mệnh")), None)
    if menh is None:
        raise ValueError("Không tìm thấy cung Mệnh")
    branch = menh["branch"]
    stars_all = [s["name"] for s in menh["stars"]]
    chinh = [s for s in stars_all if norm(s) in NORM_CT]
    id_map = star_name_to_kb_id(kb)
    chunks: List[Dict[str, str]] = []
    def add(source, field, text):
        if text and text.strip():
            chunks.append({"id": "S%d" % (len(chunks)+1), "source": source,
                           "field": field, "text": text.strip()})
    cm = kb["cung"].get("Mệnh", {})
    add("Cung Mệnh", "vai trò & nguyên tắc luận",
        cm.get("overview", {}).get("detailed", "") or cm.get("overview", {}).get("short", ""))
    for s in chinh:
        kid = id_map.get(norm(s))
        star = kb["chinhTinh"].get(kid, {}) if kid else {}
        if not star:
            continue
        nm = star["name"]; ov = star.get("overview", {})
        add(nm, "tổng quan", ov.get("detailed", "") or ov.get("short", ""))
        add(nm, "Miếu/Vượng/Hãm tại cung " + branch, detect_mieu_ham(ov.get("detailed", ""), branch))
        ch = star.get("characteristics", {})
        if ch.get("positive"): add(nm, "ưu điểm", "• " + "\n• ".join(ch["positive"]))
        if ch.get("negative"): add(nm, "nhược điểm", "• " + "\n• ".join(ch["negative"]))
        cf = star.get("careerFinance", {})
        if cf.get("overview"): add(nm, "sự nghiệp – tài chính", cf["overview"])
        rel = star.get("relationships", {})
        if rel.get("love") or rel.get("family"):
            add(nm, "tình cảm – gia đạo", " ".join(filter(None, [rel.get("love"), rel.get("family")])))
        he = star.get("health", {})
        if he.get("overview"): add(nm, "sức khoẻ", he["overview"])
        comb = star.get("combinations", {})
        if comb:
            txt = []
            if comb.get("best"): txt.append("Hợp cách: " + "; ".join(comb["best"]))
            if comb.get("challenging"): txt.append("Khó cách: " + "; ".join(comb["challenging"]))
            if comb.get("notes"): txt.append(comb["notes"])
            add(nm, "cách cục / phối tinh", "\n".join(txt))
    context_map = {"Tài Bạch": "Tam Hợp Mệnh (tài lộc)",
                   "Quan Lộc": "Tam Hợp Mệnh (sự nghiệp)",
                   "Thiên Di": "Đối cung (môi trường ngoài)"}
    context = []
    for cung_name, role in context_map.items():
        pal = next((p for p in chart["palaces"] if norm(str(p.get("cung"))) == norm(cung_name)), None)
        if pal is None:
            continue
        pal_chinh = [s["name"] for s in pal["stars"] if norm(s["name"]) in NORM_CT]
        short = kb["cung"].get(cung_name, {}).get("overview", {}).get("short", "")
        add(cung_name + " [" + role + "]", "vai trò",
            short + " Toạ tại " + pal["branch"] + "; chính tinh: "
            + (", ".join(pal_chinh) or "vô chính diệu") + ".")
        context.append({"cung": cung_name, "role": role, "branch": pal["branch"], "chinh_tinh": pal_chinh})
    return {"branch": branch, "stars_all": stars_all, "chinh_tinh": chinh,
            "is_than": menh.get("is_than", False), "chunks": chunks, "context_palaces": context}

SYSTEM = ("Bạn là Quốc Sư chuyên luận giải Tử Vi Đẩu Số cho hoàng tộc, văn phong uy nghi, "
    "mạch lạc. TUYỆT ĐỐI chỉ dùng thông tin trong NGUỒN THAM CHIẾU; không bịa ngoài nguồn. "
    "Mỗi luận điểm phải chú dẫn [Sx]. Nếu nguồn không đủ, nói rõ 'thư tịch chưa bàn tới'. "
    "Kết bằng câu nhắc tử vi mang tính tham khảo, không thay thế quyết định cá nhân.")

def build_prompt(r):
    ctx = "\n".join("[" + c["id"] + "] (" + c["source"] + " — " + c["field"] + ")\n" + c["text"] for c in r["chunks"])
    than = " (đồng thời an Thân)" if r["is_than"] else ""
    user = ("LÁ SỐ (đã an chuẩn):\n- Cung Mệnh toạ: " + r["branch"] + than
        + "\n- Sao trong Mệnh: " + ", ".join(r["stars_all"])
        + "\n- Chính tinh thủ Mệnh: " + (", ".join(r["chinh_tinh"]) or "(vô chính diệu)")
        + "\n\nNGUỒN THAM CHIẾU:\n" + ctx
        + "\n\nYÊU CẦU: luận cung Mệnh 6 mục (tổng quan; ưu/nhược; sự nghiệp-tài lộc đối chiếu "
          "Tam Hợp; tình cảm-gia đạo; sức khoẻ; đối cung Thiên Di & cách cục). Mỗi ý chú dẫn [Sx].")
    return {"system": SYSTEM, "user": user}

def generate_llm(prompt):
    key = os.getenv("OPENAI_API_KEY")
    # Ưu tiên Claude (ANTHROPIC_API_KEY) → fallback OpenAI (key ở trên) → offline
    key_a = os.getenv("ANTHROPIC_API_KEY")
    if key_a:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=key_a)
            resp = client.messages.create(
                model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
                max_tokens=4096,
                system=prompt["system"],
                messages=[{"role": "user", "content": prompt["user"]}])
            # content[0] có thể là ThinkingBlock (Claude Sonnet 5 mặc định adaptive
            # thinking) — phải lọc đúng block "text", không lấy thẳng content[0].
            return next((b.text for b in resp.content if b.type == "text"), None)
        except Exception as e:
            print("[Claude lỗi, thử OpenAI/offline] " + str(e), file=sys.stderr)
    if not key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key)
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "system", "content": prompt["system"]},
                      {"role": "user", "content": prompt["user"]}], temperature=0.7)
        return resp.choices[0].message.content
    except Exception as e:
        print("[OpenAI lỗi, offline] " + str(e), file=sys.stderr)
        return None

def generate_offline(r):
    by = {}
    for c in r["chunks"]:
        by.setdefault(c["source"], []).append(c)
    lines = ["# Luận giải Cung Mệnh — địa chi " + r["branch"] + (" (Thân đồng cung)" if r["is_than"] else ""),
        "*Chính tinh thủ Mệnh: " + (", ".join(r["chinh_tinh"]) or "vô chính diệu") + "*",
        "\n> OFFLINE COMPOSE (không có OPENAI_API_KEY) — ghép trực tiếp từ nguồn để minh hoạ grounding.\n"]
    for source, cs in by.items():
        lines.append("\n## " + source)
        for c in cs:
            lines.append("**" + c["field"] + "** [" + c["id"] + "]")
            lines.append(" ".join(c["text"].split()))  # gộp 1 dòng: tránh Guardrail tách nhầm
    lines.append("\n---\n*Tử vi mang tính tham khảo, không thay thế quyết định cá nhân.*")
    return "\n".join(lines)

def sources_block(r):
    return "\n".join("[" + c["id"] + "] " + c["source"] + " — " + c["field"] for c in r["chunks"])

def main():
    kb = load_kb()
    chart = load_chart(sys.argv[1] if len(sys.argv) > 1 else None)
    r = retrieve(chart, kb)
    prompt = build_prompt(r)
    text = generate_llm(prompt)
    mode = "LLM" if text else "OFFLINE COMPOSE"
    if not text:
        text = generate_offline(r)
    print("=" * 70)
    print("INTERPRETATION AGENT - cung Menh " + r["branch"] + " - che do: " + mode)
    print("Da truy xuat " + str(len(r["chunks"])) + " mau tri thuc (gom "
          + str(len(r["context_palaces"])) + " cung Tam Hop/doi cung)")
    print("=" * 70); print(text)
    print("\n" + "=" * 70); print("NGUON GROUNDING:"); print(sources_block(r))
    with open(os.path.join(HERE, "retrieval_debug.json"), "w", encoding="utf-8") as f:
        json.dump({"retrieved": r, "prompt": prompt}, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
