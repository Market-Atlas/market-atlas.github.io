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


def fetch_eu() -> list[str]:
    """Combined large-cap Europe: FTSE 100 + DAX 40 + CAC 40."""
    out: set[str] = set()
    for fn in (fetch_ftse100, fetch_dax40, fetch_cac40):
        try:
            out.update(fn())
        except Exception as e:
            print(f"  {fn.__name__} failed: {e}", file=sys.stderr)
    return sorted(out)


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
    p.add_argument("--only", choices=["us", "in", "jp", "eu", "ca", "cn"], default=None)
    args = p.parse_args(argv)

    targets = {
        "us": ("S&P 500 (Wikipedia)",                 fetch_sp500),
        "in": ("Nifty 500 (NSE archives)",            fetch_nifty500),
        "jp": ("Nikkei 225 (Wikipedia)",              fetch_nikkei225),
        "eu": ("FTSE 100 + DAX 40 + CAC 40 (Wikipedia)", fetch_eu),
        "ca": ("S&P/TSX 60 (Wikipedia)",              fetch_tsx60),
        "cn": ("Hang Seng Index (Wikipedia)",         fetch_hsi),
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
