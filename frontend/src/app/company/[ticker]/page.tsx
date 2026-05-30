import { notFound } from 'next/navigation';
import { listCompanyTickers, loadCompany, loadFx, loadPeers } from '@/lib/data';
import CompanyView from './CompanyView';
import type { Company } from '@/lib/types';

export async function generateStaticParams() {
  const tickers = await listCompanyTickers();
  return tickers.map(ticker => ({ ticker }));
}

export default async function CompanyPage({ params }: { params: { ticker: string } }) {
  try {
    const [company, fx, peerMap] = await Promise.all([
      loadCompany(params.ticker),
      loadFx(),
      loadPeers(),
    ]);

    const peerTickers = peerMap[company.ticker] ?? [];
    const peers: Company[] = (
      await Promise.all(peerTickers.map(t => loadCompany(t).catch(() => null)))
    ).filter((c): c is Company => c !== null);

    return <CompanyView company={company} fx={fx} peers={peers} />;
  } catch {
    notFound();
  }
}
