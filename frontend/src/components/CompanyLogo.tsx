'use client';

import { useState } from 'react';

/**
 * Square company logo with graceful fallback.
 * Sources: DuckDuckGo icon service (free, no key, reliable), then a colored
 * initials avatar if no domain or the icon fails.
 */
export default function CompanyLogo({
  domain, name, ticker, size = 28, className = '',
}: {
  domain?: string | null;
  name?: string;
  ticker?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (domain && !failed) {
    return (
      <img
        src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
        alt={name || ticker || ''}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded bg-atlas-bg object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Fallback: colored initial(s) generated from the ticker.
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
