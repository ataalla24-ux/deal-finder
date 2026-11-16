import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSparhamsterCouponEnd, supportsSparhamsterCouponExpiry } from './expiry-sparhamster-coupon.mjs';
import { verifyExpiryBatch } from './verified-expiry-apply.mjs';

const now = new Date('2026-11-16T18:00:00Z');
const url = 'https://www.sparhamster.at/mcdonalds-gutscheine-oesterreich/';
const end = '2026-11-15';
const title = '2 Klassiker für 2,50 € + 40 Ms';
const row = '2x Klassiker nach Wahl um 2,50 € (mit 40Ms)';
const update = '2026-10-27T10:00:18+00:00';
const deal = { id: 'coupon-round', brand: 'McDonald’s', title, url, validUntil: end,
  expiryKind: 'end', expires: '2026-11-15T23:59:59.999Z', validity: {
    expiryDate: end,
    sourceDateSource: 'url.couponRoundUpdatedAt',
    sourceDate: '2026-10-27T10:00:18.000Z',
    finalUrl: url,
  } };
const page = `<!doctype html><link rel="canonical" href="${url}">
<main><div class="sh-deal-detail-card-wrap">
  <h1 class="sh-deal-detail-card__heading">McDonalds Gutscheine Österreich – bis 15. November 2026</h1>
  <article class="sh-deal-detail-card--top expired">
    <span class="sh-deal-grid-card-badge-tag"><i aria-hidden="true"></i> abgelaufen </span>
    <a class="sh-deal-grid-card-btn--expired-link">Angebot abgelaufen</a>
  </article>
</div>
<div class="sh-deal-detail-text-wrap"><div class="sh-deal-detail-text__inner">
  <p>Bei <strong>McDonalds</strong> gibt’s neue Gutscheine in der <strong>App</strong>, bis 15. November 2026 sind diese gültig.</p>
  <p>McDonalds Gutscheine aus folgender Auswahl verfügbar:</p>
  <ul><li>1+1 Gratis auf 6er Chicken Nuggets</li><li>${row}</li></ul>
  <blockquote><p>© McDonald’s 2026. Gültig bis 15.11.2026: Nur für registrierte Nutzer.</p></blockquote>
  <h3>Bonusclub</h3><p>Hier gelten Prämien dauerhaft.</p>
</div></div>
<div class="sh-deal-detail-post-meta__modified"><time class="sh-deal-detail-post-meta__time" datetime="${update}">Aktualisiert</time></div>
<section class="comments">Bis 30. November 2026 steht ein anderes Angebot in den Kommentaren.</section></main>`;
const response = { status: 200, url, headers: { 'content-type': 'text/html; charset=UTF-8' }, body: page };
const assess = (input = deal, snapshot = response) => assessSparhamsterCouponEnd(input, snapshot, { now });
const html = body => ({ ...response, body });

test('exact expired McDonald’s coupon ties quantity, product, price, points and end to the current Sparhamster round', () => {
  assert.equal(supportsSparhamsterCouponExpiry(deal), true);
  assert.deepEqual(assess(), { end, evidenceText: 'McDonalds Gutscheine Österreich – bis 15. November 2026 · Angebot abgelaufen · ' + row + ' · Gültig bis 2026-11-15' });
  assert.equal(assess({ ...deal, title: '3 Cheeseburger um 3,60 € plus 50 M’s' },
    html(page.replace(row, '3× Cheeseburger um 3.60 € (mit 50 Ms)')))?.end, end);
});

test('reused campaign URLs keep a new round, even if it advertises an identical coupon', () => {
  const nextRound = page.replaceAll('15. November 2026', '6. Dezember 2026').replace('15.11.2026', '06.12.2026');
  for (const body of [
    nextRound,
    page.replace(update, '2026-11-10T10:00:18+00:00'),
    page.replace('15.11.2026', '16.11.2026'),
    page.replace('15.11.2026', '15.11.'),
    page.replace('</blockquote>', 'Verlängert bis 20.11.2026.</blockquote>'),
    page.replace('</blockquote>', 'Nicht gültig bis 15.11.2026.</blockquote>'),
    page.replace('sind diese gültig.', 'waren diese früher gültig.'),
    page.replace('</blockquote>', 'Zusätzlich gültig bis 20.11.</blockquote>'),
  ]) assert.equal(assess(deal, html(body)), null, body);
});

