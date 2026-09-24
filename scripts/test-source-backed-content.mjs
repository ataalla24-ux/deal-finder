import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeDealRecord, inferPreferredBrand, cleanUiNoiseText } from '../scraper/deal-normalization-utils.js';
import { inspectDealContentQuality } from '../scraper/deal-content-quality-utils.js';
import { normalizeSocialDeal, maybeEnrichDealCopy } from '../scraper/normalize-live-deals.js';
import { extractDealsFromThreadMessages } from '../scraper/slack-digest-utils.js';
import { applyLiveDealEditsToBundle, normalizeLiveDealEdit } from './live-deal-edits-lib.mjs';
import { applyReviewedContent } from './apply-reviewed-content.mjs';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

for (const street of ['Thaliastraße 23', 'Thaliastrasse 23', 'Thaliagasse 23']) {
  const deal = { brand: 'Instagram', title: 'Döner für 3,50 €', description: `Unser Lokal in der ${street}`, category: 'essen' };
  assert.notEqual(inferPreferredBrand(deal), 'Thalia');
  assert.doesNotMatch(normalizeDealRecord(deal).logoUrl, /thalia/);
}
assert.equal(inferPreferredBrand({ brand: 'Instagram', title: '20 % Rabatt bei Thalia' }), 'Thalia');
assert.equal(inferPreferredBrand({ brand: 'McDonalds', title: '1+1 Nuggets' }), "McDonald's");
assert.equal(inferPreferredBrand({ brand: 'Centimeter_vienna' }), 'Centimeter Wien');
assert.notEqual(inferPreferredBrand({ brand: 'Instagram', title: '1+1 Crêpes in Wien' }), "Mama's Crêpes & Shakes", 'a food type is not a merchant name');
assert.equal(inferPreferredBrand({ brand: "Mama's Crêpes & Shakes", title: '1+1 Crêpes' }), "Mama's Crêpes & Shakes");
assert.equal(inferPreferredBrand({ brand: 'Thalia', title: 'Döner in der Thaliastraße', ownerUsername: 'duruvienna', merchantUsername: 'duruvienna', sourceAccountType: 'merchant', metaGraphVerified: true }), 'Duru Döner');
assert.equal(inferPreferredBrand({ brand: 'Thalia', title: '20 % auf Bücher', ownerUsername: 'duruvienna', merchantUsername: 'duruvienna', sourceAccountType: 'creator', metaGraphVerified: true }), 'Thalia', 'a creator handle cannot override the merchant');
assert.equal(cleanUiNoiseText('Nur mit Coupon in der App. Pro Person ein Gutschein.'), 'Nur mit Coupon in der App. Pro Person ein Gutschein.');

const original = {
  id: 'duru', brand: 'Thalia', title: 'Döner-Aktion in der Thaliastraße 23',
  description: 'Kurztext', category: 'essen', type: 'rabatt',
  url: 'https://www.instagram.com/reel/EXAMPLE/',
  logo: '📚', logoUrl: 'https://freefinder.at/assets/brand-logos/thalia-thalia-at.png',
  pubDate: '2026-09-20T12:00:00Z', votes: 4, expires: '2026-09-23T23:59:59.999Z',
};
const fullDescription = 'Hühnerdöner für 3,50 € und Kalbdöner für 4,50 €. Nur in der Filiale Thaliastraße 23, 1160 Wien am 23.09.2026 von 09:00 bis 18:00 Uhr. Pro Person ein Döner zum Aktionspreis.';
const edit = normalizeLiveDealEdit({
  dealId: 'duru', brand: 'Duru Döner', title: 'Hühnerdöner für 3,50 €',
  description: fullDescription, location: 'Thaliastraße 23, 1160 Wien',
  address: 'Thaliastraße 23, 1160 Wien', validOn: '2026-09-23',
  expiryKind: 'single', expires: original.expires, expiryDisplayText: '23.09.2026, 09:00–18:00',
  editedBy: 'source-review', updatedAt: '2026-09-23T09:00:00Z',
});
const untouched = { id: 'other', title: 'Other', votes: 3 };
const bundle = { deals: [original, untouched] };
const applied = applyLiveDealEditsToBundle(bundle, { edits: [edit] });
assert.equal(applied.bundle.deals.length, 2);
assert.deepEqual(applied.bundle.deals[1], untouched);
const corrected = applied.bundle.deals[0];
assert.equal(corrected.logoUrl, '');
assert.equal(corrected.expiryKind, 'single');
assert.equal(corrected.votes, 4);
assert.equal(corrected.pubDate, original.pubDate);
let replayed = corrected;
for (let i = 0; i < 3; i++) replayed = normalizeDealRecord(normalizeSocialDeal(normalizeDealRecord(replayed)));
for (const field of ['brand', 'title', 'description', 'location', 'address', 'validOn', 'expiryKind', 'expiryDisplayText']) {
  assert.equal(replayed[field], corrected[field], `reviewed ${field} survives repeat normalization`);
}
assert.doesNotMatch(replayed.logoUrl, /thalia/);
assert.equal(replayed.logo, '🌯');
assert.equal(applyLiveDealEditsToBundle(applied.bundle, { edits: [edit] }).changed, false, 'edit replay is idempotent');

