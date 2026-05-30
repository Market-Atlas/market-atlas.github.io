'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ScreenerRow } from '@/lib/types';
import { formatMoney, formatPercent } from '@/lib/fx';
import { BP } from '@/lib/basePath';

type Filters = {
  minMarketCap: number;        // in row currency, compact billions
  minRoe: number;              // decimal
  minRoic: number;             // decimal
  maxDebtToEquity: number;     // decimal, Infinity => off
  minRevenueCagr: number;      // decimal
  minFcfCagr: number;          // decimal
  country: string;             // '' = any
  sector: string;              // '' = any
};

const DEFAULTS: Filters = {
  minMarketCap: 0, minRoe: 0, minRoic: 0,
  maxDebtToEquity: Infinity, minRevenueCagr: 0, minFcfCagr: 0,
  country: '', sector: '',
};

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [f, setF] = useState<Filters>(DEFAULTS);

  useEffect(() => {
    fetch(`${BP}/data/screener.json`).then(r => r.json()).then(setRows);
  }, []);

  const countries = useMemo(() => Array.from(new Set(rows.map(r => r.country).filter(Boolean))).sort(), [rows]);
  const sectors   = useMemo(() => Array.from(new Set(rows.map(r => r.sector).filter(Boolean))).sort(), [rows]);

  const filtered = rows.filter(r => {
    if ((r.marketCap || 0) < f.minMarketCap) return false;
    if ((r.roe ?? -Infinity) < f.minRoe) return false;
    if ((r.roic ?? -Infinity) < f.minRoic) return false;
    if (f.maxDebtToEquity !== Infinity && (r.debtToEquity ?? Infinity) > f.maxDebtToEquity) return false;
    if ((r.revenueCagr ?? -Infinity) < f.minRevenueCagr) return false;
    if ((r.fcfCagr ?? -Infinity) < f.minFcfCagr) return false;
    if (f.country && r.country !== f.country) return false;
    if (f.sector && r.sector !== f.sector) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
        <p className="text-sm text-atlas-muted">Find companies that match your criteria. Runs entirely in your browser.</p>
      </header>

      <section className="grid gap-3 rounded-lg border border-atlas-border bg-atlas-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumField label="Min ROE (%)"             value={f.minRoe * 100}        onChange={v => setF({ ...f, minRoe: v / 100 })} />
        <NumField label="Min ROIC (%)"            value={f.minRoic * 100}       onChange={v => setF({ ...f, minRoic: v / 100 })} />
        <NumField label="Max Debt/Equity"         value={f.maxDebtToEquity === Infinity ? NaN : f.maxDebtToEquity}
                  onChange={v => setF({ ...f, maxDebtToEquity: Number.isFinite(v) ? v : Infinity })}
                  placeholder="any" step={0.1} />
        <NumField label="Min revenue CAGR (%)"    value={f.minRevenueCagr * 100} onChange={v => setF({ ...f, minRevenueCagr: v / 100 })} />
        <NumField label="Min FCF CAGR (%)"        value={f.minFcfCagr * 100}     onChange={v => setF({ ...f, minFcfCagr: v / 100 })} />
        <NumField label="Min market cap"          value={f.minMarketCap}         onChange={v => setF({ ...f, minMarketCap: v })}
                  placeholder="(reporting ccy)" step={1e9} />
        <SelectField label="Country" value={f.country} options={countries as string[]} onChange={v => setF({ ...f, country: v })} />
        <SelectField label="Sector"  value={f.sector}  options={sectors as string[]}   onChange={v => setF({ ...f, sector: v })} />
      </section>

      <div className="text-xs text-atlas-muted">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</div>

      <section className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-surface">
        <table className="num min-w-full text-right text-sm">
          <thead className="bg-atlas-border/40 text-xs uppercase tracking-wide text-atlas-muted">
            <tr>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Sector</th>
              <th className="px-3 py-2 text-left">Country</th>
              <th className="px-3 py-2">Market cap</th>
              <th className="px-3 py-2">ROE</th>
              <th className="px-3 py-2">ROIC</th>
              <th className="px-3 py-2">D/E</th>
              <th className="px-3 py-2">Rev CAGR</th>
              <th className="px-3 py-2">FCF CAGR</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.ticker} className="border-t border-atlas-border hover:bg-atlas-border/30">
                <td className="px-3 py-1.5 text-left font-mono">
                  <Link href={`${BP}/company/${r.ticker}/`} className="text-atlas-accent hover:underline">
                    {r.ticker}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-left">{r.name}</td>
                <td className="px-3 py-1.5 text-left text-atlas-muted">{r.sector || '—'}</td>
                <td className="px-3 py-1.5 text-left text-atlas-muted">{r.country || '—'}</td>
                <td className="px-3 py-1.5">{formatMoney(r.marketCap ?? null, r.marketCapCurrency || r.currency || 'USD')}</td>
                <td className="px-3 py-1.5">{formatPercent(r.roe)}</td>
                <td className="px-3 py-1.5">{formatPercent(r.roic)}</td>
                <td className="px-3 py-1.5">{r.debtToEquity == null ? '—' : r.debtToEquity.toFixed(2)}</td>
                <td className="px-3 py-1.5">{formatPercent(r.revenueCagr)}</td>
                <td className="px-3 py-1.5">{formatPercent(r.fcfCagr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
