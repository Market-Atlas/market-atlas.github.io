"""yfinance → canonical company schema.

yfinance is free, covers US + India (suffix `.NS` for NSE, `.BO` for BSE),
Japan (`.T`), UK (`.L`), Europe, Canada, Australia. Perfect for bootstrapping.
We keep all values in the company's reporting currency — never convert.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import yfinance as yf

from ..tags import derive_tags

# FX snapshot used to size-bucket companies in USD.
try:
    import json as _json
    from ..paths import DATA_DIR
    _FX = _json.load(open(DATA_DIR / "fx" / "latest.json"))["rates"]
except Exception:  # pragma: no cover
    _FX = {"USD": 1.0}


def _to_usd(value: float | None, currency: str | None) -> float | None:
    if value is None or not currency:
        return None
    rate = _FX.get(currency.upper())
    return value / rate if rate else None


# ─── exchange / country inference ────────────────────────────────────────────

_SUFFIX_MAP = {
    ".NS": {"exchange": "XNSE", "country": "IN", "currency_fallback": "INR"},
    ".BO": {"exchange": "XBOM", "country": "IN", "currency_fallback": "INR"},
    ".T":  {"exchange": "XTKS", "country": "JP", "currency_fallback": "JPY"},
    ".L":  {"exchange": "XLON", "country": "GB", "currency_fallback": "GBP"},
    ".TO": {"exchange": "XTSE", "country": "CA", "currency_fallback": "CAD"},
    ".V":  {"exchange": "XTSX", "country": "CA", "currency_fallback": "CAD"},
    ".AX": {"exchange": "XASX", "country": "AU", "currency_fallback": "AUD"},
    ".HK": {"exchange": "XHKG", "country": "HK", "currency_fallback": "HKD"},
    ".DE": {"exchange": "XETR", "country": "DE", "currency_fallback": "EUR"},
    ".F":  {"exchange": "XFRA", "country": "DE", "currency_fallback": "EUR"},
    ".PA": {"exchange": "XPAR", "country": "FR", "currency_fallback": "EUR"},
    ".AS": {"exchange": "XAMS", "country": "NL", "currency_fallback": "EUR"},
    ".SW": {"exchange": "XSWX", "country": "CH", "currency_fallback": "CHF"},
    ".MI": {"exchange": "XMIL", "country": "IT", "currency_fallback": "EUR"},
    ".MC": {"exchange": "XMAD", "country": "ES", "currency_fallback": "EUR"},
    ".BR": {"exchange": "XBRU", "country": "BE", "currency_fallback": "EUR"},
    ".LS": {"exchange": "XLIS", "country": "PT", "currency_fallback": "EUR"},
    ".HE": {"exchange": "XHEL", "country": "FI", "currency_fallback": "EUR"},
    ".ST": {"exchange": "XSTO", "country": "SE", "currency_fallback": "SEK"},
    ".OL": {"exchange": "XOSL", "country": "NO", "currency_fallback": "NOK"},
    ".CO": {"exchange": "XCSE", "country": "DK", "currency_fallback": "DKK"},
    # newly added — mainland China, Taiwan, Korea, Saudi, UAE, Brazil, Mexico
    ".SS": {"exchange": "XSHG", "country": "CN", "currency_fallback": "CNY"},
    ".SZ": {"exchange": "XSHE", "country": "CN", "currency_fallback": "CNY"},
    ".TW": {"exchange": "XTAI", "country": "TW", "currency_fallback": "TWD"},
    ".TWO": {"exchange": "XTAI", "country": "TW", "currency_fallback": "TWD"},
    ".KS": {"exchange": "XKRX", "country": "KR", "currency_fallback": "KRW"},
    ".KQ": {"exchange": "XKOS", "country": "KR", "currency_fallback": "KRW"},
    ".SR": {"exchange": "XSAU", "country": "SA", "currency_fallback": "SAR"},
    ".AE": {"exchange": "XADX", "country": "AE", "currency_fallback": "AED"},
    ".SA": {"exchange": "BVMF", "country": "BR", "currency_fallback": "BRL"},
    ".MX": {"exchange": "XMEX", "country": "MX", "currency_fallback": "MXN"},
    ".JK": {"exchange": "XIDX", "country": "ID", "currency_fallback": "IDR"},
    ".SI": {"exchange": "XSES", "country": "SG", "currency_fallback": "SGD"},
    ".VI": {"exchange": "XWBO", "country": "AT", "currency_fallback": "EUR"},
    ".IR": {"exchange": "XDUB", "country": "IE", "currency_fallback": "EUR"},
}


def _infer_listing(yticker: str) -> dict[str, str]:
    for suffix, meta in _SUFFIX_MAP.items():
        if yticker.endswith(suffix):
            return meta
    # no suffix → assume US listing
    return {"exchange": "XNAS", "country": "US", "currency_fallback": "USD"}


def _safe(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _div(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


# ─── public ticker normalisation ─────────────────────────────────────────────

def canonical_ticker(yticker: str) -> str:
    """Strip the yfinance suffix for the file/URL ticker.

    AAPL → AAPL · RELIANCE.NS → RELIANCE · 7203.T → 7203
    """
    for suffix in _SUFFIX_MAP:
        if yticker.endswith(suffix):
            return yticker[: -len(suffix)]
    return yticker


# ─── main fetch ──────────────────────────────────────────────────────────────

def fetch_company(yticker: str) -> dict[str, Any] | None:
    """Return a dict that matches schemas/company.schema.json, or None on failure."""
    t = yf.Ticker(yticker)

    try:
        info: dict[str, Any] = t.info or {}
    except Exception:  # pragma: no cover - network errors
        return None
    if not info or info.get("quoteType") not in (None, "EQUITY"):
        # Skip ETFs/funds for the company adapter
        if info.get("quoteType") and info.get("quoteType") != "EQUITY":
            return None

    listing = _infer_listing(yticker)
    currency = (info.get("financialCurrency") or info.get("currency")
                or listing["currency_fallback"]).upper()

    # Income / balance / cashflow statements (yearly). Columns are fiscal periods.
    try:
        fin = t.financials                  # income statement
        bs  = t.balance_sheet
        cf  = t.cashflow
    except Exception:  # pragma: no cover
        return None

    # 35-day daily close history → drives the sparkline + day/30d change %.
    # Keep this cheap: one call, one chart period. Fail open if blocked.
    spark: list[dict[str, Any]] = []
    day_change_pct: float | None = None
    month_change_pct: float | None = None
    try:
        h = t.history(period="40d", interval="1d", auto_adjust=False)
        if h is not None and not h.empty:
            closes = [float(c) for c in h["Close"].tolist() if c == c]  # filter NaN
            if len(closes) >= 2:
                day_change_pct = (closes[-1] - closes[-2]) / closes[-2]
            if len(closes) >= 22:  # ~30 trading days = ~21 sessions back
                base = closes[-22]
                if base:
                    month_change_pct = (closes[-1] - base) / base
            # Sparkline: last 30 closes, normalised to a compact array
            tail = closes[-30:]
            for i, c in enumerate(tail):
                spark.append({"i": i, "c": round(c, 4)})
    except Exception:
        pass

    historical: list[dict[str, Any]] = []
    if fin is not None and not fin.empty:
        # yfinance returns columns sorted newest-first; we want oldest-first.
        for col in sorted(fin.columns):
            row: dict[str, Any] = {
                "fiscalYear": col.year,
                "periodEnd":  col.date().isoformat(),
            }

            def g(df, names):
                if df is None or df.empty:
                    return None
                for n in names:
                    if n in df.index:
                        val = _safe(df.at[n, col]) if col in df.columns else None
                        if val is not None:
                            return val
                return None

            revenue          = g(fin, ["Total Revenue", "TotalRevenue"])
            cost_of_revenue  = g(fin, ["Cost Of Revenue", "CostOfRevenue", "Reconciled Cost Of Revenue"])
            operating_income = g(fin, ["Operating Income", "OperatingIncome"])
            net_income       = g(fin, ["Net Income", "Net Income Common Stockholders", "NetIncome"])
            eps              = g(fin, ["Diluted EPS", "Basic EPS", "DilutedEPS", "BasicEPS"])

            cash             = g(bs,  ["Cash And Cash Equivalents", "CashAndCashEquivalents",
                                       "Cash Cash Equivalents And Short Term Investments"])
            total_debt       = g(bs,  ["Total Debt", "TotalDebt"])
            equity           = g(bs,  ["Stockholders Equity", "StockholdersEquity",
                                       "Common Stock Equity", "CommonStockEquity"])
            shares           = g(bs,  ["Share Issued", "Ordinary Shares Number", "ShareIssued"])

            operating_cf     = g(cf,  ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities",
                                       "OperatingCashFlow"])
            capex            = g(cf,  ["Capital Expenditure", "CapitalExpenditure"])
            fcf              = (operating_cf + capex) if operating_cf is not None and capex is not None else None

            gross_profit = (revenue - cost_of_revenue) if revenue is not None and cost_of_revenue is not None else None

            row.update({
                "revenue":           revenue,
                "operatingIncome":   operating_income,
                "netIncome":         net_income,
                "eps":               eps,
                "freeCashFlow":      fcf,
                "totalDebt":         total_debt,
                "cash":              cash,
                "sharesOutstanding": shares,
                "grossMargin":       _div(gross_profit, revenue),
                "operatingMargin":   _div(operating_income, revenue),
                "netMargin":         _div(net_income, revenue),
                "roe":               _div(net_income, equity),
                "roic":              _div(operating_income,  # rough: op income / (equity + debt)
                                          (equity or 0) + (total_debt or 0) or None),
            })
            historical.append(row)

    latest = historical[-1] if historical else {}

    doc = {
        "ticker":   canonical_ticker(yticker),
        "name":     info.get("longName") or info.get("shortName") or canonical_ticker(yticker),
        "country":  listing["country"],
        "exchange": info.get("exchange") and _map_exchange(info["exchange"]) or listing["exchange"],
        "sector":   info.get("sector"),
        "industry": info.get("industry"),
        "currency": currency,
        "website":  (info.get("website") or "").strip() or None,
        "marketCap": {
            "value":    _safe(info.get("marketCap")) or 0,
            "currency": (info.get("currency") or currency).upper(),
            "asOf":     datetime.now(timezone.utc).date().isoformat(),
        },
        "price": {
            "value": _safe(
                info.get("currentPrice")
                or info.get("regularMarketPrice")
                or info.get("regularMarketPreviousClose")
                or info.get("previousClose")
            ),
            "currency": (info.get("currency") or currency).upper(),
            "asOf": datetime.now(timezone.utc).date().isoformat(),
            "dayChangePct":   day_change_pct,
            "monthChangePct": month_change_pct,
            "sparkline":      spark,
        },
        "fundamentals": {
            "revenue":           latest.get("revenue"),
            "operatingIncome":   latest.get("operatingIncome"),
            "netIncome":         latest.get("netIncome"),
            "eps":               latest.get("eps"),
            "freeCashFlow":      latest.get("freeCashFlow"),
            "totalDebt":         latest.get("totalDebt"),
            "cash":              latest.get("cash"),
            "sharesOutstanding": latest.get("sharesOutstanding") or _safe(info.get("sharesOutstanding")),
            "peRatio":           _safe(info.get("trailingPE")) or _safe(info.get("forwardPE")),
            "priceToBook":       _safe(info.get("priceToBook")),
            "dividendYield":     _safe(info.get("dividendYield")),
        },
        "ratios": {
            "roe":             latest.get("roe")  or _safe(info.get("returnOnEquity")),
            "roic":            latest.get("roic"),
            "grossMargin":     latest.get("grossMargin")     or _safe(info.get("grossMargins")),
            "operatingMargin": latest.get("operatingMargin") or _safe(info.get("operatingMargins")),
            "netMargin":       latest.get("netMargin")       or _safe(info.get("profitMargins")),
            "debtToEquity":    _safe(info.get("debtToEquity")) and _safe(info.get("debtToEquity")) / 100,
        },
        "historicalFinancials": historical,
        "meta": {
            "source":      "yfinance",
            "lastUpdated": datetime.now(timezone.utc).isoformat(),
        },
    }
    doc["tags"] = derive_tags(
        doc,
        market_cap_usd=_to_usd(doc["marketCap"]["value"], doc["marketCap"]["currency"]),
    )
    return doc


# yfinance reports exchanges like "NMS", "NYQ", "NSI", "TKS" — map to MICs where easy.
_EXCH_MAP = {
    "NMS": "XNAS", "NGM": "XNAS", "NCM": "XNAS",
    "NYQ": "XNYS", "PCX": "ARCX", "ASE": "XASE",
    "NSI": "XNSE", "BSE": "XBOM",
    "TKS": "XTKS", "JPX": "XTKS",
    "LSE": "XLON",
    "TOR": "XTSE",
    "ASX": "XASX",
}


def _map_exchange(code: str) -> str | None:
    return _EXCH_MAP.get(code.upper())
