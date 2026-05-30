"""Build derived artifacts (search index + screener) from data/companies + data/etfs."""
from __future__ import annotations

import json
from typing import Any

from .paths import (
    COMPANIES_DIR,
    ETFS_DIR,
    FUNDS_DIR,
    SCREENER_PATH,
    SEARCH_INDEX_PATH,
    DATA_DIR,
)


PEERS_PATH = DATA_DIR / "peers.json"
TAGS_PATH  = DATA_DIR / "tags.json"


def _load_json(path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _domain(website: str | None) -> str | None:
    if not website:
        return None
    s = website.strip().lower()
    s = s.split("//", 1)[-1]           # drop scheme
    s = s.split("/", 1)[0]             # drop path
    if s.startswith("www."):
        s = s[4:]
    return s or None


def build_search_index() -> list[dict[str, Any]]:
    """Flat array of every searchable security.

    The frontend feeds this directly into MiniSearch / FlexSearch — no further
    server-side processing needed.
    """
    index: list[dict[str, Any]] = []

    for path in sorted(COMPANIES_DIR.glob("*.json")):
        c = _load_json(path)
        index.append({
            "type": "company",
            "ticker": c["ticker"],
            "name": c["name"],
            "exchange": c.get("exchange"),
            "country": c.get("country"),
            "sector": c.get("sector"),
            "currency": c.get("currency"),
            "domain": _domain(c.get("website")),
        })

    if ETFS_DIR.exists():
        for path in sorted(ETFS_DIR.glob("*.json")):
            e = _load_json(path)
            index.append({
                "type": "etf",
                "ticker": e["ticker"],
                "name": e["name"],
                "exchange": e.get("exchange"),
                "country": e.get("country"),
                "currency": e.get("currency"),
            })

    if FUNDS_DIR.exists():
        for path in sorted(FUNDS_DIR.glob("*.json")):
            f_ = _load_json(path)
            index.append({
                "type": "fund",
                "ticker": f_["ticker"],
                "name": f_["name"],
                "country": f_.get("country"),
                "currency": f_.get("currency"),
            })

    return index


def _pct_change(series: list[float | None]) -> float | None:
    vals = [v for v in series if v is not None and v > 0]
    if len(vals) < 2:
        return None
    first, last = vals[0], vals[-1]
    years = len(vals) - 1
    try:
        return (last / first) ** (1 / years) - 1
    except (ZeroDivisionError, ValueError, OverflowError):
        return None


def build_screener() -> list[dict[str, Any]]:
    """Flat, compact array of every company with the fields the screener filters on."""
    rows: list[dict[str, Any]] = []

    for path in sorted(COMPANIES_DIR.glob("*.json")):
        c = _load_json(path)
        hist = c.get("historicalFinancials", [])
        ratios = c.get("ratios", {}) or {}
        fund = c.get("fundamentals", {}) or {}

        revenue_series = [r.get("revenue") for r in hist]
        fcf_series = [r.get("freeCashFlow") for r in hist]

        equity = None
        if fund.get("totalDebt") is not None and ratios.get("debtToEquity"):
            try:
                equity = fund["totalDebt"] / ratios["debtToEquity"]
            except ZeroDivisionError:
                equity = None

        rows.append({
            "ticker": c["ticker"],
            "name": c["name"],
            "country": c.get("country"),
            "sector": c.get("sector"),
            "currency": c.get("currency"),
            "domain": _domain(c.get("website")),
            "tags": c.get("tags") or [],
            "marketCap": (c.get("marketCap") or {}).get("value"),
            "marketCapCurrency": (c.get("marketCap") or {}).get("currency"),
            "price": (c.get("price") or {}).get("value"),
            "priceCurrency": (c.get("price") or {}).get("currency"),
            "roe": ratios.get("roe"),
            "roic": ratios.get("roic"),
            "debtToEquity": ratios.get("debtToEquity"),
            "grossMargin": ratios.get("grossMargin"),
            "operatingMargin": ratios.get("operatingMargin"),
            "netMargin": ratios.get("netMargin"),
            "revenueCagr": _pct_change(revenue_series),
            "fcfCagr": _pct_change(fcf_series),
            "impliedEquity": equity,
        })

    return rows


def write_artifacts() -> None:
    SEARCH_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(SEARCH_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(build_search_index(), f, ensure_ascii=False, indent=2)

    screener = build_screener()
    with open(SCREENER_PATH, "w", encoding="utf-8") as f:
        json.dump(screener, f, ensure_ascii=False, indent=2)

    # Peer groups: company -> list of peer tickers (same country + sector first,
    # then same country + industry fallback, sorted by market cap desc).
    peers: dict[str, list[str]] = {}
    for row in screener:
        same = [
            r for r in screener
            if r["ticker"] != row["ticker"]
            and r.get("country") == row.get("country")
            and r.get("sector")  == row.get("sector")
            and row.get("sector")
        ]
        same.sort(key=lambda r: (r.get("marketCap") or 0), reverse=True)
        peers[row["ticker"]] = [r["ticker"] for r in same[:8]]
    with open(PEERS_PATH, "w", encoding="utf-8") as f:
        json.dump(peers, f, ensure_ascii=False, indent=2)

    # Tag index: tag -> {count, tickers (top N by market cap)}
    tag_buckets: dict[str, list[dict[str, Any]]] = {}
    for row in screener:
        for tag in row.get("tags") or []:
            tag_buckets.setdefault(tag, []).append(row)
    tag_index: dict[str, dict[str, Any]] = {}
    for tag, members in tag_buckets.items():
        members.sort(key=lambda r: (r.get("marketCap") or 0), reverse=True)
        tag_index[tag] = {
            "count":  len(members),
            "tickers": [m["ticker"] for m in members],
        }
    with open(TAGS_PATH, "w", encoding="utf-8") as f:
        json.dump(tag_index, f, ensure_ascii=False, indent=2)
