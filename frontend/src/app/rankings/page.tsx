'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CategoryEntry, FxSnapshot, ScreenerRow } from '@/lib/types';
import { convert, formatMoney } from '@/lib/fx';
import { BP } from '@/lib/basePath';
import { vUrl } from '@/lib/version';
import CompanyLogo from '@/components/CompanyLogo';

// Flag emoji from ISO 3166-1 alpha-2 (e.g. "US" → 🇺🇸)
function flag(country?: string): string {
  if (!country || country.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    ...country.toUpperCase().split('').map(c => A + c.charCodeAt(0) - 65),
  );
}

type SortKey =
  | 'rank' | 'name' | 'mcap' | 'price'
  | 'country' | 'sector' | 'pe' | 'pb' | 'revenue' | 'profit' | 'fcf';

const PAGE_SIZE = 100;

// The Sector dropdown carries two kinds of values:
//   sector:<yfinance sector>   → match on r.sector
//   tag:<category slug>        → match on r.tags including the slug
// '' means no filter.
type SectorFilter = '' | `sector:${string}` | `tag:${string}`;

export default function RankingsPage() {
  const [rows, setRows]             = useState<ScreenerRow[]>([]);
  const [fx, setFx]                 = useState<FxSnapshot | null>(null);
  const [categories, setCategories] = useState<CategoryEntry[]>([]);
  const [country, setCountry]       = useState<string>('');
  const [sector, setSector]         = useState<SectorFilter>('');
  const [search, setSearch]         = useState('');
  const [displayCcy, setDisplayCcy] = useState<'USD' | 'EUR' | 'INR' | 'JPY' | 'GBP'>('USD');
  const [sortKey, setSortKey]       = useState<SortKey>('rank');
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('asc');
  const [page, setPage]             = useState(0);

  useEffect(() => {
    fetch(vUrl(`${BP}/data/screener.json`)).then(r => r.json()).then(setRows);
    fetch(vUrl(`${BP}/data/fx/latest.json`)).then(r => r.json()).then(setFx);
    fetch(vUrl(`${BP}/data/categories.json`))
      .then(r => (r.ok ? r.json() : []))
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // Convert market cap + price to the chosen display currency once.
  const enriched = useMemo(() => {
    if (!fx) return [];
    return rows
      .map(r => {
        const ccy = r.currency || 'USD';
        return {
          ...r,
          mcapDisp:    convert(r.marketCap ?? null, r.marketCapCurrency || ccy, displayCcy, fx),
          priceDisp:   convert(r.price     ?? null, r.priceCurrency     || ccy, displayCcy, fx),
          revenueDisp: convert(r.revenue   ?? null, ccy,                         displayCcy, fx),
          profitDisp:  convert(r.netIncome ?? null, ccy,                         displayCcy, fx),
          fcfDisp:     convert(r.fcf       ?? null, ccy,                         displayCcy, fx),
        };
      })
      .filter(r => (r.mcapDisp ?? 0) > 0); // drop rows without a market cap
  }, [rows, fx, displayCcy]);

  // Global rank: by mcap desc in display ccy, independent of any filter.
  const ranked = useMemo(() => {
    const sorted = [...enriched].sort((a, b) => (b.mcapDisp ?? 0) - (a.mcapDisp ?? 0));
    return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [enriched]);

  const countries = useMemo(
    () => Array.from(new Set(ranked.map(r => r.country).filter(Boolean) as string[])).sort(),
    [ranked],
  );
  const sectors = useMemo(
    () => Array.from(new Set(ranked.map(r => r.sector).filter(Boolean) as string[])).sort(),
    [ranked],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ranked.filter(r => {
      if (country && r.country !== country) return false;
      if (sector.startsWith('sector:') && r.sector !== sector.slice(7)) return false;
      if (sector.startsWith('tag:') && !(r.tags || []).includes(sector.slice(4))) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.ticker.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ranked, country, sector, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    const NULL_LAST = sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'rank':    av = a.rank;             bv = b.rank;             break;
        case 'name':    av = a.name;             bv = b.name;             break;
        case 'mcap':    av = a.mcapDisp      ?? NULL_LAST; bv = b.mcapDisp      ?? NULL_LAST; break;
        case 'price':   av = a.priceDisp     ?? NULL_LAST; bv = b.priceDisp     ?? NULL_LAST; break;
        case 'revenue': av = a.revenueDisp   ?? NULL_LAST; bv = b.revenueDisp   ?? NULL_LAST; break;
        case 'profit':  av = a.profitDisp    ?? NULL_LAST; bv = b.profitDisp    ?? NULL_LAST; break;
        case 'fcf':     av = a.fcfDisp       ?? NULL_LAST; bv = b.fcfDisp       ?? NULL_LAST; break;
        case 'pe':      av = a.pe            ?? NULL_LAST; bv = b.pe            ?? NULL_LAST; break;
        case 'pb':      av = a.pb            ?? NULL_LAST; bv = b.pb            ?? NULL_LAST; break;
        case 'country': av = a.country || ''; bv = b.country || ''; break;
        case 'sector':  av = a.sector  || ''; bv = b.sector  || ''; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  useEffect(() => setPage(0), [country, sector, search, sortKey, sortDir]);

  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  const setSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // Text-y / rank columns ascend by default; numeric metrics descend.
      const ascByDefault = (['name', 'country', 'sector', 'rank', 'pe', 'pb'] as SortKey[]).includes(k);
      setSortDir(ascByDefault ? 'asc' : 'desc');
    }
  };

  if (!fx) return <div className="py-12 text-center text-sm text-atlas-muted">Loading rankings…</div>;

  const activeLabel =
    sector.startsWith('tag:')    ? categories.find(c => c.slug === sector.slice(4))?.label :
    sector.startsWith('sector:') ? sector.slice(7) :
    '';

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {activeLabel
            ? `Largest ${activeLabel} companies by market cap`
            : 'Largest companies by market cap'}
        </h1>
        <p className="text-sm text-atlas-muted">
          {ranked.length.toLocaleString()} companies across {countries.length} countries, ranked in {displayCcy}.
          Market caps converted using FX snapshot from {fx.asOf}.
        </p>
      </header>

      <section className="grid gap-3 rounded-lg border border-atlas-border bg-atlas-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or ticker…"
          className="rounded border border-atlas-border bg-atlas-bg px-2 py-1.5 text-sm"
        />
        <SelectField label="Country" value={country} options={countries} onChange={setCountry} render={c => `${flag(c)} ${c}`} />
        <label className="flex items-center gap-2 text-xs text-atlas-muted">
          Sector
          <select
            value={sector}
            onChange={e => setSector(e.target.value as SectorFilter)}
            className="flex-1 rounded border border-atlas-border bg-atlas-bg px-2 py-1.5 text-sm text-atlas-text"
          >
            <option value="">Any</option>
            {sectors.length > 0 && (
              <optgroup label="Sectors">
                {sectors.map(s => (
                  <option key={`s-${s}`} value={`sector:${s}`}>{s}</option>
                ))}
              </optgroup>
            )}
            {categories.length > 0 && (
              <optgroup label="Categories">
                {categories.map(c => (
                  <option key={`t-${c.slug}`} value={`tag:${c.slug}`}>{c.label} ({c.count})</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-atlas-muted">
          Display
          <select
            value={displayCcy}
            onChange={e => setDisplayCcy(e.target.value as any)}
            className="flex-1 rounded border border-atlas-border bg-atlas-bg px-2 py-1.5 text-sm text-atlas-text"
          >
            {(['USD', 'EUR', 'GBP', 'INR', 'JPY'] as const).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </section>

      <div className="flex items-center justify-between text-xs text-atlas-muted">
        <span>{sorted.length.toLocaleString()} results</span>
        <span>page {page + 1} / {totalPages}</span>
      </div>

      <section className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-surface">
        <table className="num min-w-full text-right text-sm">
          <thead className="bg-atlas-border/40 text-xs uppercase tracking-wide text-atlas-muted">
            <tr>
              <Th label="#"           onClick={() => setSort('rank')}    active={sortKey === 'rank'}    dir={sortDir} align="right" />
              <Th label="Company"     onClick={() => setSort('name')}    active={sortKey === 'name'}    dir={sortDir} align="left" />
              <Th label="Market cap"  onClick={() => setSort('mcap')}    active={sortKey === 'mcap'}    dir={sortDir} align="right" />
              <Th label="Price"       onClick={() => setSort('price')}   active={sortKey === 'price'}   dir={sortDir} align="right" hideBelow="sm" />
              <Th label="P/E"         onClick={() => setSort('pe')}      active={sortKey === 'pe'}      dir={sortDir} align="right" hideBelow="sm" />
              <Th label="Revenue"     onClick={() => setSort('revenue')} active={sortKey === 'revenue'} dir={sortDir} align="right" hideBelow="md" />
              <Th label="Profit"      onClick={() => setSort('profit')}  active={sortKey === 'profit'}  dir={sortDir} align="right" hideBelow="md" />
              <Th label="Country"     onClick={() => setSort('country')} active={sortKey === 'country'} dir={sortDir} align="left"  hideBelow="lg" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.ticker} className="border-t border-atlas-border hover:bg-atlas-border/30">
                <td className="px-3 py-1.5 text-right text-atlas-muted">{r.rank}</td>
                <td className="px-3 py-1.5 text-left">
                  <Link href={`${BP}/company/${r.ticker}/`} className="flex items-center gap-2 hover:text-atlas-accent">
                    <CompanyLogo domain={r.domain} ticker={r.ticker} name={r.name} size={24} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{r.name}</span>
                        <span className="font-mono text-[10px] text-atlas-muted">{r.ticker}</span>
                        <span className="text-xs">{flag(r.country)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-atlas-muted sm:hidden">
                        {r.priceDisp != null && <span>{formatMoney(r.priceDisp, displayCcy, { compact: false })}</span>}
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-medium">{formatMoney(r.mcapDisp, displayCcy)}</td>
                <td className="hidden px-3 py-1.5 sm:table-cell">{r.priceDisp   == null ? '—' : formatMoney(r.priceDisp, displayCcy, { compact: false })}</td>
                <td className="hidden px-3 py-1.5 sm:table-cell">{r.pe          == null ? '—' : r.pe.toFixed(1)}</td>
                <td className="hidden px-3 py-1.5 md:table-cell">{r.revenueDisp == null ? '—' : formatMoney(r.revenueDisp, displayCcy)}</td>
                <td className="hidden px-3 py-1.5 md:table-cell">{r.profitDisp  == null ? '—' : formatMoney(r.profitDisp,  displayCcy)}</td>
                <td className="hidden px-3 py-1.5 text-left lg:table-cell">{flag(r.country)} <span className="text-atlas-muted">{r.country || '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <nav className="flex items-center justify-center gap-2">
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          className="rounded border border-atlas-border px-3 py-1 text-sm disabled:opacity-40"
        >← Prev</button>
        <span className="text-xs text-atlas-muted">{page + 1} / {totalPages}</span>
        <button
          onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          disabled={page >= totalPages - 1}
          className="rounded border border-atlas-border px-3 py-1 text-sm disabled:opacity-40"
        >Next →</button>
      </nav>
    </div>
  );
}

/* ───── tiny presentational helpers ──────────────────────────────────────── */

function Th({
  label, onClick, active, dir, align, hideBelow,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: 'asc' | 'desc';
  align: 'left' | 'right';
  hideBelow?: 'sm' | 'md' | 'lg';
}) {
  const hideCls = hideBelow ? `hidden ${hideBelow}:table-cell` : '';
  return (
    <th className={`${hideCls} px-3 py-2 ${align === 'left' ? 'text-left' : 'text-right'}`}>
      <button onClick={onClick} className={`uppercase tracking-wide ${active ? 'text-atlas-text' : 'text-atlas-muted'}`}>
        {label}{active && (dir === 'asc' ? ' ↑' : ' ↓')}
      </button>
    </th>
  );
}

function SelectField({
  label, value, options, onChange, render,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void; render?: (v: string) => string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-atlas-muted">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 rounded border border-atlas-border bg-atlas-bg px-2 py-1.5 text-sm text-atlas-text"
      >
        <option value="">Any</option>
        {options.map(o => <option key={o} value={o}>{render ? render(o) : o}</option>)}
      </select>
    </label>
  );
}
