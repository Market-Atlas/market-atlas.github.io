import Link from 'next/link';
import { loadTags } from '@/lib/data';
import { BP } from '@/lib/basePath';

// Pretty-print a tag id (kebab-case → Title Case)
function pretty(tag: string): string {
  return tag.replace(/^country-/, '').replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

const GROUPS: { title: string; predicate: (t: string) => boolean }[] = [
  { title: 'Size',         predicate: t => ['mega-cap', 'large-cap', 'mid-cap', 'small-cap', 'micro-cap'].includes(t) },
  { title: 'Sector',       predicate: t => ['tech', 'comms', 'financials', 'healthcare', 'consumer-cyclical', 'consumer-defensive', 'industrials', 'energy', 'materials', 'real-estate', 'utilities'].includes(t) },
  { title: 'Country',      predicate: t => t.startsWith('country-') },
  { title: 'Themes',       predicate: () => true }, // catch-all (last)
];

export default async function TagsIndexPage() {
  const tags = await loadTags();
  const allTags = Object.entries(tags).sort((a, b) => b[1].count - a[1].count);

  const used = new Set<string>();
  const groups = GROUPS.map(g => {
    const items = allTags.filter(([t]) => !used.has(t) && g.predicate(t));
    items.forEach(([t]) => used.add(t));
    return { ...g, items };
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Browse by tag</h1>
        <p className="text-sm text-atlas-muted">
          Tags are auto-derived from each company&apos;s sector, industry, name, market cap, and country.
        </p>
      </header>

      {groups.map(g => g.items.length > 0 && (
        <section key={g.title}>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-atlas-muted">{g.title}</h2>
          <div className="flex flex-wrap gap-2">
            {g.items.map(([t, info]) => (
              <Link key={t} href={`${BP}/tags/${t}/`}
                    className="inline-flex items-center gap-2 rounded-full border border-atlas-border bg-atlas-surface px-3 py-1.5 text-sm hover:border-atlas-accent/40 hover:text-atlas-accent">
                <span>{pretty(t)}</span>
                <span className="rounded bg-atlas-border px-1.5 text-[10px] text-atlas-muted">{info.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
