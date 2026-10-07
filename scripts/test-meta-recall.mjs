import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConfig, normalizeAdLibraryItem, retainMetaOutbox, runMetaInstagramCollector } from '../scraper/meta-instagram-deals.js';
import { hasFreshActiveAdEvidence } from '../scraper/meta-ad-library-coverage.js';
import { enrichInstagramGraphMedia } from '../scraper/instagram-media-evidence.js';
import { mergeMediaBacklog, saveMediaBacklog } from '../scraper/instagram-media-backlog.js';
import { buildSocialFoodArtifacts, buildAndWriteSocialFoodAudit } from '../scraper/social-food-audit.js';
import { normalizeSocialAuditCandidate } from '../scraper/social-food-audit-utils.js';
import { selectSocialFoodReviewDeals, normalizeDeal } from '../scraper/slack-notify.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const now = new Date('2026-10-07T18:00:00Z');
const config = buildConfig({ OPENAI_API_KEY: 'test-only', META_INSTAGRAM_MEDIA_MAX_POSTS_PER_RUN: '1',
  META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_RUN: '1' }, now);
const ad = { id: '123456789', page_name: 'Test Restaurant', publisher_platforms: ['FACEBOOK'],
  ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=123456789',
  ad_creative_bodies: ['Sonntagsbrunch 9,90 EUR statt 19,90 EUR. 04.10.2026 bis 15.11.2026. Wurlitzergasse 87, 1170 Wien.'],
  ad_delivery_start_time: '2026-10-01T09:00:00Z', _adLibraryActiveCheckedAt: now.toISOString() };
const facebook = normalizeAdLibraryItem(ad, config, now).deal;
assert(facebook, 'Facebook-only consumer offers are discoverable');
assert(hasFreshActiveAdEvidence(facebook, now));
const validated = await validateDealsForSlack([normalizeDeal(facebook, 'meta-instagram')], {
  now, inspectDealUrlHealth: async (url) => ({ ok: true, status: 200, finalUrl: url, contentHints: {} }),
});
assert.equal(validated.allowedDeals.length, 1, 'Facebook evidence survives the central validator');
const invalidEvidence = await validateDealsForSlack([{ ...facebook, pubDate: '2026-09-01T09:00:00Z',
  sourcePublishedAt: '2026-09-01T09:00:00Z', evidence: { ...facebook.evidence, activeAdCheckedAt: '2026-09-01T09:00:00Z' } }], {
  now, inspectDealUrlHealth: async (url) => ({ ok: true, status: 200, finalUrl: url, contentHints: {} }),
});
assert.equal(invalidEvidence.allowedDeals.length, 0, 'Facebook label cannot bypass social freshness');
assert.equal(normalizeAdLibraryItem({ ...ad, publisher_platforms: ['AUDIENCE_NETWORK'] }, config, now).deal, null);
assert.equal(normalizeAdLibraryItem({ ...ad, publisher_platforms: undefined }, config, now).deal, null);
assert.equal(retainMetaOutbox([facebook], [facebook], now).length, 1, 'the same ad on two platforms is one deal');
assert.equal(retainMetaOutbox([], [facebook], now).length, 1);
assert.equal(retainMetaOutbox([], [facebook], new Date(+now + 25 * 3600000)).length, 0, 'retention cannot renew ACTIVE evidence');
assert.equal(retainMetaOutbox([], [facebook], now, new Set([facebook.id])).length, 0);
assert.equal(retainMetaOutbox([], [{ ...facebook, title: 'Jobs in Wien', description: 'Mitarbeiter gesucht, gratis Mittagessen fuer Mitarbeiter' }], now).length, 0);
const organic = { id: 'meta-ig-123', title: 'Gratis Kaffee', description: 'Gratis Kaffee in Wien', pubDate: now.toISOString() };
assert.equal(retainMetaOutbox([], [organic], now).length, 1);
assert.equal(retainMetaOutbox([], [organic], new Date(+now + 8 * 86400000)).length, 0);
assert.equal(retainMetaOutbox([], [{ ...organic, expires: '2026-10-06T20:00:00Z' }], now).length, 0);
assert.equal(retainMetaOutbox([{ ...organic, title: 'Neues belegtes Angebot' }], [organic], now)[0].title, 'Neues belegtes Angebot');

