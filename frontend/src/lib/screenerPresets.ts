/**
 * Pre-built screens modelled after the popular screener.in screens.
 * Each entry's `filters` is a partial Filters object that the screener page
 * spreads over its defaults when the chip is clicked.
 *
 * NOTE: We can only enforce constraints over fields the screener.json carries.
 * Some classic screens (e.g. Greenblatt's Magic Formula needs EV/EBIT) are
 * approximated with the closest available proxy and noted in `description`.
 */

export type Preset = {
  name: string;
  description: string;
  filters: Partial<{
    minMarketCap: number;
    minRoe: number;
    minRoic: number;
    maxDebtToEquity: number;
    minRevenueCagr: number;
    minFcfCagr: number;
    maxPe: number;
    minGrossMargin: number;
    minOperatingMargin: number;
    minNetMargin: number;
    minFcfYield: number;
    minDividendYield: number;
    minEps: number;
    country: string;
    sector: string;
    query: string;
  }>;
};

const B = 1e9;

export const PRESETS: Preset[] = [
  {
    name: 'Magic Formula',
    description: 'Greenblatt approximation: high ROIC + cheap earnings yield (FCF yield as proxy).',
    filters: { minRoic: 0.20, minFcfYield: 0.08, minMarketCap: 1 * B },
  },
  {
    name: 'Coffee Can',
    description: '10y compounders — strong ROE, low debt, durable revenue growth.',
    filters: { minRoe: 0.15, maxDebtToEquity: 0.5, minRevenueCagr: 0.10, minMarketCap: 1 * B },
  },
  {
    name: 'Quality at Reasonable Price',
    description: 'QARP: high return on capital + moderate P/E.',
    filters: { minRoic: 0.15, minRoe: 0.15, maxPe: 25 },
  },
  {
    name: 'Dividend Aristocrat',
    description: '> 3% dividend yield, healthy profits, low debt.',
    filters: { minDividendYield: 0.03, minRoe: 0.10, maxDebtToEquity: 1, minMarketCap: 5 * B },
  },
  {
    name: 'Cash Cow',
    description: 'Strong FCF yield with low leverage.',
    filters: { minFcfYield: 0.08, maxDebtToEquity: 0.6, minMarketCap: 1 * B },
  },
  {
    name: 'High Growth',
    description: 'Revenue compounding > 20% with positive FCF.',
    filters: { minRevenueCagr: 0.20, minFcfCagr: 0.10, minMarketCap: 1 * B },
  },
  {
    name: 'Wide Moat',
    description: 'Gross margins > 50% and consistent operating profitability.',
    filters: { minGrossMargin: 0.50, minOperatingMargin: 0.20, minRoic: 0.15 },
  },
  {
    name: 'Net-Net Wannabe',
    description: 'Low P/E, low debt — Graham-style value (no balance-sheet liquidation maths yet).',
    filters: { maxPe: 10, maxDebtToEquity: 0.3 },
  },
  {
    name: 'Profitable EV makers',
    description: 'Electric vehicle tagged + positive net margin.',
    filters: { minNetMargin: 0.01, query: 'tag = ev' },
  },
  {
    name: 'Indian large-caps',
    description: 'India-listed companies above ₹50,000 Cr (~$6B) market cap.',
    filters: { country: 'IN', minMarketCap: 5 * B },
  },
];
