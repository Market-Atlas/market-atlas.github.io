"""yfinance → canonical company schema.

yfinance is free, covers US + India (suffix `.NS` for NSE, `.BO` for BSE),
Japan (`.T`), UK (`.L`), Europe, Canada, Australia. Perfect for bootstrapping.
We keep all values in the company's reporting currency — never convert.
"""
from __future__ import annotations

import math
import random
import time
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

    # `info` is the gate. Yahoo aggressively rate-limits when too many parallel
    # callers hit it; retry a few times with jittered backoff so transient 429s
    # don't show up as 'empty' in the summary.
    info: dict[str, Any] = {}
    for attempt in range(4):
        try:
            info = t.info or {}
            if info:
                break
        except Exception:
            info = {}
        # 1.5s, 3s, 6s — plus per-thread jitter to avoid all workers retrying in lockstep
        time.sleep(1.5 * (2 ** attempt) + random.uniform(0, 0.5))
    if not info:
        return None
    if info.get("quoteType") not in (None, "EQUITY"):
        # Skip ETFs/funds for the company adapter
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

    # Quarterly statements drive the screener.in-style "last 8 quarters" table.
    # Each is a separate yfinance call; fail open if any individual one is blocked.
    qfin = qbs = qcf = None
    try:
        qfin = t.quarterly_financials
    except Exception:
        pass
    try:
        qbs = t.quarterly_balance_sheet
    except Exception:
        pass
    try:
        qcf = t.quarterly_cashflow
    except Exception:
        pass

    # Major / institutional / mutual-fund holders.
    # yfinance returns DataFrames; convert to plain JSON-safe rows or empty list.
    inst_holders: list[dict[str, Any]] = []
    fund_holders: list[dict[str, Any]] = []
    major_holders: dict[str, Any] = {}
    try:
        ih = t.institutional_holders
        if ih is not None and not ih.empty:
            for _, row in ih.head(15).iterrows():
                d = row.to_dict()
                inst_holders.append({
                    "holder":     str(d.get("Holder", "")),
                    "shares":     _safe(d.get("Shares")),
                    "pctOut":     _safe(d.get("pctHeld")) or _safe(d.get("% Out")),
                    "value":      _safe(d.get("Value")),
                    "reportDate": str(d.get("Date Reported", "")) or None,
                })
    except Exception:
        pass
    try:
        mh = t.mutualfund_holders
        if mh is not None and not mh.empty:
            for _, row in mh.head(10).iterrows():
                d = row.to_dict()
                fund_holders.append({
                    "holder":     str(d.get("Holder", "")),
                    "shares":     _safe(d.get("Shares")),
                    "pctOut":     _safe(d.get("pctHeld")) or _safe(d.get("% Out")),
                    "value":      _safe(d.get("Value")),
                    "reportDate": str(d.get("Date Reported", "")) or None,
                })
    except Exception:
        pass
    try:
        # `major_holders` ships in one of two DataFrame shapes depending on
        # yfinance version + region:
        #   (a) 2-col row table: ["0.07%", "% of Shares Held by All Insider"]
        #   (b) keyed single-row table:
        #       index=['insidersPercentHeld','institutionsPercentHeld', ...]
        #       column=['Value']                          (← used for IN, EU)
        # We parse both, then fall back to fields on `info` so even when the
        # DataFrame is empty, Indian / European tickers still get the summary
        # (insider% maps to promoter holding in NSE terms).
        mj = t.major_holders
        if mj is not None and not mj.empty:
            cols = [str(c).lower() for c in mj.columns]
            idx_strs = [str(i).lower() for i in mj.index]
            if "value" in cols and any("insider" in i for i in idx_strs):
                # Shape (b): single 'Value' column keyed by metric name
                for idx, v in mj["Value"].items():
                    name = str(idx).lower()
                    if v is None or (isinstance(v, float) and v != v):  # NaN
                        continue
                    pretty = f"{float(v) * 100:.2f}%" if isinstance(v, (int, float)) and abs(v) <= 1 else str(v)
                    if   "insider" in name:                             major_holders["insidersPct"] = pretty
                    elif "institutionsfloat" in name or ("institution" in name and "float" in name):
                        major_holders["institutionsFloatPct"] = pretty
                    elif "institutionscount" in name or "number" in name:
                        major_holders["institutionsCount"] = str(int(float(v))) if isinstance(v, (int, float)) else str(v)
                    elif "institution" in name:                         major_holders["institutionsPct"] = pretty
            else:
                # Shape (a): label + value rows
                for _, row in mj.iterrows():
                    vals = row.tolist()
                    if len(vals) >= 2:
                        label = str(vals[1]).strip().lower()
                        val   = str(vals[0]).strip()
                        if   "insider" in label:                       major_holders["insidersPct"] = val
                        elif "institution" in label and "float" not in label:
                            major_holders["institutionsPct"] = val
                        elif "float" in label:                         major_holders["institutionsFloatPct"] = val
                        elif "number of institutions" in label:        major_holders["institutionsCount"] = val
    except Exception:
        pass

    # Fallback: pull the same numbers from `info` when the DataFrame parse
    # didn't yield them. yfinance exposes these as decimals (0–1).
    def _pct(v):
        v = _safe(v)
        if v is None: return None
        return f"{v * 100:.2f}%"
    major_holders.setdefault("insidersPct",          _pct(info.get("heldPercentInsiders"))     or "")
    major_holders.setdefault("institutionsPct",      _pct(info.get("heldPercentInstitutions")) or "")
    # floatShares / sharesOutstanding → institutions-of-float ratio
    fl = _safe(info.get("floatShares")); so = _safe(info.get("sharesOutstanding"))
    if fl and so and so > 0:
        major_holders.setdefault("institutionsFloatPct", f"{(fl / so) * 100:.2f}%")
    # Drop empty placeholders we set above
    major_holders = {k: v for k, v in major_holders.items() if v}

    # 35-day daily close history → drives the sparkline + day/30d change %.
    # Keep this cheap: one call, one chart period. Fail open if blocked.
    spark: list[dict[str, Any]] = []
    day_change_pct: float | None = None
    month_change_pct: float | None = None
    price_history: list[dict[str, Any]] = []
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

    # 5-year weekly close history → drives the interactive price chart
    # (1Y / 5Y / Max). Weekly granularity caps each company's JSON at ~10KB
    # of price data. Fail open if blocked.
    try:
        h5 = t.history(period="5y", interval="1wk", auto_adjust=True)
        if h5 is not None and not h5.empty:
            for ts, row in h5.iterrows():
                close = row.get("Close")
                if close is None or close != close:  # NaN guard
                    continue
                price_history.append({
                    "d": ts.date().isoformat(),
                    "c": round(float(close), 4),
                })
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
            interest_expense = g(fin, ["Interest Expense", "InterestExpense"])
            depreciation     = g(fin, ["Reconciled Depreciation", "Depreciation And Amortization",
                                       "DepreciationAndAmortization"])
            tax_provision    = g(fin, ["Tax Provision", "TaxProvision",
                                       "Income Tax Expense", "IncomeTaxExpense"])
            pretax_income    = g(fin, ["Pretax Income", "PretaxIncome", "Income Before Tax"])

            cash             = g(bs,  ["Cash And Cash Equivalents", "CashAndCashEquivalents",
                                       "Cash Cash Equivalents And Short Term Investments"])
            total_debt       = g(bs,  ["Total Debt", "TotalDebt"])
            equity           = g(bs,  ["Stockholders Equity", "StockholdersEquity",
                                       "Common Stock Equity", "CommonStockEquity"])
            shares           = g(bs,  ["Share Issued", "Ordinary Shares Number", "ShareIssued"])
            receivables      = g(bs,  ["Accounts Receivable", "AccountsReceivable",
                                       "Gross Accounts Receivable", "Net Receivables"])
            inventory        = g(bs,  ["Inventory", "Inventories"])
            payables         = g(bs,  ["Accounts Payable", "AccountsPayable"])

            operating_cf     = g(cf,  ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities",
                                       "OperatingCashFlow"])
            investing_cf     = g(cf,  ["Investing Cash Flow", "Cash Flow From Continuing Investing Activities",
                                       "InvestingCashFlow"])
            financing_cf     = g(cf,  ["Financing Cash Flow", "Cash Flow From Continuing Financing Activities",
                                       "FinancingCashFlow"])
            capex            = g(cf,  ["Capital Expenditure", "CapitalExpenditure"])
            dividends_paid   = g(cf,  ["Cash Dividends Paid", "CashDividendsPaid",
                                       "Common Stock Dividend Paid"])
            stock_buyback    = g(cf,  ["Repurchase Of Capital Stock", "RepurchaseOfCapitalStock",
                                       "Common Stock Payments", "CommonStockPayments"])
            debt_issued      = g(cf,  ["Issuance Of Debt", "IssuanceOfDebt",
                                       "Long Term Debt Issuance", "LongTermDebtIssuance"])
            debt_repaid      = g(cf,  ["Repayment Of Debt", "RepaymentOfDebt",
                                       "Long Term Debt Payments", "LongTermDebtPayments"])
            fcf              = (operating_cf + capex) if operating_cf is not None and capex is not None else None

            gross_profit = (revenue - cost_of_revenue) if revenue is not None and cost_of_revenue is not None else None

            row.update({
                "revenue":           revenue,
                "operatingIncome":   operating_income,
                "netIncome":         net_income,
                "eps":               eps,
                "freeCashFlow":      fcf,
                "operatingCashFlow": operating_cf,
                "investingCashFlow": investing_cf,
                "financingCashFlow": financing_cf,
                "capex":             capex,
                "dividendsPaid":     dividends_paid,
                "stockBuyback":      stock_buyback,
                "debtIssued":        debt_issued,
                "debtRepaid":        debt_repaid,
                "interestExpense":   interest_expense,
                "depreciation":      depreciation,
                "taxProvision":      tax_provision,
                "pretaxIncome":      pretax_income,
                "totalDebt":         total_debt,
                "cash":              cash,
                "accountsReceivable": receivables,
                "inventory":          inventory,
                "accountsPayable":    payables,
                "sharesOutstanding": shares,
                "grossMargin":       _div(gross_profit, revenue),
                "operatingMargin":   _div(operating_income, revenue),
                "netMargin":         _div(net_income, revenue),
                "roe":               _div(net_income, equity),
                "roic":              _div(operating_income,  # rough: op income / (equity + debt)
                                          (equity or 0) + (total_debt or 0) or None),
            })
            historical.append(row)

    # Quarterly P&L (last 8 quarters max). Compact: just the columns the UI shows.
    quarterly: list[dict[str, Any]] = []
    if qfin is not None and not qfin.empty:
        cols = sorted(qfin.columns)[-8:]  # newest 8, oldest-first
        for col in cols:
            def qg(df, names):
                if df is None or df.empty:
                    return None
                for n in names:
                    if n in df.index and col in df.columns:
                        v = _safe(df.at[n, col])
                        if v is not None:
                            return v
                return None
            q_revenue = qg(qfin, ["Total Revenue", "TotalRevenue"])
            q_op      = qg(qfin, ["Operating Income", "OperatingIncome"])
            q_ni      = qg(qfin, ["Net Income", "Net Income Common Stockholders", "NetIncome"])
            q_eps     = qg(qfin, ["Diluted EPS", "Basic EPS", "DilutedEPS", "BasicEPS"])
            q_int     = qg(qfin, ["Interest Expense", "InterestExpense"])
            q_dep     = qg(qfin, ["Reconciled Depreciation", "Depreciation And Amortization"])
            q_tax     = qg(qfin, ["Tax Provision", "TaxProvision", "Income Tax Expense"])
            q_pbt     = qg(qfin, ["Pretax Income", "PretaxIncome", "Income Before Tax"])
            q_ocf     = qg(qcf, ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"])
            quarterly.append({
                "periodEnd":         col.date().isoformat(),
                "revenue":           q_revenue,
                "operatingIncome":   q_op,
                "operatingMargin":   _div(q_op, q_revenue),
                "interestExpense":   q_int,
                "depreciation":      q_dep,
                "pretaxIncome":      q_pbt,
                "taxProvision":      q_tax,
                "taxRate":           _div(q_tax, q_pbt),
                "netIncome":         q_ni,
                "netMargin":         _div(q_ni, q_revenue),
                "eps":               q_eps,
                "operatingCashFlow": q_ocf,
            })

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
        "description":  (info.get("longBusinessSummary") or info.get("description") or "").strip() or None,
        "employees":    _safe(info.get("fullTimeEmployees")),
        "headquarters": ", ".join(x for x in [info.get("city"), info.get("state"), info.get("country")] if x) or None,
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
            "history":        price_history,
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
        "quarterlyFinancials":  quarterly,
        "holders": {
            "summary":       major_holders,
            "institutional": inst_holders,
            "mutualFund":    fund_holders,
        },
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
