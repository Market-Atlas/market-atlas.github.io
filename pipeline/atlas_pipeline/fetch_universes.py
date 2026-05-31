"""Fetch ticker universes from public sources.

- S&P 500 → Wikipedia
- Nifty 500 → Wikipedia (the NSE-maintained index)

Writes plain-text files to pipeline/universes/. yfinance suffixes are added
where needed (e.g. .NS for NSE).

Usage:
    python -m atlas_pipeline.fetch_universes              # both
    python -m atlas_pipeline.fetch_universes --only us
    python -m atlas_pipeline.fetch_universes --only in
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import requests

from .paths import ROOT

UNIVERSES_DIR = ROOT / "pipeline" / "universes"
HEADERS = {"User-Agent": "Mozilla/5.0 (atlas-pipeline; +https://example.com)"}


def _get(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.text


def _parse_wiki_table(html: str, ticker_header: str) -> list[str]:
    """Extract column values from the first wikitable that has `ticker_header`
    in its <th>. Pure-regex parsing keeps deps minimal."""
    # find each <table class="wikitable ...">…</table>
    for table in re.findall(r'<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>(.*?)</table>', html, re.S):
        headers = [re.sub(r"<.*?>", "", h).strip()
                   for h in re.findall(r"<th[^>]*>(.*?)</th>", table, re.S)]
        if not any(ticker_header.lower() in h.lower() for h in headers):
            continue
        col_idx = next(i for i, h in enumerate(headers) if ticker_header.lower() in h.lower())
        tickers: list[str] = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if col_idx >= len(cells):
                continue
            cell_text = re.sub(r"<.*?>", "", cells[col_idx])
            tickers.append(cell_text.strip())
        if tickers:
            return tickers
    return []


def fetch_sp500() -> list[str]:
    html = _get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
    raw = _parse_wiki_table(html, "Symbol")
    # Wikipedia uses '.' (e.g. BRK.B) — yfinance wants '-'.
    cleaned = []
    for t in raw:
        t = t.replace(".", "-").strip()
        if t and re.match(r"^[A-Z0-9\-]+$", t):
            cleaned.append(t)
    return sorted(set(cleaned))


def fetch_nifty500() -> list[str]:
    # Direct CSV from NSE archives — most reliable.
    url = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
    try:
        text = _get(url)
        tickers = []
        for line in text.splitlines()[1:]:  # skip header
            parts = [p.strip().strip('"') for p in line.split(",")]
            if len(parts) >= 3:
                # Columns: Company Name, Industry, Symbol, …
                sym = parts[2]
                if sym and re.match(r"^[A-Z0-9&\-]+$", sym):
                    tickers.append(f"{sym}.NS")
        if tickers:
            return sorted(set(tickers))
    except Exception as e:
        print(f"  NSE CSV failed ({e}), falling back to Wikipedia…", file=sys.stderr)

    # Fallback: Wikipedia (less reliable but no auth required)
    html = _get("https://en.wikipedia.org/wiki/NIFTY_500")
    raw = _parse_wiki_table(html, "Symbol")
    cleaned = []
    for t in raw:
        t = t.strip()
        if re.match(r"^[A-Z0-9&\-]+$", t):
            cleaned.append(f"{t}.NS")
    return sorted(set(cleaned))


def _wiki_tickers(url: str, header: str, suffix: str, sanitize=lambda s: s) -> list[str]:
    html = _get(url)
    raw = _parse_wiki_table(html, header)
    out: list[str] = []
    for t in raw:
        t = sanitize(t.strip())
        if not t:
            continue
        # Strip pre-existing exchange suffix so we don't end up with FOO.PA.PA
        if "." in t:
            base, _, _ = t.rpartition(".")
            if base and re.match(r"^[A-Z0-9\-]+$", base):
                t = base
        if re.match(r"^[A-Z0-9\-]+$", t):
            out.append(f"{t}{suffix}")
    return sorted(set(out))


def fetch_nikkei225() -> list[str]:
    # Wikipedia table header is "Code"
    html = _get("https://en.wikipedia.org/wiki/Nikkei_225")
    raw = _parse_wiki_table(html, "Code")
    out = []
    for t in raw:
        t = t.strip()
        if re.match(r"^[0-9]{4,5}$", t):
            out.append(f"{t}.T")
    return sorted(set(out))


def fetch_ftse100() -> list[str]:
    # EPIC column on the constituents table
    return _wiki_tickers(
        "https://en.wikipedia.org/wiki/FTSE_100_Index",
        "Ticker",
        ".L",
        sanitize=lambda s: s.replace(".", "-"),  # e.g. BT.A -> BT-A (rare)
    )


def fetch_dax40() -> list[str]:
    return _wiki_tickers("https://en.wikipedia.org/wiki/DAX", "Ticker", ".DE")


def fetch_cac40() -> list[str]:
    return _wiki_tickers("https://en.wikipedia.org/wiki/CAC_40", "Ticker", ".PA")


def fetch_tsx60() -> list[str]:
    return _wiki_tickers(
        "https://en.wikipedia.org/wiki/S%26P/TSX_60",
        "Symbol",
        ".TO",
        sanitize=lambda s: s.replace(".", "-"),
    )


def fetch_hsi() -> list[str]:
    # Hang Seng Index — codes are 4-5 digit numbers, need .HK and zero-padding to 4.
    html = _get("https://en.wikipedia.org/wiki/Hang_Seng_Index")
    raw = _parse_wiki_table(html, "Ticker")
    out = []
    for t in raw:
        digits = "".join(c for c in t if c.isdigit())
        if digits:
            out.append(f"{int(digits):04d}.HK")
    return sorted(set(out))


def fetch_kospi200() -> list[str]:
    """KOSPI 200 from Wikipedia. Codes are 6-digit numbers → .KS."""
    html = _get("https://en.wikipedia.org/wiki/KOSPI_200")
    raw = _parse_wiki_table(html, "Ticker")
    out: list[str] = []
    for t in raw:
        digits = "".join(c for c in t if c.isdigit())
        if len(digits) >= 5:
            out.append(f"{digits.zfill(6)}.KS")
    return sorted(set(out))


def fetch_taiwan50() -> list[str]:
    """FTSE TWSE Taiwan 50 — covers TSMC, MediaTek, Foxconn, etc."""
    html = _get("https://en.wikipedia.org/wiki/FTSE_TWSE_Taiwan_50_Index")
    raw = _parse_wiki_table(html, "Ticker")
    out: list[str] = []
    for t in raw:
        digits = "".join(c for c in t if c.isdigit())
        if len(digits) >= 4:
            out.append(f"{digits}.TW")
    return sorted(set(out))


def fetch_csi300() -> list[str]:
    """CSI 300 — top 300 Shanghai + Shenzhen A-shares.
    Wikipedia table uses 6-digit codes with city prefix (e.g. 'SH 600000').
    Map prefixes to yfinance suffixes (.SS for Shanghai, .SZ for Shenzhen).
    """
    html = _get("https://en.wikipedia.org/wiki/CSI_300_Index")
    out: list[str] = []
    for table in re.findall(r'<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>(.*?)</table>', html, re.S):
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
            txt = re.sub(r"<.*?>", " ", row)
            m = re.search(r"\b(SH|SZ)\s*([0-9]{6})\b", txt)
            if m:
                pref, digits = m.group(1), m.group(2)
                suf = ".SS" if pref == "SH" else ".SZ"
                out.append(f"{digits}{suf}")
            else:
                # bare 6-digit code: 60xxxx/68xxxx→SH; 00xxxx/30xxxx→SZ
                m2 = re.search(r"\b([036][0-9]{5})\b", txt)
                if m2:
                    code = m2.group(1)
                    if code.startswith(("60", "68")):
                        out.append(f"{code}.SS")
                    elif code.startswith(("00", "30")):
                        out.append(f"{code}.SZ")
    return sorted(set(out))


def fetch_eu() -> list[str]:
    """Combined large-cap Europe: FTSE 100 + DAX 40 + CAC 40."""
    out: set[str] = set()
    for fn in (fetch_ftse100, fetch_dax40, fetch_cac40):
        try:
            out.update(fn())
        except Exception as e:
            print(f"  {fn.__name__} failed: {e}", file=sys.stderr)
    return sorted(out)


def fetch_megacap() -> list[str]:
    """Hand-curated top-200 global mega-caps (companiesmarketcap.com).

    Used as a guaranteed-coverage layer so that even if a sector index misses
    a giant, we still ingest it. Names cover Saudi Aramco, Samsung, TSMC,
    Vale, Petrobras, etc. that wouldn't be picked up by S&P 500 / Nikkei /
    FTSE-DAX-CAC alone.
    """
    return sorted({
        # United States — covered by S&P 500 but listed for completeness
        "NVDA", "AAPL", "GOOG", "MSFT", "AMZN", "AVGO", "TSLA", "META",
        "MU", "BRK-B", "LLY", "WMT", "AMD", "JPM", "ORCL", "V", "XOM",
        "INTC", "JNJ", "MA", "COST", "CAT", "LRCX", "ABBV", "PLTR", "BAC",
        "CVX", "NFLX", "AMAT", "UNH", "KO", "GE", "PG", "MS", "HD", "GS",
        "MRK", "IBM", "TXN", "PM", "DELL", "QCOM", "GEV", "KLAC", "SNDK",
        "RTX", "WFC", "PANW", "AXP", "C", "APP", "TMUS", "ADI", "ANET",
        "VZ", "MCD", "STX", "PEP", "CSCO", "ABT", "DIS", "ACN", "BLK",
        "BX", "ARM",
        # Taiwan
        "TSM", "2454.TW", "2308.TW", "2317.TW", "2330.TW", "1303.TW",
        # South Korea
        "005930.KS", "000660.KS", "035420.KS", "005380.KS", "207940.KS",
        "051910.KS", "068270.KS",
        # Saudi Arabia
        "2222.SR", "1120.SR", "1180.SR", "7010.SR",
        # UAE
        "IHC.AE",
        # Mainland China (Shanghai / Shenzhen A-shares)
        "601939.SS", "601288.SS", "601398.SS", "601988.SS", "601138.SS",
        "600519.SS", "300750.SZ", "601628.SS", "600036.SS", "601318.SS",
        "601857.SS", "601088.SS",
        # Hong Kong listings (China)
        "0700.HK", "1398.HK", "0941.HK", "0857.HK", "3690.HK", "9988.HK",
        "0939.HK", "1288.HK", "9618.HK", "2318.HK",
        # ADRs of Chinese tech
        "BABA", "TCEHY", "JD", "PDD", "BIDU", "NTES",
        # Europe (large-caps not always in FTSE/DAX/CAC)
        "RO.SW", "NESN.SW", "NOVN.SW", "UBSG.SW", "ZURN.SW", "ABBN.SW",
        "MC.PA", "OR.PA", "RMS.PA", "TTE.PA", "SAN.PA", "AIR.PA", "BNP.PA",
        "SIE.DE", "SAP.DE", "ALV.DE", "DTE.DE",
        "ASML.AS", "PRX.AS", "AD.AS", "INGA.AS",
        "NVO", "MAERSK-B.CO",
        "AZN.L", "HSBA.L", "ULVR.L", "BP.L", "SHEL.L", "BARC.L",
        "ENI.MI", "ISP.MI", "G.MI",
        "ITX.MC", "SAN.MC", "BBVA.MC",
        "VOLV-B.ST", "INVE-B.ST", "ATCO-A.ST",
        "EQNR.OL",
        # Japan (Nikkei covers most, list giants for safety)
        "7203.T", "9984.T", "8306.T", "6758.T", "9432.T", "7974.T",
        "8035.T", "6861.T", "6098.T",
        # India (Nifty covers, list giants)
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
        "HINDUNILVR.NS", "BHARTIARTL.NS", "ITC.NS", "SBIN.NS", "LT.NS",
        # Canada
        "RY.TO", "TD.TO", "ENB.TO", "SHOP.TO", "BNS.TO", "CNQ.TO",
        # Australia
        "BHP.AX", "CBA.AX", "CSL.AX", "WBC.AX", "NAB.AX", "WOW.AX",
        # Brazil
        "VALE", "PBR", "ITUB", "BBD", "BBDC4.SA", "ITUB4.SA",
        "PETR4.SA", "VALE3.SA", "ABEV3.SA", "WEGE3.SA",
        # Mexico
        "AMX", "FMX", "WALMEX.MX", "GFNORTEO.MX", "AMXB.MX",
        # Indonesia (Bank Central Asia, Telkom)
        "BBCA.JK", "TLKM.JK", "BMRI.JK",
        # Singapore
        "D05.SI", "O39.SI", "U11.SI",
    })


def write_universe(name: str, tickers: list[str], comment: str) -> None:
    UNIVERSES_DIR.mkdir(parents=True, exist_ok=True)
    path = UNIVERSES_DIR / f"{name}.txt"
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# {comment}\n")
        f.write(f"# {len(tickers)} tickers, auto-generated by fetch_universes.py\n")
        for t in tickers:
            f.write(t + "\n")
    print(f"  wrote {path} ({len(tickers)} tickers)")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--only", choices=["us", "in", "jp", "eu", "ca", "cn", "kr", "tw", "cnA", "megacap"], default=None)
    args = p.parse_args(argv)

    targets = {
        "us": ("S&P 500 (Wikipedia)",                 fetch_sp500),
        "in": ("Nifty 500 (NSE archives)",            fetch_nifty500),
        "jp": ("Nikkei 225 (Wikipedia)",              fetch_nikkei225),
        "eu": ("FTSE 100 + DAX 40 + CAC 40 (Wikipedia)", fetch_eu),
        "ca": ("S&P/TSX 60 (Wikipedia)",              fetch_tsx60),
        "cn": ("Hang Seng Index (Wikipedia)",         fetch_hsi),
        "kr": ("KOSPI 200 (Wikipedia)",               fetch_kospi200),
        "tw": ("FTSE TWSE Taiwan 50 (Wikipedia)",     fetch_taiwan50),
        "cnA": ("CSI 300 Shanghai+Shenzhen (Wikipedia)", fetch_csi300),
        "megacap": ("Curated global top-200 mega-caps", fetch_megacap),
    }

    names = [args.only] if args.only else list(targets.keys())
    for name in names:
        label, fn = targets[name]
        print(f"Fetching {label}…")
        try:
            tickers = fn()
        except Exception as e:
            print(f"  ✗ failed: {e}", file=sys.stderr)
            continue
        write_universe(name, tickers, label)
    return 0


if __name__ == "__main__":
    sys.exit(main())
