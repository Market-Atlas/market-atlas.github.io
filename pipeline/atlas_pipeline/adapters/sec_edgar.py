"""SEC EDGAR adapter — pulls 10-year history for US-listed companies.

Strategy:

1. Resolve ticker → CIK via https://www.sec.gov/files/company_tickers.json
   (cached on disk for a day to avoid hammering SEC).
2. Pull Company Facts: https://data.sec.gov/api/xbrl/companyfacts/CIK{10d}.json
3. Walk the `us-gaap` namespace, extract values per concept across all fiscal
   periods. Build per-year and per-quarter rows.
4. Return an "augment" dict the caller merges into the yfinance doc. We
   intentionally don't try to be a full adapter; yfinance handles tickers,
   exchange, sector, and live prices fine. EDGAR's win is *history depth*.

Respect SEC's fair-access guidelines:
  - Descriptive User-Agent with contact (required, else 403)
  - Cap to 10 req/s (we do <1 req/s in practice)
"""
from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timezone
from typing import Any

import requests

from ..paths import DATA_DIR

# Contact line baked into the User-Agent. SEC requires identifying the caller.
# Override via env so individual contributors can use their own.
_UA_CONTACT = os.environ.get(
    "ATLAS_EDGAR_CONTACT", "Market Atlas project (open source) contact@market-atlas.dev"
)
_HEADERS = {"User-Agent": _UA_CONTACT, "Accept-Encoding": "gzip, deflate"}

_CIK_URL = "https://www.sec.gov/files/company_tickers.json"
_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"

# Cache the ticker→CIK map on disk for a day. Saves a ~1MB roundtrip per run.
_CACHE_DIR = DATA_DIR / "_cache"
_CIK_CACHE = _CACHE_DIR / "edgar_tickers.json"
_CIK_TTL_SECONDS = 24 * 3600

# Polite throttle. SEC's stated limit is 10 req/sec.
_MIN_INTERVAL = 0.12
_last_request_at = 0.0


def _throttled_get(url: str, timeout: int = 30) -> requests.Response | None:
    global _last_request_at
    delta = time.monotonic() - _last_request_at
    if delta < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - delta)
    try:
        r = requests.get(url, headers=_HEADERS, timeout=timeout)
    except requests.RequestException:
        return None
    finally:
        _last_request_at = time.monotonic()
    if r.status_code != 200:
        return None
    return r


