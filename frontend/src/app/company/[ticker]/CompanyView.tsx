'use client';

import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useMemo, useState } from 'react';
import type { Company, FxSnapshot, HistoricalYear, QuarterlyRow, HolderRow, SectorStats } from '@/lib/types';
import { SUPPORTED_DISPLAY_CCYS, convert, formatMoney, formatPercent } from '@/lib/fx';
import WatchlistButton from './WatchlistButton';
import Link from 'next/link';
import { BP } from '@/lib/basePath';
import CompanyLogo from '@/components/CompanyLogo';

function domainOf(website?: string | null): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, '');
  } catch { return null; }
}

const SERIES = [
  { key: 'revenue',      label: 'Revenue',        color: '#5eead4' },
  { key: 'netIncome',    label: 'Net income',     color: '#a78bfa' },
  { key: 'freeCashFlow', label: 'Free cash flow', color: '#f59e0b' },
] as const;
type SeriesKey = typeof SERIES[number]['key'];

// ────────────────────────────────────────────────────────────────────────────
// helpers

/**
 * Compute CAGR over an explicit `years` window. Returns null if the *tail* of
 * `series` doesn't actually contain `years + 1` valid (positive) data points
 * separated by that many years.
 *
 * Why this matters: yfinance free tier ships ~4y of history. A naive
 * `cagr(tail(series, 11))` would silently fall back to whatever shorter window
 * the data actually has — making the "10y", "5y", and "3y" cells show the
 * same number for any company without ten years of history.
 */
function cagrFor(
  series: (number | null | undefined)[],
  years: number,
): number | null {
  if (series.length < years + 1) return null;
  const start = series[series.length - 1 - years];
  const end   = series[series.length - 1];
  if (start == null || end == null || start <= 0 || end <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

function impliedEquity(c: Company, row?: HistoricalYear): number | null {
  // Approximation: equity = totalDebt / debtToEquity. Real balance-sheet data lands later.
  const d = row?.totalDebt ?? c.fundamentals.totalDebt;
  const de = c.ratios.debtToEquity;
  if (d == null || !de || de <= 0) return null;
  return d / de;
}

// ────────────────────────────────────────────────────────────────────────────

export default function CompanyView({
  company, fx, peers = [], sectorStat, similar = [],
}: {
  company: Company;
  fx: FxSnapshot;
  peers?: Company[];
  sectorStat?: SectorStats;
  similar?: Company[];
}) {
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
    const rev  = pick('revenue');
    const ni   = pick('netIncome');
    const fcf  = pick('freeCashFlow');
    return {
      revenue:   { '10y': cagrFor(rev, 10), '5y': cagrFor(rev, 5), '3y': cagrFor(rev, 3) },
      netIncome: { '10y': cagrFor(ni,  10), '5y': cagrFor(ni,  5), '3y': cagrFor(ni,  3) },
      fcf:       { '10y': cagrFor(fcf, 10), '5y': cagrFor(fcf, 5), '3y': cagrFor(fcf, 3) },
    };
  }, [hist]);

  // ── Investment thesis: bull / bear / neutral, tied to sector medians where
  // available so "High ROIC" means "above sector median" not an arbitrary 15%.
  const thesis = useMemo(
    () => buildThesis(company, latest, growth, fcfYield, pe, sectorStat),
    [company, latest, growth, fcfYield, pe, sectorStat],
  );

  // ── Smart red flags: opinionated checks from the annual statements.
  const redFlags = useMemo(() => detectRedFlags(hist), [hist]);

  // ── Quality / Growth / Valuation scores (each 0-10), plus overall.
  const scores = useMemo(
    () => computeScores(company, latest, growth, fcfYield, pe, sectorStat),
    [company, latest, growth, fcfYield, pe, sectorStat],
  );

  // ── Quarter-over-quarter deltas for the "What Changed?" card.
  const qoq = useMemo(() => computeQoq(company.quarterlyFinancials || []), [company.quarterlyFinancials]);

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
        <div className="flex items-start gap-3">
          <CompanyLogo
            domain={domainOf(company.website)}
            name={company.name}
            ticker={company.ticker}
            size={48}
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{company.name}</h1>
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
            {company.tags && company.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {company.tags
                  .filter(t => !t.startsWith('country-'))
                  .map(t => (
                    <Link key={t} href={`${BP}/tags/${t}/`}
                          className="rounded-full border border-atlas-border bg-atlas-surface px-2 py-0.5 text-[11px] text-atlas-muted hover:border-atlas-accent/40 hover:text-atlas-accent">
                      {t}
                    </Link>
                  ))}
              </div>
            )}
          </div>
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

      {/* About — collapsed by default so the KPIs/ratios are above the fold,
          especially on mobile. <details> handles open/close natively. */}
      {(company.description || company.headquarters || company.employees) && (
        <details className="group rounded-lg border border-atlas-border bg-atlas-surface">
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-atlas-border/30"
          >
            <span className="font-medium">About {company.name}</span>
            <span className="flex items-center gap-3 text-xs text-atlas-muted">
              {company.headquarters && <span className="hidden sm:inline">{company.headquarters}</span>}
              <span className="text-atlas-muted transition-transform group-open:rotate-180" aria-hidden>▾</span>
            </span>
          </summary>
          <div className="space-y-2 border-t border-atlas-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-atlas-muted">
              {company.headquarters && <span>📍 {company.headquarters}</span>}
              {company.employees != null && (
                <span>👥 {new Intl.NumberFormat('en').format(company.employees)} employees</span>
              )}
              {company.website && (
                <a href={company.website} target="_blank" rel="noopener noreferrer"
                   className="text-atlas-accent hover:underline">
                  {domainOf(company.website)} ↗
                </a>
              )}
            </div>
            {company.description && (
              <p className="max-w-4xl text-sm leading-relaxed text-atlas-muted">
                {company.description}
              </p>
            )}
          </div>
        </details>
      )}

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

      {/* Price chart — only when the ingest captured weekly closes */}
      {(company.price?.history?.length ?? 0) >= 4 && (
        <PriceChartCard
          history={company.price!.history!}
          priceCcy={company.price!.currency}
          displayCcy={displayCcy}
          fx={fx}
          hist={hist}
        />
      )}

      {/* Investment thesis — what users actually want from a research site:
          a 30-second take. Bull / Bear / Neutral arrays come from sector-aware
          heuristics so "high ROIC" means "above the sector median" not 15% flat. */}
      <ThesisCard thesis={thesis} />

      {/* Score cards */}
      <ScoreCards scores={scores} />

      {/* What changed since last quarter */}
      {qoq && <WhatChangedCard qoq={qoq} displayCcy={displayCcy} conv={conv} />}

      {/* Red flags — only render the card if something to flag. */}
      {redFlags.length > 0 && <RedFlagsCard flags={redFlags} />}

      {/* Chart */}
      <Card title={`${hist.length}-year fundamentals · ${displayCcy}`} subtitle={hist.length < 8 ? 'Showing all years available from the data provider (yfinance free tier). Full 10y history will arrive when SEC EDGAR / NSE filings adapters land.' : undefined} actions={
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

      <Card title="Quarterly results" subtitle={`Last ${(company.quarterlyFinancials || []).length} quarters · ${displayCcy}`}>
        {(!company.quarterlyFinancials || company.quarterlyFinancials.length === 0) ? (
          <p className="text-sm text-atlas-muted">
            Quarterly data not yet ingested for this company. The nightly pipeline pulls
            the most recent 8 quarters from yfinance — it will appear here after the next run.
          </p>
        ) : (
          <ScrollTable>
            <QuarterlyTable rows={company.quarterlyFinancials} displayCcy={displayCcy} conv={conv} />
          </ScrollTable>
        )}
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
            { label: 'Operating cash flow', kind: 'money',   key: 'operatingCashFlow' },
            { label: 'Investing cash flow', kind: 'money',   key: 'investingCashFlow' },
            { label: 'Financing cash flow', kind: 'money',   key: 'financingCashFlow' },
            { label: 'Net cash flow',       kind: 'derived', compute: r => {
              const o = r.operatingCashFlow ?? null;
              const i = r.investingCashFlow ?? null;
              const f = r.financingCashFlow ?? null;
              if (o == null && i == null && f == null) return null;
              return (o ?? 0) + (i ?? 0) + (f ?? 0);
            } },
            { label: 'Capex',               kind: 'money',   key: 'capex' },
            { label: 'Free cash flow',      kind: 'money',   key: 'freeCashFlow' },
            { label: 'Dividends paid',      kind: 'money',   key: 'dividendsPaid' },
          ]} />
        </ScrollTable>
      </Card>

      <Card title="Working capital" subtitle="Days outstanding · Cash conversion cycle">
        <ScrollTable>
          <WorkingCapitalTable rows={hist} />
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

      <CapitalAllocationCard rows={hist} displayCcy={displayCcy} conv={conv} />

      <MoatCard rows={hist} />

      <ScenarioCard
        company={company}
        latest={latest}
        mcap={mcap}
        displayCcy={displayCcy}
        currentPrice={
          company.price?.value != null
            ? convert(company.price.value, company.price.currency, displayCcy, fx)
            : null
        }
      />

      <Card title="Compounded growth" subtitle={hist.length < 11 ? `Only ${hist.length} years of data available · longer windows show ‘—’` : undefined}>
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

      {/* Peer comparison matrix — company vs sector median vs sector best.
          Renders only when we have sector stats for this company's sector. */}
      {sectorStat && (
        <PeerMatrixCard company={company} sectorStat={sectorStat} pe={pe} fcfYield={fcfYield} />
      )}

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

      {/* "You may also like" — precomputed nearest-neighbours by sector + size + ROIC + growth */}
      {similar.length > 0 && (
        <SimilarStocksStrip current={company.ticker} similar={similar} fx={fx} displayCcy={displayCcy} />
      )}

      {company.holders && (
        ((company.holders.institutional?.length ?? 0) > 0 ||
         (company.holders.mutualFund?.length ?? 0) > 0 ||
         (company.holders.summary && Object.keys(company.holders.summary).length > 0)) && (
          <Card title="Shareholding" subtitle={`Source: yfinance · ${holdersSubtitle(company.country)}`}>
            <HoldersSection holders={company.holders} country={company.country} />
          </Card>
        )
      )}

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

