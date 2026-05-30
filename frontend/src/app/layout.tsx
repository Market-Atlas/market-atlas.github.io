import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Atlas — Long-term investor research',
  description:
    'Free research platform for long-term investors. 10+ years of company fundamentals, ETF holdings, and a clean screener.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-atlas-bg text-atlas-text">
        <header className="border-b border-atlas-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-atlas-accent" />
              Atlas
              <span className="text-xs font-normal text-atlas-muted">research</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-atlas-muted">
              <Link href="/" className="hover:text-atlas-text">Search</Link>
              <Link href="/screener/" className="hover:text-atlas-text">Screener</Link>
              <Link href="/watchlist/" className="hover:text-atlas-text">Watchlist</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-atlas-border py-6 text-center text-xs text-atlas-muted">
          Built for long-term investors. Data shown for research only — not investment advice.
        </footer>
      </body>
    </html>
  );
}
