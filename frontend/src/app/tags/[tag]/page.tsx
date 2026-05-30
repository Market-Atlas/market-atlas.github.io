import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadFx, loadScreener, loadTags } from '@/lib/data';
import { convert, formatMoney, formatPercent } from '@/lib/fx';
import { BP } from '@/lib/basePath';
import CompanyLogo from '@/components/CompanyLogo';

function flag(c?: string): string {
  if (!c || c.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(...c.toUpperCase().split('').map(ch => A + ch.charCodeAt(0) - 65));
}

function pretty(tag: string): string {
  return tag.replace(/^country-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function generateStaticParams() {
  const tags = await loadTags();
  return Object.keys(tags).map(tag => ({ tag }));
}

export default async function TagPage({ params }: { params: { tag: string } }) {
  const [tags, screener, fx] = await Promise.all([loadTags(), loadScreener(), loadFx()]);
  const info = tags[params.tag];
  if (!info) notFound();

  const rows = info.tickers
    .map(t => screener.find(r => r.ticker === t))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map(r => ({
      ...r,
      mcapUsd: convert(r.marketCap ?? null, r.marketCapCurrency || r.currency || 'USD', 'USD', fx),
    }))
    .sort((a, b) => (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0));

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-4 border-b border-atlas-border pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-atlas-muted">Tag</p>
          <h1 className="text-2xl font-semibold tracking-tight">{pretty(params.tag)}</h1>
          <p className="text-sm text-atlas-muted">{info.count} companies · ranked by market cap (USD)</p>
        </div>
        <Link href={`${BP}/tags/`} className="text-sm text-atlas-accent hover:underline">← All tags</Link>
      </header>

      <section className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-surface">
        <table className="num min-w-full text-right text-sm">
          <thead className="bg-atlas-border/40 text-xs uppercase tracking-wide text-atlas-muted">
            <tr>
              <th className="px-3 py-2 text-right">#</th>
              <th className="px-3 py-2 text-left">Company</th>
              <th className="px-3 py-2">Market cap (USD)</th>
              <th className="px-3 py-2">ROE</th>
              <th className="px-3 py-2">ROIC</th>
              <th className="px-3 py-2 text-left">Country</th>
              <th className="px-3 py-2 text-left">Sector</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ticker} className="border-t border-atlas-border hover:bg-atlas-border/30">
                <td className="px-3 py-1.5 text-right text-atlas-muted">{i + 1}</td>
                <td className="px-3 py-1.5 text-left">
                  <Link href={`${BP}/company/${r.ticker}/`} className="flex items-center gap-2 hover:text-atlas-accent">
                    <CompanyLogo domain={r.domain} ticker={r.ticker} name={r.name} size={20} />
                    <span className="font-mono text-xs text-atlas-muted">{r.ticker}</span>
                    <span className="truncate">{r.name}</span>
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-medium">{formatMoney(r.mcapUsd, 'USD')}</td>
                <td className="px-3 py-1.5">{formatPercent(r.roe)}</td>
                <td className="px-3 py-1.5">{formatPercent(r.roic)}</td>
                <td className="px-3 py-1.5 text-left">{flag(r.country)} <span className="text-atlas-muted">{r.country || '—'}</span></td>
                <td className="px-3 py-1.5 text-left text-atlas-muted">{r.sector || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
