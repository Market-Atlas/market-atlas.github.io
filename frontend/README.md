# Atlas frontend (Next.js 14, App Router, static export)

```bash
# 0. From repo root, generate JSON artifacts first
( cd ../pipeline && python -m atlas_pipeline.build )

# 1. Install + mirror data into public/
npm install
npm run sync-data

# 2. Dev
npm run dev          # http://localhost:3000

# 3. Static build → ./out (deployable to GitHub Pages / Cloudflare Pages / S3)
npm run build
```

Routes:

| Path                  | Purpose                                                 |
|-----------------------|---------------------------------------------------------|
| `/`                   | Hero + client-side fuzzy search                         |
| `/company/[ticker]/`  | 10y fundamentals, KPI cards, currency-toggleable charts |
| `/etf/[ticker]/`      | AUM, fees, top holdings, sector/country allocation      |
| `/screener/`          | Client-side filtering on `screener.json`                |
| `/watchlist/`         | `localStorage`-only watchlist (no auth)                 |

## Deploying under a subpath (GitHub Pages)

```bash
NEXT_PUBLIC_BASE_PATH=/Market_screener npm run build
```

`next.config.js` reads `NEXT_PUBLIC_BASE_PATH`. The GitHub Actions workflow at
`.github/workflows/deploy.yml` sets it automatically to `/<repo-name>`.
