'use client';

import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useMemo, useState } from 'react';
import type { Company, FxSnapshot, HistoricalYear } from '@/lib/types';
import { SUPPORTED_DISPLAY_CCYS, convert, formatMoney, formatPercent } from '@/lib/fx';
import WatchlistButton from './WatchlistButton';
import Link from 'next/link';
import { BP } from '@/lib/basePath';

const SERIES = [
  { key: 'revenue',      label: 'Revenue',        color: '#5eead4' },
  { key: 'netIncome',    label: 'Net income',     color: '#a78bfa' },
  { key: 'freeCashFlow', label: 'Free cash flow', color: '#f59e0b' },
] as const;
type SeriesKey = typeof SERIES[number]['key'];

// ────────────────────────────────────────────────────────────────────────────
// helpers

function cagr(series: (number | null | undefined)[]): number | null {
  const vals = series.filter((v): v is number => v != null && v > 0);
  if (vals.length < 2) return null;
  const years = vals.length - 1;
  return Math.pow(vals[vals.length - 1] / vals[0], 1 / years) - 1;
}

function tail<T>(arr: T[], n: number): T[] { return arr.slice(Math.max(0, arr.length - n)); }

function impliedEquity(c: Company, row?: HistoricalYear): number | null {
  // Approximation: equity = totalDebt / debtToEquity. Real balance-sheet data lands later.
  const d = row?.totalDebt ?? c.fundamentals.totalDebt;
  const de = c.ratios.debtToEquity;
  if (d == null || !de || de <= 0) return null;
  return d / de;
}

// ────────────────────────────────────────────────────────────────────────────

