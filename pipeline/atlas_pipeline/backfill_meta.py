"""Fast metadata backfill: hit yfinance for *just* `website` (and refresh
sector/industry/marketCap so tags re-derive correctly) without touching the
historical statements. ~10× faster than a full ingest.

    python -m atlas_pipeline.backfill_meta
    python -m atlas_pipeline.backfill_meta --workers 8
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

from .adapters.yfinance_adapter import _SUFFIX_MAP, _safe, canonical_ticker, _to_usd
from .indexers import write_artifacts
from .paths import COMPANIES_DIR
from .tags import derive_tags

# Reverse map: canonical ticker → list of possible yfinance ticker candidates.
SUFFIX_ORDER = ["", ".NS", ".T", ".L", ".TO", ".HK", ".DE", ".PA",
                ".AS", ".SW", ".MI", ".MC", ".BR", ".LS", ".HE",
                ".ST", ".OL", ".CO", ".AX", ".BO"]


def _candidates(canonical: str, country: str | None) -> list[str]:
    # Prefer the suffix matching the company's country.
    pref = []
    for sfx, meta in _SUFFIX_MAP.items():
        if meta["country"] == country:
            pref.append(sfx)
    rest = [s for s in SUFFIX_ORDER if s not in pref]
    out = []
    for s in pref + rest:
        out.append(f"{canonical}{s}" if s else canonical)
    return out


def _backfill_one(path: Path) -> tuple[str, str]:
    doc = json.load(open(path))
    canonical = doc["ticker"]
    info: dict = {}
    last_err = ""
    for yt in _candidates(canonical, doc.get("country")):
        try:
            t = yf.Ticker(yt)
            info = t.info or {}
            if info and (info.get("longName") or info.get("shortName")):
                break
        except Exception as e:  # pragma: no cover
            last_err = e.__class__.__name__
            info = {}
    if not info:
        return canonical, f"empty:{last_err}"

    website = (info.get("website") or "").strip() or None
    if website:
        doc["website"] = website

    if info.get("sector"):   doc["sector"]   = info["sector"]
    if info.get("industry"): doc["industry"] = info["industry"]
    mc_val = _safe(info.get("marketCap"))
    if mc_val:
        doc["marketCap"] = {
            "value":    mc_val,
            "currency": (info.get("currency") or doc.get("currency") or "USD").upper(),
            "asOf":     datetime.now(timezone.utc).date().isoformat(),
        }

    mc = doc.get("marketCap") or {}
    doc["tags"] = derive_tags(doc, market_cap_usd=_to_usd(mc.get("value"), mc.get("currency")))

    json.dump(doc, open(path, "w"), ensure_ascii=False, indent=2)
    return canonical, "ok" if website else "ok-no-site"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--only-missing", action="store_true",
                   help="Skip companies that already have a website field")
    args = p.parse_args(argv)

    files = sorted(COMPANIES_DIR.glob("*.json"))
    if args.only_missing:
        files = [f for f in files if not json.load(open(f)).get("website")]
    if args.limit:
        files = files[: args.limit]

    print(f"Backfilling {len(files)} companies with {args.workers} workers…")
    counts: dict[str, int] = {}
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(_backfill_one, f): f for f in files}
        for i, fut in enumerate(cf.as_completed(futures), 1):
            tk, status = fut.result()
            short = status.split(":", 1)[0]
            counts[short] = counts.get(short, 0) + 1
            mark = {"ok": "✅", "ok-no-site": "·", "empty": "∅"}.get(short, "?")
            print(f"  [{i:>4}/{len(files)}] {mark} {tk:<14} {status}")

    print("\nSummary:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print("Rebuilding derived artifacts…")
    write_artifacts()
    print("✅ Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
