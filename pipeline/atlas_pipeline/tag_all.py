"""Post-process: derive `tags` (and optionally backfill `website`) for every
company JSON already on disk. Doesn't hit the network.

    python -m atlas_pipeline.tag_all
"""
from __future__ import annotations

import json
import sys

from .indexers import write_artifacts
from .paths import COMPANIES_DIR, DATA_DIR
from .tags import derive_tags

FX = json.load(open(DATA_DIR / "fx" / "latest.json"))["rates"]


def to_usd(value, ccy):
    if value is None or not ccy:
        return None
    r = FX.get(ccy.upper())
    return value / r if r else None


def main() -> int:
    n = 0
    for path in sorted(COMPANIES_DIR.glob("*.json")):
        doc = json.load(open(path))
        mc = (doc.get("marketCap") or {}).get("value")
        mc_ccy = (doc.get("marketCap") or {}).get("currency")
        doc["tags"] = derive_tags(doc, market_cap_usd=to_usd(mc, mc_ccy))
        json.dump(doc, open(path, "w"), ensure_ascii=False, indent=2)
        n += 1
    print(f"Tagged {n} companies.")
    write_artifacts()
    print("✅ Rebuilt search-index, screener, peers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
