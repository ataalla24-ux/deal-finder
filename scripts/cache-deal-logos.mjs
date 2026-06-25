import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEALS_PATH = path.join(DOCS_DIR, 'deals.json');
const LOGO_DIR = path.join(DOCS_DIR, 'assets', 'brand-logos');
const PUBLIC_LOGO_BASE_URL = (process.env.PUBLIC_BRAND_LOGO_BASE_URL || 'https://freefinder.at/assets/brand-logos').replace(/\/+$/, '');
const REFRESH = process.argv.includes('--refresh');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value, fallback = 'deal') {
  const slug = cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function googleFaviconTargetHost(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/google\.com$/i.test(url.hostname) || !/\/s2\/favicons/i.test(url.pathname)) return '';
    const rawTarget = url.searchParams.get('domain_url') || url.searchParams.get('domain') || '';
    const targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`;
    return hostFromUrl(targetUrl);
  } catch {
    return '';
  }
}

function logoTargetHost(value) {
  return googleFaviconTargetHost(value) || hostFromUrl(value);
}

function isCacheUrl(value) {
  return String(value || '').startsWith(`${PUBLIC_LOGO_BASE_URL}/`);
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function fetchLogo(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; FreeFinderLogoCache/1.0; +https://freefinder.at)',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/^image\//i.test(contentType)) {
    throw new Error(`Unexpected content-type ${contentType}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 128) {
    throw new Error(`Logo too small (${buffer.length} bytes)`);
  }
  return buffer;
}

async function main() {
  await mkdir(LOGO_DIR, { recursive: true });

  const dealsDoc = JSON.parse(await readFile(DEALS_PATH, 'utf8'));
  const deals = Array.isArray(dealsDoc.deals) ? dealsDoc.deals : [];
  const cacheBySource = new Map();
  let normalizedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  const nextDeals = [];
  for (const rawDeal of deals) {
    const deal = normalizeDealRecord(rawDeal);
    if (JSON.stringify(deal) !== JSON.stringify(rawDeal)) normalizedCount += 1;

    const sourceLogoUrl = cleanText(deal.logoUrl || '');
    if (!sourceLogoUrl || isCacheUrl(sourceLogoUrl)) {
      nextDeals.push(deal);
      continue;
    }

    let cachedUrl = cacheBySource.get(sourceLogoUrl);
    if (!cachedUrl) {
      const host = logoTargetHost(sourceLogoUrl);
      const brandSlug = slugify(deal.brand || deal.title || host);
      const hostSlug = slugify(host, 'logo');
      const fileName = `${brandSlug}-${hostSlug}.png`;
      const filePath = path.join(LOGO_DIR, fileName);
      cachedUrl = `${PUBLIC_LOGO_BASE_URL}/${fileName}`;

      try {
        if (REFRESH || !(await fileExists(filePath))) {
          const logo = await fetchLogo(sourceLogoUrl);
          await writeFile(filePath, logo);
          cachedCount += 1;
        }
        cacheBySource.set(sourceLogoUrl, cachedUrl);
      } catch (error) {
        failedCount += 1;
        console.log(`Logo cache skipped for ${deal.brand || deal.title}: ${error.message}`);
        cachedUrl = null;
        cacheBySource.set(sourceLogoUrl, cachedUrl);
      }
    }

    nextDeals.push({
      ...deal,
      logoUrl: cachedUrl === null ? '' : (cachedUrl || deal.logoUrl),
    });
  }

  dealsDoc.deals = nextDeals;
  dealsDoc.totalDeals = nextDeals.length;
  await writeFile(DEALS_PATH, JSON.stringify(dealsDoc, null, 2) + '\n', 'utf8');

  console.log(`Normalized deals: ${normalizedCount}`);
  console.log(`Cached logos: ${cachedCount}`);
  console.log(`Failed logos: ${failedCount}`);
  console.log(`Logo directory: ${path.relative(ROOT, LOGO_DIR)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