const sameValueEdit = applyLiveDealEditsToBundle({ deals: [original] }, { edits: [normalizeLiveDealEdit({ dealId: 'duru', description: original.description })] });
assert.ok(sameValueEdit.bundle.deals[0].liveEditedFields.includes('description'), 'same-value confirmations also protect the field');
const nextEdit = applyLiveDealEditsToBundle(applied.bundle, { edits: [normalizeLiveDealEdit({ dealId: 'duru', location: '', address: '' })] });
assert.equal(nextEdit.bundle.deals[0].location, '');
assert.ok(nextEdit.bundle.deals[0].liveEditedFields.includes('brand'), 'later edits do not forget earlier field ownership');
const legacyEmpty = applyLiveDealEditsToBundle(bundle, { edits: [normalizeLiveDealEdit({ dealId: 'duru', description: '', validUntil: '' })] });
assert.equal(legacyEmpty.bundle.deals[0].description, original.description, 'legacy empty form fields must not clear content');
assert.ok(!legacyEmpty.bundle.deals[0].liveEditedFields.includes('validUntil'), 'ignored empty dates must not become locked');

const social = { ...original, brand: 'Duru Döner', title: 'Hühnerdöner für 3,50 €', description: fullDescription };
assert.equal(normalizeSocialDeal(social).description, fullDescription, 'complete conditions must not become a generic summary');
const weak = { ...social, description: '' };
assert.equal(maybeEnrichDealCopy(weak, { description: fullDescription }), true);
assert.equal(weak.description, fullDescription, 'target-page enrichment retains the tail beyond 180 chars');

const queue = [{ ...social, description: 'Mit diesem Gutschein gibt es ein zweites Gericht gratis. Nur vor Ort nach 14 Uhr, nicht mit anderen Aktionen kombinierbar.' }];
const message = (description) => ({ ts: '1790108400.0', text: `1. Hühnerdöner für 3,50 €\nMarke/Restaurant: Duru Döner\nBeschreibung: ${description}\nOrt: Wien\nKategorie: essen | Typ: rabatt\nDirektlink: https://www.instagram.com/reel/EXAMPLE/\nDeal-ID: duru` });
const parsed = extractDealsFromThreadMessages([message(queue[0].description.slice(0, 70))], { pendingQueue: queue });
assert.equal(parsed.length, 1);
assert.equal(parsed[0].description, queue[0].description, 'Slack preview must not truncate queued conditions');
const manuallyChanged = 'Nur am Samstag, abweichend vom ursprünglichen Angebot.';
assert.equal(extractDealsFromThreadMessages([message(manuallyChanged)], { pendingQueue: queue })[0].description, manuallyChanged);

