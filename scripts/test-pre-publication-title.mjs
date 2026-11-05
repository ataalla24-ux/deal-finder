import assert from 'node:assert/strict';
import { preparePublicationTitle } from '../scraper/pre-publication-title.js';
import { validateApprovalCandidates } from '../scraper/slack-approve.js';
import { advanceDealLifecycle } from '../scraper/deal-lifecycle.js';

const base = {
  id: 'community:pretitle', submissionId: 'pretitle', originSource: 'community-submission',
  source: 'Community Submission', brand: 'Testcafe', category: 'essen', type: 'rabatt',
  title: 'Sichere dir 20 Prozent Rabatt auf Pizza mit Gutschein für Neukunden',
  description: 'Nur bei Abholung, ab 20 € Mindestbestellwert. Originalbedingungen bleiben bestehen.',
  address: 'Testgasse 1, 1010 Wien', distance: 'Testgasse 1, 1010 Wien', url: '',
  submittedAt: '2026-11-05T10:00:00Z', expiresOriginal: '06.11.2026',
  price: '20', votes: 7, evidence: { caption: 'Unveränderte Originalquelle' },
};
const edited = preparePublicationTitle(base);
assert.equal(edited.title, '20 % auf Pizza mit Gutschein für Neukunden');
assert.ok(edited.description.startsWith(base.description));
assert.ok(edited.description.endsWith(base.title));
assert.deepEqual(edited.prePublicationTitleEdit, { version: 1, method: 'local-evidence-rules',
  originalTitle: base.title, title: edited.title });
assert.deepEqual(preparePublicationTitle(edited), edited, 'repeated checks are idempotent');
assert.equal(base.title.startsWith('Sichere'), true, 'do not mutate queue evidence');
for (const field of Object.keys(base).filter(key => !['title', 'description'].includes(key))) {
  assert.deepEqual(edited[field], base[field], `preserve ${field}`);
}
for (const protection of [
  { liveEditedFields: ['title'] }, { slackEditedFields: ['title'] }, { editedInSlack: true },
  { slackEditedAt: 'today' }, { slackFormEditTs: '123' }, { liveEditedAt: 'today' },
  { liveEditedFields: ['description'] }, { campaignId: 'paid-ad' }, { isBusiness: true },
]) {
  const manual = { ...base, ...protection };
  assert.strictEqual(preparePublicationTitle(manual), manual, JSON.stringify(protection));
}
assert.strictEqual(preparePublicationTitle(base, { existingIds: new Set([base.id]) }), base);
for (const title of [
  '1+1 Pizza gratis mit Gutschein',
  'Bis zu 50 % auf ausgewählte Speisen für Mitglieder bei Abholung ab 30 €',
  '2 Döner kaufen, den dritten gratis erhalten',
  '1+1 Kinotickets am Dienstag für Magenta-Kunden',
  'Ein langer, aber notwendiger Titel mit vollständigen Bedingungen für Neukunden ab 30 € bei Abholung',
  'Pizza für',
]) assert.equal(preparePublicationTitle({ ...base, title }).title, title, title);
const unsafe = { ...base, title: 'Aufgepasst: Pizza für Neukunden ab 30 € – jetzt alle Teilnahmebedingungen genau lesen!',
  description: 'Pizza für 2 €. Nur für Neukunden ab 30 €.' };
assert.equal(preparePublicationTitle(unsafe).title, unsafe.title, 'do not replace conditions with a simpler offer sentence');
assert.equal(preparePublicationTitle({ ...base, title: 'Aufgepasst: Gratis Pizza nur solange der Vorrat reicht',
  description: 'Gratis Burger.' }).title, 'Aufgepasst: Gratis Pizza nur solange der Vorrat reicht',
  'do not swap products or drop stock limits through caption sentence selection');
assert.equal(preparePublicationTitle({ ...base, title: 'Wrap zum Aktionspreis von 1 Euro für nur 2 Tage' }).title,
  'Wrap für 1 € für 2 Tage');
assert.equal(preparePublicationTitle({ ...base, title: 'GRATIS Kaffee zu jedem Frühstück' }).title,
  'Gratis Kaffee zu jedem Frühstück');
assert.equal(preparePublicationTitle({ ...base, title: 'Ein GRATIS-Geschenk zu jedem Menü' }).title,
  'Ein Gratis-Geschenk zu jedem Menü');

const now = new Date('2026-11-05T12:00:00Z');
const approved = advanceDealLifecycle(base, 'manually-approved', { at: now, user: 'U_REVIEWER' });
const fetchBefore = globalThis.fetch;
try {
  globalThis.fetch = () => { throw new Error('no network/model/Slack request allowed'); };
  const result = await validateApprovalCandidates([approved], { now, existingDeals: [], requireMap: false });
  assert.equal(result.allowedDeals.length, 1, JSON.stringify(result.results));
  assert.equal(result.allowedDeals[0].title, edited.title, 'the actual pre-publication boundary uses the editor');
  assert.equal(result.allowedDeals[0].pipelineLifecycle.manualDecision, 'approved');
  assert.equal(result.allowedDeals[0].evidence.caption, base.evidence.caption);
  const blocked = await validateApprovalCandidates([base], { now, existingDeals: [], requireMap: false });
  assert.equal(blocked.allowedDeals.length, 0, 'editing is not a human approval');
  const expired = await validateApprovalCandidates([{ ...approved, validUntil: '2026-11-04', expires: '2026-11-04' }],
    { now, existingDeals: [], requireMap: false });
  assert.equal(expired.allowedDeals.length, 0, 'title editing never bypasses validity checks');
} finally { globalThis.fetch = fetchBefore; }
console.log('PASS: local pre-publication titles, factual/manual protection, idempotence and actual approval boundary');
