import assert from 'node:assert/strict';

import { repairQueuedSlackDeal } from './repair-slack-queued-deal.mjs';

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
