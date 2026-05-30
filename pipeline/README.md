# Atlas data pipeline

Responsibilities:

1. **Fetch** source data (SEC EDGAR for US, NSE/BSE filings for IN, EDINET for
   JP, …). MVP ships with hand-curated sample JSON files in `data/companies/`.
2. **Normalize** to the canonical schema in `schemas/company.schema.json`.
3. **Validate** every file against the schema. Bad data fails the build.
4. **Build derived artifacts** the frontend consumes:
   - `data/search-index.json`  — all securities, for client-side search.
   - `data/screener.json`      — flat array used by the screener page.
5. **Trigger deployment** (GitHub Actions does this on push).

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ingest.txt   # yfinance, for live ingestion

# Ingest the US + India universes (~100 tickers) via yfinance.
python -m atlas_pipeline.ingest --universe us,in --workers 6

# Or refresh just a few:
python -m atlas_pipeline.ingest --tickers AAPL,MSFT,RELIANCE.NS

# Validate + rebuild derived artifacts (search index, screener, peers)
python -m atlas_pipeline.build

# Add --strict to fail on any schema violation
python -m atlas_pipeline.build --strict
```

Ticker universes live under `pipeline/universes/*.txt` — one ticker per line,
`#` for comments. Add `<TICKER>.NS` for NSE India, `<TICKER>.T` for Japan, etc.

## Adding a new company adapter

Adapters live under `atlas_pipeline/adapters/`. Each adapter must return a dict
that matches `schemas/company.schema.json`. The orchestrator handles
validation, writing to `data/companies/<TICKER>.json`, and index rebuilds.

## Design rules

- **Never** convert reporting currency at ingest time. Store JPY as JPY.
- FX rates live in `data/fx/latest.json` and are applied **only** in the UI.
- Every file gets a `meta.lastUpdated` timestamp.
