import SearchBox from '@/components/SearchBox';

export default function HomePage() {
  return (
    <div className="space-y-12 py-8">
      <section className="space-y-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Research a company in <span className="text-atlas-accent">under five minutes</span>.
        </h1>
        <p className="mx-auto max-w-2xl text-atlas-muted">
          10+ years of fundamentals, in the original reporting currency. No
          intraday charts, no noise, no paywall. Built for long-term investors.
        </p>
      </section>

      <section className="mx-auto max-w-2xl">
        <SearchBox autoFocus />
        <p className="mt-3 text-center text-xs text-atlas-muted">
          Try: <span className="font-mono">MSFT</span> · <span className="font-mono">AAPL</span> ·{' '}
          <span className="font-mono">7203</span> (Toyota) ·{' '}
          <span className="font-mono">RELIANCE</span> · <span className="font-mono">VOO</span>
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { title: '10-year fundamentals', body: 'Revenue, earnings, FCF, ROIC — at a glance, in the reporting currency.' },
          { title: 'Currency-faithful',    body: 'Toyota in JPY, Reliance in INR. USD/EUR/GBP are derived, not source.' },
          { title: 'Static & free',        body: 'Nightly rebuild, CDN-delivered JSON, zero infra. Yours forever.' },
        ].map(card => (
          <div key={card.title} className="rounded-lg border border-atlas-border bg-atlas-surface p-5">
            <h3 className="font-medium text-atlas-text">{card.title}</h3>
            <p className="mt-2 text-sm text-atlas-muted">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