def _load_cik_map() -> dict[str, str]:
    """Return {TICKER_UPPER: '0000320193'} from SEC's master file. Cached on disk."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if _CIK_CACHE.exists():
        age = time.time() - _CIK_CACHE.stat().st_mtime
        if age < _CIK_TTL_SECONDS:
            try:
                return json.loads(_CIK_CACHE.read_text())
            except Exception:
                pass

    r = _throttled_get(_CIK_URL)
    if r is None:
        if _CIK_CACHE.exists():
            try:
                return json.loads(_CIK_CACHE.read_text())
            except Exception:
                pass
        return {}

    raw = r.json()
    # SEC returns { "0": {"cik_str":320193,"ticker":"AAPL","title":"Apple Inc."}, ... }
    mp = {
        str(entry["ticker"]).upper(): f"{int(entry['cik_str']):010d}"
        for entry in raw.values()
    }
    try:
        _CIK_CACHE.write_text(json.dumps(mp))
    except Exception:
        pass
    return mp


# ─── XBRL concept → canonical field map ──────────────────────────────────────
# Each canonical field gets a list of candidate XBRL tags, in preference order.
# First candidate that yields any rows wins for that concept group.

_INCOME = {
    "revenue": [
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
    ],
    "costOfRevenue": [
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
        "CostOfGoodsSold",
    ],
    "operatingIncome": ["OperatingIncomeLoss"],
    "netIncome":       ["NetIncomeLoss"],
    "eps":             ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "interestExpense": ["InterestExpense"],
    "depreciation": [
        "DepreciationAndAmortization",
        "DepreciationDepletionAndAmortization",
        "Depreciation",
    ],
    "taxProvision": ["IncomeTaxExpenseBenefit"],
    "pretaxIncome": [
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
}

_BALANCE = {
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "longTermDebt":       ["LongTermDebt", "LongTermDebtNoncurrent"],
    "shortTermDebt":      ["ShortTermBorrowings", "LongTermDebtCurrent", "DebtCurrent"],
    "equity":             ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "sharesOutstanding":  ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"],
    "accountsReceivable": ["AccountsReceivableNetCurrent"],
    "inventory":          ["InventoryNet"],
    "accountsPayable":    ["AccountsPayableCurrent"],
}

_CASHFLOW = {
    "operatingCashFlow":  ["NetCashProvidedByUsedInOperatingActivities",
                           "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "investingCashFlow":  ["NetCashProvidedByUsedInInvestingActivities",
                           "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"],
    "financingCashFlow":  ["NetCashProvidedByUsedInFinancingActivities",
                           "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"],
    "capex":              ["PaymentsToAcquirePropertyPlantAndEquipment"],
    "dividendsPaid":      ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
}


# ─── Public API ─────────────────────────────────────────────────────────────

def fetch_augment(ticker: str) -> dict[str, Any] | None:
    """Return a partial dict to merge over the yfinance doc, or None on failure.

    The shape is intentionally compatible with the canonical company doc:

        {
          "historicalFinancials": [...],   # ~10y annual, oldest-first
          "quarterlyFinancials":  [...],   # last 8 quarters, oldest-first
          "meta": {"edgar": {"cik": "...", "fetchedAt": "..."}}
        }
    """
    cik_map = _load_cik_map()
    cik = cik_map.get(ticker.upper())
    if not cik:
        return None

    r = _throttled_get(_FACTS_URL.format(cik=cik), timeout=45)
    if r is None:
        return None
    try:
        facts = r.json().get("facts", {}).get("us-gaap", {})
    except ValueError:
        return None
    if not facts:
        return None

    annual    = _extract(facts, frame="annual")
    quarterly = _extract(facts, frame="quarterly")

    if not annual and not quarterly:
        return None

    return {
        "historicalFinancials": annual,
        "quarterlyFinancials":  quarterly,
        "meta": {
            "edgar": {
                "cik": cik,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
            },
        },
    }


# ─── XBRL extraction helpers ────────────────────────────────────────────────

def _pick_units(concept: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the most useful unit array from a concept's units dict.

    Concepts may have multiple units (USD, USD/shares, shares, pure). For
    income-statement / balance-sheet line items, USD is what we want; for EPS
    it's USD/shares; for share counts it's 'shares'. First non-empty wins,
    which is fine because we never mix concepts here.
    """
    units = concept.get("units") or {}
    for key in ("USD", "USD/shares", "shares", "pure"):
        if units.get(key):
            return units[key]
    for v in units.values():
        if v:
            return v
    return []


