// Data sync script — copies /data → /frontend/public/data so Next.js can
// serve the static JSON at build time. Run via `npm run sync-data`.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const src = join(repoRoot, 'data');
const dest = join(__dirname, '..', 'public', 'data');

if (!existsSync(src)) {
  console.error(`No data directory found at ${src}. Run the pipeline first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Synced ${src} → ${dest}`);
