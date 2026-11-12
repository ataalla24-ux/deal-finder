import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeSourceOutbox } from './generated-source-merge.mjs';
import { inspectCouponTools } from './coupon-tools-preflight.mjs';
import { discoveryRejection } from '../scraper/deal-discovery-policy.js';
import { extractActiveOfferWindow } from '../scraper/instagram-ai-validity-utils.js';
import { isUnsafeSocialFoodReviewContent, normalizeSocialAuditCandidate } from '../scraper/social-food-audit-utils.js';
import { prepareSocialFoodReviewDeals } from '../scraper/slack-notify.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { classifyWithOpenAi } from '../scraper/instagram-ai-agent.js';

const now = new Date('2026-11-05T12:00:00Z');
const payload = deals => ({ deals, totalDeals: deals.length, lastUpdated: '2026-11-05T10:00:00Z' });
const inspection = async () => ({ ok: true, status: 200, dateHints: {}, contentHints: {} });
const candidate = description => ({ id: 'nov05-fixture', brand: 'Cafe Wien', title: 'Gratis Kaffee', description,
  url: 'https://www.instagram.com/reel/DfHZ5jORqUM/', distance: '1010 Wien', category: 'kaffee', type: 'gratis',
  source: 'instagram-ai-agent', pubDate: '2026-11-04T10:00:00Z', pubDateSource: 'instagram-graph-timestamp' });

test('concurrent source updates preserve new discoveries, remote proofs/edits and removals', () => {
  const base = payload([{ id: 'same', title: 'old', evidence: { caption: 'original', checked: 1 } }, { id: 'removed' }, { id: 'locally-pruned' }]);
  const remote = payload([{ id: 'same', title: 'human corrected', evidence: { caption: 'original', checked: 2 }, slackTs: '123.1' }, { id: 'remote-new' }, { id: 'locally-pruned' }]);
  const local = payload([{ id: 'same', title: 'stale rewrite', evidence: { caption: 'original', checked: 1, ocr: 'new OCR' } }, { id: 'removed', title: 'local enrichment' }, { id: 'local-new' }]);
  const result = mergeSourceOutbox(base, remote, local);
  assert.deepEqual(result.deals.map(d => d.id), ['same', 'remote-new', 'local-new']);
  assert.equal(result.deals[0].title, 'human corrected');
  assert.equal(result.deals[0].slackTs, '123.1');
  assert.deepEqual(result.deals[0].evidence, { caption: 'original', checked: 2, ocr: 'new OCR' });
  assert.equal(result.totalDeals, 3);
  assert.equal(mergeSourceOutbox({}, payload([{ id: 'remote' }]), payload([{ id: 'local' }])).deals.length, 2);
  assert.throws(() => mergeSourceOutbox(base, remote, { deals: [{ id: 'dup' }, { id: 'dup' }] }));
  assert.throws(() => mergeSourceOutbox(base, remote, []));
});

