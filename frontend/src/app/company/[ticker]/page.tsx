import { notFound } from 'next/navigation';
import {
  listCompanyTickers, loadCompany, loadFx, loadPeers, loadSectorStats, loadSimilar,
} from '@/lib/data';
import CompanyView from './CompanyView';
import type { Company } from '@/lib/types';

export async function generateStaticParams() {
  const tickers = await listCompanyTickers();
  return tickers.map(ticker => ({ ticker }));
}

export default async function CompanyPage({ params }: { params: { ticker: string } }) {
  try {
    const [company, fx, peerMap, sectorStats, similarMap] = await Promise.all([
      loadCompany(params.ticker),
      loadFx(),
      loadPeers(),
      loadSectorStats(),
      loadSimilar(),
    ]);

    const peerTickers = peerMap[company.ticker] ?? [];
    const peers: Company[] = (
      await Promise.all(peerTickers.map(t => loadCompany(t).catch(() => null)))
    ).filter((c): c is Company => c !== null);

    // Lightweight rows for the "Similar stocks" strip — only need name/sector/mcap.
    const similarTickers = similarMap[company.ticker] ?? [];
    const similar = (
      await Promise.all(similarTickers.map(t => loadCompany(t).catch(() => null)))
    ).filter((c): c is Company => c !== null);

    const sectorStat = company.sector ? sectorStats[company.sector] : undefined;

    return (
      <CompanyView
        company={company}
        fx={fx}
        peers={peers}
        sectorStat={sectorStat}
        similar={similar}
      />
    );
  } catch {
    notFound();
  }
}