const entry = (id) => ({ item: { id, caption: 'Unser Kaffee-Wochenplan in Wien', timestamp: '2026-10-07T09:00:00Z',
  media_type: 'IMAGE', media_url: `https://scontent.cdninstagram.com/${id}.jpg`, permalink: `https://www.instagram.com/p/${id}/` },
context: { sourceType: 'account', sourceName: 'wiencafe', account: { username: 'wiencafe', verifiedVienna: true, category: 'food' } } });
const mediaOptions = { tools: { tesseract: true, ffmpeg: false },
  analyzeItem: async () => ({ ocrText: 'Zweiter Kaffee gratis in 1070 Wien', assetCount: 1, imageCount: 1, errors: [],
    visionImages: ['data:image/jpeg;base64,AQID'] }),
  classifyOcr: async () => ({ isDeal: true, confidence: 0.95, offerText: 'Zweiter Kaffee gratis in 1070 Wien', exclusion: 'none' }),
};
const first = await enrichInstagramGraphMedia([entry('first'), entry('second'), entry('third')], config, now, mediaOptions);
assert.equal(first.report.analyzed, 1);
assert.equal(first.backlog.length, 2, 'per-run cap defers instead of discarding');
const second = await enrichInstagramGraphMedia([], config, new Date(+now + 3600000), { ...mediaOptions, cache: first.cache, backlog: first.backlog });
assert.equal(second.report.backlogResumed, 2, 'a completely empty next API snapshot still drains the queue');
assert.equal(second.report.analyzed, 1);
assert.equal(second.backlog.length, 1);
const third = await enrichInstagramGraphMedia([], config, new Date(+now + 2 * 3600000), { ...mediaOptions, cache: second.cache, backlog: second.backlog });
assert.equal(third.backlog.length, 0);
const budgeted = await enrichInstagramGraphMedia([entry('budgeted')], { ...config, mediaLlmMaxCallsPerRun: 0 }, now, mediaOptions);
assert.equal(budgeted.report.aiCalls, 0);
assert.equal(budgeted.backlog.length, 1, 'exhausted daily AI budget retains evidence candidates');
const restored = await enrichInstagramGraphMedia([], config, new Date(+now + 3600000), { ...mediaOptions, cache: budgeted.cache, backlog: budgeted.backlog });
assert.equal(restored.report.aiCalls, 1);
assert.equal(restored.backlog.length, 0);
const deferred = await enrichInstagramGraphMedia([entry('deadline')], config, now, { ...mediaOptions, deadline: 0,
  analyzeItem: () => assert.fail('runtime cap must defer expensive work') });
assert.equal(deferred.report.runtimeDeferred, 1);
assert.equal(deferred.backlog.length, 1);
assert.equal(mergeMediaBacklog([], first.backlog, new Date(+now + 8 * 86400000)).entries.length, 0);
const unsafe = entry('safe');
unsafe.item.token = 'secret-do-not-store';
unsafe.item._mediaEvidence = { aiPending: true, visionImages: ['data:image/jpeg;base64,PRIVATE'] };
unsafe.item.thumbnail_url = 'https://scontent.cdninstagram.com/a.jpg?access_token=secret';
unsafe.context.token = 'secret';
unsafe.context.account.secret = 'secret';
const stored = saveMediaBacklog([unsafe], {}, now, config);
assert.equal(stored.length, 1);
assert.doesNotMatch(JSON.stringify(stored), /secret|access_token|data:image|PRIVATE/);
assert.equal(saveMediaBacklog([{ ...entry('evil'), item: { ...entry('evil').item, media_url: 'https://attacker.invalid/photo' } }], {}, now, config).length, 0);
const updated = entry('second'); updated.item.media_url = 'https://scontent.cdninstagram.com/fresh-signed.jpg';
assert.equal(mergeMediaBacklog([updated], first.backlog, now).entries.find((row) => row.item.id === 'second').item.media_url, updated.item.media_url);

