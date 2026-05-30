'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BP } from '@/lib/basePath';

const KEY = 'atlas:watchlist';
type WatchItem = { kind: 'company' | 'etf'; ticker: string };

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);

  useEffect(() => {
    const sync = () => {
      try { setItems(JSON.parse(localStorage.getItem(KEY) || '[]')); }
      catch { setItems([]); }
    };
    sync();
    window.addEventListener('atlas:watchlist', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('atlas:watchlist', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const remove = (it: WatchItem) => {
    const next = items.filter(i => !(i.ticker === it.ticker && i.kind === it.kind));
    localStorage.setItem(KEY, JSON.stringify(next));
    setItems(next);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-sm text-atlas-muted">
          Saved in this browser only. No account, no sync, no tracking.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-atlas-border bg-atlas-surface p-8 text-center text-sm text-atlas-muted">
          Your watchlist is empty. Open any company or ETF and tap ☆ to save it here.
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-atlas-border bg-atlas-surface">
          {items.map(it => (
            <li key={`${it.kind}:${it.ticker}`} className="flex items-center justify-between border-t border-atlas-border px-4 py-2.5 first:border-t-0">
              <Link
                href={`${BP}/${it.kind === 'etf' ? 'etf' : 'company'}/${it.ticker}/`}
                className="flex items-center gap-3 text-sm hover:text-atlas-accent"
              >
                <span className="rounded bg-atlas-border px-1.5 py-0.5 text-[10px] uppercase text-atlas-muted">{it.kind}</span>
                <span className="font-mono">{it.ticker}</span>
              </Link>
              <button onClick={() => remove(it)} className="text-xs text-atlas-muted hover:text-atlas-negative">Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
