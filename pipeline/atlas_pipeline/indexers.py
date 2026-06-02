"""Build derived artifacts (search index + screener) from data/companies + data/etfs."""
from __future__ import annotations

import json
import math
import re
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
CATEGORIES_PATH  = DATA_DIR / "categories.json"
SECTOR_STATS_PATH = DATA_DIR / "sector-stats.json"
SIMILAR_PATH      = DATA_DIR / "similar.json"


# Human labels + display order for the Rankings category nav.
# Slugs match KEYWORD_RULES in tags.py — change them together.
# Order is roughly the same as companiesmarketcap.com's sidebar.
CATEGORY_LABELS: list[tuple[str, str]] = [
    ("ai",                  "AI"),
    ("automakers",          "Automakers"),
    ("ev",                  "EV"),
    ("banks",               "Banks"),
    ("semiconductors",      "Semiconductor"),
    ("software",            "Software"),
    ("cloud",               "Cloud"),
    ("ecommerce",           "E-commerce"),
    ("streaming",           "Streaming"),
    ("social-media",        "Social networks"),
    ("search-engines",      "Search engines"),
    ("gaming",              "Gaming"),
    ("cybersecurity",       "Cybersecurity"),
    ("consumer-electronics","Consumer electronics"),
    ("hardware",            "Hardware"),
    ("fintech",             "Fintech"),
    ("payments",            "Payments"),
    ("insurance",           "Insurance"),
    ("asset-management",    "Asset management"),
    ("exchanges",           "Exchanges"),
    ("crypto",              "Crypto"),
    ("real-estate",         "Real Estate"),
    ("pharma",              "Pharmaceutical"),
    ("biotech",             "Biotech"),
    ("medical-devices",     "Medical devices"),
    ("healthcare",          "Healthcare"),
    ("oil-gas",             "Oil & Gas"),
    ("renewables",          "Renewable energy"),
    ("nuclear",             "Nuclear"),
    ("utilities",           "Utilities"),
    ("coal",                "Coal"),
    ("mining",              "Mining"),
    ("steel",               "Steel"),
    ("metals",              "Metals"),
    ("chemicals",           "Chemicals"),
    ("cement",              "Cement"),
    ("construction",        "Construction"),
    ("auto-parts",          "Auto parts"),
    ("aerospace-defense",   "Defense & Aerospace"),
    ("airlines",            "Airlines"),
    ("ports",               "Ports"),
    ("shipping",            "Shipping"),
    ("logistics",           "Logistics"),
    ("agriculture",         "Agriculture"),
    ("retail",              "Retail"),
    ("luxury",              "Luxury goods"),
    ("apparel",             "Apparel"),
    ("consumer-goods",      "Consumer goods"),
    ("food-beverage",       "Food & Beverage"),
    ("restaurants",         "Restaurants"),
    ("alcohol",             "Alcohol"),
    ("tobacco",             "Tobacco"),
    ("travel",              "Travel & Hotels"),
    ("media",               "Media"),
    ("telecom",             "Telecom"),
    ("robotics",            "Robotics"),
    ("space",               "Space"),
]


