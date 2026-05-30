'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MiniSearch from 'minisearch';
import type { SearchHit } from '@/lib/types';
import { BP } from '@/lib/basePath';
import CompanyLogo from '@/components/CompanyLogo';

export default function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const mini = useMemo(
    () =>
      new MiniSearch<SearchHit>({
        idField: 'ticker',
        fields: ['ticker', 'name', 'sector', 'country', 'exchange'],
        storeFields: ['type', 'ticker', 'name', 'exchange', 'country', 'sector', 'currency', 'domain'],
        searchOptions: { boost: { ticker: 4, name: 2 }, prefix: true, fuzzy: 0.2 },
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    fetch(`${BP}/data/search-index.json`)
      .then(r => r.json() as Promise<SearchHit[]>)
      .then(data => { if (alive) mini.addAll(data); })
      .catch(err => console.error('Failed to load search index', err));
    return () => { alive = false; };
  }, [mini]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    if (!query.trim()) { setHits([]); return; }
    const results = mini.search(query, { prefix: true, fuzzy: 0.2 }).slice(0, 12) as unknown as SearchHit[];
    setHits(results);
    setActive(0);
  }, [query, mini]);

  const hrefFor = (h: SearchHit) =>
    h.type === 'etf' ? `${BP}/etf/${h.ticker}/` : `${BP}/company/${h.ticker}/`;

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && hits[active]) { window.location.href = hrefFor(hits[active]); }
        }}
        placeholder="Search by ticker or company name — MSFT, AAPL, 7203 (Toyota), RELIANCE, VOO…"
        className="w-full rounded-lg border border-atlas-border bg-atlas-surface px-4 py-3 text-base outline-none placeholder:text-atlas-muted focus:border-atlas-accent"
      />

      {hits.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-lg border border-atlas-border bg-atlas-surface">
          {hits.map((h, i) => (
            <li key={`${h.type}:${h.ticker}`}>
              <Link
                href={hrefFor(h)}
                className={`flex items-center justify-between px-4 py-2.5 text-sm hover:bg-atlas-border/60 ${
                  i === active ? 'bg-atlas-border/40' : ''
                }`}
              >
                <span className="flex items-center gap-3">
                  <CompanyLogo domain={h.domain} ticker={h.ticker} name={h.name} size={20} />
                  <span className="rounded bg-atlas-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-atlas-muted">
                    {h.type}
                  </span>
                  <span className="font-mono">{h.ticker}</span>
                  <span className="text-atlas-text">{h.name}</span>
                </span>
                <span className="text-xs text-atlas-muted">
                  {[h.exchange, h.country, h.currency].filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