def _annual_filings(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Index annual (FY 10-K) rows by fiscal year, keeping the latest filing per FY."""
    out: dict[int, dict[str, Any]] = {}
    for r in rows:
        if r.get("fp") != "FY":
            continue
        if not str(r.get("form", "")).startswith("10-K"):
            continue
        fy = r.get("fy")
        if fy is None:
            continue
        prev = out.get(fy)
        if prev is None or (r.get("filed", "") > prev.get("filed", "")):
            out[fy] = r
    return out


def _quarterly_filings(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index quarterly rows by 'end' date (period-end ISO string)."""
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        form = str(r.get("form", ""))
        if not (form.startswith("10-Q") or form.startswith("10-K")):
            continue
        end = r.get("end")
        if not end:
            continue
        # Only pick quarterly durations (~90d). EDGAR has both single-quarter
        # values and full-year values under the same concept; skip the latter.
        start = r.get("start")
        if start:
            try:
                d = (date.fromisoformat(end) - date.fromisoformat(start)).days
                if d > 130:  # > ~4 months → full-year row, not a quarter
                    continue
            except ValueError:
                pass
        prev = out.get(end)
        if prev is None or (r.get("filed", "") > prev.get("filed", "")):
            out[end] = r
    return out


def _extract(facts: dict[str, Any], frame: str) -> list[dict[str, Any]]:
    """Build per-period rows by walking every concept group we care about.

    `frame` is 'annual' or 'quarterly'. For annual we key by fiscal year;
    quarterly we key by period-end date.
    """
    assert frame in ("annual", "quarterly")

    rows: dict[Any, dict[str, Any]] = {}

    def _set(period_key: Any, field: str, value: float | None, meta: dict[str, Any]):
        if value is None:
            return
        row = rows.setdefault(period_key, {})
        if field in row:
            return
        row[field] = value
        if frame == "annual" and "fiscalYear" not in row:
            row["fiscalYear"] = period_key
            row["periodEnd"]  = meta.get("end")
        elif frame == "quarterly" and "periodEnd" not in row:
            row["periodEnd"]  = period_key

    def _walk(group: dict[str, list[str]]):
        for canonical, candidates in group.items():
            # Merge contributions from every candidate. XBRL concepts change
            # over time (e.g. Apple used `Revenues` until 2018 then switched to
            # `RevenueFromContractWithCustomerExcludingAssessedTax`). Earlier
            # candidates win per-period via the first-wins guard in _set().
            for tag in candidates:
                concept = facts.get(tag)
                if not concept:
                    continue
                series = _pick_units(concept)
                if frame == "annual":
                    for fy, row in _annual_filings(series).items():
                        _set(fy, canonical, _to_float(row.get("val")), row)
                else:
                    for end, row in _quarterly_filings(series).items():
                        _set(end, canonical, _to_float(row.get("val")), row)

    _walk(_INCOME)
    _walk(_BALANCE)
    _walk(_CASHFLOW)

    out = list(rows.values())
    if frame == "annual":
        out.sort(key=lambda r: r.get("fiscalYear", 0))
    else:
        out.sort(key=lambda r: r.get("periodEnd", ""))
        out = out[-8:]  # cap at 8 quarters like screener.in

    for r in out:
        _enrich(r)
    return out


def _enrich(r: dict[str, Any]) -> None:
    """Compute the same derived ratios the yfinance adapter does, in-place."""
    rev = r.get("revenue")
    op  = r.get("operatingIncome")
    ni  = r.get("netIncome")
    cog = r.get("costOfRevenue")
    pbt = r.get("pretaxIncome")
    tax = r.get("taxProvision")

    if rev and op  is not None: r.setdefault("operatingMargin", op / rev)
    if rev and ni  is not None: r.setdefault("netMargin",       ni / rev)
    if rev and cog is not None: r.setdefault("grossMargin",     (rev - cog) / rev)
    if pbt and tax is not None and pbt != 0:
        r.setdefault("taxRate", tax / pbt)

    # FCF = OCF - Capex (Capex is reported positive in EDGAR; in yfinance it's negative)
    ocf = r.get("operatingCashFlow")
    capex = r.get("capex")
    if ocf is not None and capex is not None:
        r.setdefault("freeCashFlow", ocf - capex)

    # Total debt = long-term + short-term
    lt = r.get("longTermDebt")
    st = r.get("shortTermDebt")
    if lt is not None or st is not None:
        r.setdefault("totalDebt", (lt or 0) + (st or 0))

    eq = r.get("equity")
    if eq and ni is not None: r.setdefault("roe",  ni / eq)
    if eq and op is not None:
        denom = eq + (r.get("totalDebt") or 0)
        if denom:
            r.setdefault("roic", op / denom)


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ─── Legacy alias ───────────────────────────────────────────────────────────

def fetch(ticker: str) -> dict[str, Any]:  # pragma: no cover
    out = fetch_augment(ticker)
    if out is None:
        raise RuntimeError(f"EDGAR returned no data for {ticker}")
    return out