export default function CompanyView({ company, fx, peers = [] }: { company: Company; fx: FxSnapshot; peers?: Company[] }) {
  const [displayCcy, setDisplayCcy] = useState(company.currency);
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    revenue: true, netIncome: true, freeCashFlow: true,
  });

  const hist = company.historicalFinancials;
  const latest = hist[hist.length - 1];
  const conv = (v: number | null | undefined) =>
    convert(v ?? null, company.currency, displayCcy, fx);

  const mcap = convert(
    company.marketCap?.value ?? null,
    company.marketCap?.currency ?? company.currency,
    displayCcy,
    fx,
  );
  const mcapReporting = convert(
    company.marketCap?.value ?? null,
    company.marketCap?.currency ?? company.currency,
    company.currency,
    fx,
  );
  const pe = mcapReporting && latest?.netIncome ? mcapReporting / latest.netIncome : null;
  const equity = impliedEquity(company, latest);
  const pb = mcapReporting && equity ? mcapReporting / equity : null;
  const bvps = equity && latest?.sharesOutstanding ? equity / latest.sharesOutstanding : null;
  const fcfYield = mcapReporting && latest?.freeCashFlow ? latest.freeCashFlow / mcapReporting : null;
  const earningsYield = pe ? 1 / pe : null;

  const growth = useMemo(() => {
    const pick = (k: keyof HistoricalYear) => hist.map(r => r[k] as number | null | undefined);
    return {
      revenue:   { '10y': cagr(tail(pick('revenue'), 11)),      '5y': cagr(tail(pick('revenue'), 6)),      '3y': cagr(tail(pick('revenue'), 4)) },
      netIncome: { '10y': cagr(tail(pick('netIncome'), 11)),    '5y': cagr(tail(pick('netIncome'), 6)),    '3y': cagr(tail(pick('netIncome'), 4)) },
      fcf:       { '10y': cagr(tail(pick('freeCashFlow'), 11)), '5y': cagr(tail(pick('freeCashFlow'), 6)), '3y': cagr(tail(pick('freeCashFlow'), 4)) },
    };
  }, [hist]);

  const pros: string[] = [];
  const cons: string[] = [];
  if ((latest?.roic ?? 0) >= 0.15) pros.push(`High ROIC of ${formatPercent(latest?.roic)} — efficient capital allocation.`);
  if ((latest?.roe  ?? 0) >= 0.15) pros.push(`Strong ROE of ${formatPercent(latest?.roe)}.`);
  if ((latest?.freeCashFlow ?? 0) > 0) pros.push(`Generates positive free cash flow.`);
  if ((growth.revenue['5y'] ?? 0) >= 0.10) pros.push(`Revenue compounding ${formatPercent(growth.revenue['5y'])} over 5 years.`);
  if ((growth.fcf['5y'] ?? 0) >= 0.10)    pros.push(`FCF compounding ${formatPercent(growth.fcf['5y'])} over 5 years.`);
  if ((company.ratios.debtToEquity ?? 0) > 1) cons.push(`Elevated debt/equity of ${company.ratios.debtToEquity?.toFixed(2)}.`);
  if ((latest?.operatingMargin ?? 0) < 0.10) cons.push(`Operating margin is thin at ${formatPercent(latest?.operatingMargin)}.`);
  if ((growth.netIncome['5y'] ?? 0) < 0)     cons.push(`Net income shrank over the last 5 years.`);
  if (pros.length === 0) pros.push('Insufficient evidence for highlights — review the tables below.');
  if (cons.length === 0) cons.push('No major red flags from the dataset.');

  const chartData = hist.map(r => ({
    year: r.fiscalYear,
    revenue:      conv(r.revenue),
    netIncome:    conv(r.netIncome),
    freeCashFlow: conv(r.freeCashFlow),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-atlas-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <span className="rounded bg-atlas-border px-2 py-0.5 font-mono text-sm">{company.ticker}</span>
            {company.price?.value != null && (
              <span className="num text-lg font-semibold text-atlas-text">
                {formatMoney(
                  convert(company.price.value, company.price.currency, displayCcy, fx),
                  displayCcy,
                  { compact: false },
                )}
              </span>
            )}
            <span className="rounded bg-atlas-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-atlas-muted">
              {company.exchange} · {company.country}
            </span>
          </div>
          <p className="mt-1 text-sm text-atlas-muted">
            {[
              company.sector,
              company.industry,
              `Reports in ${company.currency}`,
              company.price?.asOf && `Price as of ${company.price.asOf}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-atlas-muted">Display</label>
          <select
            value={displayCcy}
            onChange={e => setDisplayCcy(e.target.value)}
            className="rounded border border-atlas-border bg-atlas-surface px-2 py-1 text-sm"
          >
            {[company.currency, ...SUPPORTED_DISPLAY_CCYS.filter(c => c !== company.currency)].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <WatchlistButton ticker={company.ticker} kind="company" />
        </div>
      </header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-atlas-border bg-atlas-border sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Market cap"    value={formatMoney(mcap, displayCcy)} />
        <Kpi label="P / E"         value={pe == null ? '—' : pe.toFixed(1)} />
        <Kpi label="P / B"         value={pb == null ? '—' : pb.toFixed(2)} />
        <Kpi label="Book value"    value={bvps == null ? '—' : formatMoney(conv(bvps), displayCcy)} sub="per share" />
        <Kpi label="EPS"           value={latest?.eps == null ? '—' : latest.eps.toFixed(2)} sub={company.currency} />
        <Kpi label="ROE"           value={formatPercent(company.ratios.roe)}  tone={pickTone(company.ratios.roe, 0.15)} />
        <Kpi label="ROIC"          value={formatPercent(company.ratios.roic)} tone={pickTone(company.ratios.roic, 0.15)} />
        <Kpi label="Debt / Equity" value={company.ratios.debtToEquity?.toFixed(2) ?? '—'} tone={pickTone(company.ratios.debtToEquity, 0.5, true)} />
        <Kpi label="FCF yield"     value={formatPercent(fcfYield)} tone={pickTone(fcfYield, 0.04)} />
        <Kpi label="Earnings yield" value={formatPercent(earningsYield)} />
      </section>

      {/* Pros & Cons */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Pros">
          <ul className="space-y-1.5 text-sm">
            {pros.map(p => (
              <li key={p} className="flex gap-2"><span className="text-atlas-positive">✓</span><span>{p}</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Cons">
          <ul className="space-y-1.5 text-sm">
            {cons.map(c => (
              <li key={c} className="flex gap-2"><span className="text-atlas-negative">✗</span><span>{c}</span></li>
            ))}
          </ul>
        </Card>
      </section>

      {/* Chart */}
      <Card title={`10-year fundamentals · ${displayCcy}`} actions={
        <div className="flex flex-wrap gap-2 text-xs">
          {SERIES.map(s => (
            <button
              key={s.key}
              onClick={() => setEnabled(e => ({ ...e, [s.key]: !e[s.key] }))}
              className={`rounded border px-2 py-1 ${
                enabled[s.key]
                  ? 'border-atlas-accent/40 bg-atlas-accent/10 text-atlas-text'
                  : 'border-atlas-border text-atlas-muted'
              }`}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      }>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1f2430" vertical={false} />
              <XAxis dataKey="year" stroke="#8a93a6" fontSize={12} />
              <YAxis stroke="#8a93a6" fontSize={12}
                     tickFormatter={(v: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} />
              <Tooltip contentStyle={{ background: '#11141b', border: '1px solid #1f2430', borderRadius: 8 }}
                       formatter={(v: number) => formatMoney(v, displayCcy)} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#8a93a6' }} />
              {SERIES.filter(s => enabled[s.key]).map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} name={s.label} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Quarterly results">
        <p className="text-sm text-atlas-muted">
          Quarterly data isn&apos;t included in the MVP dataset yet — only audited annual
          fundamentals are stored, in each company&apos;s reporting currency. Quarterly
          ingestion (US 10-Q, Indian quarterly filings, Japan&apos;s 四半期) is on the roadmap.
        </p>
      </Card>

      <Card title="Profit & Loss" subtitle={`Annual · ${displayCcy}`}>
        <ScrollTable>
          <FinancialsTable rows={hist} displayCcy={displayCcy} conv={conv} spec={[
            { label: 'Revenue',           kind: 'money',   key: 'revenue' },
            { label: 'Operating income',  kind: 'money',   key: 'operatingIncome' },
            { label: 'Operating margin',  kind: 'percent', key: 'operatingMargin' },
            { label: 'Net income',        kind: 'money',   key: 'netIncome' },
            { label: 'Net margin',        kind: 'percent', key: 'netMargin' },
            { label: 'EPS',               kind: 'number',  key: 'eps', digits: 2 },
          ]} />
        </ScrollTable>
      </Card>

      <Card title="Balance Sheet" subtitle={`Annual · ${displayCcy} (equity is derived from debt/equity)`}>
        <ScrollTable>
          <FinancialsTable rows={hist} displayCcy={displayCcy} conv={conv} spec={[
            { label: 'Cash',               kind: 'money',  key: 'cash' },
            { label: 'Total debt',         kind: 'money',  key: 'totalDebt' },
            { label: 'Net debt',           kind: 'derived', compute: r => r.totalDebt != null && r.cash != null ? r.totalDebt - r.cash : null },
            { label: 'Implied equity',     kind: 'derived', compute: () => impliedEquity(company, latest) },
            { label: 'Shares outstanding', kind: 'number', key: 'sharesOutstanding', digits: 0 },
          ]} />
        </ScrollTable>
      </Card>

      <Card title="Cash Flow" subtitle={`Annual · ${displayCcy}`}>
        <ScrollTable>
          <FinancialsTable rows={hist} displayCcy={displayCcy} conv={conv} spec={[
            { label: 'Free cash flow', kind: 'money', key: 'freeCashFlow' },
          ]} />
        </ScrollTable>
      </Card>

      <Card title="Ratios" subtitle="Annual">
        <ScrollTable>
          <FinancialsTable rows={hist} displayCcy={displayCcy} conv={conv} spec={[
            { label: 'Gross margin',     kind: 'percent', key: 'grossMargin' },
            { label: 'Operating margin', kind: 'percent', key: 'operatingMargin' },
            { label: 'Net margin',       kind: 'percent', key: 'netMargin' },
            { label: 'ROE',              kind: 'percent', key: 'roe' },
            { label: 'ROIC',             kind: 'percent', key: 'roic' },
          ]} />
        </ScrollTable>
      </Card>

      <Card title="Compounded growth">
        <div className="overflow-x-auto">
          <table className="num min-w-full text-right text-sm">
            <thead className="text-xs uppercase tracking-wide text-atlas-muted">
              <tr>
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2">10 years</th>
                <th className="px-3 py-2">5 years</th>
                <th className="px-3 py-2">3 years</th>
              </tr>
            </thead>
            <tbody>
              <GrowthRow label="Sales growth"  g={growth.revenue} />
              <GrowthRow label="Profit growth" g={growth.netIncome} />
              <GrowthRow label="FCF growth"    g={growth.fcf} />
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Peers" subtitle={`Same sector & country · ${displayCcy}`}>
        {peers.length === 0 ? (
          <p className="text-sm text-atlas-muted">
            No peer companies in our dataset yet for this sector/country combination.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="num min-w-full text-right text-sm">
              <thead className="text-xs uppercase tracking-wide text-atlas-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Company</th>
                  <th className="px-3 py-2">Market cap</th>
                  <th className="px-3 py-2">Revenue</th>
                  <th className="px-3 py-2">Net income</th>
                  <th className="px-3 py-2">P / E</th>
                  <th className="px-3 py-2">ROE</th>
                  <th className="px-3 py-2">ROIC</th>
                  <th className="px-3 py-2">Op. margin</th>
                  <th className="px-3 py-2">D / E</th>
                </tr>
              </thead>
              <tbody>
                <PeerRow current company={company} fx={fx} displayCcy={displayCcy} />
                {peers
                  .slice()
                  .sort((a, b) => (b.marketCap?.value ?? 0) - (a.marketCap?.value ?? 0))
                  .map(p => (
                    <PeerRow key={p.ticker} company={p} fx={fx} displayCcy={displayCcy} />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-atlas-muted">
        Source values stored in <span className="font-mono">{company.currency}</span>;
        other currencies derived from FX snapshot ({fx.asOf}). Pros/cons are heuristics
        from the dataset, not investment advice.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components

function Kpi({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' }) {
  const toneCls = tone === 'positive' ? 'text-atlas-positive'
    : tone === 'negative' ? 'text-atlas-negative'
    : 'text-atlas-text';
  return (
    <div className="bg-atlas-surface p-3">
      <div className="text-[10px] uppercase tracking-wide text-atlas-muted">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-atlas-muted">{sub}</div>}
    </div>
  );
}

function pickTone(v: number | null | undefined, threshold: number, inverse = false): 'positive' | 'negative' | undefined {
  if (v == null) return undefined;
  if (inverse) return v <= threshold ? 'positive' : 'negative';
  return v >= threshold ? 'positive' : v < 0 ? 'negative' : undefined;
}

function Card({
  title, subtitle, actions, children,
}: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-atlas-border bg-atlas-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-atlas-border px-4 py-2.5">
        <div>
          <h2 className="text-sm font-medium text-atlas-text">{title}</h2>
          {subtitle && <p className="text-[11px] text-atlas-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ScrollTable({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

type Spec =
  | { label: string; kind: 'money';   key: keyof HistoricalYear }
  | { label: string; kind: 'percent'; key: keyof HistoricalYear }
  | { label: string; kind: 'number';  key: keyof HistoricalYear; digits?: number }
  | { label: string; kind: 'derived'; compute: (r: HistoricalYear) => number | null };

function FinancialsTable({
  rows, displayCcy, conv, spec,
}: {
  rows: HistoricalYear[];
  displayCcy: string;
  conv: (v: number | null | undefined) => number | null;
  spec: Spec[];
}) {
  return (
    <table className="num min-w-full text-right text-sm">
      <thead className="text-xs uppercase tracking-wide text-atlas-muted">
        <tr>
          <th className="sticky left-0 z-10 bg-atlas-surface px-3 py-2 text-left">Metric</th>
          {rows.map(r => (
            <th key={r.fiscalYear} className="px-3 py-2">{r.fiscalYear}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {spec.map(s => (
          <tr key={s.label} className="border-t border-atlas-border">
            <td className="sticky left-0 z-10 bg-atlas-surface px-3 py-1.5 text-left text-atlas-muted">
              {s.label}
            </td>
            {rows.map(r => {
              let cell: string;
              if (s.kind === 'money') {
                cell = formatMoney(conv(r[s.key] as number | null | undefined), displayCcy);
              } else if (s.kind === 'percent') {
                cell = formatPercent(r[s.key] as number | null | undefined);
              } else if (s.kind === 'number') {
                const v = r[s.key] as number | null | undefined;
                cell = v == null ? '—'
                  : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: s.digits ?? 2 }).format(v);
              } else {
                cell = formatMoney(conv(s.compute(r)), displayCcy);
              }
              return <td key={r.fiscalYear} className="px-3 py-1.5">{cell}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GrowthRow({ label, g }: { label: string; g: { '10y': number | null; '5y': number | null; '3y': number | null } }) {
  const cell = (v: number | null) => {
    const cls = v == null ? 'text-atlas-muted'
      : v >= 0.10 ? 'text-atlas-positive'
      : v < 0    ? 'text-atlas-negative'
      : 'text-atlas-text';
    return <td className={`px-3 py-1.5 ${cls}`}>{formatPercent(v)}</td>;
  };
  return (
    <tr className="border-t border-atlas-border">
      <td className="px-3 py-1.5 text-left text-atlas-muted">{label}</td>
      {cell(g['10y'])}
      {cell(g['5y'])}
      {cell(g['3y'])}
    </tr>
  );
}

function PeerRow({
  company, fx, displayCcy, current = false,
}: { company: Company; fx: FxSnapshot; displayCcy: string; current?: boolean }) {
  const latest = company.historicalFinancials[company.historicalFinancials.length - 1];
  const conv = (v: number | null | undefined) =>
    convert(v ?? null, company.currency, displayCcy, fx);
  const mcap = convert(
    company.marketCap?.value ?? null,
    company.marketCap?.currency ?? company.currency,
    displayCcy, fx,
  );
  const mcapReporting = convert(
    company.marketCap?.value ?? null,
    company.marketCap?.currency ?? company.currency,
    company.currency, fx,
  );
  const pe = mcapReporting && latest?.netIncome ? mcapReporting / latest.netIncome : null;

  return (
    <tr className={`border-t border-atlas-border ${current ? 'bg-atlas-accent/5' : 'hover:bg-atlas-border/30'}`}>
      <td className="px-3 py-1.5 text-left">
        {current ? (
          <span className="flex items-center gap-2">
            <span className="font-mono">{company.ticker}</span>
            <span className="truncate text-atlas-muted">{company.name}</span>
            <span className="rounded bg-atlas-accent/20 px-1.5 text-[10px] uppercase text-atlas-accent">this</span>
          </span>
        ) : (
          <Link href={`${BP}/company/${company.ticker}/`} className="flex items-center gap-2 hover:text-atlas-accent">
            <span className="font-mono">{company.ticker}</span>
            <span className="truncate text-atlas-muted">{company.name}</span>
          </Link>
        )}
      </td>
      <td className="px-3 py-1.5">{formatMoney(mcap, displayCcy)}</td>
      <td className="px-3 py-1.5">{formatMoney(conv(latest?.revenue), displayCcy)}</td>
      <td className="px-3 py-1.5">{formatMoney(conv(latest?.netIncome), displayCcy)}</td>
      <td className="px-3 py-1.5">{pe == null ? '—' : pe.toFixed(1)}</td>
      <td className="px-3 py-1.5">{formatPercent(company.ratios.roe)}</td>
      <td className="px-3 py-1.5">{formatPercent(company.ratios.roic)}</td>
      <td className="px-3 py-1.5">{formatPercent(company.ratios.operatingMargin)}</td>
      <td className="px-3 py-1.5">{company.ratios.debtToEquity?.toFixed(2) ?? '—'}</td>
    </tr>
  );
}
