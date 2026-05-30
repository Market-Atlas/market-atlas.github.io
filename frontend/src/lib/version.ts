// A build-time constant that changes on every deploy. Appended as ?v=<id> to
// every client-side data fetch so browsers / CDNs never serve stale JSON.
//
// `NEXT_PUBLIC_BUILD_ID` is set in next.config.js. We keep a stable fallback
// of '' for dev so HMR doesn't churn.
export const BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

/** Append ?v=<build id> to a fetchable URL (skips when no id). */
export function vUrl(path: string): string {
  if (!BUILD_ID || BUILD_ID === 'dev') return path;
  return path + (path.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(BUILD_ID);
}
