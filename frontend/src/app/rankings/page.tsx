'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FxSnapshot, ScreenerRow } from '@/lib/types';
import { convert, formatMoney, formatPercent } from '@/lib/fx';
import { BP } from '@/lib/basePath';
import CompanyLogo from '@/components/CompanyLogo';

// Flag emoji from ISO 3166-1 alpha-2 (e.g. "US" → 🇺🇸)
function flag(country?: string): string {
  if (!country || country.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(...country.toUpperCase().split('').map(c => A + c.charCodeAt(0) - 65));
}

type SortKey = 'rank' | 'name' | 'mcap' | 'price' | 'country' | 'sector';
const PAGE_SIZE = 100;

export default function RankingsPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [fx, setFx] = useState<FxSnapshot | null>(null);
  const [country, setCountry] = useState<string>('');
  const [sector, setSector] = useState<string>('');
  const [search, setSearch] = useState('');
  const [displayCcy, setDisplayCcy] = useState<'USD' | 'EUR' | 'INR' | 'JPY' | 'GBP'>('USD');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch(`${BP}/data/screener.json`).then(r => r.json()).then(setRows);
    fetch(`${BP}/data/fx/latest.json`).then(r => r.json()).then(setFx);
  }, []);

  // Convert market cap + price to the chosen display currency once.
  const enriched = useMemo(() => {
    if (!fx) return [];
    return rows
      .map(r => ({
        ...r,
        mcapDisp: convert(r.marketCap ?? null, r.marketCapCurrency || r.currency || 'USD', displayCcy, fx),
        priceDisp: convert(r.price ?? null, r.priceCurrency || r.currency || 'USD', displayCcy, fx),
      }))
      .filter(r => (r.mcapDisp ?? 0) > 0); // drop rows without a market cap
  }, [rows, fx, displayCcy]);

  // Global rank: independent of filter, by mcap desc in display ccy.
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
      if (sector && r.sector !== sector) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.ticker.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ranked, country, sector, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'rank':    av = a.rank;            bv = b.rank;            break;
        case 'name':    av = a.name;            bv = b.name;            break;
        case 'mcap':    av = a.mcapDisp ?? 0;   bv = b.mcapDisp ?? 0;   break;
        case 'price':   av = a.priceDisp ?? 0;  bv = b.priceDisp ?? 0;  break;
        case 'country': av = a.country || '';   bv = b.country || '';   break;
        case 'sector':  av = a.sector  || '';   bv = b.sector  || '';   break;
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
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'name' || k === 'country' || k === 'sector' ? 'asc' : 'desc'); }
  };

  if (!fx) return <div className="py-12 text-center text-sm text-atlas-muted">Loading rankings…</div>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Largest companies by market cap</h1>
        <p className="text-sm text-atlas-muted">
          {ranked.length.toLocaleString()} companies across {countries.length} countries, ranked in {displayCcy}.
          Market caps are converted from each company&apos;s reporting currency using
          the FX snapshot as of {fx.asOf}.
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
        <SelectField label="Sector"  value={sector}  options={sectors}  onChange={setSector} />
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
              <Th label="#"            onClick={() => setSort('rank')}    active={sortKey === 'rank'}    dir={sortDir} align="right" />
              <Th label="Company"      onClick={() => setSort('name')}    active={sortKey === 'name'}    dir={sortDir} align="left" />
              <Th label="Market cap"   onClick={() => setSort('mcap')}    active={sortKey === 'mcap'}    dir={sortDir} align="right" />
              <Th label="Price"        onClick={() => setSort('price')}   active={sortKey === 'price'}   dir={sortDir} align="right" />
              <Th label="Country"      onClick={() => setSort('country')} active={sortKey === 'country'} dir={sortDir} align="left" />
              <th className="px-3 py-2 text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.ticker} className="border-t border-atlas-border hover:bg-atlas-border/30">
                <td className="px-3 py-1.5 text-right text-atlas-muted">{r.rank}</td>
                <td className="px-3 py-1.5 text-left">
                  <Link href={`${BP}/company/${r.ticker}/`} className="flex items-center gap-2 hover:text-atlas-accent">
                    <CompanyLogo domain={r.domain} ticker={r.ticker} name={r.name} size={20} />
                    <span className="font-mono text-xs text-atlas-muted">{r.ticker}</span>
                    <span className="truncate">{r.name}</span>
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-medium">{formatMoney(r.mcapDisp, displayCcy)}</td>
                <td className="px-3 py-1.5">{r.priceDisp == null ? '—' : formatMoney(r.priceDisp, displayCcy, { compact: false })}</td>
                <td className="px-3 py-1.5 text-left">{flag(r.country)} <span className="text-atlas-muted">{r.country || '—'}</span></td>
                <td className="px-3 py-1.5 text-left">
                  <div className="flex flex-wrap gap-1">
                    {(r.tags || [])
                      .filter(t => !t.startsWith('country-') && !['large-cap','mid-cap','small-cap','mega-cap','micro-cap'].includes(t))
                      .slice(0, 3)
                      .map(t => (
                        <Link key={t} href={`${BP}/tags/${t}/`}
                              className="rounded-full bg-atlas-border/60 px-2 py-0.5 text-[10px] text-atlas-muted hover:bg-atlas-accent/20 hover:text-atlas-accent">
                          {t}
                        </Link>
                      ))}
                  </div>
                </td>
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

function Th({ label, onClick, active, dir, align }:
  { label: string; onClick: () => void; active: boolean; dir: 'asc' | 'desc'; align: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 ${align === 'left' ? 'text-left' : 'text-right'}`}>
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
