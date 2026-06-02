// Watchlist storage helpers (localStorage only — no backend).
//
// History note: the original schema was { kind, ticker }. To support a
// portfolio analyser we added an optional `qty`. Old records are still
// readable (qty defaults to 0) so anyone who saved tickers before keeps
// their list intact.

const KEY = 'atlas:watchlist';

export type WatchItem = {
  kind: 'company' | 'etf';
  ticker: string;
  qty?: number;
};

export function readWatchlist(): WatchItem[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

export function writeWatchlist(items: WatchItem[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('atlas:watchlist'));
}

export function toggleWatch(it: WatchItem) {
  const list = readWatchlist();
  const exists = list.some(i => i.ticker === it.ticker && i.kind === it.kind);
  writeWatchlist(
    exists
      ? list.filter(i => !(i.ticker === it.ticker && i.kind === it.kind))
      : [...list, it],
  );
}

export function setQty(ticker: string, kind: WatchItem['kind'], qty: number) {
  const list = readWatchlist();
  const idx = list.findIndex(i => i.ticker === ticker && i.kind === kind);
  if (idx === -1) {
    writeWatchlist([...list, { ticker, kind, qty }]);
  } else {
    const next = list.slice();
    next[idx] = { ...next[idx], qty };
    writeWatchlist(next);
  }
}

// Subscribe to localStorage / in-tab updates. Returns the cleanup fn.
export function subscribeWatchlist(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('atlas:watchlist', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('atlas:watchlist', cb);
    window.removeEventListener('storage', cb);
  };
}
