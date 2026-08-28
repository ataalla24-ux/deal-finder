import assert from 'node:assert/strict';

import {
  rebuildTikTokQueuedSource,
  repairQueuedSlackDeal,
} from './repair-slack-queued-deal.mjs';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const soundcubeUrl = 'https://www.tiktok.com/@temibrowncoffee/video/7678068346285346070';
const oldSoundcube = {
  id: 'tiktok-old',
  brand: 'dm',
  title: 'dm Angebot',
  description: 'Free kids dance class. Dm to register.',
  type: 'gratis',
  category: 'beauty',
  url: soundcubeUrl,
  validFrom: '2026-08-30',
  validUntil: '2026-08-30',
  expires: '2026-08-30',
  distance: '1110 Wien',
  pubDate: '2026-08-25T20:26:35.000Z',
  slackTs: '100.200',
  slackThreadTs: '100.100',
  order: 1,
};
const correctedSoundcube = {
  ...oldSoundcube,
  id: 'tiktok-current',
  brand: 'Soundcube',
  title: 'Kostenloser Afro-Dance-Kurs für Kinder im Soundcube',
  description: 'Kostenloser Afro-Dance-Kurs für Kinder von 7 bis 12 Jahren im Soundcube in Wien.',
  category: 'freizeit',
  logo: '💃',
  slackTs: '',
  slackThreadTs: '',
};

const updateCalls = [];
const updated = await repairQueuedSlackDeal({
  action: 'update',
  url: soundcubeUrl,
  channel: 'C123',
  now: NOW,
  queuePayload: { deals: [oldSoundcube], totalDeals: 1 },
  sourceDeals: { deals: [correctedSoundcube] },
  validate: async (deals) => ({
    allowedDeals: deals.map((deal) => ({
      ...deal,
      validity: {
        status: 'warning',
        sourceDate: deal.pubDate,
        expiryDate: deal.validUntil,
        warnings: ['startet am 2026-08-30'],
      },
    })),
    blockedDeals: [],
  }),
  slackApi: async (method, payload) => {
    updateCalls.push({ method, payload });
    return { ok: true };
  },
});

assert.equal(updated.changed, true);
assert.equal(updated.queuePayload.deals[0].brand, 'Soundcube');
assert.equal(updated.queuePayload.deals[0].title, correctedSoundcube.title);
assert.equal(updated.queuePayload.deals[0].slackTs, oldSoundcube.slackTs);
assert.equal(updateCalls.length, 1);
assert.equal(updateCalls[0].method, 'chat.update');
assert.match(updateCalls[0].payload.text, /Kostenloser Afro-Dance-Kurs für Kinder/);
assert.match(updateCalls[0].payload.text, /Marke\/Restaurant: Soundcube/);
assert.match(updateCalls[0].payload.text, /Startet am: 30\.8\.2026/);

const wienxtraUrl = 'https://www.tiktok.com/@frishwienxtra/video/7676417793163644182';
const oldWienxtra = {
  id: 'tiktok-old-wienxtra',
  brand: '@frishwienxtra',
  title: '@frishwienxtra Angebot',
  description: 'Im September geht unser gratis Cinemagic Open-Air-Kino in die letzte Runde.',
  type: 'gratis',
  category: 'kultur',
  url: wienxtraUrl,
  distance: 'Wien',
  pubDate: '2026-08-21T09:41:35.000Z',
  sourcePublishedAt: '2026-08-21T09:41:35.000Z',
  slackTs: `${Date.parse('2026-08-27T10:00:00.000Z') / 1000}.100`,
  slackThreadTs: `${Date.parse('2026-08-27T09:59:59.000Z') / 1000}.100`,
  order: 1,
};
const reconstructedWienxtra = await rebuildTikTokQueuedSource(oldWienxtra, {
  now: NOW,
  fetchImpl: async () => ({
    ok: true,
    text: async () => `<!doctype html><html><head>
      <meta property="og:title" content="SUNSET CINEMA bei WIENXTRA">
      <meta property="og:description" content="Im September geht unser gratis Cinemagic Open-Air-Kino das SUNSET CINEMA in die letzte Runde. Alle Termine finden im Weghuberpark statt. #openairkino #kostenlos">
    </head></html>`,
  }),
});
assert.ok(reconstructedWienxtra);
assert.equal(reconstructedWienxtra.brand, 'WIENXTRA');
assert.equal(reconstructedWienxtra.title, 'Gratis Open-Air-Kino Sunset Cinema im Weghuberpark');
assert.equal(reconstructedWienxtra.validFrom, '2026-09-01');
assert.equal(reconstructedWienxtra.validUntil, '2026-09-30');

