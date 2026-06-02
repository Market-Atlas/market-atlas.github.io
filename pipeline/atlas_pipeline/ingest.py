"""Ingest companies from ticker universes into data/companies/<TICKER>.json.

Usage:
    python -m atlas_pipeline.ingest                       # all universes
    python -m atlas_pipeline.ingest --universe us         # only US
    python -m atlas_pipeline.ingest --universe us,in      # both
    python -m atlas_pipeline.ingest --tickers AAPL,MSFT   # ad-hoc list
    python -m atlas_pipeline.ingest --limit 5             # smoke-test
    python -m atlas_pipeline.ingest --workers 8           # parallel fetches
    python -m atlas_pipeline.ingest --skip-existing       # incremental refresh

Companies fetched via yfinance. Values are stored exactly as reported, in the
reporting currency. After ingest, derived artifacts (search index, screener,
peers) are rebuilt via `atlas_pipeline.build`.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import sys
from pathlib import Path

from .adapters.yfinance_adapter import canonical_ticker, fetch_company
from .adapters.sec_edgar      import fetch_augment as fetch_edgar
from .indexers import write_artifacts
from .paths import COMPANIES_DIR, ROOT
from .validate import validate

UNIVERSES_DIR = ROOT / "pipeline" / "universes"


def _merge_edgar(doc: dict, edgar: dict) -> dict:
    """Overlay EDGAR's deeper history onto the yfinance base doc.

    Strategy:
      - For annual: EDGAR usually has 10y+, yfinance ~4y. Merge by fiscalYear;
        EDGAR wins (more recent SEC filings, complete coverage). yfinance-only
        years (typically the most recent if EDGAR hasn't filed yet) are kept.
      - For quarterly: EDGAR wins outright when present.
      - Mark provenance under meta.edgar so the UI can show the source.
    """
    # Annual merge
    yf_annual = {r.get("fiscalYear"): r for r in (doc.get("historicalFinancials") or [])}
    eg_annual = edgar.get("historicalFinancials") or []
    merged_by_fy: dict = dict(yf_annual)
    for row in eg_annual:
        fy = row.get("fiscalYear")
        if fy is None:
            continue
        existing = merged_by_fy.get(fy) or {}
        # EDGAR row wins, but keep any yfinance fields it doesn't have
        combined = {**existing, **{k: v for k, v in row.items() if v is not None}}
        merged_by_fy[fy] = combined
    doc["historicalFinancials"] = sorted(
        merged_by_fy.values(), key=lambda r: r.get("fiscalYear", 0)
    )

    # Quarterly: EDGAR replaces if it has anything
    if edgar.get("quarterlyFinancials"):
        doc["quarterlyFinancials"] = edgar["quarterlyFinancials"]

    # Provenance
    meta = doc.setdefault("meta", {})
    if edgar.get("meta", {}).get("edgar"):
        meta["edgar"] = edgar["meta"]["edgar"]

    return doc


def _read_universe(name: str) -> list[str]:
    p = UNIVERSES_DIR / f"{name}.txt"
    if not p.exists():
        raise SystemExit(f"Unknown universe '{name}' (expected {p}).")
    out = []
    for line in p.read_text().splitlines():
        s = line.split("#", 1)[0].strip()
        if s:
            out.append(s)
    return out


def _ingest_one(yticker: str, skip_existing: bool) -> tuple[str, str]:
    """Return (yticker, status). status ∈ {'ok','skipped','empty','invalid','error:<msg>'}."""
    out_path = COMPANIES_DIR / f"{canonical_ticker(yticker)}.json"
    if skip_existing and out_path.exists():
        return yticker, "skipped"

    try:
        doc = fetch_company(yticker)
    except Exception as e:  # pragma: no cover - network
        return yticker, f"error:{e.__class__.__name__}"

    if not doc:
        return yticker, "empty"
    if not doc.get("historicalFinancials"):
        return yticker, "empty"

    # EDGAR augment for US-listed tickers — gives 10y+ history and clean
    # quarterly. Non-US tickers (everything with a yfinance suffix like .NS
    # or .T) are skipped; EDGAR only covers SEC filers.
    if "." not in yticker:
        try:
            edgar = fetch_edgar(yticker)
        except Exception:
            edgar = None
        if edgar:
            doc = _merge_edgar(doc, edgar)

    errs = validate(doc, "company.schema.json")
    if errs:
        return yticker, "invalid:" + "; ".join(errs[:2])

    COMPANIES_DIR.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    return yticker, "ok"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Ingest companies via yfinance")
    p.add_argument("--universe", default="us,in",
                   help="Comma-separated universe names under pipeline/universes/ (default: us,in)")
    p.add_argument("--tickers", default=None,
                   help="Comma-separated yfinance tickers, overrides --universe")
    p.add_argument("--tickers-file", default=None,
                   help="Path to a file of yfinance tickers (one per line, '#' comments). Overrides --universe.")
    p.add_argument("--limit", type=int, default=None, help="Stop after N tickers (debugging)")
    p.add_argument("--workers", type=int, default=4, help="Parallel fetches (default 4)")
    p.add_argument("--skip-existing", action="store_true",
                   help="Don't refetch tickers already on disk")
    p.add_argument("--no-rebuild", action="store_true",
                   help="Skip search/screener rebuild at the end")
    args = p.parse_args(argv)

    if args.tickers:
        tickers = [t.strip() for t in args.tickers.split(",") if t.strip()]
    elif args.tickers_file:
        tickers = []
        for line in Path(args.tickers_file).read_text().splitlines():
            s = line.split("#", 1)[0].strip()
            if s:
                tickers.append(s)
    else:
        tickers = []
        for u in args.universe.split(","):
            u = u.strip()
            if u:
                tickers += _read_universe(u)
    if args.limit:
        tickers = tickers[: args.limit]

    print(f"Ingesting {len(tickers)} tickers with {args.workers} workers…")

    counts: dict[str, int] = {}
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(_ingest_one, t, args.skip_existing): t for t in tickers}
        for i, fut in enumerate(cf.as_completed(futures), 1):
            yticker, status = fut.result()
            short = status.split(":", 1)[0]
            counts[short] = counts.get(short, 0) + 1
            mark = {"ok": "✅", "skipped": "·", "empty": "∅", "invalid": "⚠", "error": "✗"}.get(short, "?")
            print(f"  [{i:>3}/{len(tickers)}] {mark} {yticker:<14} {status}")

    print("\nSummary:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    if not args.no_rebuild:
        print("\nRebuilding derived artifacts…")
        write_artifacts()
        print("✅ Wrote data/search-index.json and data/screener.json")

    # success if at least one ticker succeeded
    return 0 if counts.get("ok", 0) + counts.get("skipped", 0) > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
