import assert from 'node:assert/strict';

import * as validator from './validate-instagram-ai-output.mjs';

const { validateInstagramAiPayload } = validator;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const now = new Date();
const emptyModeration = {
  blockedIds: [],
  blockedUrls: [],
  blockedProviders: [],
  blockedText: [],
  hiddenDeals: [],
};

function baseDeal(overrides = {}) {
  const pubDate = new Date(now.getTime() - HOUR_MS).toISOString();
  const viennaEvidence = {
    verified: true,
    source: 'instagram-post',
    value: 'Wien',
    detail: 'Wien',
    location: 'Wien',
  };
  return {
    id: 'instagram-ai-test-1',
    brand: 'Ugis',
    title: 'Kaffee gratis zum Burger',
    description: 'Konkrete Aktion für Gäste.',
    type: 'gratis',
    category: 'essen',
    url: 'https://www.instagram.com/reel/Validator1/',
    distance: 'Wien',
    city: 'Wien',
    viennaVerified: true,
    viennaEvidence,
    expires: '',
    pubDate,
    sourcePublishedAt: pubDate,
    sourcePublishedAtSource: 'instagram-rendered-time-datetime',
    pubDateSource: 'instagram-rendered-time-datetime',
    evidence: {
      postDateSource: 'instagram-rendered-time-datetime',
      viennaEvidence,
      explicitOfferEnd: '',
      explicitOfferDateSource: '',
      textSample: 'In Wien: Kaffee gratis zum Burger.',
    },
    ...overrides,
  };
}

function validate(deals, report = {}) {
  return validateInstagramAiPayload(
    { totalDeals: deals.length, deals },
    { config: { maxAgeDays: 7 }, ...report },
    { now, moderation: emptyModeration },
  ).errors;
}

assert.deepEqual(validate([baseDeal()]), []);

const actualAgentEvidenceSource = baseDeal({
  id: 'verified-account-source',
  url: 'https://www.instagram.com/reel/ValidatorVerifiedAccount/',
  viennaEvidence: {
    verified: true,
    source: 'verified-account-watchlist',
    value: '@ugisvienna: curated and verified',
    location: 'Wien',
  },
  evidence: {
    ...baseDeal().evidence,
    viennaEvidence: {
      verified: true,
      source: 'verified-account-watchlist',
      value: '@ugisvienna: curated and verified',
      location: 'Wien',
    },
  },
});
assert.deepEqual(validate([actualAgentEvidenceSource]), []);

const caseDistinctShortcodes = [
  baseDeal({ id: 'case-upper', url: 'https://www.instagram.com/p/CaseSensitive/' }),
  baseDeal({ id: 'case-lower', url: 'https://www.instagram.com/reel/casesensitive/' }),
];
assert.deepEqual(validate(caseDistinctShortcodes), [], 'case-sensitive Instagram shortcodes must remain distinct');

const synthetic = baseDeal({
  id: 'synthetic',
  url: 'https://www.instagram.com/reel/ValidatorSynthetic/',
  pubDateSource: 'discoveredAt',
  evidence: {
    ...baseDeal().evidence,
    postDateSource: 'discoveredAt',
  },
});
assert.ok(validate([synthetic]).some((error) => /untrusted pubDateSource/.test(error)));

const missingSourceProvenance = baseDeal({
  id: 'missing-source-provenance',
  url: 'https://www.instagram.com/reel/ValidatorMissingSource/',
  pubDateSource: '',
  sourcePublishedAtSource: '',
  evidence: {
    ...baseDeal().evidence,
    postDateSource: '',
  },
});
assert.ok(validate([missingSourceProvenance]).some((error) => /untrusted pubDateSource/.test(error)));
assert.ok(validate([missingSourceProvenance]).some((error) => /untrusted sourcePublishedAtSource/.test(error)));

const trustedTimeTextSource = baseDeal({
  id: 'trusted-time-text-source',
  url: 'https://www.instagram.com/reel/ValidatorTimeTextSource/',
  pubDateSource: 'instagram-rendered-time-text',
  sourcePublishedAtSource: 'instagram-rendered-time-text',
  evidence: {
    ...baseDeal().evidence,
    postDateSource: 'instagram-rendered-time-text',
  },
});
assert.deepEqual(validate([trustedTimeTextSource]), []);

const genericInstagramSource = baseDeal({
  id: 'generic-instagram-source',
  url: 'https://www.instagram.com/reel/ValidatorGenericSource/',
  pubDateSource: 'instagram-ai-agent',
  sourcePublishedAtSource: 'instagram-ai-agent',
  evidence: {
    ...baseDeal().evidence,
    postDateSource: 'instagram-ai-agent',
  },
});
assert.ok(validate([genericInstagramSource]).some((error) => /untrusted pubDateSource/.test(error)));

