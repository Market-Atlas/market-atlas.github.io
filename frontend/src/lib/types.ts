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
  tags?: string[];
  marketCap?: MoneyAt;
  price?: { value: number | null; currency: Currency; asOf: string };
  fundamentals: Fundamentals;
  ratios: Ratios;
  historicalFinancials: HistoricalYear[];
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
