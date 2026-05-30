'use client';
import { useEffect, useState } from 'react';

const KEY = 'atlas:watchlist';

export type WatchItem = { kind: 'company' | 'etf'; ticker: string };

function read(): WatchItem[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(items: WatchItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('atlas:watchlist'));
}

export default function WatchlistButton({ ticker, kind }: WatchItem) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(read().some(i => i.ticker === ticker && i.kind === kind));
    sync();
    window.addEventListener('atlas:watchlist', sync);
    return () => window.removeEventListener('atlas:watchlist', sync);
  }, [ticker, kind]);

  return (
    <button
      onClick={() => {
        const list = read();
        const exists = list.some(i => i.ticker === ticker && i.kind === kind);
        write(exists ? list.filter(i => !(i.ticker === ticker && i.kind === kind))
                     : [...list, { ticker, kind }]);
      }}
      className={`rounded border px-2 py-1 text-sm ${
        on ? 'border-atlas-accent/40 bg-atlas-accent/10 text-atlas-accent'
           : 'border-atlas-border text-atlas-muted hover:text-atlas-text'
      }`}
    >
      {on ? '★ Watching' : '☆ Watch'}
    </button>
  );
}
