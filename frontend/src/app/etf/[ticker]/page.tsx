import { notFound } from 'next/navigation';
import { listEtfTickers, loadEtf, loadFx } from '@/lib/data';
import { convert, formatMoney, formatPercent } from '@/lib/fx';

export async function generateStaticParams() {
  const tickers = await listEtfTickers();
  return tickers.map(ticker => ({ ticker }));
}

export default async function EtfPage({ params }: { params: { ticker: string } }) {
  let etf, fx;
  try { [etf, fx] = await Promise.all([loadEtf(params.ticker), loadFx()]); }
  catch { notFound(); }

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{etf!.name}</h1>
          <span className="rounded bg-atlas-border px-2 py-0.5 font-mono text-sm">{etf!.ticker}</span>
          <span className="rounded bg-atlas-border px-2 py-0.5 text-xs uppercase text-atlas-muted">ETF</span>
        </div>
        <p className="mt-1 text-sm text-atlas-muted">
          {[etf!.exchange, etf!.country, etf!.currency].filter(Boolean).join(' · ')}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Kpi label="AUM" value={formatMoney(convert(etf!.aum ?? null, etf!.currency, etf!.currency, fx!), etf!.currency)} />
        <Kpi label="Expense ratio" value={formatPercent(etf!.expenseRatio, 2)} />
        <Kpi label="Holdings (sample)" value={String(etf!.topHoldings?.length ?? 0)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Top holdings">
          <table className="num min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-atlas-muted">
              <tr><th className="py-1">Ticker</th><th>Name</th><th className="text-right">Weight</th></tr>
            </thead>
            <tbody>
              {etf!.topHoldings?.map(h => (
                <tr key={h.ticker} className="border-t border-atlas-border">
                  <td className="py-1.5 font-mono">{h.ticker}</td>
                  <td className="text-atlas-muted">{h.name}</td>
                  <td className="py-1.5 text-right">{formatPercent(h.weight, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Sector allocation">
          <AllocationList data={etf!.sectorAllocation || {}} />
        </Card>

        <Card title="Country allocation">
          <AllocationList data={etf!.countryAllocation || {}} />
        </Card>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-atlas-border bg-atlas-surface p-4">
      <div className="text-xs uppercase tracking-wide text-atlas-muted">{label}</div>
      <div className="num mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-atlas-border bg-atlas-surface p-4">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}

function AllocationList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  return (
    <ul className="space-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <li key={k} className="flex items-center gap-3">
          <span className="w-40 truncate text-atlas-muted">{k}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded bg-atlas-border">
            <span
              className="absolute inset-y-0 left-0 bg-atlas-accent/60"
              style={{ width: `${(v / max) * 100}%` }}
            />
          </span>
          <span className="num w-12 text-right text-atlas-text">{formatPercent(v, 1)}</span>
        </li>
      ))}
    </ul>
  );
}