// ────────────────────────────────────────────────────────────────────────────
// Price chart — uses the 5y weekly close history captured by the ingest.
// Range buttons (1M / 6M / 1Y / 5Y / Max) slice the same series client-side.

const PRICE_RANGES: Array<{ key: string; days: number | null }> = [
  { key: '1M',  days: 31 },
  { key: '6M',  days: 183 },
  { key: 'YTD', days: -1 },          // sentinel — handled separately
  { key: '1Y',  days: 365 },
  { key: '5Y',  days: 365 * 5 },
  { key: 'Max', days: null },
];

function PriceChartCard({
  history, priceCcy, displayCcy, fx, hist,
}: {
  history: { d: string; c: number }[];
  priceCcy: string;
  displayCcy: string;
  fx: FxSnapshot;
  hist: HistoricalYear[];   // annual rows → drives trailing-EPS lookup for PE overlay
}) {
  const [range, setRange] = useState('1Y');
  const [showPe, setShowPe] = useState(true);

  // Pre-build a (year → trailing EPS) map so the PE line is cheap to compute
  // even at weekly granularity. Uses the prior fiscal year's EPS for each
  // price point (no leakage from filings published after the price date).
  const epsByYear = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of hist) {
      if (r.eps != null && r.fiscalYear != null) m.set(r.fiscalYear, r.eps);
    }
    return m;
  }, [hist]);

  const data = useMemo(() => {
    const now = Date.now();
    const cutoff = (() => {
      const r = PRICE_RANGES.find(x => x.key === range);
      if (!r || r.days === null) return -Infinity;
      if (r.days === -1) {  // YTD
        return new Date(new Date().getFullYear(), 0, 1).getTime();
      }
      return now - r.days * 86400 * 1000;
    })();
    return history
      .filter(p => new Date(p.d).getTime() >= cutoff)
      .map(p => {
        const priceConv = convert(p.c, priceCcy, displayCcy, fx) ?? p.c;
        // PE = price (in reporting ccy) / trailing EPS (in reporting ccy).
        // Use the price *before* converting so the ratio is currency-clean.
        const yr = new Date(p.d).getFullYear() - 1;  // prior FY's EPS, conservative
        const eps = epsByYear.get(yr);
        const pe  = (eps && eps > 0) ? p.c / eps : null;
        return { d: p.d, c: priceConv, pe };
      });
  }, [history, range, priceCcy, displayCcy, fx, epsByYear]);

  const first = data[0]?.c;
  const last  = data[data.length - 1]?.c;
  const chg   = (first != null && last != null && first > 0)
    ? (last - first) / first
    : null;
  const chgCls = chg == null ? 'text-atlas-muted'
    : chg >= 0 ? 'text-atlas-positive' : 'text-atlas-negative';

  // Only show the PE toggle when we actually have any non-null PE points in range.
  const hasPe = data.some(d => d.pe != null);

  return (
    <Card
      title="Stock price"
      subtitle={`Weekly close · ${displayCcy}`}
      actions={
        <div className="flex flex-wrap items-center gap-1">
          {hasPe && (
            <button
              onClick={() => setShowPe(s => !s)}
              className={`mr-2 rounded px-2 py-1 text-xs ${
                showPe
                  ? 'border border-amber-400/40 bg-amber-400/10 text-amber-300'
                  : 'border border-atlas-border text-atlas-muted hover:text-atlas-text'
              }`}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-400" />
              P/E
            </button>
          )}
          {PRICE_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded px-2 py-1 text-xs ${
                range === r.key
                  ? 'border border-atlas-accent/40 bg-atlas-accent/10 text-atlas-text'
                  : 'border border-atlas-border text-atlas-muted hover:text-atlas-text'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-2 flex items-baseline gap-3 text-sm">
        <span className="num text-lg font-semibold">{last != null ? formatMoney(last, displayCcy, { compact: false }) : '—'}</span>
        {chg != null && (
          <span className={`num ${chgCls}`}>
            {chg >= 0 ? '▲' : '▼'} {(chg * 100).toFixed(2)}% over {range}
          </span>
        )}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#1f2430" vertical={false} />
            <XAxis dataKey="d" stroke="#8a93a6" fontSize={11}
                   tickFormatter={(v: string) => {
                     const d = new Date(v);
                     return d.toLocaleString('en', { month: 'short', year: '2-digit' });
                   }} minTickGap={32} />
            <YAxis yAxisId="price" stroke="#8a93a6" fontSize={11}
                   domain={['auto', 'auto']}
                   tickFormatter={(v: number) =>
                     new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} />
            {hasPe && showPe && (
              <YAxis yAxisId="pe" orientation="right" stroke="#f59e0b" fontSize={11}
                     domain={['auto', 'auto']}
                     tickFormatter={(v: number) => v.toFixed(0)} />
            )}
            <Tooltip
              contentStyle={{ background: '#11141b', border: '1px solid #1f2430', borderRadius: 8 }}
              labelFormatter={(v: string) => new Date(v).toLocaleDateString('en')}
              formatter={(v: number, name: string) =>
                name === 'P/E'
                  ? v == null ? '—' : `${v.toFixed(1)}×`
                  : formatMoney(v, displayCcy, { compact: false })}
            />
            <Line yAxisId="price" type="monotone" dataKey="c"  stroke="#5eead4" strokeWidth={1.5} dot={false} name="Close" />
            {hasPe && showPe && (
              <Line yAxisId="pe" type="monotone" dataKey="pe" stroke="#f59e0b" strokeWidth={1} dot={false} name="P/E"
                    strokeDasharray="3 3" connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Quarterly results: 8-quarter table mirroring screener.in's "Quarterly Results"
// section. All money columns are converted to displayCcy; percentages are raw.

const QUARTER_SPEC: Array<{
  label: string;
  key: keyof QuarterlyRow;
  kind: 'money' | 'percent' | 'number';
  digits?: number;
}> = [
  { label: 'Revenue',          key: 'revenue',          kind: 'money' },
  { label: 'Operating profit', key: 'operatingIncome',  kind: 'money' },
  { label: 'OPM %',            key: 'operatingMargin',  kind: 'percent' },
  { label: 'Interest',         key: 'interestExpense',  kind: 'money' },
  { label: 'Depreciation',     key: 'depreciation',     kind: 'money' },
  { label: 'Profit before tax', key: 'pretaxIncome',    kind: 'money' },
  { label: 'Tax %',            key: 'taxRate',          kind: 'percent' },
  { label: 'Net profit',       key: 'netIncome',        kind: 'money' },
  { label: 'NPM %',            key: 'netMargin',        kind: 'percent' },
  { label: 'EPS',              key: 'eps',              kind: 'number', digits: 2 },
];

function QuarterlyTable({
  rows, displayCcy, conv,
}: {
  rows: QuarterlyRow[];
  displayCcy: string;
  conv: (v: number | null | undefined) => number | null;
}) {
  const fmtMoney = (v: number | null | undefined) => formatMoney(conv(v), displayCcy);
  const fmtNum = (v: number | null | undefined, digits = 2) =>
    v == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: digits }).format(v);

  // Show period as e.g. "Mar 2026"
  const periodLabel = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('en', { month: 'short', year: 'numeric' });
  };

  return (
    <table className="num min-w-full text-right text-sm">
      <thead className="text-xs uppercase tracking-wide text-atlas-muted">
        <tr>
          <th className="sticky left-0 z-10 bg-atlas-surface px-3 py-2 text-left">Metric</th>
          {rows.map(r => (
            <th key={r.periodEnd} className="px-3 py-2">{periodLabel(r.periodEnd)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {QUARTER_SPEC.map(s => (
          <tr key={s.label} className="border-t border-atlas-border">
            <td className="sticky left-0 z-10 bg-atlas-surface px-3 py-1.5 text-left text-atlas-muted">{s.label}</td>
            {rows.map(r => {
              const v = r[s.key] as number | null | undefined;
              const cell = s.kind === 'money'   ? fmtMoney(v)
                         : s.kind === 'percent' ? formatPercent(v)
                         :                        fmtNum(v, s.digits);
              return <td key={r.periodEnd} className="px-3 py-1.5">{cell}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Working capital ratios — DSO, DIO, DPO, CCC computed from the annual
// balance-sheet line items the new ingest captures.
//
//   DSO (debtor days)   = receivables / revenue * 365
//   DIO (inventory days) = inventory   / COGS    * 365
//   DPO (days payable)  = payables    / COGS    * 365
//   CCC (cash conv. cycle) = DSO + DIO − DPO
//
// COGS is approximated as revenue × (1 − grossMargin) when grossMargin is
// available; otherwise we fall back to revenue (which makes DIO/DPO directional
// rather than precise — labelled accordingly in the subtitle).

function _days(numer: number | null | undefined, denom: number | null | undefined): number | null {
  if (numer == null || denom == null || denom <= 0) return null;
  return (numer / denom) * 365;
}

function _cogs(r: HistoricalYear): number | null {
  if (r.revenue == null) return null;
  if (r.grossMargin != null) return r.revenue * (1 - r.grossMargin);
  return r.revenue; // fallback: approximate, but keeps trend meaningful
}

function WorkingCapitalTable({ rows }: { rows: HistoricalYear[] }) {
  const fmtDays = (v: number | null) => v == null ? '—' : `${Math.round(v)}d`;
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
        {[
          { label: 'Debtor days',    fn: (r: HistoricalYear) => _days(r.accountsReceivable, r.revenue) },
          { label: 'Inventory days', fn: (r: HistoricalYear) => _days(r.inventory,          _cogs(r)) },
          { label: 'Days payable',   fn: (r: HistoricalYear) => _days(r.accountsPayable,    _cogs(r)) },
          { label: 'Cash conversion cycle', fn: (r: HistoricalYear) => {
              const dso = _days(r.accountsReceivable, r.revenue);
              const dio = _days(r.inventory,          _cogs(r));
              const dpo = _days(r.accountsPayable,    _cogs(r));
              if (dso == null && dio == null && dpo == null) return null;
              return (dso ?? 0) + (dio ?? 0) - (dpo ?? 0);
          } },
        ].map(spec => (
          <tr key={spec.label} className="border-t border-atlas-border">
            <td className="sticky left-0 z-10 bg-atlas-surface px-3 py-1.5 text-left text-atlas-muted">{spec.label}</td>
            {rows.map(r => (
              <td key={r.fiscalYear} className="px-3 py-1.5">{fmtDays(spec.fn(r))}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Holders: insider/institution % summary + top institutional + mutual-fund tables.

// yfinance reports a per-region split through 'insiders %' vs 'institutions %'.
// In Indian disclosure terms the insider bucket maps to *promoter* holding,
// and US 13F-style institutional row data isn't published by NSE/BSE — only
// the aggregate percentage. We surface that distinction through the labels.
const INDIAN_COUNTRY = 'IN';

function holdersSubtitle(country: string): string {
  return country === INDIAN_COUNTRY
    ? 'aggregate split only · NSE doesn\u2019t publish per-holder filings'
    : 'institutional + fund filings';
}

function HoldersSection({ holders, country }: { holders: NonNullable<Company['holders']>; country: string }) {
  const fmtPct = (v: number | null | undefined) =>
    v == null ? '—' : `${(v * 100).toFixed(2)}%`;
  const fmtShares = (v: number | null | undefined) =>
    v == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(v);

  const isIN = country === INDIAN_COUNTRY;
  const labels = isIN
    ? {
        insiders:     'Promoter holding',
        institutions: 'Institutions (FII + DII)',
        float:        '% of float',
        count:        '# institutions',
      }
    : {
        insiders:     'Insiders',
        institutions: 'Institutions',
        float:        '% of float',
        count:        '# institutions',
      };

  const HolderTable = ({ title, rows }: { title: string; rows: HolderRow[] }) =>
    rows.length === 0 ? null : (
      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-atlas-muted">{title}</h3>
        <div className="overflow-x-auto">
          <table className="num min-w-full text-right text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-atlas-muted">
              <tr>
                <th className="px-3 py-1.5 text-left">Holder</th>
                <th className="px-3 py-1.5">Shares</th>
                <th className="px-3 py-1.5">% out</th>
                <th className="px-3 py-1.5">Reported</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h, i) => (
                <tr key={`${h.holder}-${i}`} className="border-t border-atlas-border">
                  <td className="px-3 py-1.5 text-left">{h.holder || '—'}</td>
                  <td className="px-3 py-1.5">{fmtShares(h.shares)}</td>
                  <td className="px-3 py-1.5">{fmtPct(h.pctOut)}</td>
                  <td className="px-3 py-1.5 text-atlas-muted">{h.reportDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

  const summary = holders.summary || {};
  const hasInstRows = (holders.institutional?.length ?? 0) > 0;
  const hasFundRows = (holders.mutualFund    ?.length ?? 0) > 0;
  return (
    <div className="space-y-4">
      {Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-atlas-border bg-atlas-border sm:grid-cols-4">
          {summary.insidersPct          && <Kpi label={labels.insiders}     value={summary.insidersPct} />}
          {summary.institutionsPct      && <Kpi label={labels.institutions} value={summary.institutionsPct} />}
          {summary.institutionsFloatPct && <Kpi label={labels.float}        value={summary.institutionsFloatPct} />}
          {summary.institutionsCount    && <Kpi label={labels.count}        value={summary.institutionsCount} />}
        </div>
      )}
      <HolderTable title="Top institutional holders" rows={holders.institutional || []} />
      <HolderTable title="Top mutual-fund holders"   rows={holders.mutualFund    || []} />
      {!hasInstRows && !hasFundRows && (
        <p className="text-xs text-atlas-muted">
          {isIN
            ? 'Per-holder breakdown isn\u2019t available — NSE/BSE only publish aggregate shareholding percentages, not 13F-style filings. The FII vs DII split would require BSE\u2019s quarterly XBRL filings, which aren\u2019t in our pipeline yet.'
            : 'Per-holder breakdown not published for this exchange. Only the aggregate split above is available.'}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Investment thesis: bull/bear/neutral buckets keyed off sector medians where
// available. Falls back to absolute thresholds when sector data is missing.

type ThesisItem = { kind: 'bull' | 'bear' | 'neutral'; text: string };

function buildThesis(
  company: Company,
  latest: HistoricalYear | undefined,
  growth: { revenue: any; netIncome: any; fcf: any },
  fcfYield: number | null,
  pe: number | null,
  sectorStat?: SectorStats,
): ThesisItem[] {
  const out: ThesisItem[] = [];
  const med = (m: string) => sectorStat?.metrics?.[m]?.median ?? null;

  const cmp = (v: number | null | undefined, sectorMedian: number | null, abs: number, higherBetter = true) => {
    if (v == null) return null;
    if (sectorMedian != null) return higherBetter ? v >= sectorMedian * 1.15 : v <= sectorMedian * 0.85;
    return higherBetter ? v >= abs : v <= abs;
  };

  const roic = latest?.roic ?? company.ratios.roic;
  const roe  = latest?.roe  ?? company.ratios.roe;
  const opm  = latest?.operatingMargin ?? company.ratios.operatingMargin;
  const grm  = latest?.grossMargin     ?? company.ratios.grossMargin;
  const de   = company.ratios.debtToEquity;
  const rev5 = growth.revenue['5y'];
  const ni5  = growth.netIncome['5y'];
  const fcf5 = growth.fcf['5y'];

  // ── Bull
  if (cmp(roic, med('roic'),  0.15)) out.push({ kind: 'bull', text: `ROIC of ${formatPercent(roic)} — capital is earning above-sector returns.` });
  if (cmp(roe,  med('roe'),   0.15)) out.push({ kind: 'bull', text: `ROE of ${formatPercent(roe)}.` });
  if (cmp(opm,  med('operatingMargin'), 0.20)) out.push({ kind: 'bull', text: `Operating margin ${formatPercent(opm)} — strong pricing power.` });
  if (cmp(grm,  med('grossMargin'),     0.50)) out.push({ kind: 'bull', text: `Gross margin ${formatPercent(grm)} — wide moat candidate.` });
  if (cmp(rev5, med('revenueCagr'),     0.10)) out.push({ kind: 'bull', text: `Revenue compounding ${formatPercent(rev5)} over 5y.` });
  if (cmp(fcf5, med('fcfCagr'),         0.10)) out.push({ kind: 'bull', text: `FCF compounding ${formatPercent(fcf5)} over 5y.` });
  if ((latest?.freeCashFlow ?? 0) > 0)         out.push({ kind: 'bull', text: 'Generates positive free cash flow.' });

  // ── Bear
  if (de != null && de > 1)                                                out.push({ kind: 'bear', text: `Elevated debt/equity of ${de.toFixed(2)}.` });
  if (opm != null && opm < 0.05)                                           out.push({ kind: 'bear', text: `Operating margin only ${formatPercent(opm)}.` });
  if (ni5  != null && ni5 < 0)                                             out.push({ kind: 'bear', text: 'Net income shrank over the last 5 years.' });
  if (fcf5 != null && fcf5 < 0)                                            out.push({ kind: 'bear', text: 'FCF compounding has been negative over 5y.' });
  if (pe != null && med('pe') != null && pe > (med('pe')! * 1.5))          out.push({ kind: 'bear', text: `P/E of ${pe.toFixed(1)} is well above sector median ${(med('pe')!).toFixed(1)} — priced for perfection.` });
  if (fcfYield != null && fcfYield < 0)                                    out.push({ kind: 'bear', text: 'Burning cash relative to market cap.' });

  // ── Neutral / context
  if (pe != null && med('pe') != null && Math.abs(pe - med('pe')!) / med('pe')! < 0.15)
    out.push({ kind: 'neutral', text: `Trades roughly in line with sector P/E (${pe.toFixed(1)} vs ${(med('pe')!).toFixed(1)}).` });
  if (company.sector) out.push({ kind: 'neutral', text: `Categorised as ${company.sector}${company.industry ? ` · ${company.industry}` : ''}.` });

  return out;
}

function ThesisCard({ thesis }: { thesis: ThesisItem[] }) {
  const bull    = thesis.filter(t => t.kind === 'bull');
  const bear    = thesis.filter(t => t.kind === 'bear');
  const neutral = thesis.filter(t => t.kind === 'neutral');
  const Bucket = ({ title, items, tone }: { title: string; items: ThesisItem[]; tone: string }) => (
    <Card title={title} subtitle={`${items.length} signal${items.length === 1 ? '' : 's'}`}>
      {items.length === 0 ? (
        <p className="text-sm text-atlas-muted">No signals.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map(i => (
            <li key={i.text} className="flex gap-2">
              <span className={tone}>•</span><span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Bucket title="Bull case"    items={bull}    tone="text-atlas-positive" />
      <Bucket title="Bear case"    items={bear}    tone="text-atlas-negative" />
      <Bucket title="Neutral"      items={neutral} tone="text-atlas-muted"    />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// What changed — quarter-over-quarter deltas.

type QoqDelta = {
  current:  QuarterlyRow;
  previous: QuarterlyRow;
  rows: Array<{ label: string; kind: 'money' | 'percent' | 'number'; cur: number | null | undefined; prev: number | null | undefined; lowerBetter?: boolean }>;
};

function computeQoq(qs: QuarterlyRow[]): QoqDelta | null {
  if (qs.length < 2) return null;
  const cur  = qs[qs.length - 1];
  const prev = qs[qs.length - 2];
  return {
    current: cur,
    previous: prev,
    rows: [
      { label: 'Revenue',          kind: 'money',   cur: cur.revenue,         prev: prev.revenue },
      { label: 'Operating profit', kind: 'money',   cur: cur.operatingIncome, prev: prev.operatingIncome },
      { label: 'Operating margin', kind: 'percent', cur: cur.operatingMargin, prev: prev.operatingMargin },
      { label: 'Net profit',       kind: 'money',   cur: cur.netIncome,       prev: prev.netIncome },
      { label: 'Net margin',       kind: 'percent', cur: cur.netMargin,       prev: prev.netMargin },
      { label: 'EPS',              kind: 'number',  cur: cur.eps,             prev: cur.eps != null && prev.eps != null ? prev.eps : prev.eps },
      { label: 'Tax rate',         kind: 'percent', cur: cur.taxRate,         prev: prev.taxRate, lowerBetter: true },
    ],
  };
}

function WhatChangedCard({
  qoq, displayCcy, conv,
}: {
  qoq: QoqDelta;
  displayCcy: string;
  conv: (v: number | null | undefined) => number | null;
}) {
  const periodLabel = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('en', { month: 'short', year: 'numeric' });
  };
  return (
    <Card
      title="What changed?"
      subtitle={`${periodLabel(qoq.previous.periodEnd)} → ${periodLabel(qoq.current.periodEnd)}`}
    >
      <div className="overflow-x-auto">
        <table className="num min-w-full text-right text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-atlas-muted">
            <tr>
              <th className="px-3 py-2 text-left">Metric</th>
              <th className="px-3 py-2">Previous</th>
              <th className="px-3 py-2">Current</th>
              <th className="px-3 py-2">Δ</th>
            </tr>
          </thead>
          <tbody>
            {qoq.rows.map(r => {
              const fmt = (v: number | null | undefined): string => {
                if (v == null) return '—';
                if (r.kind === 'percent') return formatPercent(v);
                if (r.kind === 'number')  return v.toFixed(2);
                return formatMoney(conv(v), displayCcy);
              };
              // Δ: absolute for %, percent for money/number
              let deltaCell: string = '—';
              let cls = 'text-atlas-muted';
              if (r.cur != null && r.prev != null) {
                let positive: boolean;
                if (r.kind === 'percent') {
                  const d = r.cur - r.prev;
                  positive = r.lowerBetter ? d <= 0 : d >= 0;
                  deltaCell = `${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)} pp`;
                } else {
                  if (r.prev === 0) {
                    positive = r.cur > 0;
                    deltaCell = '—';
                  } else {
                    const pct = (r.cur - r.prev) / Math.abs(r.prev);
                    positive = r.lowerBetter ? pct <= 0 : pct >= 0;
                    deltaCell = `${pct >= 0 ? '▲' : '▼'} ${(pct * 100).toFixed(1)}%`;
                  }
                }
                cls = positive ? 'text-atlas-positive' : 'text-atlas-negative';
              }
              return (
                <tr key={r.label} className="border-t border-atlas-border">
                  <td className="px-3 py-1.5 text-left text-atlas-muted">{r.label}</td>
                  <td className="px-3 py-1.5">{fmt(r.prev)}</td>
                  <td className="px-3 py-1.5">{fmt(r.cur)}</td>
                  <td className={`px-3 py-1.5 ${cls}`}>{deltaCell}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Red flags — opinionated checks against the annual statements.

type RedFlag = { severity: 'high' | 'med'; title: string; detail: string };

function detectRedFlags(hist: HistoricalYear[]): RedFlag[] {
  const out: RedFlag[] = [];
  if (hist.length < 2) return out;

  const last  = hist[hist.length - 1];
  const prev  = hist[hist.length - 2];

  // 1. Receivables growing materially faster than revenue → channel stuffing risk
  const dRev = pctChange(prev.revenue, last.revenue);
  const dRec = pctChange(prev.accountsReceivable, last.accountsReceivable);
  if (dRev != null && dRec != null && dRec > dRev + 0.15 && dRec > 0.20) {
    out.push({
      severity: 'high',
      title: 'Receivables growing faster than revenue',
      detail: `Accounts receivable up ${formatPercent(dRec)} vs revenue ${formatPercent(dRev)} year-over-year.`,
    });
  }

  // 2. Inventory spike vs revenue growth (excluding revenue-decline cases)
  const dInv = pctChange(prev.inventory, last.inventory);
  if (dRev != null && dInv != null && dRev > 0 && dInv > dRev + 0.25 && dInv > 0.30) {
    out.push({
      severity: 'med',
      title: 'Inventory build-up',
      detail: `Inventory grew ${formatPercent(dInv)} while revenue grew ${formatPercent(dRev)} — possible demand softness.`,
    });
  }

  // 3. Debt surge (>50% YoY)
  const dDebt = pctChange(prev.totalDebt, last.totalDebt);
  if (dDebt != null && dDebt > 0.5 && (last.totalDebt ?? 0) > 0) {
    out.push({
      severity: 'high',
      title: 'Sharp debt increase',
      detail: `Total debt grew ${formatPercent(dDebt)} year-over-year.`,
    });
  }

  // 4. CFO consistently less than reported PAT → earnings quality concern
  const tail3 = hist.slice(-3);
  if (tail3.length === 3) {
    const allLagging = tail3.every(r =>
      r.operatingCashFlow != null && r.netIncome != null
      && r.netIncome > 0 && r.operatingCashFlow < r.netIncome * 0.6,
    );
    if (allLagging) {
      out.push({
        severity: 'high',
        title: 'Cash flow not following earnings',
        detail: 'Operating cash flow has been < 60% of reported net income for 3 consecutive years.',
      });
    }
  }

  // 5. Multi-year negative FCF
  const fcfStreak = hist.slice(-3).every(r => (r.freeCashFlow ?? 0) < 0);
  if (fcfStreak && hist.length >= 3) {
    out.push({
      severity: 'med',
      title: 'Negative FCF streak',
      detail: 'Free cash flow has been negative for 3+ consecutive years.',
    });
  }

  return out;
}

function pctChange(prev: number | null | undefined, cur: number | null | undefined): number | null {
  if (prev == null || cur == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

function RedFlagsCard({ flags }: { flags: RedFlag[] }) {
  return (
    <Card title="⚠ Red flags" subtitle={`${flags.length} signal${flags.length === 1 ? '' : 's'} from the financials`}>
      <ul className="space-y-2 text-sm">
        {flags.map(f => (
          <li key={f.title} className="flex gap-2">
            <span className={f.severity === 'high' ? 'text-atlas-negative' : 'text-amber-300'}>
              {f.severity === 'high' ? '●' : '○'}
            </span>
            <div>
              <div className="font-medium">{f.title}</div>
              <div className="text-atlas-muted">{f.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Quality / Growth / Valuation scores — each is a 0–10 number derived from
// the most informative metrics in that bucket. Overall is the weighted mean.

type ScoreSet = { quality: number | null; growth: number | null; valuation: number | null; overall: number | null };

function computeScores(
  company: Company,
  latest: HistoricalYear | undefined,
  growth: { revenue: any; netIncome: any; fcf: any },
  fcfYield: number | null,
  pe: number | null,
  _sectorStat?: SectorStats,
): ScoreSet {
  // Scale: map raw value linearly into [0,1] within sensible bounds.
  const norm = (v: number | null | undefined, lo: number, hi: number) => {
    if (v == null || !isFinite(v)) return null;
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  };
  const invert = (v: number | null) => v == null ? null : 1 - v;
  const avg = (xs: (number | null)[]) => {
    const ok = xs.filter((x): x is number => x != null);
    return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
  };
  const score = (v: number | null) => v == null ? null : +(v * 10).toFixed(1);

  const quality = avg([
    norm(latest?.roe  ?? company.ratios.roe,  0,    0.30),
    norm(latest?.roic ?? company.ratios.roic, 0,    0.30),
    norm(latest?.operatingMargin ?? company.ratios.operatingMargin, 0, 0.30),
    invert(norm(company.ratios.debtToEquity, 0, 2)),
  ]);
  const grw = avg([
    norm(growth.revenue['5y']  , 0, 0.30),
    norm(growth.netIncome['5y'], 0, 0.30),
    norm(growth.fcf['5y']      , 0, 0.30),
  ]);
  const valuation = avg([
    invert(norm(pe, 5, 50)),
    norm(fcfYield, 0, 0.10),
  ]);
  const overall = avg([quality, grw, valuation]);
  return { quality: score(quality), growth: score(grw), valuation: score(valuation), overall: score(overall) };
}

function ScoreCards({ scores }: { scores: ScoreSet }) {
  const Tile = ({ label, score, max = 10 }: { label: string; score: number | null; max?: number }) => {
    const tone = score == null ? 'text-atlas-muted'
      : score >= 7 ? 'text-atlas-positive'
      : score >= 4 ? 'text-atlas-text'
      : 'text-atlas-negative';
    return (
      <div className="rounded-lg border border-atlas-border bg-atlas-surface px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-atlas-muted">{label}</div>
        <div className={`num mt-0.5 text-2xl font-semibold ${tone}`}>
          {score == null ? '—' : score.toFixed(1)}<span className="text-sm text-atlas-muted"> / {max}</span>
        </div>
      </div>
    );
  };
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Quality"   score={scores.quality} />
      <Tile label="Growth"    score={scores.growth} />
      <Tile label="Valuation" score={scores.valuation} />
      <Tile label="Overall"   score={scores.overall} />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Peer comparison matrix — company vs sector median vs sector best.

function PeerMatrixCard({
  company, sectorStat, pe, fcfYield,
}: {
  company: Company;
  sectorStat: SectorStats;
  pe: number | null;
  fcfYield: number | null;
}) {
  const rows: Array<{ label: string; key: string; companyVal: number | null | undefined; kind: 'percent' | 'number'; higherBetter: boolean }> = [
    { label: 'ROE',              key: 'roe',             companyVal: company.ratios.roe,              kind: 'percent', higherBetter: true },
    { label: 'ROIC',             key: 'roic',            companyVal: company.ratios.roic,             kind: 'percent', higherBetter: true },
    { label: 'Operating margin', key: 'operatingMargin', companyVal: company.ratios.operatingMargin,  kind: 'percent', higherBetter: true },
    { label: 'Net margin',       key: 'netMargin',       companyVal: company.ratios.netMargin,        kind: 'percent', higherBetter: true },
    { label: 'Gross margin',     key: 'grossMargin',     companyVal: company.ratios.grossMargin,      kind: 'percent', higherBetter: true },
    { label: 'Debt / Equity',    key: 'debtToEquity',    companyVal: company.ratios.debtToEquity,     kind: 'number',  higherBetter: false },
    { label: 'P / E',            key: 'pe',              companyVal: pe,                              kind: 'number',  higherBetter: false },
    { label: 'FCF yield',        key: 'fcfYield',        companyVal: fcfYield,                        kind: 'percent', higherBetter: true },
  ];
  const fmtVal = (v: number | null | undefined, k: 'percent' | 'number') => {
    if (v == null) return '—';
    return k === 'percent' ? formatPercent(v) : v.toFixed(2);
  };
  return (
    <Card title="Peer comparison" subtitle={`vs sector · ${sectorStat.count} ${company.sector} companies`}>
      <div className="overflow-x-auto">
        <table className="num min-w-full text-right text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-atlas-muted">
            <tr>
              <th className="px-3 py-2 text-left">Metric</th>
              <th className="px-3 py-2">{company.ticker}</th>
              <th className="px-3 py-2">Sector median</th>
              <th className="px-3 py-2">Best in sector</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const stat = sectorStat.metrics[r.key];
              let cls = 'text-atlas-text';
              if (r.companyVal != null && stat) {
                const beat = r.higherBetter ? r.companyVal > stat.median : r.companyVal < stat.median && r.companyVal > 0;
                cls = beat ? 'text-atlas-positive' : 'text-atlas-negative';
              }
              return (
                <tr key={r.label} className="border-t border-atlas-border">
                  <td className="px-3 py-1.5 text-left text-atlas-muted">{r.label}</td>
                  <td className={`px-3 py-1.5 font-medium ${cls}`}>{fmtVal(r.companyVal, r.kind)}</td>
                  <td className="px-3 py-1.5 text-atlas-muted">{stat ? fmtVal(stat.median, r.kind) : '—'}</td>
                  <td className="px-3 py-1.5 text-atlas-muted">
                    {stat ? (
                      <Link href={`${BP}/company/${stat.bestTicker}/`} className="hover:text-atlas-accent">
                        {fmtVal(stat.best, r.kind)} <span className="font-mono text-[10px]">({stat.bestTicker})</span>
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Capital allocation — what management did with the cash.

function CapitalAllocationCard({
  rows, displayCcy, conv,
}: {
  rows: HistoricalYear[];
  displayCcy: string;
  conv: (v: number | null | undefined) => number | null;
}) {
  // EDGAR returns these as positive outflows; yfinance returns them negative.
  // Normalise to a positive "amount returned/used" figure.
  const abs = (r: HistoricalYear, k: keyof HistoricalYear) => {
    const v = r[k] as number | null | undefined;
    if (v == null) return null;
    return Math.abs(v);
  };
  return (
    <Card title="Capital allocation" subtitle={`Annual outflows · ${displayCcy}`}>
      <ScrollTable>
        <table className="num min-w-full text-right text-sm">
          <thead className="text-xs uppercase tracking-wide text-atlas-muted">
            <tr>
              <th className="sticky left-0 z-10 bg-atlas-surface px-3 py-2 text-left">Use of cash</th>
              {rows.map(r => <th key={r.fiscalYear} className="px-3 py-2">{r.fiscalYear}</th>)}
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Capex',           fn: (r: HistoricalYear) => abs(r, 'capex') },
              { label: 'Dividends paid',  fn: (r: HistoricalYear) => abs(r, 'dividendsPaid') },
              { label: 'Stock buybacks',  fn: (r: HistoricalYear) => abs(r, 'stockBuyback') },
              { label: 'Debt repaid',     fn: (r: HistoricalYear) => abs(r, 'debtRepaid') },
              { label: 'Debt issued',     fn: (r: HistoricalYear) => abs(r, 'debtIssued') },
            ].map(spec => (
              <tr key={spec.label} className="border-t border-atlas-border">
                <td className="sticky left-0 z-10 bg-atlas-surface px-3 py-1.5 text-left text-atlas-muted">{spec.label}</td>
                {rows.map(r => (
                  <td key={r.fiscalYear} className="px-3 py-1.5">{formatMoney(conv(spec.fn(r)), displayCcy)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Moat indicators — derived purely from annual history.

function MoatCard({ rows }: { rows: HistoricalYear[] }) {
  if (rows.length < 4) {
    return (
      <Card title="Economic moat" subtitle="Need ≥ 4y of history for these indicators">
        <p className="text-sm text-atlas-muted">
          Only {rows.length} year{rows.length === 1 ? '' : 's'} of data available — moat metrics depend on multi-year consistency.
        </p>
      </Card>
    );
  }
  const grossMargins = rows.map(r => r.grossMargin).filter((v): v is number => v != null);
  const opMargins    = rows.map(r => r.operatingMargin).filter((v): v is number => v != null);
  const roics        = rows.map(r => r.roic).filter((v): v is number => v != null);

  const stdev = (xs: number[]) => {
    if (xs.length < 2) return null;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  };
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const grStdev = stdev(grossMargins);
  const grossStability = grStdev == null ? null
    : grStdev < 0.02 ? 'High'
    : grStdev < 0.05 ? 'Moderate'
    : 'Low';
  const aboveThreshold = roics.filter(r => r >= 0.15).length;
  const persistence = roics.length ? aboveThreshold / roics.length : null;
  const persLabel = persistence == null ? '—'
    : persistence >= 0.8 ? `Strong (${aboveThreshold}/${roics.length} years > 15%)`
    : persistence >= 0.5 ? `Moderate (${aboveThreshold}/${roics.length} years > 15%)`
    : `Weak (${aboveThreshold}/${roics.length} years > 15%)`;
  const opMed = median(opMargins);
  const pricingPower = opMed == null ? '—'
    : opMed >= 0.20 ? `Strong (${formatPercent(opMed)} median OPM)`
    : opMed >= 0.10 ? `Moderate (${formatPercent(opMed)} median OPM)`
    : `Weak (${formatPercent(opMed)} median OPM)`;

  return (
    <Card title="Economic moat" subtitle="Margin stability · ROIC persistence · Pricing power">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-atlas-muted">Gross margin stability</dt>
          <dd className="mt-0.5 text-sm">{grossStability ?? '—'} <span className="text-atlas-muted">(stdev {grStdev != null ? formatPercent(grStdev) : '—'})</span></dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-atlas-muted">ROIC persistence</dt>
          <dd className="mt-0.5 text-sm">{persLabel}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-atlas-muted">Pricing power</dt>
          <dd className="mt-0.5 text-sm">{pricingPower}</dd>
        </div>
      </dl>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// "You may also like" strip — horizontally scrollable cards of similar tickers.

function SimilarStocksStrip({
  current, similar, fx, displayCcy,
}: {
  current: string;
  similar: Company[];
  fx: FxSnapshot;
  displayCcy: string;
}) {
  return (
    <Card title="You may also like" subtitle="Same sector · similar size, ROIC and growth profile">
      <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-1">
        {similar.filter(s => s.ticker !== current).map(s => {
          const mcap = convert(
            s.marketCap?.value ?? null,
            s.marketCap?.currency ?? s.currency,
            displayCcy, fx,
          );
          return (
            <Link
              key={s.ticker}
              href={`${BP}/company/${s.ticker}/`}
              className="group flex w-44 shrink-0 flex-col rounded-lg border border-atlas-border bg-atlas-bg p-3 transition hover:border-atlas-accent/40"
            >
              <div className="flex items-center gap-2">
                <CompanyLogo
                  domain={s.website ? new URL(s.website.startsWith('http') ? s.website : `https://${s.website}`).hostname.replace(/^www\./, '') : null}
                  ticker={s.ticker}
                  name={s.name}
                  size={24}
                />
                <span className="font-mono text-[10px] text-atlas-muted">{s.ticker}</span>
              </div>
              <div className="mt-1.5 line-clamp-2 text-sm group-hover:text-atlas-accent">{s.name}</div>
              <div className="mt-2 text-[11px] text-atlas-muted">
                {formatMoney(mcap, displayCcy)} · ROE {formatPercent(s.ratios.roe)}
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario analysis — three sliders (revenue growth, net margin, exit P/E)
// project net income → market cap → annualised return over N years.
//
// Defaults pull from the company's own history so the initial sliders show
// the "no change vs trailing 5y" base case. Users move them to see what
// growth/margin/multiple shifts would do to the implied price.

function ScenarioCard({
  company, latest, mcap, displayCcy, currentPrice,
}: {
  company: Company;
  latest?: HistoricalYear;
  mcap: number | null;
  displayCcy: string;
  currentPrice: number | null;
}) {
  const hist = company.historicalFinancials;

  // Defaults derived from history. Bounded so sliders behave sensibly.
  const baseRev = latest?.revenue ?? null;
  const baseMargin = latest?.netMargin ?? null;
  const basePe = (() => {
    if (!mcap || !latest?.netIncome || latest.netIncome <= 0) return null;
    const ni = latest.netIncome;  // reporting ccy
    const mc = company.marketCap?.value ?? null;
    return mc && mc > 0 ? mc / ni : null;
  })();
  const baseShares = latest?.sharesOutstanding ?? null;

  // 5y revenue CAGR for "Use historical growth" hint.
  const cagr5y = useMemo(() => {
    const rev = hist.map(r => r.revenue ?? null);
    return cagrFor(rev, 5);
  }, [hist]);

  const [years,  setYears]  = useState(5);
  const [growth, setGrowth] = useState(() => clamp(cagr5y ?? 0.10, -0.20, 0.50));
  const [margin, setMargin] = useState(() => clamp(baseMargin ?? 0.10, -0.30, 0.60));
  const [exitPe, setExitPe] = useState(() => clamp(basePe ?? 20, 1, 80));

  // Cannot project without revenue + share count.
  if (baseRev == null || !baseShares || baseShares <= 0) {
    return (
      <Card title="Scenario analysis" subtitle="Project future earnings + return">
        <p className="text-sm text-atlas-muted">
          Need revenue and shares-outstanding to project earnings — those fields aren&apos;t available for this company yet.
        </p>
      </Card>
    );
  }

  // Forward projection.
  const futureRev    = baseRev * Math.pow(1 + growth, years);
  const futureNI     = futureRev * margin;
  const futureEps    = futureNI / baseShares;
  const futureMcapReporting = futureNI * exitPe;        // exit market cap in reporting ccy

  // Convert to display ccy for the headline (mcap is already in displayCcy).
  // If we have a current mcap, derive a unit factor; otherwise show in reporting ccy.
  const ccyFactor = mcap && company.marketCap?.value
    ? mcap / company.marketCap.value
    : 1;
  const futureMcapDisp = futureMcapReporting * ccyFactor;
  const futurePriceDisp = (futureMcapDisp ?? 0) / baseShares;

  const totalReturn = currentPrice && currentPrice > 0
    ? futurePriceDisp / currentPrice - 1
    : null;
  const annualReturn = totalReturn != null
    ? Math.pow(1 + totalReturn, 1 / years) - 1
    : null;

  const tone = annualReturn == null ? undefined
    : annualReturn >= 0.10 ? 'positive'
    : annualReturn < 0     ? 'negative'
    : undefined;

  return (
    <Card
      title="Scenario analysis"
      subtitle={`Project ${years} years forward · sliders are editable`}
      actions={
        <div className="flex gap-1">
          {[3, 5, 10].map(y => (
            <button
              key={y}
              onClick={() => setYears(y)}
              className={`rounded px-2 py-1 text-xs ${
                years === y
                  ? 'border border-atlas-accent/40 bg-atlas-accent/10 text-atlas-text'
                  : 'border border-atlas-border text-atlas-muted hover:text-atlas-text'
              }`}
            >
              {y}Y
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
        {/* Sliders */}
        <div className="space-y-3">
          <Slider
            label="Revenue growth (CAGR)"
            value={growth}
            min={-0.20} max={0.50} step={0.005}
            format={v => `${(v * 100).toFixed(1)}%`}
            hint={cagr5y != null ? `Trailing 5y: ${(cagr5y * 100).toFixed(1)}%` : 'No 5y CAGR available'}
            onChange={setGrowth}
          />
          <Slider
            label="Net margin"
            value={margin}
            min={-0.30} max={0.60} step={0.005}
            format={v => `${(v * 100).toFixed(1)}%`}
            hint={baseMargin != null ? `Current: ${(baseMargin * 100).toFixed(1)}%` : 'No current margin'}
            onChange={setMargin}
          />
          <Slider
            label="Exit P/E"
            value={exitPe}
            min={1} max={80} step={0.5}
            format={v => `${v.toFixed(1)}×`}
            hint={basePe != null ? `Current: ${basePe.toFixed(1)}×` : 'No current P/E'}
            onChange={setExitPe}
          />
        </div>

        {/* Outputs */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-atlas-border bg-atlas-border">
          <Kpi label={`Revenue (FY+${years})`} value={formatMoney(futureRev * ccyFactor, displayCcy)} />
          <Kpi label={`Net income (FY+${years})`} value={formatMoney(futureNI * ccyFactor, displayCcy)} />
          <Kpi label={`EPS (FY+${years})`} value={isFinite(futureEps) ? (futureEps * ccyFactor).toFixed(2) : '—'} sub={displayCcy} />
          <Kpi label={`Market cap (FY+${years})`} value={formatMoney(futureMcapDisp, displayCcy)} />
          <Kpi
            label={`Implied price (FY+${years})`}
            value={isFinite(futurePriceDisp) ? formatMoney(futurePriceDisp, displayCcy, { compact: false }) : '—'}
            sub={currentPrice != null ? `vs ${formatMoney(currentPrice, displayCcy, { compact: false })} today` : undefined}
          />
          <Kpi
            label="Annualised return"
            value={annualReturn == null ? '—' : `${annualReturn >= 0 ? '+' : ''}${(annualReturn * 100).toFixed(1)}%`}
            sub={totalReturn != null ? `${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(0)}% total` : undefined}
            tone={tone}
          />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-atlas-muted">
        Pure arithmetic: revenue × (1+g)<sup>n</sup>, × margin = net income, ÷ shares = EPS,
        × exit P/E = market cap, ÷ shares = price. Doesn&apos;t model buybacks, dilution, or FX drift.
      </p>
    </Card>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function Slider({
  label, value, min, max, step, format, hint, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-atlas-muted">{label}</span>
        <span className="num text-sm font-medium">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-atlas-accent"
      />
      {hint && <div className="text-[10px] text-atlas-muted">{hint}</div>}
    </div>
  );
}