test('a different, duplicated, hidden or outside coupon never qualifies', () => {
  for (const change of [
    '3x Klassiker nach Wahl um 2,50 € (mit 40Ms)',
    '2x Klassiker nach Wahl um 2,60 € (mit 40Ms)',
    '2x Klassiker nach Wahl um 2,50 € (mit 50Ms)',
    '2x Cheeseburger nach Wahl um 2,50 € (mit 40Ms)',
    '2x Klassiker nach Wahl um 2,50 € (ohne 40Ms)',
  ]) assert.equal(assess(deal, html(page.replace(row, change))), null, change);
  assert.equal(assess(deal, html(page.replace(`<li>${row}</li>`, `<li hidden>${row}</li>`))), null);
  assert.equal(assess(deal, html(page.replace(`<li>${row}</li>`, `<li>${row}</li><li>${row}</li>`))), null);
  assert.equal(assess(deal, html(page.replace(`<li>${row}</li>`, '').replace('<h3>Bonusclub</h3>', `<h3>Bonusclub</h3><ul><li>${row}</li></ul>`))), null);
});

test('a redirect, blocked page, noncanonical URL, active status or inconsistent deal end is deferred', () => {
  for (const change of [
    { status: 302 }, { status: 403 }, { url: url.replace('/mcdonalds-', '/burger-king-') }, { headers: {} },
    { body: page.replace(`href="${url}"`, 'href="https://example.org/"') },
    { body: page.replace('card--top expired', 'card--top') },
    { body: page.replace('Angebot abgelaufen', 'Angebot nicht abgelaufen') },
    { body: page.replace('badge-tag"><i', 'badge-tag" style="display: none"><i') },
    { body: page.replace('badge-tag"><i', 'badge-tag" aria-hidden="true"><i') },
  ]) assert.equal(assess(deal, { ...response, ...change }), null);
  for (const change of [
    { brand: 'Burger King' }, { title: 'McDonald’s Gratis Fußball-Donut' }, { url: url + '?round=new' },
    { sourceUrl: 'https://example.org/' }, { validUntil: '2026-11-18' }, { validUntil: '2026-02-30' },
    { expires: '2026-11-18T23:59:59.999Z' }, { validOn: '2026-11-18' },
  ]) {
    const input = { ...deal, ...change };
    assert.equal(supportsSparhamsterCouponExpiry(input), false, JSON.stringify(change));
    assert.equal(assess(input), null);
  }
});

test('the ordinary bounded expiry job confirms a coupon twice before archiving it', async () => {
  const unrelated = Array.from({ length: 31 }, (_, index) =>
    ({ id: `other-${index}`, url: `https://example.org/offer/${index}` }));
  const deals = [...unrelated, deal];
  const checks = [];
  const inspect = async source => {
    checks.push(source);
    return source === url ? response : { status: 404 };
  };
  const first = await verifyExpiryBatch(deals, {}, [], {
    now: new Date('2026-11-19T12:00:00Z'), inspect, budget: 2, apply: true,
  });
  assert.equal(first.report.entries[0].method, 'sparhamster-coupon-round');
  assert.equal(first.removed.length, 0);
  assert.equal(checks.length, 2);

  const next = { now: new Date('2026-11-20T13:00:00Z'), budget: 2, apply: true };
  const confirmed = await verifyExpiryBatch(deals, first.state, [], { ...next, inspect });
  assert.deepEqual(confirmed.removed.map(entry => entry.originalDeal), [deal]);
  assert.deepEqual(confirmed.deals, unrelated);
  assert.equal(checks.length, 4);
  const renewed = await verifyExpiryBatch(deals, first.state, [], { ...next,
    inspect: async source => source === url
      ? html(page.replaceAll('15. November 2026', '6. Dezember 2026').replace('15.11.2026', '06.12.2026'))
      : { status: 404 },
  });
  assert.deepEqual(renewed.deals, deals);
  const protectedDeal = await verifyExpiryBatch(deals, first.state, [{ dealId: deal.id }], { ...next, inspect });
  assert.deepEqual(protectedDeal.deals, deals);
  assert.equal(checks.slice(4).includes(url), false);
});
