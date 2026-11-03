# -*- coding: utf-8 -*-
"""HTTP API tử vi (FastAPI). Chạy: python src/service/api.py  → http://127.0.0.1:8973/docs"""
from __future__ import annotations

import functools
import hmac
import json
import os
import sys
from typing import Any, Dict, List, Literal, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
for sub in (os.path.join(HERE, ".."), os.path.join(HERE, "..", "..", "agents")):
    sys.path.insert(0, os.path.abspath(sub))

import env_loader  # noqa: F401,E402
import orchestrator as orch  # noqa: E402
import interpretation_agent as ia  # noqa: E402
import van_han  # noqa: E402
from cach_cuc import nhan_dien_cach_cuc  # noqa: E402
from thoi_gian import CHI, KINH_DO_TINH, chi_cua_gio, quy_doi_gio  # noqa: E402
from tuvi_engine import lap_la_so  # noqa: E402

from fastapi import FastAPI, Header, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from pydantic import BaseModel, Field, model_validator  # noqa: E402

KB = ia.load_kb()
app = FastAPI(title="Tử Vi API", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_methods=["*"], allow_headers=["*"],
    allow_origins=[o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",") if o.strip()],
)


@app.exception_handler(ValueError)
async def _gia_tri_sai(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"error": str(exc)})


class BirthInput(BaseModel):
    ngay: int = Field(ge=1, le=31)
    thang: int = Field(ge=1, le=12)
    nam: int = Field(ge=1800, le=2199)
    gioi_tinh: Literal[1, -1]
    gio_sinh: Optional[int] = Field(None, ge=1, le=12, description="Giờ âm 1=Tý..12=Hợi")
    gio: Optional[int] = Field(None, ge=0, le=23, description="Giờ đồng hồ, thay cho gio_sinh")
    phut: int = Field(0, ge=0, le=59)
    duong_lich: bool = True
    thang_nhuan: bool = False
    tinh: Optional[str] = Field(None, description="Nơi sinh, tra kinh độ để tính Chân Thái Dương")
    kinh_do: Optional[float] = Field(None, ge=-180, le=180)
    utc_offset_phut: int = 420
    quy_tac_ty: Literal["ngay_sau", "ngay_hien_tai"] = "ngay_sau"
    nhuan_policy: Literal["thang_nay", "chia_doi"] = "thang_nay"

    @model_validator(mode="after")
    def _kiem_tra(self):
        if (self.gio_sinh is None) == (self.gio is None):
            raise ValueError("Cần đúng một trong hai: gio_sinh hoặc gio")
        if self.tinh and self.tinh not in KINH_DO_TINH:
            raise ValueError("Tỉnh không có trong danh sách, xem GET /v1/meta")
        if not self.duong_lich and (self.tinh or self.kinh_do is not None):
            raise ValueError("Chân Thái Dương chỉ áp dụng khi nhập dương lịch")
        return self


class YearInput(BirthInput):
    nam_xem: int = Field(ge=1800, le=2300)


class ReportInput(BirthInput):
    use_llm: bool = False


class InterpretInput(BirthInput):
    cung: str


def _key(body: BaseModel, *bo: str) -> str:
    return json.dumps(body.model_dump(exclude=set(bo)), sort_keys=True, ensure_ascii=False)


@functools.lru_cache(maxsize=2048)
def _chart_cached(key: str) -> str:
    b = json.loads(key)
    hieu_chinh = None
    ngay, thang, nam, gio_sinh = b["ngay"], b["thang"], b["nam"], b["gio_sinh"]
    if b["gio"] is not None:
        if b["duong_lich"]:
            kd = KINH_DO_TINH[b["tinh"]] if b["tinh"] else b["kinh_do"]
            q, hieu_chinh = quy_doi_gio(ngay, thang, nam, b["gio"], b["phut"], kd,
                                        b["utc_offset_phut"], b["quy_tac_ty"])
            ngay, thang, nam, gio_sinh = q["ngay"], q["thang"], q["nam"], q["gio_sinh"]
        else:
            gio_sinh = chi_cua_gio(b["gio"], b["phut"])
    chart = lap_la_so(ngay, thang, nam, gio_sinh, b["gioi_tinh"], b["duong_lich"],
                      thang_nhuan=b["thang_nhuan"], nhuan_policy=b["nhuan_policy"])
    chart["hieu_chinh_gio"] = hieu_chinh
    return json.dumps(chart, ensure_ascii=False)


def _chart(body: BaseModel) -> Dict[str, Any]:
    return json.loads(_chart_cached(_key(body, "nam_xem", "use_llm", "cung")))


@functools.lru_cache(maxsize=512)
def _report_cached(key: str, use_llm: bool) -> str:
    return json.dumps(orch.build_report(json.loads(_chart_cached(key)), KB, use_llm), ensure_ascii=False)


def _kiem_key(x_api_key: Optional[str]):
    can = os.getenv("API_KEY")
    if can and not hmac.compare_digest(x_api_key or "", can):
        raise HTTPException(401, "Sai API key")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/v1/meta")
def meta():
    return {"gio": [{"gio_sinh": i + 1, "chi": c} for i, c in enumerate(CHI)],
            "tinh": sorted(KINH_DO_TINH)}


@app.post("/v1/la-so")
def la_so(body: BirthInput):
    c = _chart(body)
    return {"chart": c, "dai_han": van_han.danh_sach_dai_han(c), "cach_cuc": nhan_dien_cach_cuc(c)}


@app.post("/v1/luu-nien")
def luu_nien(body: YearInput):
    c = _chart(body)
    return {"luu_nien": van_han.luu_nien(c, body.nam_xem),
            "luu_nguyet": van_han.luu_nguyet(c, body.nam_xem)}


@app.post("/v1/luan-giai")
def luan_giai(body: ReportInput, x_api_key: Optional[str] = Header(None)):
    if body.use_llm:   # chỉ bản LLM tốn tiền
        _kiem_key(x_api_key)
    _chart(body)
    return json.loads(_report_cached(_key(body, "nam_xem", "use_llm", "cung"), body.use_llm))


# ---- Tương thích laso_viewer.html ----
@app.post("/chart")
def chart_compat(body: BirthInput):
    return _chart(body)


@app.post("/interpret")
def interpret_compat(body: InterpretInput):
    c = _chart(body)
    pal = next((p for p in c["palaces"] if ia.norm(str(p["cung"])) == ia.norm(body.cung)), None)
    if pal is None:
        raise ValueError("Không có cung " + body.cung)
    k = orch.luan_cung(pal, KB, nhan_dien_cach_cuc(c))
    g = k["guardrail"]
    return {"interpretation": k["text"],
            "sources": [{"id": x["id"], "label": x["source"] + " — " + x["field"]} for x in k["chunks"]],
            "guardrail": {"passed": g["passed"], "fail": g["fail"],
                          "verdict": "ĐẠT" if g["passed"] == g["total"] else "CẢNH BÁO"}}


@app.get("/viewer")
def viewer():
    return FileResponse(os.path.join(HERE, "laso_viewer.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8973")))
