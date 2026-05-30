"""SEC EDGAR adapter for US-listed companies.

Stub. Implementation plan:

1. Resolve ticker -> CIK via https://www.sec.gov/files/company_tickers.json
2. Pull company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK<10-digit>.json
3. Map US-GAAP concepts to canonical fields:
     Revenues / SalesRevenueNet      -> revenue
     OperatingIncomeLoss             -> operatingIncome
     NetIncomeLoss                   -> netIncome
     EarningsPerShareDiluted         -> eps
     NetCashProvidedByOperating      -> (FCF = OCF - CapEx)
     PaymentsToAcquirePPE            ->     capex
     LongTermDebt + ShortTermDebt    -> totalDebt
     CashAndCashEquivalentsAtCarryingValue -> cash
     CommonStockSharesOutstanding    -> sharesOutstanding
4. Always store in USD (the reporting currency for US issuers). Never convert.
5. Return a dict matching schemas/company.schema.json.

Respect SEC's fair-access guidelines: set a descriptive User-Agent and cap to
~10 req/s.
"""
from __future__ import annotations

from typing import Any


def fetch(ticker: str) -> dict[str, Any]:  # pragma: no cover - not yet implemented
    raise NotImplementedError(
        "SEC EDGAR adapter not yet implemented. "
        "MVP uses curated sample JSON in data/companies/."
    )