const issueCodes = (deal) => inspectDealContentQuality(deal).map((issue) => issue.code);
assert.ok(issueCodes({ ...original, metaGraphCaption: 'Duru: Döner in der Thaliastraße 23. Pro Person ein Döner.' }).includes('street-as-merchant'));
assert.ok(!issueCodes({ ...original, metaGraphCaption: 'Thalia eröffnet in der Thaliastraße.' }).includes('street-as-merchant'));
assert.ok(issueCodes({ ...original, description: '', metaGraphCaption: 'Nur per App. Pro Person ein Gutschein.' }).includes('source-condition-missing'));
assert.ok(issueCodes({ ...original, sourceAccountType: 'creator', merchantUsername: '' }).includes('unresolved-merchant'));
assert.ok(issueCodes({ ...original, expires: '', distance: 'Wien' }).includes('validity-unspecified'));
assert.ok(issueCodes({ ...original, expires: '', expiryDisplayText: 'Bis Saisonende; genaues Datum nicht genannt' }).includes('validity-unspecified'));
assert.ok(!issueCodes({ ...corrected, description: 'Ausschließlich bei Duru in der Thaliastraße 23.', metaGraphCaption: 'Ausschließlich in unserer Filiale Thaliastraße 23.' }).includes('source-condition-missing'));
assert.ok(issueCodes({ ...original, distance: 'Wien' }).includes('location-unspecific'));
assert.deepEqual(original, bundle.deals[0], 'review checks and edits do not mutate the source object');
const approval = await validateDealsForSlack([{ ...original,
  url: 'https://example.com/duru', pubDateSource: 'sourcePage',
  metaGraphCaption: 'Duru in der Thaliastraße 23. Pro Person ein Döner.',
}], { now: new Date('2026-09-21T12:00:00Z'), requireVienna: false,
  inspectDealUrlHealth: async (url) => ({ status: 200, finalUrl: url, dateHints: {}, contentHints: {} }),
});
assert.equal(approval.results[0].decision.allowed, true, 'content hints do not silently block an otherwise eligible deal');
assert.match(approval.results[0].deal.validity.warnings.join(' '), /Anbieter scheint aus einem Straßennamen/);
const manifest = { checkedAt: '2026-09-23T09:00:00Z', reviews: [{
  dealId: original.id, sourceUrl: original.url, expectedBrand: 'Thalia', status: 'verified',
  evidence: 'Test fixture: merchant caption', patch: { brand: 'Duru Döner' },
}] };
assert.equal(applyReviewedContent(bundle, { edits: [] }, manifest).bundle.deals[0].brand, 'Duru Döner');
assert.throws(() => applyReviewedContent(bundle, { edits: [] }, { ...manifest, reviews: [{ ...manifest.reviews[0], sourceUrl: 'https://wrong.example/' }] }));
assert.throws(() => applyReviewedContent(bundle, { edits: [] }, { ...manifest, reviews: [{ ...manifest.reviews[0], patch: { hidden: 'true' } }] }));

