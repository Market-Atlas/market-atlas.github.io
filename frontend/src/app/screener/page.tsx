'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FxSnapshot, ScreenerRow } from '@/lib/types';
import { convert, formatMoney, formatPercent } from '@/lib/fx';
import { BP } from '@/lib/basePath';
import { vUrl } from '@/lib/version';
import { PRESETS, type Preset } from '@/lib/screenerPresets';
import { parseQuery, matchesQuery, type Query } from '@/lib/screenerQuery';

// ────────────────────────────────────────────────────────────────────────────
// Filter model. All numeric ranges are decimals where applicable (e.g. 0.15
// for 15% ROE). NaN / Infinity mean "no constraint".

type Filters = {
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
  query: string;          // free-form query overlay
};

const DEFAULTS: Filters = {
  minMarketCap: 0,
  minRoe: 0, minRoic: 0,
  maxDebtToEquity: Infinity,
  minRevenueCagr: 0, minFcfCagr: 0,
  maxPe: Infinity,
  minGrossMargin: 0, minOperatingMargin: 0, minNetMargin: 0,
  minFcfYield: 0, minDividendYield: 0,
  minEps: -Infinity,
  country: '', sector: '',
  query: '',
};

// Column definitions used by both the table and the CSV export. Keeping them
// in one place avoids drift between what's visible and what's downloaded.
// `render` and `csv` receive the row plus a `ctx` with the user's chosen
// display currency + FX snapshot so the market-cap column can convert.
type RenderCtx = { displayCcy: string; fx: FxSnapshot | null };

type ColDef = {
  key: keyof ScreenerRow | 'derived';
  label: string;
  hideBelow?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
  render?: (r: ScreenerRow, ctx: RenderCtx) => string;
  csv?: (r: ScreenerRow, ctx: RenderCtx) => string | number | null;
};

const COLUMNS: ColDef[] = [
  { key: 'ticker',  label: 'Ticker', align: 'left' },
  { key: 'name',    label: 'Name',   align: 'left' },
  { key: 'sector',  label: 'Sector',  align: 'left', hideBelow: 'md',
    render: r => r.sector || '—', csv: r => r.sector ?? '' },
  { key: 'country', label: 'Country', align: 'left', hideBelow: 'lg',
    render: r => r.country || '—', csv: r => r.country ?? '' },
  { key: 'marketCap', label: 'Market cap',
    render: (r, { displayCcy, fx }) => {
      const src = r.marketCapCurrency || r.currency || 'USD';
      const v = fx ? convert(r.marketCap ?? null, src, displayCcy, fx) : r.marketCap ?? null;
      return formatMoney(v, displayCcy);
    },
    csv: (r, { displayCcy, fx }) => {
      const src = r.marketCapCurrency || r.currency || 'USD';
      return fx ? convert(r.marketCap ?? null, src, displayCcy, fx) : r.marketCap ?? null;
    },
  },
  { key: 'pe',    label: 'P/E',  hideBelow: 'sm',
    render: r => r.pe == null ? '—' : r.pe.toFixed(1),
    csv: r => r.pe ?? null },
  { key: 'roe',   label: 'ROE', render: r => formatPercent(r.roe),     csv: r => r.roe   ?? null },
  { key: 'roic',  label: 'ROIC', hideBelow: 'sm',
    render: r => formatPercent(r.roic), csv: r => r.roic ?? null },
  { key: 'debtToEquity', label: 'D/E', hideBelow: 'sm',
    render: r => r.debtToEquity == null ? '—' : r.debtToEquity.toFixed(2),
    csv: r => r.debtToEquity ?? null },
  { key: 'operatingMargin', label: 'Op. mgn', hideBelow: 'md',
    render: r => formatPercent(r.operatingMargin), csv: r => r.operatingMargin ?? null },
  { key: 'netMargin', label: 'Net mgn', hideBelow: 'md',
    render: r => formatPercent(r.netMargin), csv: r => r.netMargin ?? null },
  { key: 'fcfYield', label: 'FCF yield', hideBelow: 'md',
    render: r => formatPercent(r.fcfYield), csv: r => r.fcfYield ?? null },
  { key: 'dividendYield', label: 'Div yield', hideBelow: 'lg',
    render: r => formatPercent(r.dividendYield), csv: r => r.dividendYield ?? null },
  { key: 'revenueCagr', label: 'Rev CAGR', hideBelow: 'lg',
    render: r => formatPercent(r.revenueCagr), csv: r => r.revenueCagr ?? null },
  { key: 'fcfCagr', label: 'FCF CAGR', hideBelow: 'lg',
    render: r => formatPercent(r.fcfCagr), csv: r => r.fcfCagr ?? null },
];

