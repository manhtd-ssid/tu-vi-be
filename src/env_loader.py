# -*- coding: utf-8 -*-
"""Nạp file .env ở gốc repo vào os.environ — chỉ dùng stdlib, không cần python-dotenv.

Cách dùng: `import env_loader` ở đầu entry point (tự chạy khi import).
Quy tắc parse:
  - Mỗi dòng dạng KEY=VALUE; bỏ qua dòng trống và dòng bắt đầu bằng `#`.
  - Chấp nhận tiền tố `export ` (copy từ shell script vẫn chạy).
  - VALUE được bỏ cặp nháy bao quanh ("..." hoặc '...') nếu có.
  - Biến ĐÃ CÓ trong môi trường được giữ nguyên (env thật ưu tiên hơn .env).
  - VALUE rỗng bị bỏ qua (giữ placeholder trong .env.example không gây hại).
Vị trí .env: gốc repo (thư mục cha của poc_engine/), theo đường dẫn tương đối
file này — chạy được từ mọi thư mục, không phụ thuộc cwd.
"""
from __future__ import annotations

import os

_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ENV_FILE = os.path.join(_ROOT, ".env")


def load_env(path: str = ENV_FILE) -> None:
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            if key and val and key not in os.environ:
                os.environ[key] = val


load_env()
