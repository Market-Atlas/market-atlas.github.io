# MVP Scope — Project Atlas

Target: shippable in 4–8 weeks. Nothing outside this list is built pre‑launch.

## In scope

### Search
- Companies, ETFs, funds.
- Result fields: name, ticker, exchange, country, security type.
- Fully client‑side via a static `search-index.json` (MiniSearch / FlexSearch).

### Company page
**Overview** — name, ticker, country, exchange, sector, industry, market cap, currency.

**Fundamentals (annual, 10y)** — revenue, operating income, net income, EPS,
free cash flow, total debt, cash, shares outstanding.

**Ratios (10y)** — ROE, ROIC, gross margin, operating margin, net margin.

**Historical view (10y, most important section)** — revenue, earnings, FCF,
ROIC charts. Currency toggle (reporting / USD / INR / EUR / JPY / GBP).

### ETF page
- Overview: name, ticker, AUM, expense ratio.
- Top holdings.
- Sector + country allocation.

### Screener
Filters: market cap, revenue growth, ROE, ROIC, debt/equity, FCF growth,
country, sector. Runs entirely client‑side on a compact `screener.json`.

### Watchlist
- No auth.
- Browser `localStorage` only.

## Out of scope (MVP)

Real‑time quotes, intraday charts, options, futures, crypto, social feeds,
news, trading, broker integration, AI chatbot.
