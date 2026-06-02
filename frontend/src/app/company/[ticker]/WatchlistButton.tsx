'use client';
import { useEffect, useState } from 'react';
import { readWatchlist, subscribeWatchlist, toggleWatch, type WatchItem } from '@/lib/watchlist';

export type { WatchItem };

export default function WatchlistButton({ ticker, kind }: WatchItem) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(readWatchlist().some(i => i.ticker === ticker && i.kind === kind));
    sync();
    return subscribeWatchlist(sync);
  }, [ticker, kind]);

  return (
    <button
      onClick={() => toggleWatch({ ticker, kind })}
      className={`rounded border px-2 py-1 text-sm ${
        on ? 'border-atlas-accent/40 bg-atlas-accent/10 text-atlas-accent'
           : 'border-atlas-border text-atlas-muted hover:text-atlas-text'
      }`}
    >
      {on ? '★ Watching' : '☆ Watch'}
    </button>
  );
}
