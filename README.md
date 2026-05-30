# Project Atlas

> The best free research platform for long‑term investors.

Atlas is **not** a trading platform, brokerage, charting terminal, or real‑time
market tool. It exists to help an investor — anywhere in the world — understand
a company, ETF, or fund in minutes, using **10+ years of fundamentals** stored
in the original reporting currency.

## Principles

1. **Investor first.** Every feature must help long‑term decisions.
2. **Data before design.** The dataset is the moat.
3. **Static and cheap.** Static pages, nightly JSON refresh, CDN delivery.
4. **Original data always preserved.** Toyota in JPY, Nestlé in CHF, Reliance
   in INR. USD/EUR/etc. are *derived*.
5. **Build what we personally use.**

## Repository Layout

```
.
├── frontend/        # Next.js + TypeScript + Tailwind (static export)
├── pipeline/        # Python data ingestion → JSON
├── data/            # Source-of-truth JSON the frontend consumes
│   ├── companies/
│   ├── etfs/
│   ├── funds/
│   ├── fx/          # FX rate snapshots for derived currency views
│   └── search-index.json
├── schemas/         # JSON Schemas for company / etf / fund
└── .github/workflows/   # nightly pipeline + Pages deploy
```

## MVP scope

See [`docs/MVP.md`](docs/MVP.md). Anything not listed is out of scope until
launch.

## Quick start

```bash
# 1. Generate / refresh the dataset
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m atlas_pipeline.build --sample   # uses bundled sample data

# 2. Run the frontend
cd ../frontend
npm install
npm run dev
```

Open <http://localhost:3000>. Search for `MSFT`, `AAPL`, `7203` (Toyota), or
`RELIANCE` and you should see 10 years of fundamentals in the company's
reporting currency, with a USD/INR/EUR toggle.

## Geography roadmap

| Phase | Markets                                |
|-------|-----------------------------------------|
| 1     | United States                           |
| 2     | India                                   |
| 3     | Japan, UK, Europe, Canada, Australia    |
| 4     | Broad global                            |

## Success criteria

The MVP is successful when:

1. We personally use it weekly.
2. We stop relying on multiple sites for basic research.
3. We can research a company in < 5 minutes.
4. Infrastructure stays free (GitHub Pages + free APIs).
5. 20–50 investors use it voluntarily.
