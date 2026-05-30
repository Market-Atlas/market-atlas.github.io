"""Compute which universe tickers don't yet have a data/companies/*.json file.
Useful for retrying after a rate-limited ingest run.
"""
from pathlib import Path
import sys, re

ROOT = Path(__file__).resolve().parents[2]
UNIVERSES = ROOT / "pipeline" / "universes"
COMPANIES = ROOT / "data" / "companies"

SUFFIXES = (".NS", ".BO", ".T", ".L", ".TO", ".AX")

def canonical(t: str) -> str:
    for s in SUFFIXES:
        if t.endswith(s):
            return t[: -len(s)]
    return t

existing = {p.stem for p in COMPANIES.glob("*.json")}
missing: list[str] = []
for name in (sys.argv[1:] or ["us", "in"]):
    for line in (UNIVERSES / f"{name}.txt").read_text().splitlines():
        s = line.split("#", 1)[0].strip()
        if s and canonical(s) not in existing:
            missing.append(s)

print(",".join(missing))
