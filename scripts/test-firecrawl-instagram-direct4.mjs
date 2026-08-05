import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeInstagramPostUrl } from '../scraper/firecrawl-post-verifier.js';

const KEY4_SOURCE_PATH = 'scraper/firecrawl-instagram-direct4.js';
const GASTRO2_SOURCE_PATH = 'scraper/firecrawl-gastro2.js';
const WORKFLOW_PATH = '.github/workflows/firecrawl-instagram-key4.yml';

const key4Source = fs.readFileSync(KEY4_SOURCE_PATH, 'utf8');
const gastro2Source = fs.readFileSync(GASTRO2_SOURCE_PATH, 'utf8');
const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

function scrapeUrls(source) {
  const block = source.match(/const SCRAPE_URLS = \[([\s\S]*?)\];/)?.[1] || '';
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function stringArray(source, name) {
  const block = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] || '';
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const key4Urls = scrapeUrls(key4Source);
const gastro2Urls = new Set(scrapeUrls(gastro2Source));
const expectedHashtags = [
  'viennafood', 'viennafoodie', 'viennarestaurant', 'restaurantvienna',
  'allyoucaneatvienna', 'kostenloswien', 'wiengratis', 'gratisessenwien',
  'kostenlosessenwien', 'angebotwien', 'angebotewien', 'wienangebot',
  'dealswien', 'wienerdeals', 'rabattwien', 'wienrabatt', 'sparenwien',
  'fooddealwien', 'fooddealsvienna', 'freefoodvienna', 'viennadeals',
  'viennaoffers', 'viennafreebies', 'happyhourwien', 'lunchdealwien',
  'gastroaktionwien', 'neueröffnungwien', 'eröffnungwien',
];
const expectedAccounts = [
  'tastyfood.vienna', 'foodiewien', 'eatinvienna_', 'viennaeats',
  'viennafoodstories', 'viennarestaurants', 'zushimarket', 'ciosgrill',
  'corner_xvi', 'tokki_korean_bbq', 'sajado.bbq', 'mosquito_mexican',
];
const discoveryHashtags = stringArray(key4Source, 'DISCOVERY_HASHTAGS');
const discoveryAccounts = stringArray(key4Source, 'DISCOVERY_ACCOUNTS');
const lastPathSegment = (url) => decodeURIComponent(
  new URL(url).pathname.split('/').filter(Boolean).at(-1),
);

assert.equal(key4Urls.length, 7, 'Key 4 uses the same number of starting sources as Gastro2');
assert.equal(new Set(key4Urls).size, key4Urls.length, 'discovery sources must be unique');
assert.ok(key4Urls.every((url) => url.includes('/explore/tags/')), 'accounts must not be direct starting URLs');
assert.deepEqual(new Set(discoveryHashtags), new Set(expectedHashtags));
assert.deepEqual(new Set(discoveryAccounts), new Set(expectedAccounts));
assert.deepEqual(key4Urls, [
  'https://www.instagram.com/explore/tags/viennafood/',
  'https://www.instagram.com/explore/tags/viennafoodie/',
  'https://www.instagram.com/explore/tags/viennarestaurant/',
  'https://www.instagram.com/explore/tags/kostenloswien/',
  'https://www.instagram.com/explore/tags/angebotwien/',
  'https://www.instagram.com/explore/tags/happyhourwien/',
  'https://www.instagram.com/explore/tags/neueröffnungwien/',
]);
assert.ok(key4Urls.every((url) => !gastro2Urls.has(url)), 'Key 4 sources must not duplicate Gastro2 sources');
assert.ok(key4Urls.map(lastPathSegment).every((hashtag) => expectedHashtags.includes(hashtag)));

assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/corner_xvi/'), '');
assert.equal(
  normalizeInstagramPostUrl('https://www.instagram.com/reel/DbEYTWHRymD/?utm_source=fixture'),
  'https://www.instagram.com/reel/DbEYTWHRymD/',
);

assert.match(key4Source, /process\.env\.FIRECRAWL_API_KEY4/);
assert.doesNotMatch(key4Source, /process\.env\.FIRECRAWL_API_KEY(?:1|2|3|5|6)\b/);
assert.doesNotMatch(key4Source, /process\.env\.FIRECRAWL_API_KEY\b/);
assert.match(key4Source, /return firecrawl\.agent\(payload\)/);
assert.match(key4Source, /schema: gastroSchema/);
assert.match(key4Source, /model: 'spark-1-pro'/);
assert.match(key4Source, /normalizeInstagramPostUrl\(postUrl\)/);
assert.match(key4Source, /instagram-profile-not-post/);
assert.match(key4Source, /Niemals Profil-, Kanal-, Hashtag- oder Explore-URLs/);
assert.match(key4Source, /URL-Dedupe deaktiviert/);
assert.match(key4Source, /verifyFirecrawlDeals\(allDeals/);
assert.doesNotMatch(key4Source, /classifyKey4Evidence|dedupeKey4Candidates|FC4_MAX_AGE_DAYS/);

assert.match(workflow, /FIRECRAWL_API_KEY4: \$\{\{ secrets\.FIRECRAWL_API_KEY4 \}\}/);
assert.doesNotMatch(workflow, /FIRECRAWL_API_KEY(?:1|2|3|5|6):/);
assert.doesNotMatch(workflow, /^\s+FIRECRAWL_API_KEY:/m);
assert.match(workflow, /FIRECRAWL_POST_VERIFY_MAX: 60/);
assert.match(workflow, /FIRECRAWL_POST_VERIFY_MAX_AGE_DAYS: 45/);
assert.doesNotMatch(workflow, /timeout-minutes:/);
assert.doesNotMatch(workflow, /deals-(?:raw|review|rejected)-firecrawl4\.json/);

console.log('Firecrawl Key 4 Gastro2-clone regression tests passed.');