test('actual generated commit saves source results despite registry and verifier races', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-race-'));
  const script = path.resolve('scripts/commit-generated.mjs');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_EMAIL: 'fixture@example.test' };
  const run = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  const put = (cwd, file, value) => { fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true }); fs.writeFileSync(path.join(cwd, file), JSON.stringify(value)); };
  try {
    const seed = path.join(root, 'seed'), remote = path.join(root, 'remote.git'), stale = path.join(root, 'stale'), fresh = path.join(root, 'fresh');
    fs.mkdirSync(seed);
    run(seed, ['init', '-b', 'main']);
    put(seed, 'docs/deals-pending-firecrawl2.json', payload([{ id: 'old' }]));
    put(seed, 'docs/deals-pending-joe.json', payload([{ id: 'old-joe' }]));
    put(seed, 'docs/instagram-merchant-registry.json', { version: 'base' });
    run(seed, ['add', '.']); run(seed, ['commit', '-m', 'base']);
    run(root, ['init', '--bare', remote]); run(seed, ['remote', 'add', 'origin', remote]); run(seed, ['push', 'origin', 'main']);
    run(root, ['clone', '-b', 'main', remote, stale]); run(root, ['clone', '-b', 'main', remote, fresh]);
    put(fresh, 'docs/deals-pending-firecrawl2.json', payload([{ id: 'remote-verified' }]));
    put(fresh, 'docs/deals-pending-joe.json', payload([{ id: 'remote-joe' }]));
    put(fresh, 'docs/instagram-merchant-registry.json', { version: 'newer remote' });
    run(fresh, ['add', '.']); run(fresh, ['commit', '-m', 'concurrent verifier']); run(fresh, ['push', 'origin', 'main']);
    put(stale, 'docs/deals-pending-firecrawl2.json', payload([{ id: 'old' }, { id: 'new-local-deal' }]));
    put(stale, 'docs/deals-pending-joe.json', payload([{ id: 'old-joe' }, { id: 'local-joe' }]));
    put(stale, 'docs/instagram-merchant-registry.json', { version: 'stale local' });
    execFileSync(process.execPath, [script, '--skip-conflicts', '--message', 'source race fixture', '--remote', 'origin', '--branch', 'main', '--files', 'docs/deals-pending-firecrawl2.json', 'docs/deals-pending-joe.json', 'docs/instagram-merchant-registry.json'], { cwd: stale, env, encoding: 'utf8', stdio: 'pipe' });
    run(fresh, ['fetch', 'origin', 'main']);
    const result = JSON.parse(run(fresh, ['show', 'origin/main:docs/deals-pending-firecrawl2.json']));
    assert.deepEqual(result.deals.map(d => d.id), ['remote-verified', 'new-local-deal']);
    assert.deepEqual(JSON.parse(run(fresh, ['show', 'origin/main:docs/deals-pending-joe.json'])).deals.map(d => d.id), ['remote-joe', 'local-joe']);
    assert.equal(JSON.parse(run(fresh, ['show', 'origin/main:docs/instagram-merchant-registry.json'])).version, 'newer remote');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('coupon preflight skips installed tools and bounds both package operations', () => {
  const available = inspectCouponTools((tool, args, options) => {
    assert.equal(options.timeout, 3000);
    return { status: 0, stdout: args.includes('--list-langs') ? 'deu\neng\nosd\n' : 'version' };
  });
  assert.equal(available.available, true);
  assert.deepEqual(available.packages, []);
  const missing = inspectCouponTools(() => ({ status: 1 }));
  assert.equal(missing.available, false);
  assert.equal(missing.packages.filter(p => p === 'poppler-utils').length, 1);
  const action = fs.readFileSync('.github/actions/coupon-tools/action.yml', 'utf8');
  assert.match(action, /60s sudo apt-get/);
  assert.match(action, /120s sudo apt-get/);
  assert.match(action, /if \(installed\) needed = false/);
  assert.match(action, /inspectCouponTools/);
  assert.match(action, /COUPON_TOOLS_AVAILABLE/);
  assert.match(action, /MISSING_COUPON_PACKAGES/);
  assert.doesNotMatch(action, /exit 0|continue-on-error/);
});

test('Instagram captions survive unavailable optional OCR dependencies without installing PDF tools', () => {
  const calls = [];
  const available = inspectCouponTools((tool, args) => {
    calls.push(tool);
    return { status: 0, stdout: args.includes('--list-langs') ? 'deu\neng\n' : '' };
  }, { includePdf: false });
  assert.equal(available.available, true);
  assert(!calls.some(tool => tool.startsWith('pdf')));
  const missing = inspectCouponTools(() => ({ status: 1 }), { includePdf: false });
  assert.deepEqual(missing.packages, ['ffmpeg', 'tesseract-ocr', 'tesseract-ocr-deu', 'tesseract-ocr-eng']);
  const workflow = fs.readFileSync('.github/workflows/meta-instagram-deals.yml', 'utf8');
  assert.match(workflow, /coupon-tools-preflight\.mjs --instagram/);
  const install = workflow.split('- name: Install missing Instagram media OCR tools')[1].split('- name: Collect official')[0];
  assert.match(install, /available != 'true'/);
  assert.match(install, /continue-on-error: true/);
  assert.match(install, /timeout-minutes: 5/);
  assert.match(install, /Acquire::Retries=1/);
  const collect = workflow.split('- name: Collect official Meta Instagram deals')[1].split('- name: Verify factual')[0];
  assert.doesNotMatch(collect, /steps\.media_tools|always\(\)/);
  assert.match(collect, /meta_graph_health.outputs.ready == 'true'/);
});

test('TikTok uses current saved pauses and does not lose captions to optional OCR setup failures', () => {
  const workflow = fs.readFileSync('.github/workflows/tiktok-deals.yml', 'utf8');
  assert.match(workflow, /actions\/checkout@v4\s+with:\s+ref: main/);
  assert.match(workflow, /coupon-tools-preflight\.mjs --social-media/);
  const install = workflow.split('- name: Install missing TikTok media OCR tools')[1].split('- name: Scan current')[0];
  assert.match(install, /available != 'true'/);
  assert.match(install, /continue-on-error: true/);
  assert.match(install, /timeout-minutes: 5/);
  assert.match(install, /Acquire::Retries=1/);
  const collect = workflow.split('- name: Scan current TikTok deals')[1].split('- name: Commit')[0];
  assert.doesNotMatch(collect, /steps\.media_tools|always\(\)/);
  assert.match(workflow, /TIKTOK_SEARCH_PAGES: 3/);
  assert.match(workflow, /TIKTOK_SEARCH_COUNT: 30/);
});

test('November 11 non-offers cannot pass the standard or food review lanes', async () => {
  const rejects = [
    'Mehr Genuss. Weniger zahlen. Gratisangebote und Food-Deals in Wien mit FreeFinder entdecken. Kaffee fuer 2,50 EUR. Burger King 1+1. Werbung fuer FreeFinder.',
    'Mit nur 10 Euro ein Fruehstueck fuer zwei Personen zaubern. Das Video bietet Schritt-fuer-Schritt-Anleitungen und erklaert, welche Zutaten man im Supermarkt kaufen muss.',
    'For Vienna restaurants, bars, cafes and hotels: 1 Reel (20 s) + 3 edited photos, free. One offer per venue.',
    'TIPTRUST: Neue Partner in Wien. Die ersten 2 starten gratis. 0 EUR Einrichtung, 0 EUR monatlich. Du bist Handwerker oder Dienstleister? Pruefe deinen Partnerplatz.',
    'Wie jedes Jahr haben wir als Kubbe Cocuk an der Baumpflanzaktion teilgenommen. Gemeinsam verbrachten wir einen schoenen Tag. Danke an die Stadt Wien.',
  ];
  for (const description of rejects) {
    const deal = { ...candidate(description), title: description, description };
    assert(discoveryRejection(deal), description);
    assert(isUnsafeSocialFoodReviewContent(description), description);
    const checked = await validateDealsForSlack([deal], { now, inspectDealUrlHealth: inspection });
    assert.equal(checked.allowedDeals.length, 0, description);
  }
  for (const description of [
    'Running + Boxing oder Pilates + Brunch fuer nur 10 EUR. 14. November in Wien.',
    '5 Gerichte zur Auswahl inklusive Suppe fuer nur 14,90 EUR. Wien.',
    'Gratis Semmel-Doener am 14.11.2026 von 12 bis 15 Uhr fuer alle Follower.',
    '2 EUR Rabatt auf Mocktails (18 bis 20 Uhr).',
    'Konditorkrapfen: 4+1 gratis, 8+2 gratis, 16+4 gratis.',
    'Schritt-fuer-Schritt-Anleitungen mit Zutaten. Heute bei uns: 20% Rabatt auf Pizza mit Code PIZZA20.',
    'For Vienna restaurants: free edited photos. Fuer alle Gaeste gibt es gratis Kaffee.',
    'For Vienna restaurants: free edited photos. Fuer alle Gaeste: 20% Rabatt auf Pizza.',
    'For Vienna restaurants: free edited photos. Fuer alle Gaeste: 1+1 Burger.',
    'Baeume pflanzen in Wien: Heute gibt es gratis Pizza fuer alle Teilnehmer.',
  ]) assert.equal(discoveryRejection({ title: description, description }), '', description);
});

const badAds = [
  'NiKa Bilanz zeigt dir wo jeder Euro hingeht. Rechnung, Betrag und MwSt. Belege an den Steuerberater. Schick uns deine Speisekarte und sieh gratis welche Gerichte zu wenig verdienen. Wien.',
  'Mit e-stempel.at sammeln Ihre Gaeste digitale Kaffeestempel. Belohnen Sie Treue mit Levels, z. B. Stufe 1: Gratis Espresso, Stufe 2: ein Stueck Torte. Wien.',
  'Volunteers Wanted! Wir suchen Unterstuetzung fuer Kochkurse. Du bist Helping Hand und bekommst ein gratis Ticket fuer den Kochkurs in Wien.',
];

test('real B2B and work-for-reward cases cannot use the consumer or review lanes', async () => {
  for (const text of badAds) {
    assert(discoveryRejection(text), text);
    assert.equal(isUnsafeSocialFoodReviewContent(text), true);
    const audit = normalizeSocialAuditCandidate({ ...candidate(text), text, status: 'rejected', rejectionReason: 'no-concrete-offer' }, {}, now);
    assert.equal(audit.reviewEligible, false);
    const review = { ...candidate(text), socialFoodReview: true, evidence: { socialFoodAudit: { foodDrinkScore: 2, dealSignal: true, viennaSignal: true, contentViennaSignal: true } } };
    assert.equal(prepareSocialFoodReviewDeals([review], { now }).deals.length, 0);
    const checked = await validateDealsForSlack([candidate(text)], { now, inspectDealUrlHealth: inspection });
    assert.equal(checked.allowedDeals.length, 0);
  }
  assert.equal(isUnsafeSocialFoodReviewContent('VIP is only EUR25 more. Dinner buffet, after-party with DJ, VIP only.'), true);
});

test('real loyalty rewards, public food distribution and low prices are retained', () => {
  for (const text of [
    'Bei unserer digitalen Stempelkarte ist dein 10. Kaffee gratis. Cafe in Wien.',
    'Unsere digitale Stempelkarte fuer Stammkunden: Dein 10. Kaffee ist gratis im Cafe in Wien.',
    'Unsere digitale Stempelkarte belohnt euch, zum Beispiel mit Gratis Kaffee nach 10 Besuchen. Wien.',
    'Unsere Volunteers verteilen morgen gratis Kaffee an alle Besucher in Wien.',
    'Eroeffnungsaktion: Doener fuer nur 1 Euro in 1100 Wien.',
    'Gratis Kaffee fuer alle unsere Gaeste bei der Eroeffnung in Wien.',
  ]) {
    assert.equal(discoveryRejection(text), '', text);
    assert.equal(isUnsafeSocialFoodReviewContent(text), false, text);
  }
});

test('explicit action date and year block old openings despite a fresh post or missing expiry', async () => {
  for (const year of [2025, 2026]) {
    const text = `CIO HALLOWEEN GRAND OPENING! Samstag, 31. Oktober ${year} 12:00-17:00 Uhr GRATIS DOENER in 1010 Wien.`;
    assert.equal(extractActiveOfferWindow(text, { now }).endDate.toISOString().slice(0, 10), `${year}-10-31`);
    const result = await validateDealsForSlack([candidate(text)], { now, inspectDealUrlHealth: inspection });
    assert.equal(result.allowedDeals.length, 0);
    assert(result.blockedDeals[0].validity.reasons.some(r => /abgelaufen/.test(r)));
  }
});

test('future actions and cross-year/recurring offers survive; publication labels are not expiry', async () => {
  for (const text of [
    'GRATIS Kaffee bei der Eroeffnung! Samstag, 7. November 2026 von 12:00-17:00 Uhr in 1010 Wien.',
    'Gratis Kaffee fuer alle Gaeste von 2. November 2026 bis 31. Jaenner 2027 in Wien.',
    'Jeden Montag Gratis Kaffee in 1010 Wien.',
    'Gratis Kaffee am 7. Nov. 2026 in 1010 Wien.',
    'Gratis Kaffee am 2026-11-07 in 1010 Wien.',
  ]) assert.equal((await validateDealsForSlack([candidate(text)], { now, inspectDealUrlHealth: inspection })).allowedDeals.length, 1, text);
  assert.equal(extractActiveOfferWindow('Veroeffentlicht Samstag, 31. Oktober 2026. Unser Kaffee bleibt gratis fuer alle Gaeste.', { now }), null);
  const outside = candidate('Gratis Kaffee am 7. November 2026 in 2026 Ernstbrunn.');
  assert.equal((await validateDealsForSlack([outside], { now, inspectDealUrlHealth: inspection })).allowedDeals.length, 0, 'a real 20xx postal code must not be removed with calendar years');
});

test('quota failures are redacted and never retried as ordinary rate limits', async () => {
  let calls = 0;
  const result = await classifyWithOpenAi([candidate('Gratis Kaffee Wien')], { enabled: true, apiKey: 'fixture-not-a-secret', fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'PRIVATE PROVIDER TEXT must not be persisted' } }), { status: 429 });
  } });
  assert.equal(calls, 1);
  assert.equal(result.health.code, 'insufficient_quota');
  assert.equal(result.health.billingActionRequired, true);
  assert.equal(result.health.retryable, false);
  assert(!JSON.stringify(result).includes('PRIVATE PROVIDER TEXT'));
});
