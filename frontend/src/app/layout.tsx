import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Atlas — Long-term investor research',
  description:
    'Free research platform for long-term investors. 10+ years of company fundamentals, ETF holdings, and a clean screener.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-atlas-bg text-atlas-text">
        <header className="border-b border-atlas-border">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-3 py-3 sm:px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-atlas-accent" />
              Atlas
              <span className="text-xs font-normal text-atlas-muted">research</span>
            </Link>
            <nav className="-mx-3 flex w-full items-center gap-4 overflow-x-auto px-3 text-sm text-atlas-muted sm:mx-0 sm:w-auto sm:gap-5 sm:overflow-visible sm:px-0">
              <Link href="/" className="whitespace-nowrap hover:text-atlas-text">Search</Link>
              <Link href="/rankings/" className="whitespace-nowrap hover:text-atlas-text">Rankings</Link>
              <Link href="/heatmap/" className="whitespace-nowrap hover:text-atlas-text">Heatmap</Link>
              <Link href="/tags/" className="whitespace-nowrap hover:text-atlas-text">Tags</Link>
              <Link href="/screener/" className="whitespace-nowrap hover:text-atlas-text">Screener</Link>
              <Link href="/watchlist/" className="whitespace-nowrap hover:text-atlas-text">Portfolio</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-8">{children}</main>
        <footer className="border-t border-atlas-border px-4 py-6 text-center text-xs text-atlas-muted">
          Built for long-term investors. Data shown for research only — not investment advice.
        </footer>
      </body>
    </html>
  );
}
