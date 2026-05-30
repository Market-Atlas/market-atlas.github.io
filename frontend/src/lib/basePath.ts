// Normalised public base path for client-side links/fetches.
// `NEXT_PUBLIC_BASE_PATH` is replaced at build time. A lone "/" or whitespace
// is treated as empty (root-site deploys).
const raw = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim();

export const BP =
  raw && raw !== '/'
    ? (raw.startsWith('/') ? raw : `/${raw}`)
    : '';
