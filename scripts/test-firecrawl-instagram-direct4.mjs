import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  GASTRO2_BASE_PROMPT,
  ROTATING_ACCOUNT_TARGETS,
  ROTATING_HASHTAG_TARGETS,
  WEB_TARGETS,
  buildTargetPrompt,
  selectScrapeTargets,
} from '../scraper/firecrawl-instagram-direct4-config.js';
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

const fixedDate = new Date('2026-08-08T00:00:00.000Z');
const nextDate = new Date('2026-08-09T00:00:00.000Z');
const selectedTargets = selectScrapeTargets(fixedDate);
const nextTargets = selectScrapeTargets(nextDate);
const selectedByKind = (kind) => selectedTargets.filter((target) => target.kind === kind);
const selectedUrls = selectedTargets.map((target) => target.url);
const gastro2Urls = new Set(scrapeUrls(gastro2Source));

const configuredHashtags = [
  'kostenlosessenwien',
  'fooddealwien',
  'gastroaktionwien',
  ...ROTATING_HASHTAG_TARGETS.map((target) => target.label.slice(1)),
];
const configuredAccounts = [
  'tastyfood.vienna',
  ...ROTATING_ACCOUNT_TARGETS.map((target) => target.label.slice(1)),
];

assert.deepEqual(new Set(configuredHashtags), new Set(expectedHashtags));
assert.deepEqual(new Set(configuredAccounts), new Set(expectedAccounts));
assert.equal(WEB_TARGETS.length, 2);
assert.ok(WEB_TARGETS.some((target) => target.url.includes('gutschein.at')));
assert.ok(WEB_TARGETS.some((target) => target.url.includes('preisjaeger.at')));
assert.ok(WEB_TARGETS.every((target) => !target.url.includes('gastro.news')));

assert.equal(selectedTargets.length, 10, 'Key 4 should run ten real, bounded targets');
assert.equal(new Set(selectedUrls).size, selectedTargets.length, 'selected targets must be unique');
assert.equal(selectedByKind('instagram-hashtag').length, 5);
assert.equal(selectedByKind('instagram-account').length, 3);
assert.equal(selectedByKind('web-deal-list').length, 2);
assert.ok(selectedTargets.some((target) => target.id === 'hashtag:kostenlosessenwien'));
assert.ok(selectedTargets.some((target) => target.id === 'hashtag:fooddealwien'));
assert.ok(selectedTargets.some((target) => target.id === 'hashtag:gastroaktionwien'));
assert.ok(selectedTargets.some((target) => target.id === 'account:tastyfood.vienna'));
assert.ok(selectedByKind('instagram-hashtag').every((target) => target.url.includes('/explore/tags/')));
assert.ok(selectedByKind('instagram-account').every((target) => /^https:\/\/www\.instagram\.com\/[^/]+\/$/.test(target.url)));
assert.ok(selectedUrls.every((url) => !gastro2Urls.has(url)), 'Key 4 targets must not duplicate Gastro2 start URLs');
assert.notDeepEqual(
  selectedTargets.map((target) => target.id),
  nextTargets.map((target) => target.id),
  'rotating targets should change between days',
);

const gastro2Prompt = gastro2Source.match(/const PROMPT = `([\s\S]*?)`;/)?.[1] || '';
assert.equal(GASTRO2_BASE_PROMPT, gastro2Prompt, 'Key 4 base prompt must stay identical to Gastro2');

const hashtagPrompt = buildTargetPrompt(selectedByKind('instagram-hashtag')[0]);
const accountPrompt = buildTargetPrompt(selectedByKind('instagram-account')[0]);
const webPrompt = buildTargetPrompt(selectedByKind('web-deal-list')[0]);
assert.ok(hashtagPrompt.startsWith(GASTRO2_BASE_PROMPT));
assert.match(hashtagPrompt, /ausschließlich konkrete Originalposts/);
assert.match(accountPrompt, /ausschließlich konkrete Originalposts/);
assert.match(webPrompt, /Erfasse jede unterschiedliche aktuelle Aktion als eigenen Deal/);
assert.match(hashtagPrompt, /Ignoriere für diesen Durchlauf die allgemeine Web-Ergänzung/);
assert.match(hashtagPrompt, /Niemals Profil-, Kanal-, Hashtag- oder Explore-URLs/);
assert.doesNotMatch(hashtagPrompt, /Prüfe außerdem gezielt aktuelle Posts dieser Accounts/);

assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/corner_xvi/'), '');
assert.equal(
  normalizeInstagramPostUrl('https://www.instagram.com/reel/DbEYTWHRymD/?utm_source=fixture'),
  'https://www.instagram.com/reel/DbEYTWHRymD/',
);

const agentPayload = key4Source.match(/const result = await runAgent\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || '';
assert.match(key4Source, /process\.env\.FIRECRAWL_API_KEY4/);
assert.doesNotMatch(key4Source, /process\.env\.FIRECRAWL_API_KEY(?:1|2|3|5|6)\b/);
assert.doesNotMatch(key4Source, /process\.env\.FIRECRAWL_API_KEY\b/);
assert.match(key4Source, /return runBoundedFirecrawlAgent\(firecrawl, payload/);
assert.match(agentPayload, /urls: \[target\.url\]/);
assert.doesNotMatch(agentPayload, /(^|\n)\s*url:/);
assert.match(agentPayload, /prompt: buildTargetPrompt\(target\)/);
assert.match(agentPayload, /schema: gastroSchema/);
assert.match(agentPayload, /model: target\.kind === 'web-deal-list' \? 'spark-1-pro' : 'spark-1-mini'/);
assert.doesNotMatch(agentPayload, /maxCredits:/);
assert.match(key4Source, /normalizeInstagramPostUrl\(postUrl\)/);
assert.match(key4Source, /instagram-profile-not-post/);
assert.match(key4Source, /instagram-target-returned-web-result/);
assert.match(key4Source, /web-target-returned-other-domain/);
assert.match(key4Source, /mergeFirecrawlDealHistory\(allDeals, previousOutput\.deals/);
assert.match(key4Source, /verifyFirecrawlDeals\(history\.deals/);
assert.match(key4Source, /sourceStats/);
assert.match(key4Source, /totalCreditsUsed/);
assert.match(key4Source, /retainedPreviousDeals: history\.retainedPreviousDeals/);
assert.match(key4Source, /FIRECRAWL4_AGENT_TIMEOUT_SECONDS/);
assert.match(key4Source, /searchFreshInstagramPosts/);
assert.match(key4Source, /searchFreshWebDeals/);
assert.match(key4Source, /MAX_AGENT_FALLBACKS/);
assert.match(key4Source, /FIRECRAWL4_BROAD_AGENT_PASSES/);
assert.match(key4Source, /Diese Suche ist absichtlich offen/);
assert.doesNotMatch(key4Source, /classifyKey4Evidence|dedupeKey4Candidates|FC4_MAX_AGE_DAYS/);

assert.match(workflow, /FIRECRAWL_API_KEY4: \$\{\{ secrets\.FIRECRAWL_API_KEY4 \}\}/);
assert.doesNotMatch(workflow, /FIRECRAWL_API_KEY(?:1|2|3|5|6):/);
assert.doesNotMatch(workflow, /^\s+FIRECRAWL_API_KEY:/m);
assert.match(workflow, /FIRECRAWL4_MAX_CREDITS_PER_TARGET: 500/);
assert.match(workflow, /FIRECRAWL4_AGENT_TIMEOUT_SECONDS: 360/);
assert.match(workflow, /FIRECRAWL4_MAX_AGENT_FALLBACKS: 1/);
assert.match(workflow, /FIRECRAWL4_BROAD_AGENT_PASSES: 2/);
assert.match(workflow, /FIRECRAWL_POST_VERIFY_MAX: 60/);
assert.match(workflow, /FIRECRAWL_POST_VERIFY_MAX_AGE_DAYS: 7/);
assert.match(workflow, /FIRECRAWL_POST_MAX_ACCEPTED_AGE_DAYS: 7/);
assert.match(workflow, /timeout-minutes: 35/);
assert.doesNotMatch(workflow, /deals-(?:raw|review|rejected)-firecrawl4\.json/);

console.log('Firecrawl Key 4 targeted Gastro2-clone regression tests passed.');
