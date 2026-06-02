'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FxSnapshot, ScreenerRow } from '@/lib/types';
import { convert, formatMoney, formatPercent } from '@/lib/fx';
import { BP } from '@/lib/basePath';
import { vUrl } from '@/lib/version';
import { readWatchlist, setQty, subscribeWatchlist, writeWatchlist, type WatchItem } from '@/lib/watchlist';

type Tab = 'watch' | 'portfolio';

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [rows, setRows]   = useState<ScreenerRow[]>([]);
  const [fx, setFx]       = useState<FxSnapshot | null>(null);
  const [tab, setTab]     = useState<Tab>('watch');
  const [displayCcy, setDisplayCcy] = useState<'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY'>('USD');

  // Hydrate from localStorage + listen for changes (cross-tab too).
  useEffect(() => {
    setItems(readWatchlist());
    return subscribeWatchlist(() => setItems(readWatchlist()));
  }, []);

  // The screener row gives us mcap, sector, country, ratios for analytics.
  useEffect(() => {
    fetch(vUrl(`${BP}/data/screener.json`)).then(r => r.json()).then(setRows);
    fetch(vUrl(`${BP}/data/fx/latest.json`)).then(r => r.json()).then(setFx);
  }, []);

  const rowByTicker = useMemo(() => {
    const m = new Map<string, ScreenerRow>();
    for (const r of rows) m.set(r.ticker, r);
    return m;
  }, [rows]);

  const remove = (it: WatchItem) =>
    writeWatchlist(items.filter(i => !(i.ticker === it.ticker && i.kind === it.kind)));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist & Portfolio</h1>
          <p className="text-sm text-atlas-muted">
            Saved locally in this browser. Set a quantity on each row to enable the portfolio view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex overflow-hidden rounded border border-atlas-border text-xs">
            {(['watch', 'portfolio'] as Tab[]).map(t => (
              <button key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 capitalize ${
                  tab === t
                    ? 'bg-atlas-accent/15 text-atlas-accent'
                    : 'bg-atlas-surface text-atlas-muted hover:text-atlas-text'
                }`}>
                {t}
              </button>
            ))}
          </span>
          <label className="flex items-center gap-2 text-xs text-atlas-muted">
            Display
            <select
              value={displayCcy}
              onChange={e => setDisplayCcy(e.target.value as any)}
              className="rounded border border-atlas-border bg-atlas-bg px-2 py-1 text-sm text-atlas-text"
            >
              {(['USD','EUR','GBP','INR','JPY'] as const).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </header>

      {items.length === 0 ? (
        <Empty />
      ) : tab === 'watch' ? (
        <WatchTable items={items} rowByTicker={rowByTicker} fx={fx} displayCcy={displayCcy} onRemove={remove} />
      ) : (
        <PortfolioView items={items} rowByTicker={rowByTicker} fx={fx} displayCcy={displayCcy} />
      )}
    </div>
  );
}

// ─── empty state ────────────────────────────────────────────────────────────

function Empty() {
  return (
    <div className="rounded-lg border border-dashed border-atlas-border bg-atlas-surface p-8 text-center text-sm text-atlas-muted">
      Your watchlist is empty. Open any company or ETF and tap ☆ to save it here.
    </div>
  );
}

// ─── watchlist table with editable quantity ────────────────────────────────

function WatchTable({
  items, rowByTicker, fx, displayCcy, onRemove,
}: {
  items: WatchItem[];
  rowByTicker: Map<string, ScreenerRow>;
  fx: FxSnapshot | null;
  displayCcy: string;
  onRemove: (it: WatchItem) => void;
}) {
  return (
    <section className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-surface">
      <table className="num min-w-full text-right text-sm">
        <thead className="bg-atlas-border/40 text-xs uppercase tracking-wide text-atlas-muted">
          <tr>
            <th className="px-3 py-2 text-left">Ticker</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="hidden px-3 py-2 text-left md:table-cell">Sector</th>
            <th className="px-3 py-2">Price</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2 text-right">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => {
            const r = rowByTicker.get(it.ticker);
            const priceDisp = fx && r?.price != null
              ? convert(r.price, r.priceCurrency || r.currency || 'USD', displayCcy, fx)
              : null;
            const value = (priceDisp ?? 0) * (it.qty ?? 0);
            return (
              <tr key={`${it.kind}:${it.ticker}`} className="border-t border-atlas-border hover:bg-atlas-border/30">
                <td className="px-3 py-1.5 text-left">
                  <Link
                    href={`${BP}/${it.kind === 'etf' ? 'etf' : 'company'}/${it.ticker}/`}
                    className="font-mono text-atlas-accent hover:underline"
                  >
                    {it.ticker}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-left">{r?.name || <span className="text-atlas-muted">—</span>}</td>
                <td className="hidden px-3 py-1.5 text-left text-atlas-muted md:table-cell">{r?.sector || '—'}</td>
                <td className="px-3 py-1.5">{priceDisp == null ? '—' : formatMoney(priceDisp, displayCcy, { compact: false })}</td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    defaultValue={it.qty ?? 0}
                    onBlur={e => setQty(it.ticker, it.kind, Number(e.target.value) || 0)}
                    className="w-20 rounded border border-atlas-border bg-atlas-bg px-1.5 py-0.5 text-right text-sm"
                  />
                </td>
                <td className="px-3 py-1.5 font-medium">{value > 0 ? formatMoney(value, displayCcy, { compact: false }) : '—'}</td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => onRemove(it)} className="text-xs text-atlas-muted hover:text-atlas-negative">Remove</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ─── portfolio analytics ────────────────────────────────────────────────────

function PortfolioView({
  items, rowByTicker, fx, displayCcy,
}: {
  items: WatchItem[];
  rowByTicker: Map<string, ScreenerRow>;
  fx: FxSnapshot | null;
  displayCcy: string;
}) {
  // Stitch each watchlist line to its screener row + convert price to displayCcy.
  // Drop lines without a quantity — those just live in the watchlist tab.
  const positions = useMemo(() => {
    if (!fx) return [];
    const out: Array<{
      ticker: string;
      name: string;
      qty: number;
      priceDisp: number;
      value: number;
      sector: string;
      country: string;
      tags: string[];
      dayChangePct: number | null;
      roic: number | null;
      pe: number | null;
      debtToEquity: number | null;
      marketCapUsd: number | null;
    }> = [];
    for (const it of items) {
      const r = rowByTicker.get(it.ticker);
      if (!r || !(it.qty && it.qty > 0)) continue;
      const priceDisp = r.price != null
        ? convert(r.price, r.priceCurrency || r.currency || 'USD', displayCcy, fx)
        : null;
      if (priceDisp == null) continue;
      out.push({
        ticker: r.ticker,
        name: r.name,
        qty: it.qty,
        priceDisp,
        value: priceDisp * it.qty,
        sector: r.sector || 'Unknown',
        country: r.country || 'Unknown',
        tags: r.tags || [],
        dayChangePct: r.dayChangePct ?? null,
        roic: r.roic ?? null,
        pe: r.pe ?? null,
        debtToEquity: r.debtToEquity ?? null,
        marketCapUsd: r.marketCapUsd ?? null,
      });
    }
    return out;
  }, [items, rowByTicker, fx, displayCcy]);

  const total = positions.reduce((s, p) => s + p.value, 0);

  // Sector allocation (descending by value).
  const allocation = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of positions) m.set(p.sector, (m.get(p.sector) || 0) + p.value);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [positions]);

  const countryAlloc = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of positions) m.set(p.country, (m.get(p.country) || 0) + p.value);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [positions]);

  // Day-change is a value-weighted average across positions that have a change.
  const portfolioDayChange = useMemo(() => {
    let num = 0, denom = 0;
    for (const p of positions) {
      if (p.dayChangePct == null) continue;
      num   += p.dayChangePct * p.value;
      denom += p.value;
    }
    return denom > 0 ? num / denom : null;
  }, [positions]);

  // Quality / valuation aggregates — value-weighted means.
  const weighted = (sel: (p: typeof positions[number]) => number | null) => {
    let num = 0, denom = 0;
    for (const p of positions) {
      const v = sel(p);
      if (v == null || !isFinite(v)) continue;
      num   += v * p.value;
      denom += p.value;
    }
    return denom > 0 ? num / denom : null;
  };

  const avgROIC = weighted(p => p.roic);
  const avgPE   = weighted(p => p.pe);
  const avgDE   = weighted(p => p.debtToEquity);

  // Mcap mix (mega / large / mid / small) — gives a feel for concentration risk.
  const sizeMix = useMemo(() => {
    const buckets = { 'Mega (>$200B)': 0, 'Large ($10B-$200B)': 0, 'Mid ($1B-$10B)': 0, 'Small (<$1B)': 0, Unknown: 0 };
    for (const p of positions) {
      const m = p.marketCapUsd;
      if (m == null)            buckets.Unknown += p.value;
      else if (m >= 200e9)      buckets['Mega (>$200B)'] += p.value;
      else if (m >= 10e9)       buckets['Large ($10B-$200B)'] += p.value;
      else if (m >= 1e9)        buckets['Mid ($1B-$10B)'] += p.value;
      else                       buckets['Small (<$1B)'] += p.value;
    }
    return Object.entries(buckets).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }, [positions]);

  // Concentration: top-5 % and Herfindahl index. HHI > 0.25 → highly concentrated.
  const sorted = useMemo(() => positions.slice().sort((a, b) => b.value - a.value), [positions]);
  const top5Pct = total > 0 ? sorted.slice(0, 5).reduce((s, p) => s + p.value, 0) / total : 0;
  const hhi     = total > 0 ? positions.reduce((s, p) => s + Math.pow(p.value / total, 2), 0) : 0;

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-atlas-border bg-atlas-surface p-8 text-center text-sm text-atlas-muted">
        Set a quantity (Qty column in the Watch tab) on at least one ticker to see portfolio analytics.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Headline KPIs */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-atlas-border bg-atlas-border sm:grid-cols-4">
        <Kpi label="Total value"     value={formatMoney(total, displayCcy, { compact: false })} />
        <Kpi label="Positions"       value={String(positions.length)} sub={`${allocation.length} sectors`} />
        <Kpi
          label="Day change"
          value={portfolioDayChange == null ? '—' : `${portfolioDayChange >= 0 ? '+' : ''}${(portfolioDayChange * 100).toFixed(2)}%`}
          tone={portfolioDayChange == null ? undefined : portfolioDayChange >= 0 ? 'positive' : 'negative'}
        />
        <Kpi
          label="Top-5 concentration"
          value={`${(top5Pct * 100).toFixed(0)}%`}
          sub={hhi > 0.25 ? 'Highly concentrated' : hhi > 0.15 ? 'Moderately concentrated' : 'Diversified'}
          tone={hhi > 0.25 ? 'negative' : hhi > 0.15 ? undefined : 'positive'}
        />
      </section>

      {/* Weighted ratios */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-atlas-border bg-atlas-border sm:grid-cols-3">
        <Kpi label="Weighted ROIC"  value={formatPercent(avgROIC)}              tone={avgROIC == null ? undefined : avgROIC >= 0.15 ? 'positive' : 'negative'} />
        <Kpi label="Weighted P/E"   value={avgPE == null ? '—' : avgPE.toFixed(1)} tone={avgPE  == null ? undefined : avgPE <= 25 ? 'positive' : 'negative'} />
        <Kpi label="Weighted D/E"   value={avgDE == null ? '—' : avgDE.toFixed(2)} tone={avgDE  == null ? undefined : avgDE <= 0.5 ? 'positive' : 'negative'} />
      </section>

      {/* Allocation bars */}
      <div className="grid gap-4 lg:grid-cols-3">
        <AllocCard title="Sector allocation"  rows={allocation}   total={total} displayCcy={displayCcy} />
        <AllocCard title="Country allocation" rows={countryAlloc} total={total} displayCcy={displayCcy} />
        <AllocCard title="Market-cap mix"     rows={sizeMix}      total={total} displayCcy={displayCcy} />
      </div>

      {/* Holdings ranked */}
      <section className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-surface">
        <table className="num min-w-full text-right text-sm">
          <thead className="bg-atlas-border/40 text-xs uppercase tracking-wide text-atlas-muted">
            <tr>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="hidden px-3 py-2 text-left md:table-cell">Sector</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">% port</th>
              <th className="hidden px-3 py-2 sm:table-cell">Today</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const pct = total > 0 ? p.value / total : 0;
              const dc  = p.dayChangePct;
              return (
                <tr key={p.ticker} className="border-t border-atlas-border hover:bg-atlas-border/30">
                  <td className="px-3 py-1.5 text-left">
                    <Link href={`${BP}/company/${p.ticker}/`} className="font-mono text-atlas-accent hover:underline">{p.ticker}</Link>
                  </td>
                  <td className="px-3 py-1.5 text-left">{p.name}</td>
                  <td className="hidden px-3 py-1.5 text-left text-atlas-muted md:table-cell">{p.sector}</td>
                  <td className="px-3 py-1.5">{p.qty}</td>
                  <td className="px-3 py-1.5">{formatMoney(p.priceDisp, displayCcy, { compact: false })}</td>
                  <td className="px-3 py-1.5 font-medium">{formatMoney(p.value, displayCcy, { compact: false })}</td>
                  <td className="px-3 py-1.5">{(pct * 100).toFixed(1)}%</td>
                  <td className={`hidden px-3 py-1.5 sm:table-cell ${dc == null ? 'text-atlas-muted' : dc >= 0 ? 'text-atlas-positive' : 'text-atlas-negative'}`}>
                    {dc == null ? '—' : `${dc >= 0 ? '▲ +' : '▼ '}${(dc * 100).toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── small presentational helpers ──────────────────────────────────────────

function Kpi({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' }) {
  const cls = tone === 'positive' ? 'text-atlas-positive'
            : tone === 'negative' ? 'text-atlas-negative'
            : 'text-atlas-text';
  return (
    <div className="bg-atlas-surface p-3">
      <div className="text-[10px] uppercase tracking-wide text-atlas-muted">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-atlas-muted">{sub}</div>}
    </div>
  );
}

function AllocCard({
  title, rows, total, displayCcy,
}: { title: string; rows: Array<[string, number]>; total: number; displayCcy: string }) {
  return (
    <section className="rounded-lg border border-atlas-border bg-atlas-surface">
      <header className="border-b border-atlas-border px-4 py-2.5 text-sm font-medium">{title}</header>
      <div className="space-y-2 p-4">
        {rows.map(([name, val]) => {
          const pct = total > 0 ? val / total : 0;
          return (
            <div key={name} className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-atlas-muted">{name}</span>
                <span className="num">
                  {formatMoney(val, displayCcy, { compact: false })}{' '}
                  <span className="text-atlas-muted">· {(pct * 100).toFixed(1)}%</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-atlas-border">
                <div className="h-full bg-atlas-accent" style={{ width: `${pct * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