// ────────────────────────────────────────────────────────────────────────────
// URL state. We encode the diff vs DEFAULTS so shareable links stay short.

function encodeFilters(f: Filters): string {
  const params = new URLSearchParams();
  (Object.keys(f) as Array<keyof Filters>).forEach(k => {
    const v = f[k];
    const d = DEFAULTS[k];
    if (v === d) return;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return;
      if (v === Infinity || v === -Infinity) return;
    }
    params.set(k, String(v));
  });
  return params.toString();
}

function decodeFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const out: Filters = { ...DEFAULTS };
  params.forEach((raw, k) => {
    if (!(k in DEFAULTS)) return;
    const key = k as keyof Filters;
    const def = DEFAULTS[key];
    if (typeof def === 'number') {
      const n = Number(raw);
      if (!Number.isNaN(n)) (out as any)[key] = n;
    } else {
      (out as any)[key] = raw;
    }
  });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [fx, setFx]     = useState<FxSnapshot | null>(null);
  const [f, setF]       = useState<Filters>(DEFAULTS);
  const [displayCcy, setDisplayCcy] = useState<'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY'>('USD');
  const [hydrated, setHydrated] = useState(false);

  // Initial hydration from URL (only client-side; SSR sees defaults).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      setF(decodeFilters(window.location.search.slice(1)));
    }
    setHydrated(true);
  }, []);

  // Push URL on any filter change (replaceState — keeps history clean).
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    const qs = encodeFilters(f);
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [f, hydrated]);

  useEffect(() => {
    fetch(vUrl(`${BP}/data/screener.json`)).then(r => r.json()).then(setRows);
    fetch(vUrl(`${BP}/data/fx/latest.json`)).then(r => r.json()).then(setFx);
  }, []);

  const countries = useMemo(
    () => Array.from(new Set(rows.map(r => r.country).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const sectors = useMemo(
    () => Array.from(new Set(rows.map(r => r.sector).filter(Boolean) as string[])).sort(),
    [rows],
  );

  // Parse free-form query once per change. Errors are surfaced to the user
  // but don't break the page — just don't apply the query overlay.
  const { query, queryError } = useMemo<{ query: Query | null; queryError: string | null }>(() => {
    const text = f.query.trim();
    if (!text) return { query: null, queryError: null };
    try {
      return { query: parseQuery(text), queryError: null };
    } catch (e: any) {
      return { query: null, queryError: e?.message ?? 'Query parse failed' };
    }
  }, [f.query]);

  const filtered = rows.filter(r => {
    // Min market cap filter is always interpreted in USD so the same value
    // makes sense across all listings (mixing 10B USD with 10B INR is meaningless).
    if ((r.marketCapUsd ?? 0) < f.minMarketCap) return false;
    if ((r.roe  ?? -Infinity) < f.minRoe)  return false;
    if ((r.roic ?? -Infinity) < f.minRoic) return false;
    if (f.maxDebtToEquity !== Infinity && (r.debtToEquity ?? Infinity) > f.maxDebtToEquity) return false;
    if ((r.revenueCagr ?? -Infinity) < f.minRevenueCagr) return false;
    if ((r.fcfCagr     ?? -Infinity) < f.minFcfCagr)     return false;
    if (f.maxPe !== Infinity && (r.pe ?? Infinity) > f.maxPe) return false;
    if ((r.grossMargin     ?? -Infinity) < f.minGrossMargin)     return false;
    if ((r.operatingMargin ?? -Infinity) < f.minOperatingMargin) return false;
    if ((r.netMargin       ?? -Infinity) < f.minNetMargin)       return false;
    if ((r.fcfYield        ?? -Infinity) < f.minFcfYield)        return false;
    if ((r.dividendYield   ?? -Infinity) < f.minDividendYield)   return false;
    if (f.minEps !== -Infinity && (r.eps ?? -Infinity) < f.minEps) return false;
    if (f.country && r.country !== f.country) return false;
    if (f.sector  && r.sector  !== f.sector)  return false;
    if (query && !matchesQuery(r, query)) return false;
    return true;
  });

  const applyPreset = (p: Preset) => {
    setF({ ...DEFAULTS, ...p.filters });
  };

  const exportCsv = () => {
    const ctx: RenderCtx = { displayCcy, fx };
    const header = COLUMNS.map(c => c.label).join(',');
    const lines = filtered.map(r =>
      COLUMNS.map(c => {
        const v = c.csv ? c.csv(r, ctx) : (r as any)[c.key];
        if (v == null) return '';
        if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
        return String(v);
      }).join(','),
    );
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas-screen-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareLink = () => {
    const url = window.location.href;
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
          <p className="text-sm text-atlas-muted">
            Filters run entirely in your browser. Share the URL to share the screen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={shareLink}
                  className="rounded border border-atlas-border bg-atlas-surface px-3 py-1.5 hover:border-atlas-accent/40 hover:text-atlas-accent">
            Copy share link
          </button>
          <button onClick={exportCsv}
                  className="rounded border border-atlas-border bg-atlas-surface px-3 py-1.5 hover:border-atlas-accent/40 hover:text-atlas-accent">
            Export CSV ({filtered.length})
          </button>
          <button onClick={() => setF(DEFAULTS)}
                  className="rounded border border-atlas-border bg-atlas-surface px-3 py-1.5 text-atlas-muted hover:text-atlas-text">
            Reset
          </button>
        </div>
      </header>

      {/* Preset screens — one-click filters modelled after screener.in's popular screens. */}
      <section className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1">
        {PRESETS.map(p => (
          <button
            key={p.name}
            onClick={() => applyPreset(p)}
            title={p.description}
            className="shrink-0 rounded-full border border-atlas-border bg-atlas-surface px-3 py-1 text-xs text-atlas-muted hover:border-atlas-accent/40 hover:text-atlas-text"
          >
            {p.name}
          </button>
        ))}
      </section>

      {/* Numeric filter grid */}
      <section className="grid gap-3 rounded-lg border border-atlas-border bg-atlas-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumField label="Min ROE (%)"             value={f.minRoe * 100}            onChange={v => setF({ ...f, minRoe:  v / 100 })} />
        <NumField label="Min ROIC (%)"            value={f.minRoic * 100}           onChange={v => setF({ ...f, minRoic: v / 100 })} />
        <NumField label="Max P/E"                 value={f.maxPe === Infinity ? NaN : f.maxPe}
                  placeholder="any"
                  onChange={v => setF({ ...f, maxPe: Number.isFinite(v) ? v : Infinity })} step={1} />
        <NumField label="Max Debt/Equity"         value={f.maxDebtToEquity === Infinity ? NaN : f.maxDebtToEquity}
                  placeholder="any" step={0.1}
                  onChange={v => setF({ ...f, maxDebtToEquity: Number.isFinite(v) ? v : Infinity })} />
        <NumField label="Min revenue CAGR (%)"    value={f.minRevenueCagr * 100}    onChange={v => setF({ ...f, minRevenueCagr: v / 100 })} />
        <NumField label="Min FCF CAGR (%)"        value={f.minFcfCagr * 100}        onChange={v => setF({ ...f, minFcfCagr: v / 100 })} />
        <NumField label="Min gross margin (%)"    value={f.minGrossMargin * 100}    onChange={v => setF({ ...f, minGrossMargin:     v / 100 })} />
        <NumField label="Min operating margin (%)" value={f.minOperatingMargin * 100} onChange={v => setF({ ...f, minOperatingMargin: v / 100 })} />
        <NumField label="Min net margin (%)"      value={f.minNetMargin * 100}      onChange={v => setF({ ...f, minNetMargin: v / 100 })} />
        <NumField label="Min FCF yield (%)"       value={f.minFcfYield * 100}       onChange={v => setF({ ...f, minFcfYield: v / 100 })} />
        <NumField label="Min dividend yield (%)"  value={f.minDividendYield * 100}  onChange={v => setF({ ...f, minDividendYield: v / 100 })} />
        <NumField label="Min EPS"                 value={f.minEps === -Infinity ? NaN : f.minEps}
                  placeholder="any" step={0.5}
                  onChange={v => setF({ ...f, minEps: Number.isFinite(v) ? v : -Infinity })} />
        <NumField label="Min market cap (USD)"    value={f.minMarketCap}            placeholder="e.g. 1000000000" step={1e9}
                  onChange={v => setF({ ...f, minMarketCap: v })} />
        <SelectField label="Country" value={f.country} options={countries} onChange={v => setF({ ...f, country: v })} />
        <SelectField label="Sector"  value={f.sector}  options={sectors}  onChange={v => setF({ ...f, sector:  v })} />
        <label className="flex flex-col gap-1 text-xs text-atlas-muted">
          Display currency
          <select
            value={displayCcy}
            onChange={e => setDisplayCcy(e.target.value as any)}
            className="rounded border border-atlas-border bg-atlas-bg px-2 py-1 text-sm text-atlas-text"
          >
            {(['USD', 'EUR', 'GBP', 'INR', 'JPY'] as const).map(c => (
              <option key={c} value={c}>{c}{c === 'INR' ? ' (Lakh / Cr)' : ''}</option>
            ))}
          </select>
        </label>
      </section>

      {/* Custom query — screener.in-style boolean expression */}
      <section className="rounded-lg border border-atlas-border bg-atlas-surface p-4">
        <label className="block text-xs uppercase tracking-wide text-atlas-muted">
          Custom query
        </label>
        <input
          type="text"
          value={f.query}
          placeholder='e.g.  roe > 15 AND debtToEquity < 0.5 AND marketCap > 10B'
          onChange={e => setF({ ...f, query: e.target.value })}
          className="mt-1 w-full rounded border border-atlas-border bg-atlas-bg px-2 py-1.5 font-mono text-sm text-atlas-text"
        />
        <p className="mt-1 text-[11px] text-atlas-muted">
          Fields: <code>marketCap pe pb roe roic debtToEquity operatingMargin netMargin grossMargin
          fcfYield dividendYield revenueCagr fcfCagr eps revenue netIncome fcf</code>.{' '}
          Operators: <code>{'>'} {'>='} {'<'} {'<='} {'='} {'!='}</code>. Joiners: <code>AND OR</code>.{' '}
          Suffixes: <code>%</code> on RHS for percentages (15% = 0.15), <code>K M B T</code> for money.
        </p>
        {queryError && (
          <p className="mt-1 text-xs text-atlas-negative">⚠ {queryError}</p>
        )}
      </section>

      <div className="flex items-center justify-between text-xs text-atlas-muted">
        <span>
          {filtered.length.toLocaleString()} match{filtered.length === 1 ? '' : 'es'}
          {' '}· market cap shown in <span className="text-atlas-text">{displayCcy}</span>
        </span>
        {f.query && !queryError && <span>Query active</span>}
      </div>

      <section className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-surface">
        <table className="num min-w-full text-right text-sm">
          <thead className="bg-atlas-border/40 text-xs uppercase tracking-wide text-atlas-muted">
            <tr>
              {COLUMNS.map(c => {
                const hide = c.hideBelow ? `hidden ${c.hideBelow}:table-cell` : '';
                // Annotate the Market cap header with the active display ccy
                // so a user sorting/filtering knows the units instantly.
                const label = c.key === 'marketCap' ? `${c.label} (${displayCcy})` : c.label;
                return (
                  <th key={c.label}
                      className={`${hide} px-3 py-2 ${c.align === 'left' ? 'text-left' : 'text-right'}`}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map(r => (
              <tr key={r.ticker} className="border-t border-atlas-border hover:bg-atlas-border/30">
                {COLUMNS.map(c => {
                  const hide = c.hideBelow ? `hidden ${c.hideBelow}:table-cell` : '';
                  const align = c.align === 'left' ? 'text-left' : '';
                  if (c.key === 'ticker') {
                    return (
                      <td key={c.label} className={`${hide} ${align} px-3 py-1.5 font-mono`}>
                        <Link href={`${BP}/company/${r.ticker}/`} className="text-atlas-accent hover:underline">
                          {r.ticker}
                        </Link>
                      </td>
                    );
                  }
                  const val = c.render
                    ? c.render(r, { displayCcy, fx })
                    : ((r as any)[c.key] ?? '—');
                  return (
                    <td key={c.label} className={`${hide} ${align} px-3 py-1.5 ${c.align === 'left' ? 'text-atlas-muted' : ''}`}>
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <p className="px-3 py-2 text-center text-xs text-atlas-muted">
            Showing first 500 matches — refine filters to narrow down, or export CSV for the full set.
          </p>
        )}
      </section>
    </div>
  );
}

function NumField({
  label, value, onChange, placeholder, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; placeholder?: string; step?: number }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-atlas-muted">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        className="rounded border border-atlas-border bg-atlas-bg px-2 py-1 text-sm text-atlas-text"
      />
    </label>
  );
}

function SelectField({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-atlas-muted">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded border border-atlas-border bg-atlas-bg px-2 py-1 text-sm text-atlas-text"
      >
        <option value="">Any</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