const mismatchedTimestampSources = baseDeal({
  id: 'mismatched-timestamp-sources',
  url: 'https://www.instagram.com/reel/ValidatorMismatchedSources/',
  sourcePublishedAtSource: 'apifyPostMetadata',
});
assert.ok(validate([mismatchedTimestampSources]).some((error) => /pubDateSource differs from sourcePublishedAtSource/.test(error)));

const giveaway = baseDeal({
  id: 'giveaway',
  url: 'https://www.instagram.com/reel/ValidatorGiveaway/',
  description: 'Gewinnspiel: Gewinne einen Kaffee gratis.',
});
assert.ok(validate([giveaway]).some((error) => /false-positive language/.test(error)));

const explicitlyNotVienna = baseDeal({
  id: 'not-vienna',
  url: 'https://www.instagram.com/reel/ValidatorNotVienna/',
  description: 'Nur in München, nicht in Wien: Burger gratis.',
  evidence: {
    ...baseDeal().evidence,
    textSample: 'Nur in München, nicht in Wien: Burger gratis.',
  },
});
assert.ok(validate([explicitlyNotVienna]).some((error) => /explicitly excludes Vienna/.test(error)));

const selfCertifiedViennaEvidence = {
  verified: true,
  source: 'structured-location',
  value: 'Wien',
  detail: 'Wien',
  location: 'Wien',
};
const selfCertifiedVienna = baseDeal({
  id: 'self-certified-vienna',
  url: 'https://www.instagram.com/reel/ValidatorSelfCertifiedVienna/',
  viennaEvidence: selfCertifiedViennaEvidence,
  evidence: {
    ...baseDeal().evidence,
    viennaEvidence: selfCertifiedViennaEvidence,
  },
});
assert.ok(validate([selfCertifiedVienna]).some((error) => /no postcode or address/.test(error)));

const addressViennaEvidence = {
  verified: true,
  source: 'structured-location',
  value: 'Taborstraße 1, 1020 Wien',
  detail: 'Taborstraße 1, 1020 Wien',
  location: 'Taborstraße 1, 1020 Wien',
};
const concreteViennaAddress = baseDeal({
  id: 'concrete-vienna-address',
  url: 'https://www.instagram.com/reel/ValidatorConcreteVienna/',
  distance: 'Taborstraße 1, 1020 Wien',
  viennaEvidence: addressViennaEvidence,
  evidence: {
    ...baseDeal().evidence,
    viennaEvidence: addressViennaEvidence,
  },
});
assert.deepEqual(validate([concreteViennaAddress]), []);

const rejected = baseDeal({
  id: 'rejected',
  url: 'https://www.instagram.com/reel/ValidatorRejected/',
});
assert.ok(validate([rejected], {
  rejected: [{ url: rejected.url, reason: 'LLM hat Kandidat abgelehnt' }],
}).some((error) => /both deals and the rejection report/.test(error)));

const stalePubDate = new Date(now.getTime() - 4 * DAY_MS).toISOString();
const staleWithoutEnd = baseDeal({
  id: 'stale-no-end',
  url: 'https://www.instagram.com/reel/ValidatorStaleNoEnd/',
  pubDate: stalePubDate,
  sourcePublishedAt: stalePubDate,
});
assert.deepEqual(validate([staleWithoutEnd]), [], 'posts inside the current seven-day window do not need an explicit end date');

const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 59, 59, 999);
const staleWithEnd = baseDeal({
  id: 'stale-with-end',
  url: 'https://www.instagram.com/reel/ValidatorStaleWithEnd/',
  pubDate: stalePubDate,
  sourcePublishedAt: stalePubDate,
  expires: end.toISOString(),
  evidence: {
    ...baseDeal().evidence,
    explicitOfferEnd: end.toISOString(),
    explicitOfferDateSource: 'gültig bis zum übermorgen angegebenen Datum',
  },
});
assert.deepEqual(validate([staleWithEnd]), []);

const futureStart = new Date(now.getTime() + DAY_MS).toISOString();
const notYetActive = baseDeal({
  id: 'not-yet-active',
  url: 'https://www.instagram.com/reel/ValidatorFutureStart/',
  validFrom: futureStart,
  validUntil: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
  expires: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
});
assert.deepEqual(validate([notYetActive]), [], 'published upcoming deals are valid output');

const withinClockSkew = new Date(now.getTime() + 9 * 60 * 1000).toISOString();
const acceptableClockSkew = baseDeal({
  id: 'acceptable-clock-skew',
  url: 'https://www.instagram.com/reel/ValidatorClockSkew9m/',
  pubDate: withinClockSkew,
  sourcePublishedAt: withinClockSkew,
});
assert.deepEqual(validate([acceptableClockSkew]), []);

