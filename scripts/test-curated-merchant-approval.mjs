import test from 'node:test';
import assert from 'node:assert/strict';
import { curatedMerchantTask, extractMerchantOfferCandidates } from '../scraper/merchant-offer-discovery.js';
import { normalizeDeal } from '../scraper/slack-notify.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { validateApprovalCandidates } from '../scraper/slack-approve.js';

const now = new Date('2026-11-21T12:00:00.000Z');
const url = 'https://viennasweets.com/de/offers';
const page = `<main><section class="test_intro"><b class="test_eyebrow">Aktuelle Angebote</b></section>
  <section class="test_offers"><article><h2>3+1 Gratis Aktion</h2>
  <p>Handgemachte Mozartkugeln und Trüffel: 3+1 gratis auf ausgewählte Produkte.</p>
  <p>Nur solange der Vorrat reicht!</p></article><ul>
  <li><h2>Kostenlose Verkostung täglich</h2>
  <p>Entdecken Sie österreichische Süßwaren und genießen Sie kostenlose Kostproben im Geschäft.</p></li>
  </ul></section><h2>Unser Geschäft am Neuer Markt</h2></main>
  <footer><address>Neuer Markt 8a, 1010 Wien</address></footer>`;
const cards = extractMerchantOfferCandidates(page, curatedMerchantTask(url), now).map(deal => normalizeDeal(deal));
const approved = cards.map(deal => ({ ...deal, pipelineLifecycle: { manualDecision: 'approved' } }));

function servePage(t, body, finalUrl = url) {
  return t.mock.method(globalThis, 'fetch', async requested => {
    assert.equal(String(requested), url);
    const response = new Response(body, { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  });
}

test('two offers share one request and keep their unknown end after Slack approval', async t => {
  const source = servePage(t, page + '<aside>Andere Aktion gültig bis 24.12.2026</aside>');
  assert.equal(cards.length, 2);
  const dispatch = await validateDealsForSlack(cards, { now });
  assert.equal(dispatch.allowedDeals.length, 2, JSON.stringify(dispatch.report));
  assert.equal(source.mock.callCount(), 1);
  const result = await validateApprovalCandidates(approved, { now, existingDeals: [], requireMap: false });
  assert.equal(result.allowedDeals.length, 2, JSON.stringify(result.report));
  assert.equal(source.mock.callCount(), 2);
  for (const row of result.allowedDeals) {
    assert.equal(row.address, 'Neuer Markt 8a, 1010 Wien');
    assert.ok(!row.validUntil && !row.validOn);
  }
});

test('changed conditions, hidden cards, changed venue and a different final URL hold the approval', async t => {
  for (const [name, html, finalUrl, expected] of [
    ['changed', page.replace('der Vorrat reicht', 'der Vorrat reicht, nur für Clubmitglieder'), url, 1],
    ['hidden', page.replace('<article>', '<article hidden>'), url, 1],
    ['sold out', page.replace('3+1 Gratis Aktion', '3+1 Gratis Aktion ausverkauft'), url, 1],
    ['moved', page.replace('Neuer Markt 8a, 1010 Wien', 'Graz'), url, 0],
    ['redirect', page, url + '?redirected=1', 0],
  ]) {
    await t.test(name, async t => {
      servePage(t, html, finalUrl);
      const result = await validateApprovalCandidates(approved, { now, existingDeals: [], requireMap: false });
      assert.equal(result.allowedDeals.length, expected);
      assert.match(result.results.find(row => !row.decision.allowed).decision.reasons.join(' '), /nicht bestätigt/);
    });
  }
});

test('queued terms, an end date or an address cannot replace fresh card terms', async t => {
  servePage(t, page);
  for (const edit of [{ description: 'Alle Produkte gratis' }, { address: 'Anderer Standort, 1010 Wien' },
    { validUntil: '2027-12-31' }, { evidence: { ...cards[0].evidence, contentHash: 'stale' } }]) {
    const result = await validateDealsForSlack([{ ...cards[0], ...edit }], { now });
    assert.equal(result.allowedDeals.length, 0);
  }
});
