'use client';

import { useState } from 'react';

/**
 * Square company logo with a graceful fallback chain:
 *   1. Clearbit Logo API   (logo.clearbit.com/<domain>)   — sharp PNG, free
 *   2. Google favicons     (s2/favicons?sz=64&domain=<>)  — covers Clearbit misses
 *   3. DuckDuckGo ip3      (icons.duckduckgo.com/ip3)     — ico, last resort
 *   4. Colored initials avatar
 *
 * Each failure advances to the next source. Networks / ad-blockers can take
 * out any one of these, so we always end up at the deterministic initials.
 */
const SOURCES = (domain: string): string[] => [
  `https://logo.clearbit.com/${domain}`,
  `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
];

export default function CompanyLogo({
  domain, name, ticker, size = 28, className = '',
}: {
  domain?: string | null;
  name?: string;
  ticker?: string;
  size?: number;
  className?: string;
}) {
  const [idx, setIdx] = useState(0);

  if (domain) {
    const urls = SOURCES(domain);
    if (idx < urls.length) {
      return (
        <img
          src={urls[idx]}
          alt={name || ticker || ''}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setIdx((i) => i + 1)}
          className={`shrink-0 rounded bg-white object-contain ${className}`}
          style={{ width: size, height: size }}
        />
      );
    }
  }

  // Final fallback: colored initial(s).
  const label = (ticker || name || '?').slice(0, 2).toUpperCase();
  const hue = Math.abs((ticker || name || '?')
    .split('')
    .reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) % 360;

  return (
    <span
      aria-label={name || ticker}
      className={`shrink-0 inline-flex items-center justify-center rounded text-[10px] font-semibold text-white ${className}`}
      style={{
        width: size, height: size,
        background: `hsl(${hue} 55% 35%)`,
        fontSize: Math.max(9, size * 0.38),
      }}
    >
      {label}
    </span>
  );
}