const fallbackCalls = [];
const fallbackUpdated = await repairQueuedSlackDeal({
  action: 'update',
  url: wienxtraUrl,
  channel: 'C123',
  now: NOW,
  queuePayload: { deals: [oldWienxtra], totalDeals: 1 },
  sourceDeals: [],
  rebuildSource: async () => reconstructedWienxtra,
  validate: async (deals) => ({ allowedDeals: deals, blockedDeals: [] }),
  slackApi: async (method, payload) => {
    fallbackCalls.push({ method, payload });
    return { ok: true };
  },
});
assert.equal(fallbackUpdated.queuePayload.deals[0].brand, 'WIENXTRA');
assert.equal(fallbackUpdated.queuePayload.deals[0].validFrom, '2026-09-01');
assert.match(fallbackCalls[0].payload.text, /Gratis Open-Air-Kino Sunset Cinema im Weghuberpark/);

const pianoUrl = 'https://www.instagram.com/reel/DclUJEBAvfc/';
const pianoQueueDeal = {
  id: 'meta-ig-piano',
  brand: 'Instagram',
  title: 'Jetzt 10 % Rabatt auf alle gebrauchten Pianos & Flügel sichern!',
  description: 'Schulstart = Klavierstart! Jetzt 10 % Rabatt auf alle gebrauchten Pianos & Flügel sichern!',
  type: 'rabatt',
  category: 'shopping',
  url: pianoUrl,
  validFrom: '2026-09-01',
  validUntil: '2026-10-15',
  expires: '2026-10-15',
  distance: 'Wien',
  location: 'Klavier Galerie | Kaiserstraße 10, 1070 Wien',
  postalCode: '1070',
  pubDate: '2026-08-28T12:01:37.000Z',
  slackTs: '101.200',
  slackThreadTs: '101.100',
  order: 1,
};
const pianoUpdated = await repairQueuedSlackDeal({
  action: 'update',
  url: pianoUrl,
  channel: 'C123',
  now: NOW,
  queuePayload: { deals: [pianoQueueDeal], totalDeals: 1 },
  sourceDeals: { deals: [pianoQueueDeal] },
  validate: async (deals) => ({ allowedDeals: deals, blockedDeals: [] }),
  slackApi: async () => ({ ok: true }),
});
assert.equal(pianoUpdated.queuePayload.deals[0].brand, 'Klavier Galerie');
assert.equal(pianoUpdated.queuePayload.deals[0].category, 'shopping');
assert.equal(pianoUpdated.queuePayload.deals[0].validUntil, '2026-10-15');

await assert.rejects(
  repairQueuedSlackDeal({
    action: 'update',
    url: soundcubeUrl,
    channel: 'C123',
    queuePayload: { deals: [{ ...oldSoundcube, editedInSlack: true }] },
    sourceDeals: [correctedSoundcube],
    slackApi: async () => ({ ok: true }),
  }),
  /human Slack edits/,
);

const deleteCalls = [];
const deleted = await repairQueuedSlackDeal({
  action: 'delete',
  url: soundcubeUrl,
  channel: 'C123',
  now: NOW,
  queuePayload: { deals: [oldSoundcube], totalDeals: 1 },
  slackApi: async (method, payload) => {
    deleteCalls.push({ method, payload });
    return { ok: true };
  },
});

assert.equal(deleted.queuePayload.totalDeals, 0);
assert.deepEqual(deleteCalls, [
  { method: 'chat.delete', payload: { channel: 'C123', ts: '100.200' } },
  { method: 'chat.delete', payload: { channel: 'C123', ts: '100.100' } },
]);

console.log('Slack queued deal repair tests passed');
