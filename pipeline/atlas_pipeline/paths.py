"""Shared path constants for the pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
COMPANIES_DIR = DATA_DIR / "companies"
ETFS_DIR = DATA_DIR / "etfs"
FUNDS_DIR = DATA_DIR / "funds"
FX_DIR = DATA_DIR / "fx"
SCHEMAS_DIR = ROOT / "schemas"

SEARCH_INDEX_PATH = DATA_DIR / "search-index.json"
SCREENER_PATH = DATA_DIR / "screener.json"
