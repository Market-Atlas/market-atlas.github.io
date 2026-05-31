"""Refresh data/fx/latest.json from a free public source.

Provider: https://open.er-api.com (no API key, ~daily updates, used by many
open-source tools). Falls back to https://api.frankfurter.app/latest.

Usage:
    python -m atlas_pipeline.fetch_fx
    python -m atlas_pipeline.fetch_fx --base USD
"""
from __future__ import annotations

import argparse
import json
import sys

import requests

from .paths import DATA_DIR

# Currencies we display in the UI.
KEEP = ["USD", "EUR", "GBP", "JPY", "INR", "CHF", "CAD", "AUD",
        "HKD", "SEK", "NOK", "DKK", "CNY", "SGD", "KRW",
        "TWD", "SAR", "AED", "BRL", "MXN", "IDR"]


def _from_open_er(base: str) -> dict:
    url = f"https://open.er-api.com/v6/latest/{base}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    data = r.json()
    if data.get("result") != "success":
        raise RuntimeError(f"open.er-api error: {data}")
    # time_last_update_utc looks like 'Sat, 31 May 2025 00:00:00 +0000'
    from datetime import datetime
    try:
        d = datetime.strptime(data["time_last_update_utc"], "%a, %d %b %Y %H:%M:%S %z").date().isoformat()
    except Exception:
        d = data.get("time_last_update_utc", "")[:10]
    return {"base": data["base_code"], "asOf": d, "rates": data["rates"]}


def _from_frankfurter(base: str) -> dict:
    url = f"https://api.frankfurter.app/latest?from={base}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    data = r.json()
    # Frankfurter omits the base from rates; add it back.
    rates = {**data["rates"], data["base"]: 1.0}
    return {"base": data["base"], "asOf": data["date"], "rates": rates}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="USD")
    args = p.parse_args(argv)

    try:
        snap = _from_open_er(args.base)
        source = "open.er-api.com"
    except Exception as e:
        print(f"open.er-api failed ({e}); trying frankfurter…", file=sys.stderr)
        snap = _from_frankfurter(args.base)
        source = "frankfurter.app"

    # Slim to currencies we use and round to 4 dp.
    rates = {k: round(v, 4) for k, v in snap["rates"].items() if k in KEEP}
    rates.setdefault(snap["base"], 1.0)

    out = {
        "asOf":   snap["asOf"],
        "base":   snap["base"],
        "rates":  rates,
        "source": source,
    }

    path = DATA_DIR / "fx" / "latest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"✅ Wrote {path}")
    print(f"   base={out['base']}  asOf={out['asOf']}  source={source}")
    print(f"   INR={rates.get('INR')}  JPY={rates.get('JPY')}  EUR={rates.get('EUR')}  GBP={rates.get('GBP')}  HKD={rates.get('HKD')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
