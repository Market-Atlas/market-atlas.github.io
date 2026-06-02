// Mirror of schemas/company.schema.json and schemas/etf.schema.json.
// Keep in sync when the schema changes (schema changes require discussion).

export type Currency = string; // ISO 4217

export interface MoneyAt {
  value: number;
  currency: Currency;
  asOf: string;
}

export interface Fundamentals {
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  freeCashFlow: number | null;
  totalDebt: number | null;
  cash: number | null;
  sharesOutstanding: number | null;
  peRatio?: number | null;
  priceToBook?: number | null;
  dividendYield?: number | null;
}

export interface Ratios {
  roe: number | null;
  roic: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  debtToEquity?: number | null;
}

export interface HistoricalYear extends Partial<Fundamentals>, Partial<Ratios> {
  fiscalYear: number;
  periodEnd?: string;
  operatingCashFlow?: number | null;
  investingCashFlow?: number | null;
  financingCashFlow?: number | null;
  capex?: number | null;
  dividendsPaid?: number | null;
  interestExpense?: number | null;
  depreciation?: number | null;
  taxProvision?: number | null;
  pretaxIncome?: number | null;
  accountsReceivable?: number | null;
  inventory?: number | null;
  accountsPayable?: number | null;
}

export interface QuarterlyRow {
  periodEnd: string;
  revenue?: number | null;
  operatingIncome?: number | null;
  operatingMargin?: number | null;
  interestExpense?: number | null;
  depreciation?: number | null;
  pretaxIncome?: number | null;
  taxProvision?: number | null;
  taxRate?: number | null;
  netIncome?: number | null;
  netMargin?: number | null;
  eps?: number | null;
  operatingCashFlow?: number | null;
}

export interface HolderRow {
  holder: string;
  shares?: number | null;
  pctOut?: number | null;
  value?: number | null;
  reportDate?: string | null;
}

export interface Holders {
  summary?: {
    insidersPct?: string;
    institutionsPct?: string;
    institutionsFloatPct?: string;
    institutionsCount?: string;
  };
  institutional?: HolderRow[];
  mutualFund?: HolderRow[];
}

export interface Company {
  ticker: string;
  name: string;
  country: string;
  exchange: string;
  sector?: string;
  industry?: string;
  currency: Currency;
  website?: string | null;
  description?: string | null;
  employees?: number | null;
  headquarters?: string | null;
  tags?: string[];
  marketCap?: MoneyAt;
  price?: { value: number | null; currency: Currency; asOf: string };
  fundamentals: Fundamentals;
  ratios: Ratios;
  historicalFinancials: HistoricalYear[];
  quarterlyFinancials?: QuarterlyRow[];
  holders?: Holders;
  meta?: { source?: string; lastUpdated?: string };
}

export interface Holding {
  ticker: string;
  name?: string;
  weight: number;
}

export interface ETF {
  ticker: string;
  name: string;
  exchange?: string;
  country?: string;
  currency: Currency;
  aum?: number | null;
  expenseRatio?: number | null;
  topHoldings?: Holding[];
  sectorAllocation?: Record<string, number>;
  countryAllocation?: Record<string, number>;
  meta?: { source?: string; lastUpdated?: string };
}

export interface SearchHit {
  type: 'company' | 'etf' | 'fund';
  ticker: string;
  name: string;
  exchange?: string;
  country?: string;
  sector?: string;
  currency?: Currency;
  domain?: string | null;
}

export interface ScreenerRow {
  ticker: string;
  name: string;
  country?: string;
  sector?: string;
  currency?: Currency;
  domain?: string | null;
  tags?: string[];
  aliases?: string[];
  marketCap?: number | null;
  marketCapCurrency?: Currency;
  marketCapUsd?: number | null;
  price?: number | null;
  priceCurrency?: Currency;
  dayChangePct?: number | null;
  monthChangePct?: number | null;
  sparkline?: { i: number; c: number }[];
  revenue?: number | null;
  netIncome?: number | null;
  fcf?: number | null;
  eps?: number | null;
  pe?: number | null;
  pb?: number | null;
  roe?: number | null;
  roic?: number | null;
  debtToEquity?: number | null;
  grossMargin?: number | null;
  operatingMargin?: number | null;
  netMargin?: number | null;
  dividendYield?: number | null;
  fcfYield?: number | null;
  revenueCagr?: number | null;
  fcfCagr?: number | null;
}

export interface CategoryEntry {
  slug: string;
  label: string;
  count: number;
  top: string[];
}

export interface TagInfo { count: number; tickers: string[]; }

export interface FxSnapshot {
  asOf: string;
  base: Currency;
  rates: Record<Currency, number>;
}