const cheesecakeManifest = JSON.parse(fs.readFileSync(new URL('../reviews/2026-09-24-cheesecake.json', import.meta.url)));
const cheesecakeReview = cheesecakeManifest.reviews[0];
const cheesecakeOriginal = {
  id: cheesecakeReview.dealId, url: cheesecakeReview.sourceUrl,
  brand: 'Cheesecake', merchantName: 'Cheesecake',
  title: 'rotating_light: First come, first served',
  description: 'Get ready, #cheesecake lovers! :cake:',
  category: 'reisen', type: 'gratis', logo: '✈️', logoUrl: '',
  pubDate: '2026-09-23T10:44:12.000Z', votes: 1,
  expires: '2026-09-26T23:59:59.999Z', validOn: '2026-09-26',
};
const cheesecakeResult = applyReviewedContent({ deals: [cheesecakeOriginal, untouched] }, { edits: [] }, cheesecakeManifest);
const cheesecake = cheesecakeResult.bundle.deals[0];
let normalizedCheesecake = cheesecake;
for (let i = 0; i < 3; i++) {
  normalizedCheesecake = normalizeDealRecord(normalizeSocialDeal(normalizeDealRecord(normalizedCheesecake)));
}
for (const [field, expected] of Object.entries(cheesecakeReview.patch)) {
  assert.equal(normalizedCheesecake[field], expected, `reviewed cheesecake ${field} survives normalization`);
}
for (const field of ['id', 'url', 'pubDate', 'votes', 'expires']) {
  assert.equal(cheesecake[field], cheesecakeOriginal[field], `cheesecake correction preserves ${field}`);
}
assert.deepEqual(cheesecakeResult.bundle.deals[1], untouched);
assert.match(cheesecake.description, /Keine Anmeldung oder Reservierung erforderlich/);
assert.match(cheesecake.expiryDisplayText, /ab 12 Uhr/);
assert.ok(!issueCodes(cheesecake).includes('location-unspecific'));
assert.equal(applyReviewedContent(cheesecakeResult.bundle, cheesecakeResult.store, cheesecakeManifest).changed, false);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-content-regression-'));
try {
  const needsReview = { ...original, id: 'needs-review', brand: 'Mahnoor', sourceAccountType: 'creator', merchantUsername: '', location: '', distance: 'Wien', description: 'Angebot', metaGraphCaption: 'Nur per App. Pro Person ein Gutschein.' };
  const fixture = { deals: [corrected, needsReview, cheesecake], totalDeals: 3 };
  const reviewedEdits = [edit, ...cheesecakeResult.store.edits];
  fs.writeFileSync(path.join(temp, 'deals.json'), JSON.stringify(fixture));
  fs.writeFileSync(path.join(temp, 'live-deal-edits.json'), JSON.stringify({ edits: reviewedEdits }));
  fs.writeFileSync(path.join(temp, 'deal-candidates-index.json'), JSON.stringify({ deals: [] }));
  for (const name of ['gemeinde', 'gottesdienste', 'events']) {
    fs.writeFileSync(path.join(temp, `deals-pending-church-${name}.json`), JSON.stringify({ deals: [] }));
  }
  const run = spawnSync(process.execPath, ['scraper/normalize-live-deals.js'], {
    env: { ...process.env, SENTRY_DISABLED: '1', LIVE_DEAL_DOCS_DIR: temp,
      LIVE_DEAL_VALIDATION_APPLY: '1', LIVE_DEAL_REMOVALS_ENABLED: '0', ALLOW_AUTOMATED_LIVE_REMOVALS: '0',
      MAX_LIVE_URL_HEALTH_CHECKS: '0', MAX_LIVE_URL_EXPIRY_REFRESHES: '0', MAX_LIVE_CONTENT_ENRICHMENTS: '0' },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  const normalized = JSON.parse(fs.readFileSync(path.join(temp, 'deals.json')));
  assert.deepEqual(normalized.deals.map((deal) => deal.id).sort(), ['duru', 'needs-review', cheesecake.id]);
  const reapply = applyLiveDealEditsToBundle(normalized, { edits: reviewedEdits }).bundle;
  const finalCheesecake = normalizeDealRecord(reapply.deals.find((deal) => deal.id === cheesecake.id));
  for (const [field, expected] of Object.entries(cheesecakeReview.patch)) {
    assert.equal(finalCheesecake[field], expected, `full pipeline preserves cheesecake ${field}`);
  }
  const afterLogoPass = normalizeDealRecord(reapply.deals.find((deal) => deal.id === 'duru'));
  for (const field of ['brand', 'title', 'description', 'address', 'validOn', 'expiryDisplayText']) {
    assert.equal(afterLogoPass[field], corrected[field], `full pipeline preserves ${field}`);
  }
  const review = JSON.parse(fs.readFileSync(path.join(temp, 'live-deal-review-candidates.json')));
  const flagged = review.candidates.find((candidate) => candidate.id === 'needs-review');
  assert.ok(flagged.details.contentIssues.some((issue) => issue.code === 'unresolved-merchant'));
  assert.equal(flagged.details.automaticRemovalEligible, false);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('Source-backed content regression checks passed.');