const beyondClockSkew = new Date(now.getTime() + 11 * 60 * 1000).toISOString();
const rejectedClockSkew = baseDeal({
  id: 'rejected-clock-skew',
  url: 'https://www.instagram.com/reel/ValidatorClockSkew11m/',
  pubDate: beyondClockSkew,
  sourcePublishedAt: beyondClockSkew,
});
assert.ok(validate([rejectedClockSkew]).some((error) => /implausibly in the future/.test(error)));

// Run 45792101432 rolled back six finished rows after an expiry error for this
// post. Its exact Graph caption and timestamp survived, but the rejected file
// did not. Reconstruct the reported failure with one conflicting finished field.
const failedRunNow = new Date('2026-11-26T09:38:35.136Z');
const sourcePostTime = '2026-11-25T18:53:03.000Z';
const exactOfferSignal = 'Nur EINEN TAG lang gibt es unsere unschlagbaren Eröffnungsangebote: 🥙 Hühnerdöner – nur 2,99 € 🥙 Kalbsdöner – nur 3,99 € 🍕 Jede Pizzaschnitte – nur 1 € (Standardsorten) 🥤 Pepsi & Ayran – je nur 1 € 📅 Samstag, 28.11.2026 ⏰ 12:00–22:00 Uhr 📍 Koppstraße 68, 1160 Wien';
const failedRunOptions = { now: failedRunNow, moderation: emptyModeration };
const originalAuraDeal = baseDeal({
  id: 'aura-doener-replay',
  brand: 'Aura Döner',
  title: 'Aura Döner Eröffnung in Wien',
  url: 'https://www.instagram.com/p/DgLN3hogldf/',
  pubDate: sourcePostTime,
  sourcePublishedAt: sourcePostTime,
  pubDateSource: 'instagram-graph-timestamp',
  sourcePublishedAtSource: 'instagram-graph-timestamp',
  validFrom: '2026-11-28',
  validUntil: '2026-11-28',
  expires: '2026-11-28T23:59:59.999Z',
  evidence: {
    ...baseDeal().evidence,
    postDateSource: 'instagram-graph-timestamp',
    offerDateSignal: exactOfferSignal,
  },
});
const conflictingAuraDeal = {
  ...originalAuraDeal,
  expiryDisplayText: 'Gültig bis 25.11.2026',
  qualityScore: 99,
};
const fiveValidControls = Array.from({ length: 5 }, (_, index) => baseDeal({
  id: `failed-run-control-${index}`,
  url: `https://www.instagram.com/reel/FailedRunControl${index}/`,
  pubDate: sourcePostTime,
  sourcePublishedAt: sourcePostTime,
}));
const failedRunDeals = [conflictingAuraDeal, ...fiveValidControls];
assert.deepEqual(
  validateInstagramAiPayload({ totalDeals: 6, deals: failedRunDeals }, {}, failedRunOptions).errors,
  ['https://www.instagram.com/p/DgLN3hogldf/ has expired source offer evidence'],
);
const admission = validator.partitionInstagramAiDeals(failedRunDeals, {}, failedRunOptions);
assert.deepEqual(admission.deals, fiveValidControls);
assert.deepEqual(admission.quarantine, { count: 1, reasons: { 'offer-expired': 1 } });
assert.deepEqual(
  validateInstagramAiPayload({ totalDeals: 5, deals: admission.deals }, {}, failedRunOptions).errors,
  [],
);
const withValidOriginal = validator.partitionInstagramAiDeals(
  [conflictingAuraDeal, originalAuraDeal, ...fiveValidControls],
  {},
  failedRunOptions,
);
assert.deepEqual(withValidOriginal.deals, [originalAuraDeal, ...fiveValidControls]);
assert.deepEqual(
  validateInstagramAiPayload({ totalDeals: 6, deals: withValidOriginal.deals }, {}, failedRunOptions).errors,
  [],
);
assert.ok(validate([baseDeal(), baseDeal()]).some((error) => /duplicates another Instagram post URL/.test(error)));
assert.ok(validate([baseDeal(), baseDeal({ url: 'https://www.instagram.com/p/UniqueOther/' })])
  .some((error) => /duplicates id/.test(error)));
assert.ok(validateInstagramAiPayload({ totalDeals: 6, deals: admission.deals }, {}, failedRunOptions)
  .errors.some((error) => /totalDeals=6 but deals.length=5/.test(error)));
assert.ok(validateInstagramAiPayload({ totalDeals: 0, deals: null }).errors
  .some((error) => /deals is not an array/.test(error)));

console.log('Instagram AI output validator invariants: ok');