const rows = Array.from({ length: 120 }, (_, i) => normalizeSocialAuditCandidate({
  url: `https://www.instagram.com/reel/REVIEW${i}/`, title: 'Gratis Pizza in Wien',
  textSample: 'Diese Woche gratis Pizza in 1070 Wien', pubDate: '2026-10-07T09:00:00Z', reason: 'no-concrete-offer', status: 'rejected',
}, { source: 'meta-instagram', sourceLabel: 'Meta Instagram Graph' }, now));
const all = buildSocialFoodArtifacts({ now, observations: rows, sendAll: true });
assert.equal(all.review.deals.length, 120, 'neither daily nor per-source artifact cap drops eligible candidates');
assert.equal(all.review.policy.maxSlackPostsPerDay, null);
const selection = selectSocialFoodReviewDeals(all.review.deals, { day: '2026-10-07', posted: [{ key: 'instagram:reel:REVIEW0' }] }, { now, sendAll: true });
assert.equal(selection.deals.length, 119, 'unlimited delivery retains posted-key deduplication');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-recall-'));
try {
  const reviewPath = path.join(tmp, 'review.json');
  fs.writeFileSync(reviewPath, JSON.stringify(all.review));
  const retained = buildAndWriteSocialFoodAudit({ docsDir: tmp, reviewPath, now, sourceSpecs: [], sendAll: true });
  assert.equal(retained.review.deals.length, 120, 'empty collector snapshots cannot erase unsent review candidates');
  fs.writeFileSync(path.join(tmp, 'report.json'), JSON.stringify({ candidateAudit: [{
    url: rows[0].url, title: 'Gratis Pizza in Wien', textSample: 'Gratis Pizza in Wien', pubDate: now.toISOString(), reason: 'giveaway', status: 'rejected',
  }] }));
  const revised = buildAndWriteSocialFoodAudit({ docsDir: tmp, reviewPath, now, sendAll: true,
    sourceSpecs: [{ key: 'meta-instagram', report: 'report.json', output: 'pending.json' }] });
  assert.equal(revised.review.deals.length, 119, 'new hard rejection supersedes previous review candidate');
  const expired = buildAndWriteSocialFoodAudit({ docsDir: tmp, reviewPath, sourceSpecs: [], now: new Date(+now + 8 * 86400000), sendAll: true });
  assert.equal(expired.review.deals.length, 0);

  const env = { META_AD_LIBRARY_ACCESS_TOKEN: 'test', META_AD_LIBRARY_SEARCH_TERMS: 'Wien Brunch',
    META_INSTAGRAM_MAX_RETRIES: '0', META_INSTAGRAM_OUTPUT_ALL_VERIFIED: '1',
    META_INSTAGRAM_OUTPUT_PATH: path.join(tmp, 'output.json'), META_INSTAGRAM_REPORT_PATH: path.join(tmp, 'scan-report.json'),
    META_INSTAGRAM_STATE_PATH: path.join(tmp, 'state.json'), META_INSTAGRAM_GRAPH_EVIDENCE_PATH: path.join(tmp, 'graph.json') };
  const paths = { watchlistPath: path.join(tmp, 'none'), registryPath: path.join(tmp, 'none'), candidatePaths: [] };
  await runMetaInstagramCollector({ env, paths, now, fetchImpl: async () => Response.json({ data: [ad] }) });
  const empty = await runMetaInstagramCollector({ env, paths, now, fetchImpl: async () => Response.json({ data: [] }) });
  assert.equal(empty.payload.deals.length, 1, 'collector outbox persists across successful empty scans');
  const rejected = await runMetaInstagramCollector({ env, paths, now, fetchImpl: async () => Response.json({ data: [{ ...ad, ad_creative_bodies: ['Gratis Kebab in Wien am 05.10.2026'] }] }) });
  assert.equal(rejected.payload.deals.length, 0, 'new expiry evidence invalidates a retained ad');
  const graphConfig = { ...buildConfig({ ...env, INSTAGRAM_ACCESS_TOKEN: 'test-graph', INSTAGRAM_USER_ID: '123',
    META_INSTAGRAM_ACCOUNTS: 'testrestaurant', META_INSTAGRAM_MAX_ACCOUNTS_PER_RUN: '1',
    META_INSTAGRAM_MAX_GRAPH_REQUESTS: '1' }, now), hashtags: [], adLibraryToken: '' };
  const rescuedEntry = entry('rescued');
  rescuedEntry.item.caption = 'Gratis Kaffee in Wien am 08.10.2026, Neubaugasse 9, 1070 Wien';
  const rescued = await runMetaInstagramCollector({ env, config: graphConfig, paths, now,
    scanStatePath: path.join(tmp, 'scan.json'), peerScanStatePath: path.join(tmp, 'peer.json'),
    fetchImpl: async () => Response.json({ error: { message: 'Temporary failure', code: 2 } }, { status: 503 }),
    enrichGraphMedia: async () => ({ entries: [rescuedEntry], cache: {}, backlog: [], report: { aiCalls: 0 } }),
  });
  assert.equal(rescued.shouldFail, true, 'API failure remains observable');
  assert.equal(rescued.payload.deals.length, 1, 'successfully rescued backlog is retained even if all API sources failed');
  assert.equal(JSON.parse(fs.readFileSync(env.META_INSTAGRAM_OUTPUT_PATH, 'utf8')).deals.length, 1);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('Meta recall: Facebook evidence, durable queues, bounded media work, uncapped eligible review and retained outbox passed');