def _load_json(path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_fx() -> dict[str, float]:
    """Load USD-base FX rates; returns {} on failure."""
    try:
        snap = _load_json(DATA_DIR / "fx" / "latest.json")
        return snap.get("rates") or {}
    except Exception:
        return {}


# Tokens stripped from company names when grouping ADRs / multi-listings.
# Leave 'group' alone so SoftBank Corp != SoftBank Group Corp.
_NAME_NOISE = re.compile(
    r"\b(inc\.?|corp\.?|corporation|incorporated|limited|ltd\.?|plc|ag|sa|nv|spa|"
    r"co\.?|company|holdings?|adr|the|sponsored|class\s+[abc])\b",
    re.IGNORECASE,
)


def _normalize_name(name: str | None) -> str:
    if not name:
        return ""
    n = _NAME_NOISE.sub(" ", name.lower())
    n = re.sub(r"[^a-z0-9]+", " ", n).strip()
    return n


def _to_usd(value: float | None, ccy: str | None, fx: dict[str, float]) -> float | None:
    if value is None or not ccy:
        return None
    rate = fx.get(ccy.upper())
    if not rate:
        return None
    try:
        return float(value) / float(rate)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


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
    """Flat, compact array of every company with the fields the screener filters on.

    De-duplicates multi-listings (ADRs, dual listings) by normalized name,
    keeping the row with the highest USD market cap. Tickers that lost the
    tie-break are tracked in the kept row as `aliases` so search still resolves.
    """
    fx = _load_fx()
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

        mcap_val = (c.get("marketCap") or {}).get("value")
        mcap_ccy = (c.get("marketCap") or {}).get("currency") or c.get("currency")
        latest_ni = hist[-1].get("netIncome") if hist else None
        latest_fcf = hist[-1].get("freeCashFlow") if hist else None
        # PE: prefer yfinance's reported peRatio, fall back to mcap / netIncome
        # (same calc the company page does — handles all the older rows that
        # don't have peRatio yet).
        pe = fund.get("peRatio") or ratios.get("peRatio")
        if pe is None and mcap_val and latest_ni and latest_ni > 0:
            try:
                pe = float(mcap_val) / float(latest_ni)
            except (TypeError, ValueError, ZeroDivisionError):
                pe = None
        # FCF yield = TTM FCF / market cap (both in reporting ccy)
        fcf_yield = None
        if mcap_val and latest_fcf:
            try:
                fcf_yield = float(latest_fcf) / float(mcap_val)
            except (TypeError, ValueError, ZeroDivisionError):
                fcf_yield = None

        rows.append({
            "ticker": c["ticker"],
            "name": c["name"],
            "country": c.get("country"),
            "sector": c.get("sector"),
            "currency": c.get("currency"),
            "domain": _domain(c.get("website")),
            "tags": c.get("tags") or [],
            "marketCap": mcap_val,
            "marketCapCurrency": mcap_ccy,
            "marketCapUsd": _to_usd(mcap_val, mcap_ccy, fx),
            "price": (c.get("price") or {}).get("value"),
            "priceCurrency": (c.get("price") or {}).get("currency"),
            "dayChangePct":   (c.get("price") or {}).get("dayChangePct"),
            "monthChangePct": (c.get("price") or {}).get("monthChangePct"),
            "sparkline":      (c.get("price") or {}).get("sparkline") or [],
            "revenue":  (hist[-1].get("revenue")    if hist else None),
            "netIncome": latest_ni,
            "fcf":      (hist[-1].get("freeCashFlow") if hist else None),
            "eps":      (hist[-1].get("eps")        if hist else None),
            "pe":       pe,
            "pb":       fund.get("priceToBook") or ratios.get("priceToBook"),
            "dividendYield": fund.get("dividendYield"),
            "fcfYield": fcf_yield,
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

    return _dedupe_listings(rows)


def _dedupe_listings(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse multi-listings (ADRs, dual listings) keyed by normalized name.

    Strategy per group:
      1. If any member is on a non-US exchange AND any member is a US ADR,
         drop the US ADRs (keep only home/foreign listings).
      2. From the surviving pool, keep the row with the highest USD market cap.
      3. Losing tickers become `aliases` on the kept row.

    This picks the home listing in the common cases:
      Tencent  → 0700.HK  beats TCEHY
      TSMC     → 2330.TW  beats TSM
      Baidu    → 9888.HK  beats BIDU
      Alibaba  → 9988.HK  beats BABA
      HSBC     → HSBA.L   beats 0005.HK (UK is home) and HSBC (US ADR)
      Alphabet → GOOGL    beats GOOG    (both US — highest mcap wins)
    """
    from collections import defaultdict
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    singletons: list[dict[str, Any]] = []
    for r in rows:
        key = _normalize_name(r.get("name"))
        if not key:
            singletons.append(r)
        else:
            groups[key].append(r)

    deduped: list[dict[str, Any]] = list(singletons)
    dropped = 0
    for key, members in groups.items():
        if len(members) == 1:
            deduped.append(members[0])
            continue
        foreign = [m for m in members if (m.get("country") or "") != "US"]
        has_us = any((m.get("country") or "") == "US" for m in members)
        pool = foreign if (foreign and has_us) else members
        pool_sorted = sorted(
            pool,
            key=lambda r: (r.get("marketCapUsd") or 0, r.get("marketCap") or 0),
            reverse=True,
        )
        winner = pool_sorted[0]
        losers = [m for m in members if m["ticker"] != winner["ticker"]]
        winner["aliases"] = sorted({l["ticker"] for l in losers})
        deduped.append(winner)
        dropped += len(losers)

    if dropped:
        print(f"  Deduped {dropped} multi-listing rows (kept {len(deduped)} unique companies)")
    return deduped


# ── Sector statistics & similar-stocks helpers ────────────────────────────────

# Metrics surfaced in the peer-comparison matrix on the company page.
# Per-sector median + best are precomputed at build time.
_SECTOR_METRICS = (
    "roe", "roic", "operatingMargin", "netMargin", "grossMargin",
    "debtToEquity", "pe", "fcfYield", "revenueCagr", "fcfCagr",
)

# Direction = "high" → bigger is better; "low" → smaller is better.
# Drives both color-coding and "best" selection.
_METRIC_DIR = {
    "roe": "high", "roic": "high",
    "operatingMargin": "high", "netMargin": "high", "grossMargin": "high",
    "debtToEquity": "low", "pe": "low",
    "fcfYield": "high", "revenueCagr": "high", "fcfCagr": "high",
}


def _median(xs: list[float]) -> float | None:
    xs = sorted(x for x in xs if x is not None and isinstance(x, (int, float)))
    if not xs:
        return None
    n = len(xs)
    mid = n // 2
    return xs[mid] if n % 2 else (xs[mid - 1] + xs[mid]) / 2


def _compute_sector_stats(screener: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Group rows by sector, return median + best per metric.

    Shape:
      { "Technology": {
          "count": 153,
          "metrics": { "roe": {"median": 0.18, "best": 0.71, "bestTicker": "AAPL"}, ... }
      }, ... }
    """
    buckets: dict[str, list[dict[str, Any]]] = {}
    for row in screener:
        sec = row.get("sector")
        if not sec:
            continue
        buckets.setdefault(sec, []).append(row)

    out: dict[str, dict[str, Any]] = {}
    for sec, rows in buckets.items():
        metrics: dict[str, dict[str, Any]] = {}
        for m in _SECTOR_METRICS:
            vals = [(r.get(m), r["ticker"]) for r in rows if r.get(m) is not None]
            if not vals:
                continue
            nums = [v for v, _ in vals]
            med = _median(nums)
            if _METRIC_DIR[m] == "high":
                best_val, best_ticker = max(vals, key=lambda p: p[0])
            else:
                # For "low is better" metrics, ignore non-positive values where
                # they're nonsensical (e.g. negative P/E from loss-making firms).
                pos = [(v, t) for v, t in vals if v > 0]
                if not pos:
                    continue
                best_val, best_ticker = min(pos, key=lambda p: p[0])
            metrics[m] = {
                "median":     med,
                "best":       best_val,
                "bestTicker": best_ticker,
            }
        out[sec] = {"count": len(rows), "metrics": metrics}
    return out


def _compute_similar(
    screener: list[dict[str, Any]], k: int = 6,
) -> dict[str, list[str]]:
    """Precompute nearest-neighbour tickers per row.

    Distance metric is intentionally crude: same sector + similar mcap bucket
    + similar ROIC + similar revenue-CAGR. Good enough for a "you may also
    like" strip without dragging in numpy/scikit-learn at build time.
    """
    def feat(r: dict[str, Any]) -> tuple[float, float, float] | None:
        mcap = r.get("marketCapUsd") or r.get("marketCap")
        if not mcap:
            return None
        return (
            math.log10(max(mcap, 1.0)),
            float(r.get("roic")        or 0.0),
            float(r.get("revenueCagr") or 0.0),
        )

    indexed = []
    for r in screener:
        f = feat(r)
        if f is None:
            continue
        indexed.append((r, f))

    out: dict[str, list[str]] = {}
    for row, fa in indexed:
        candidates = []
        for other, fb in indexed:
            if other["ticker"] == row["ticker"]:
                continue
            if other.get("sector") != row.get("sector"):
                continue
            # Lower distance = more similar. Mcap is on log scale already.
            d = ((fa[0] - fb[0]) * 2) ** 2 + (fa[1] - fb[1]) ** 2 + (fa[2] - fb[2]) ** 2
            candidates.append((d, other["ticker"]))
        candidates.sort()
        out[row["ticker"]] = [t for _, t in candidates[:k]]
    return out


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

    # Categories: subset of tags surfaced in the Rankings nav, with display
    # labels and counts. Keeps the nav ordered + filterable client-side.
    categories: list[dict[str, Any]] = []
    for slug, label in CATEGORY_LABELS:
        bucket = tag_index.get(slug)
        if not bucket or bucket.get("count", 0) == 0:
            continue
        categories.append({
            "slug":  slug,
            "label": label,
            "count": bucket["count"],
            "top":   bucket["tickers"][:10],
        })
    with open(CATEGORIES_PATH, "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=2)

    # Sector statistics: median + best for each metric, grouped by sector.
    # Drives the "Peer Comparison Matrix" card on the company page.
    sector_stats = _compute_sector_stats(screener)
    with open(SECTOR_STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(sector_stats, f, ensure_ascii=False, indent=2)

    # Similar stocks index: precomputed nearest-neighbours per ticker so the
    # company page can render a "You may also like" strip without rebuilding
    # the whole dataset client-side. ~6 picks per ticker, ~80KB total.
    similar = _compute_similar(screener)
    with open(SIMILAR_PATH, "w", encoding="utf-8") as f:
        json.dump(similar, f, ensure_ascii=False, indent=2)
