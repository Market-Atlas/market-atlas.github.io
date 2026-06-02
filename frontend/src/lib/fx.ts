import type { Currency, FxSnapshot } from './types';

/**
 * Convert a value from one reporting currency to another using a snapshot.
 *
 * Snapshot semantics: `rates[ccy]` = how many units of `ccy` per 1 unit of `base`.
 * So 1 base = rates[ccy] of ccy, and 1 ccy = 1 / rates[ccy] of base.
 */
export function convert(
  value: number | null | undefined,
  from: Currency,
  to: Currency,
  fx: FxSnapshot,
): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (from === to) return value;

  const rFrom = fx.rates[from];
  const rTo = fx.rates[to];
  if (!rFrom || !rTo) return null;

  // base->from rate = rFrom; convert to base first, then to target.
  const inBase = value / rFrom;
  return inBase * rTo;
}

export const SUPPORTED_DISPLAY_CCYS: Currency[] = [
  'USD', 'EUR', 'GBP', 'JPY', 'INR', 'CHF', 'CAD', 'AUD',
];

/** Human-readable, currency-aware formatter with scale suffix.
 *  INR uses the Indian numbering system (Lakh / Crore) via the en-IN locale;
 *  everything else uses Western K/M/B/T via en-US. */
export function formatMoney(
  value: number | null | undefined,
  ccy: Currency,
  opts: { compact?: boolean } = { compact: true },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';

  const locale = ccy === 'INR' ? 'en-IN' : 'en-US';

  if (opts.compact) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: ccy,
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: ccy,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(
  value: number | null | undefined,
  digits = 2,
  ccy?: Currency,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const locale = ccy === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}
