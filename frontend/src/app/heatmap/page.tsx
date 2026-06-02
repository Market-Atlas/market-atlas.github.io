'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, Treemap } from 'recharts';
import type { ScreenerRow } from '@/lib/types';
import { BP } from '@/lib/basePath';
import { vUrl } from '@/lib/version';

// ── colour ramp ─────────────────────────────────────────────────────────────
// Map a day-change % to an HSL string. Symmetric around 0:
//   < -5 % → deep red       0 % → neutral grey       > +5 % → deep green
// Clamps at ±5 % so a single 30% spike doesn't wash out the rest.
function tileColor(pct: number | null | undefined): string {
  if (pct == null || !isFinite(pct)) return '#1f2430';
  const clamped = Math.max(-0.05, Math.min(0.05, pct));
  const intensity = Math.min(1, Math.abs(clamped) / 0.05);
  if (clamped >= 0) {
    // green: hsl(150, 50%, lightness)
    const l = 18 + intensity * 22;
    return `hsl(150 55% ${l}%)`;
  }
  const l = 18 + intensity * 22;
  return `hsl(0 55% ${l}%)`;
}

type GroupBy = 'sector' | 'country' | 'tag';
type SizeBy  = 'marketCap' | 'count';

export default function HeatmapPage() {
  const [rows, setRows]       = useState<ScreenerRow[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('sector');
  const [sizeBy,  setSizeBy]  = useState<SizeBy>('marketCap');
  const [country, setCountry] = useState<string>('');     // optional country filter

  useEffect(() => {
    fetch(vUrl(`${BP}/data/screener.json`)).then(r => r.json()).then(setRows);
  }, []);

  const countries = useMemo(
    () => Array.from(new Set(rows.map(r => r.country).filter(Boolean) as string[])).sort(),
    [rows],
  );

  // Build the treemap data: outer = group, inner = company tiles.
  const data = useMemo(() => {
    if (rows.length === 0) return [];
    const filtered = country ? rows.filter(r => r.country === country) : rows;

    // Group key resolution. For 'tag' we pick the *first* non-cap, non-country
    // tag so a company shows up exactly once.
    const keyOf = (r: ScreenerRow): string | null => {
      if (groupBy === 'sector')  return r.sector || null;
      if (groupBy === 'country') return r.country || null;
      const t = (r.tags || []).find(t =>
        !t.startsWith('country-') &&
        !['large-cap','mid-cap','small-cap','mega-cap','micro-cap'].includes(t),
      );
      return t || null;
    };

    const groups = new Map<string, ScreenerRow[]>();
    for (const r of filtered) {
      const k = keyOf(r);
      if (!k) continue;
      const arr = groups.get(k) ?? [];
      arr.push(r);
      groups.set(k, arr);
    }

    return Array.from(groups.entries()).map(([name, members]) => ({
      name,
      children: members
        .filter(r => (r.marketCap ?? 0) > 0)
        .map(r => ({
          name:    r.ticker,
          fullName: r.name,
          size:    sizeBy === 'count' ? 1 : (r.marketCap ?? 0),
          dayChangePct: r.dayChangePct ?? null,
        }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 40),  // cap per-group tile count so labels stay readable
    }))
    .filter(g => g.children.length > 0)
    .sort((a, b) => b.children.reduce((s, c) => s + c.size, 0)
                  - a.children.reduce((s, c) => s + c.size, 0));
  }, [rows, country, groupBy, sizeBy]);

  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-atlas-muted">Loading heatmap…</div>;
  }

  // Top-line summary: how many tickers have a day-change at all?
  const withChange = rows.filter(r => r.dayChangePct != null).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market heatmap</h1>
          <p className="text-sm text-atlas-muted">
            Each tile is a company. Size = market cap, colour = day&nbsp;%. Click to open the company page.
            {withChange < rows.length * 0.5 && (
              <span className="ml-2 text-amber-400">
                ⚠ Day-change data is missing for many tickers — nightly cron is still re-ingesting.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-atlas-muted">
          <Seg label="Group by" value={groupBy} onChange={v => setGroupBy(v as GroupBy)} options={[
            { v: 'sector',  l: 'Sector'   },
            { v: 'country', l: 'Country'  },
            { v: 'tag',     l: 'Category' },
          ]} />
          <Seg label="Size by" value={sizeBy} onChange={v => setSizeBy(v as SizeBy)} options={[
            { v: 'marketCap', l: 'Market cap' },
            { v: 'count',     l: 'Equal'      },
          ]} />
          <label className="flex items-center gap-2">
            Country
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="rounded border border-atlas-border bg-atlas-bg px-2 py-1 text-sm text-atlas-text"
            >
              <option value="">All</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </header>

      <Legend />

      <section className="overflow-hidden rounded-lg border border-atlas-border bg-atlas-surface">
        <div className="h-[78vh]">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="size"
              stroke="#0e1116"
              animationDuration={250}
              content={<TileContent />}
            />
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

// ── Recharts custom tile renderer ───────────────────────────────────────────
// Recharts passes the node's geometry + payload. Group nodes (depth=1) get a
// header strip; leaf nodes (depth=2) get the colour fill + ticker + day %.

function TileContent(props: any) {
  const { depth, x, y, width, height, name, dayChangePct } = props;
  if (width <= 0 || height <= 0) return null;

  if (depth === 1) {
    // Group label — only render text if the box is big enough.
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill="transparent" stroke="#11141b" strokeWidth={2} />
        {width > 80 && height > 18 && (
          <text x={x + 6} y={y + 13} fill="#8a93a6" fontSize={11} className="select-none">
            {name}
          </text>
        )}
      </g>
    );
  }

  // Leaf — a company tile.
  const fill = tileColor(dayChangePct);
  const showLabel  = width > 32 && height > 18;
  const showChange = width > 60 && height > 28 && dayChangePct != null;
  const ticker = name;
  return (
    <g style={{ cursor: 'pointer' }}>
      <Link href={`${BP}/company/${ticker}/`}>
        <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#11141b" />
        {showLabel && (
          <text
            x={x + width / 2} y={y + height / 2 - (showChange ? 4 : 0)}
            fill="#fff" fontSize={Math.min(12, Math.max(8, Math.sqrt(width * height) / 9))}
            textAnchor="middle" dominantBaseline="middle"
            className="select-none font-mono pointer-events-none"
          >
            {ticker}
          </text>
        )}
        {showChange && (
          <text
            x={x + width / 2} y={y + height / 2 + 9}
            fill="#fff" fontSize={Math.min(10, Math.max(7, Math.sqrt(width * height) / 12))}
            textAnchor="middle" dominantBaseline="middle"
            className="select-none pointer-events-none"
            opacity={0.85}
          >
            {(dayChangePct >= 0 ? '+' : '')}{(dayChangePct * 100).toFixed(1)}%
          </text>
        )}
      </Link>
    </g>
  );
}

function Seg({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <span className="inline-flex overflow-hidden rounded border border-atlas-border">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-2 py-1 text-xs ${
              value === o.v
                ? 'bg-atlas-accent/15 text-atlas-accent'
                : 'bg-atlas-surface text-atlas-muted hover:text-atlas-text'
            }`}
          >
            {o.l}
          </button>
        ))}
      </span>
    </span>
  );
}

function Legend() {
  // 9 swatches from -5 % → +5 % to give the eye a calibration anchor.
  const stops = [-0.05, -0.03, -0.015, -0.005, 0, 0.005, 0.015, 0.03, 0.05];
  return (
    <div className="flex items-center gap-2 text-[11px] text-atlas-muted">
      <span>−5 %</span>
      <div className="flex h-3 overflow-hidden rounded border border-atlas-border">
        {stops.map((s, i) => (
          <span key={i} style={{ background: tileColor(s), width: 22, height: 12, display: 'block' }} />
        ))}
      </div>
      <span>+5 %</span>
    </div>
  );
}
