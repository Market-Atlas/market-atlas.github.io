// Static data loaders. All JSON ships in /public/data and is fetched at build
// time (generateStaticParams) or in the browser.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Company, ETF, FxSnapshot, ScreenerRow, SearchHit, SectorStatsMap, TagInfo } from './types';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

export async function listCompanyTickers(): Promise<string[]> {
  const files = await fs.readdir(path.join(DATA_DIR, 'companies'));
  return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
}

export async function listEtfTickers(): Promise<string[]> {
  const dir = path.join(DATA_DIR, 'etfs');
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

export async function loadCompany(ticker: string): Promise<Company> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'companies', `${ticker}.json`), 'utf-8');
  return JSON.parse(raw) as Company;
}

export async function loadEtf(ticker: string): Promise<ETF> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'etfs', `${ticker}.json`), 'utf-8');
  return JSON.parse(raw) as ETF;
}

export async function loadSearchIndex(): Promise<SearchHit[]> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'search-index.json'), 'utf-8');
  return JSON.parse(raw) as SearchHit[];
}

export async function loadScreener(): Promise<ScreenerRow[]> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'screener.json'), 'utf-8');
  return JSON.parse(raw) as ScreenerRow[];
}

export async function loadFx(): Promise<FxSnapshot> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'fx', 'latest.json'), 'utf-8');
  return JSON.parse(raw) as FxSnapshot;
}

export async function loadPeers(): Promise<Record<string, string[]>> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'peers.json'), 'utf-8');
    return JSON.parse(raw) as Record<string, string[]>;
  } catch {
    return {};
  }
}

export async function loadTags(): Promise<Record<string, TagInfo>> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'tags.json'), 'utf-8');
    return JSON.parse(raw) as Record<string, TagInfo>;
  } catch {
    return {};
  }
}

export async function loadSectorStats(): Promise<SectorStatsMap> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'sector-stats.json'), 'utf-8');
    return JSON.parse(raw) as SectorStatsMap;
  } catch {
    return {};
  }
}

export async function loadSimilar(): Promise<Record<string, string[]>> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'similar.json'), 'utf-8');
    return JSON.parse(raw) as Record<string, string[]>;
  } catch {
    return {};
  }
}
