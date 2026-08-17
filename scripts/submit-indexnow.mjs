#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'freefinder.at';
const KEY = fs.readFileSync(path.join(ROOT, 'docs', 'indexnow-key.txt'), 'utf8').trim();
const KEY_LOCATION = `https://${HOST}/indexnow-key.txt`;
const sitemap = fs.readFileSync(path.join(ROOT, 'docs', 'sitemap.xml'), 'utf8');
const explicitUrls = process.argv.slice(2);
const sitemapUrls = [...sitemap.matchAll(/<loc>(https:\/\/freefinder\.at\/[^<]*)<\/loc>/g)].map((match) => match[1]);
const urlList = [...new Set(explicitUrls.length ? explicitUrls : sitemapUrls)]
  .filter((value) => {
    try {
      return new URL(value).hostname === HOST;
    } catch (_) {
      return false;
    }
  })
  .slice(0, 10000);

if (!/^[a-z0-9-]{8,128}$/i.test(KEY)) throw new Error('Invalid IndexNow key');
if (!urlList.length) throw new Error('No freefinder.at URLs found for IndexNow');

async function verifyPublishedKey() {
  const attempts = process.env.CI ? 24 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${KEY_LOCATION}?v=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
      if (response.ok && (await response.text()).trim() === KEY) return;
    } catch (_) {
      // The Pages deployment may still be propagating.
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error(`Published IndexNow key is not available at ${KEY_LOCATION}`);
}

await verifyPublishedKey();
const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
});
if (![200, 202].includes(response.status)) {
  throw new Error(`IndexNow submission failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
}
console.log(`Submitted ${urlList.length} FreeFinder URLs to IndexNow (HTTP ${response.status})`);
