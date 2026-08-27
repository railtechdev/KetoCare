"""Выгружает openapi.json — источник для генерации packages/api-client (`make openapi`)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from api.main import create_app


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("apps/api/openapi.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(create_app().openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"OpenAPI записан: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
