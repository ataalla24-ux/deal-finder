import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { isSupportedIamstudentApprovalUrl, extractIamstudentApprovalSourceEvidence, prepareIamstudentApprovalCopy, iamstudentApprovalDateHold } from '../scraper/approval-iamstudent-source-evidence.js';

const url = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const html = readFileSync(new URL('./fixtures/iamstudent-vapiano-20261114.html', import.meta.url), 'utf8');
const extract = (source = html, requested = url, final = requested) => extractIamstudentApprovalSourceEvidence(source, requested, final);
const mutate = callback => { const $ = load(html); callback($); return $.html(); };
const blocked = source => {
  const result = extract(source);
  assert.ok(result?.blockingReason);
  assert.equal(result.caption, undefined, 'incomplete or blocked source supplies no model evidence');
};

test('captured public offer supplies all own conditions without countdown-derived expiry', () => {
  const result = extract();
  assert.equal(result.blockingReason, undefined);
  assert.equal(result.sourceUrl, url);
  assert.equal(result.voucherId, '13585');
  for (const expected of ['Studentenrabatt', 'Neuanmeldung', 'nur während des Anmeldeprozesses', 'PASTALOVER',
    'Pomodoro, Carbonara, Bolognese und Bolognese vegan', 'innerhalb von 30 Tagen', 'außer im VAPIANO Linz', '1 Mal pro Person'])
    assert.ok(result.caption.includes(expected), expected);
  assert.doesNotMatch(result.caption, /108 Tage|28\.02\.2027|Verfügbarkeit|nicht mehr verfügbar|vergriffen/);
  assert.equal(result.validUntil, undefined);
  assert.equal(result.expires, undefined);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test('only the exact reviewed original URL and canonical identity are supported', () => {
  assert.equal(isSupportedIamstudentApprovalUrl(url), true);
  for (const other of [url + '?cached=1', url + '#terms', url + '/einloesen', url.replace('www.', ''),
    url.replace('.at/', '.de/'), url.replace('www.iamstudent.at', 'www.iamstudent.at.evil.test'),
    url.replace('wise26', 'wise25'), 'http://www.iamstudent.at/g/example']) {
    assert.equal(isSupportedIamstudentApprovalUrl(other), false);
    assert.equal(extract(html, other), null);
    assert.ok(extract(html, url, other).blockingReason);
  }
  for (const source of [mutate($ => $('link[rel=canonical]').attr('href', url + '/other')),
    mutate($ => $('meta[property="og:url"]').attr('content', url + '/other')),
    mutate($ => $('[data-voucher-page]').attr('data-voucher-page', '999')),
    mutate($ => $('head').append($('link[rel=canonical]').clone()))]) blocked(source);
});

test('inactive hidden templates do not create a false withdrawal; visible refusal does block', () => {
  assert.ok(!extract(html).blockingReason);
  for (const state of ['sold_out', 'sold_out_text', 'not_yet', 'no_permission', '!permission_type']) {
    blocked(mutate($ => $(`[data-voucher-show="${state}"]`).removeClass('voucher-hidden')));
  }
  blocked(mutate($ => $('.header-voucher').append('<p>Dieser Gutschein ist abgelaufen.</p>')));
  blocked(mutate($ => $('main').prepend('<div role="alert">Dieser Gutschein ist nicht mehr verfügbar.</div>')));
  blocked(mutate($ => $('.header-voucher .row.infos').text('läuft noch 0 Tage Verfügbarkeit ∞')));
});

test('changed offer or binding terms cannot be replaced with facts elsewhere on the page', () => {
  for (const [before, after] of [['50% Ersparnis', '30% Ersparnis'], ['1+1 gratis Pasta', 'Gratis Pasta'],
    ['30 Tagen', '60 Tagen'], ['1 Mal pro Person', '2 Mal pro Person'], ['außer im VAPIANO Linz', 'auch im VAPIANO Linz'],
    ['PASTALOVER', 'OTHER'], ['Pomodoro, Carbonara', 'Pizza, Carbonara']]) blocked(html.replaceAll(before, after));
  blocked(mutate($ => { const original = $('#infos').clone(); $('#infos').find('p').first().remove(); $('body').append(original.attr('id', 'recommendation')); }));
  blocked(mutate($ => $('#infos > .panel-body-accordion').append('<p>Zusätzlich nur bei 20 Euro Mindestumsatz.</p>')));
});

test('hidden, gated, removed or ambiguous primary conditions fail closed', () => {
  for (const source of [mutate($ => $('#infos').remove()), mutate($ => $('#infos').attr('hidden', '')),
    mutate($ => $('#infos').attr('style', 'display: none')), mutate($ => $('#infos').attr('aria-hidden', 'true')),
    mutate($ => $('#infos').removeClass('in').attr('aria-expanded', 'false')),
    mutate($ => $('#infos > .panel-body-accordion').html('<h2>Gutscheinbedingungen</h2><p>Bitte melde dich an, um die Bedingungen zu lesen.</p>')),
    mutate($ => $('#voucherAccordion').append($('#infosTab').clone())),
    mutate($ => $('[data-voucher-page]').attr('hidden', ''))]) blocked(source);
  blocked('<html><body>Bitte anmelden</body></html>');
});

test('recommendations, comments, account dialogs and scripts cannot supply or pollute evidence', () => {
  const noisy = mutate($ => $('body').append('<aside><h1>Gratis Pizza</h1><p>Andere Aktion gratis bis 2030.</p></aside>'
    + '<div id="comments">Fremder Kommentar: Gutschein abgelaufen!</div>'
    + '<div class="modal">Bitte anmelden. Gutschein nicht mehr verfügbar.</div>'
    + '<script>window.fake = "PASTALOVER 20 Prozent";</script>'));
  assert.deepEqual(extract(noisy), extract(html));
  blocked(mutate($ => { const saved = $('#infos').html(); $('#infos').empty(); $('body').append(`<aside>${saved}</aside>`); }));
});

test('parser is bounded and pure, without network, account, model or persistence operations', () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network operation permitted'); };
  try {
    assert.deepEqual(extract(), extract());
    blocked('x'.repeat(4000001));
    assert.ok(extractIamstudentApprovalSourceEvidence(null, url).blockingReason);
  } finally { globalThis.fetch = previous; }
});

test('URL health reuses one HTML GET, only the fully matched voucher avoids hidden-template false expiry', async () => {
  process.env.SENTRY_DISABLED = '1';
  const { inspectDealUrlHealth } = await import('../scraper/expiry-utils.js');
  const previous = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async (requested, init) => {
      requests++;
      assert.equal(requested, url);
      assert.equal(init.redirect, 'manual', 'supported voucher never follows a redirect');
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    const health = await inspectDealUrlHealth(url);
    assert.equal(requests, 1);
    assert.equal(health.invalid, false);
    assert.deepEqual(health.approvalSourceEvidence, extract());
    assert.equal(health.dateHints.expiryDate, undefined, 'countdown never becomes a calendar end');
    for (const source of [html.replace('30 Tagen', '60 Tagen'),
      mutate($ => $('[data-voucher-show="sold_out_text"]').removeClass('voucher-hidden'))]) {
      globalThis.fetch = async () => new Response(source, { headers: { 'content-type': 'text/html' } });
      const held = await inspectDealUrlHealth(url);
      assert.ok(held.invalid || held.approvalSourceEvidence?.blockingReason);
      assert.equal(held.approvalSourceEvidence?.caption, undefined);
    }
    globalThis.fetch = async (_requested, init) => {
      assert.equal(init.redirect, 'follow', 'other source behavior remains unchanged');
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    assert.equal((await inspectDealUrlHealth('https://example.com/offer')).invalid, true);
  } finally { globalThis.fetch = previous; }
});

test('HTTP refusals, redirect, changed origin and unreadable terms remain blocked with zero review calls', async () => {
  process.env.SENTRY_DISABLED = '1';
  const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
  const previous = globalThis.fetch;
  const previousReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  const candidate = { id: 'iamstudent-integration', url, title: '1+1 Pasta für Studierende', brand: 'Vapiano',
    description: '', source: 'Firecrawl Gastro #2', originSource: 'Firecrawl Gastro #2',
    category: 'essen', type: 'bogo', distance: 'Wien', expiryKind: 'unknown',
    sourcePublishedAt: '2026-11-13T12:00:00Z', sourcePublishedAtSource: 'url.publicationDate',
    pipelineLifecycle: { manualDecision: 'approved' } };
  try {
    const variants = [
      () => new Response(html, { status: 403, headers: { 'content-type': 'text/html' } }),
      () => new Response(html, { status: 429, headers: { 'content-type': 'text/html' } }),
      () => new Response('', { status: 302, headers: { location: 'https://example.com/login' } }),
      () => { const response = new Response(html, { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: 'https://example.com/login' }); return response; },
      () => new Response(mutate($ => $('#infos').remove()), { headers: { 'content-type': 'text/html' } }),
      () => new Response(mutate($ => $('[data-voucher-show="no_permission"]').removeClass('voucher-hidden')),
        { headers: { 'content-type': 'text/html' } }),
      () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    ];
    for (const response of variants) {
      let requests = 0, modelCalls = 0;
      globalThis.fetch = async (requested, init) => { requests++; assert.equal(requested, url);
        assert.equal(init.redirect, 'manual'); return response(); };
      const result = await validateApprovalCandidates([structuredClone(candidate)], {
        now: new Date('2026-11-14T10:00:00Z'), requireMap: false, existingDeals: [], approvalCachedReviewOnly: true,
        approvalModelRequest: async () => { modelCalls++; throw Error('Model calls forbidden'); },
      });
      assert.equal(requests, 1);
      assert.equal(modelCalls, 0);
      assert.equal(result.allowedDeals.length, 0);
      assert.ok(result.results[0].decision.reasons.some(reason => /Angebotsbeleg ausstehend/.test(reason)));
      assert.equal(result.blockedDeals[0].pipelineLifecycle.manualDecision, 'approved');
    }
  } finally {
    globalThis.fetch = previous;
    if (previousReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previousReview;
  }
});

const approvedFixture = () => ({ id: 'iamstudent-copy-integration', url,
  title: '1+1 gratis Pasta bei Neuanmeldung in der VAPIANO Lovers App (Pomodoro, Carbonara, Bolognese oder Bolognese vegan)',
  brand: 'Vapiano', description: '', source: 'Firecrawl Gastro #2', originSource: 'Firecrawl Gastro #2',
  // The existing location is separate from this text adapter, and occurs in the
  // full captured source. Map lookup is disabled only in these offline fixtures.
  category: 'essen', type: 'bogo', address: 'Herrengasse 6-8, 1010 Wien',
  distance: 'Herrengasse 6-8, 1010 Wien', expiryKind: 'unknown',
  sourcePublishedAt: '2026-11-13T12:00:00Z', sourcePublishedAtSource: 'url.publicationDate',
  pipelineLifecycle: { manualDecision: 'approved' } });

test('reviewed source template fills only missing copy with all restrictions and no AI memo or date change', async () => {
  const { copyReviewReasons } = await import('./automatic-deal-maintenance.mjs');
  const original = approvedFixture();
  const prepared = prepareIamstudentApprovalCopy(original, extract());
  assert.notEqual(prepared, original);
  assert.ok(prepared.title.length <= 50);
  assert.ok(prepared.description.length <= 550);
  for (const condition of ['Neuanmeldung', 'Joining Code PASTALOVER', 'während der Registrierung',
    'Studierende', 'Zwei Pasta-Gerichte', 'eines gratis', 'Pomodoro, Carbonara, Bolognese oder Bolognese vegan',
    'Prämien', 'Warenkorb', 'Vapianisti', '30 Tagen nach Anmeldung', 'einmal pro Person',
    'allen VAPIANO-Restaurants in Österreich außer Linz']) assert.ok(prepared.description.includes(condition), condition);
  assert.equal(prepared.approvalCopyReview, undefined);
  assert.equal(prepared.reviewedSourceCopy.method, 'reviewed-source-template-v1');
  assert.deepEqual(copyReviewReasons(prepared), []);
  for (const field of ['validUntil', 'validOn', 'validFrom', 'expires', 'expiryKind', 'expiresOriginal', 'dateConfidence'])
    assert.equal(prepared[field], original[field], field);
  assert.equal(prepareIamstudentApprovalCopy(prepared, extract()), prepared, 'idempotent');
  const existingCopy = { ...original, description: 'Existing authored conditions' };
  assert.equal(prepareIamstudentApprovalCopy(existingCopy, extract()).description, existingCopy.description);
  assert.ok(prepareIamstudentApprovalCopy({ ...original, title: '' }, extract()).title);
});

test('template cannot reuse stale proofs, rewrite manual/live copy or authorize a different offer', () => {
  for (const patch of [{ pipelineLifecycle: {} }, { editedInSlack: true }, { slackEditedAt: '2026-11-13' },
    { slackFormEditTs: '1' }, { liveEditedAt: '2026-11-13' }, { slackEditedFields: ['description'] },
    { liveEditedFields: ['title'] }, { pipelineLifecycle: { manualDecision: 'approved', publishedAt: '2026-11-13' } },
    { pipelineLifecycle: { manualDecision: 'approved', stage: 'published' } }, { forceKeep: true },
    { title: 'Gratis Pizza ohne App' }, { url: url + '?other=1' }]) {
    const deal = { ...approvedFixture(), ...patch };
    assert.equal(prepareIamstudentApprovalCopy(deal, extract()), deal);
  }
  const deal = approvedFixture();
  for (const evidence of [undefined, { ...extract(), blockingReason: 'unreadable' },
    { ...extract(), caption: extract().caption.replace('30 Tagen', '60 Tagen') },
    { ...extract(), contentHash: 'changed' }, { ...extract(), sourceUrl: 'https://example.com' }])
    assert.equal(prepareIamstudentApprovalCopy(deal, evidence), deal);
  assert.equal(prepareIamstudentApprovalCopy(deal, extract(), { existingIds: new Set([deal.id]) }), deal);
});

test('current source template passes ordinary validation with one normal GET and zero model calls', async () => {
  process.env.SENTRY_DISABLED = '1';
  const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
  const previous = globalThis.fetch;
  const previousReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  try {
    let requests = 0, modelCalls = 0;
    globalThis.fetch = async (requested, init) => { requests++; assert.equal(requested, url);
      assert.equal(init.redirect, 'manual'); return new Response(html, { headers: { 'content-type': 'text/html' } }); };
    const { advanceDealLifecycle } = await import('../scraper/deal-lifecycle.js');
    const candidate = { ...advanceDealLifecycle(approvedFixture(), 'manually-approved', {
      at: new Date('2026-11-14T10:00:00Z'), user: 'U_REVIEWER',
    }), approvedAt: '2026-11-14T10:00:00.000Z' };
    const result = await validateApprovalCandidates([candidate], {
      now: new Date('2026-11-14T10:00:00Z'), requireMap: false, existingDeals: [], approvalCachedReviewOnly: true,
      approvalModelRequest: async () => { modelCalls++; throw Error('No additional model request'); },
    });
    assert.equal(requests, 1, 'evidence and validation share the single normal health GET');
    assert.equal(modelCalls, 0);
    assert.equal(result.allowedDeals.length, 1, JSON.stringify(result.results[0].decision.reasons));
    assert.equal(result.results[0].deal.description, prepareIamstudentApprovalCopy(candidate, extract()).description);
    assert.equal(result.results[0].deal.reviewedSourceCopy.method, 'reviewed-source-template-v1');
    assert.equal(result.results[0].deal.approvalCopyReview, undefined);
    assert.equal(result.results[0].deal.validUntil || '', '', 'no expiry guessed from countdown or redemption period');
  } finally {
    globalThis.fetch = previous;
    if (previousReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previousReview;
  }
});

test('calendar ends outside the exact reviewed machine-recovery row remain held and untouched', async () => {
  const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
  const previous = globalThis.fetch;
  const previousReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  const dated = { ...approvedFixture(), expires: '2027-02-28', validUntil: '2027-02-28T12:00:00.000Z',
    expiresSource: 'deal.structured', dateConfidence: 'medium', expiryKind: 'end' };
  try {
    for (const candidate of [dated, prepareIamstudentApprovalCopy(dated, extract())]) {
      let requests = 0, modelCalls = 0;
      globalThis.fetch = async () => { requests++; return new Response(html, { headers: { 'content-type': 'text/html' } }); };
      const result = await validateApprovalCandidates([candidate], {
        now: new Date('2026-11-14T10:00:00Z'), requireMap: false, existingDeals: [], approvalCachedReviewOnly: true,
        approvalModelRequest: async () => { modelCalls++; throw Error('Model calls forbidden'); },
      });
      assert.equal(requests, 1); assert.equal(modelCalls, 0);
      assert.equal(result.allowedDeals.length, 0, 'even bypassing the independent map gate cannot release the date');
      assert.ok(result.results[0].decision.reasons.some(reason => reason.startsWith('Aktionszeitraum widersprüchlich')));
      assert.equal(result.blockedDeals[0].expires, dated.expires);
      assert.equal(result.blockedDeals[0].validUntil, dated.validUntil);
      assert.equal(result.blockedDeals[0].description, candidate.description, 'pending restores original, not its own suggestion');
      assert.equal(result.blockedDeals[0].pipelineLifecycle.manualDecision, 'approved');
    }
    for (const field of ['expires', 'expiresOriginal', 'expiryDisplayText', 'end_date', 'validity_date', 'validUntil', 'validOn'])
      assert.match(iamstudentApprovalDateHold({ ...approvedFixture(), [field]: '2027-02-28' }, extract()), /^Aktionszeitraum widersprüchlich/);
    assert.equal(iamstudentApprovalDateHold(approvedFixture(), extract()), '');
  } finally {
    globalThis.fetch = previous;
    if (previousReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previousReview;
  }
});

test('a title outside the fixed template retains the existing independently cached review path', async () => {
  const { reviewApprovedCopy } = await import('./automatic-deal-maintenance.mjs');
  const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
  const previous = globalThis.fetch;
  const previousReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  const cwd = mkdtempSync(join(tmpdir(), 'iamstudent-review-'));
  const now = new Date('2026-11-14T10:00:00Z');
  const candidate = { ...approvedFixture(), title: '1+1 Pasta für Studierende' };
  try {
    assert.equal(prepareIamstudentApprovalCopy(candidate, extract()), candidate);
    mkdirSync(join(cwd, 'reviews'));
    writeFileSync(join(cwd, 'reviews/automatic-maintenance-policy.json'), JSON.stringify({ version: 1, enabled: true, maxAiCandidatesPerRun: 1 }));
    let mockedReviewCalls = 0;
    const source = extract();
    const description = prepareIamstudentApprovalCopy(approvedFixture(), source).description;
    const [reviewed] = await reviewApprovedCopy([candidate], { cwd, now, sourceEvidence: new Map([[candidate.id, source]]),
      request: async (_target, init) => {
        mockedReviewCalls++;
        assert.ok(init.body.includes('PASTALOVER'));
        const response = mockedReviewCalls % 2 ? { title: '', quote: '', description,
          conditionsQuote: source.caption.split('\n')[2], dateQuote: '' } : { supported: true };
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] });
      } });
    assert.equal(mockedReviewCalls, 2, 'two local fake responses; no API was called');
    assert.equal(reviewed.description, description);
    let requests = 0, newReviewCalls = 0;
    globalThis.fetch = async () => { requests++; return new Response(html, { headers: { 'content-type': 'text/html' } }); };
    const result = await validateApprovalCandidates([{ ...candidate, approvalCopyReview: reviewed.approvalCopyReview }], {
      now, requireMap: false, existingDeals: [], approvalCachedReviewOnly: true,
      approvalModelRequest: async () => { newReviewCalls++; throw Error('No additional model request'); },
    });
    assert.equal(requests, 1);
    assert.equal(newReviewCalls, 0);
    assert.equal(result.allowedDeals.length, 1, JSON.stringify(result.results[0].decision.reasons));
    assert.equal(result.results[0].deal.description, description);
    assert.equal(result.results[0].deal.reviewedSourceCopy, undefined);
    assert.equal(result.results[0].deal.approvalCopyReview.waitingForSlot, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    globalThis.fetch = previous;
    if (previousReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previousReview;
  }
});

test('targeted and ordinary approval runners prepare source copy before publishing or retaining a date hold', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), 'iamstudent-approval-runner-'));
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  const previousLog = console.log;
  const logs = [];
  const write = (file, value) => writeFileSync(join(temp, 'docs', file), JSON.stringify(value));
  const read = file => JSON.parse(readFileSync(join(temp, 'docs', file), 'utf8'));
  try {
    for (const dir of ['scraper', 'sentry']) cpSync(join(root, dir), join(temp, dir), { recursive: true });
    mkdirSync(join(temp, 'scripts'));
    for (const file of ['deal-map-review.mjs', 'deal-map-enrichment.mjs', 'deal-map-chain-rules.mjs',
      'deal-map-source-addresses.mjs', 'approval-map-readiness.mjs', 'discover-vienna-merchants.mjs',
      'automatic-deal-maintenance.mjs', 'automatic-maintenance-review.mjs', 'refresh-maintenance-evidence.mjs',
      'deal-photo-contract.mjs']) copyFileSync(join(root, 'scripts', file), join(temp, 'scripts', file));
    copyFileSync(join(root, 'package.json'), join(temp, 'package.json'));
    symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
    mkdirSync(join(temp, 'docs')); mkdirSync(join(temp, 'reviews'));
    for (const file of ['restaurant-coupon-documents.json', 'nordsee-coupon-cards-20261113.json'])
      copyFileSync(join(root, 'reviews', file), join(temp, 'reviews', file));
    writeFileSync(join(temp, 'reviews/automatic-maintenance-policy.json'), JSON.stringify({ version: 1, enabled: true, maxAiCandidatesPerRun: 4 }));
    Object.assign(process.env, { SENTRY_DISABLED: '1', SLACK_BOT_TOKEN: 'test-only', SLACK_CHANNEL_ID: 'C_TEST',
      APPROVE_SLACK_CHANNEL_ID: 'C_TEST', APPROVAL_REQUIRE_MAP: '0', APPROVAL_SOURCE_COPY_REVIEW: '1',
      APPROVAL_COPY_CACHE_ONLY: '1', OPENAI_API_KEY: 'test-only-no-provider-calls',
      APPROVAL_MAP_GEOCODE_REQUESTS: '0', APPROVAL_MAP_SOURCE_REQUESTS: '0',
      APPROVE_FULL_SCAN_MAX_THREADS: '1', APPROVE_FULL_SCAN_MAX_DEALS: '1' });
    for (const key of ['COMMUNITY_QUEUE_PATH', 'APPROVE_SLACK_REACTION', 'APPROVE_SLACK_REACTION_USER']) delete process.env[key];
    const ts = Math.floor(Date.now() / 1000);
    const source = { ...approvedFixture(), sourcePublishedAt: new Date().toISOString(),
      slackTs: `${ts}.001`, slackThreadTs: `${ts - 3}.001`,
      approvalBlock: { checkedAt: new Date().toISOString(), reasons: ['Angebotsbeleg ausstehend'] } };
    const reactions = [{ name: 'white_check_mark', users: ['U_REVIEWER'] }];
    const message = { ts: source.slackTs, thread_ts: source.slackThreadTs, user: 'BOT', text: 'fixture', reactions };
    let sourceRequests = 0, modelCalls = 0;
    globalThis.fetch = async (target, init = {}) => {
      const parsed = new URL(target);
      if (target === url) { sourceRequests++; assert.equal(init.redirect, 'manual');
        return new Response(html, { headers: { 'content-type': 'text/html' } }); }
      if (parsed.hostname !== 'slack.com') { modelCalls++; throw Error('Unexpected external request'); }
      if (parsed.pathname.endsWith('/auth.test')) return Response.json({ ok: true, user_id: 'BOT' });
      if (parsed.pathname.endsWith('/conversations.history')) return Response.json({ ok: true, messages: [] });
      if (parsed.pathname.endsWith('/conversations.replies')) return Response.json({ ok: true, messages: [message] });
      if (parsed.pathname.endsWith('/reactions.get')) return Response.json({ ok: true, message });
      if (/\/chat\.(?:postMessage|update)$/.test(parsed.pathname)) return Response.json({ ok: true, ts: 'mock-notice' });
      throw Error('Unexpected mocked Slack operation');
    };
    console.log = (...args) => logs.push(args.map(String).join(' '));
    for (const mode of ['targeted', 'ordinary']) {
      if (mode === 'targeted') process.env.APPROVE_SLACK_MESSAGE_TS = source.slackTs;
      else delete process.env.APPROVE_SLACK_MESSAGE_TS;
      const { main } = await import(`${pathToFileURL(join(temp, 'scraper/slack-approve.js'))}?iamstudent-${mode}`);
      for (const hasCalendarEnd of [false, true]) {
        sourceRequests = 0; modelCalls = 0; logs.length = 0;
        const candidate = hasCalendarEnd ? { ...source, expires: '2027-02-28', validUntil: '2027-02-28',
          expiryKind: 'end', expiresSource: 'deal.structured', dateConfidence: 'medium' } : source;
        write('deals.json', { deals: [], totalDeals: 0 });
        write('deals-pending-all.json', { deals: [candidate] });
        write('deal-review-feedback.json', { events: [] });
        await main();
        assert.equal(sourceRequests, 1, `${mode}: one reused source GET`);
        assert.equal(modelCalls, 0, `${mode}: no model or other provider call`);
        assert.ok(logs.some(line => line.startsWith('IAMSTUDENT source copy prepared:')), `${mode}: fixed copy really prepared`);
        if (hasCalendarEnd) {
          assert.equal(read('deals.json').deals.length, 0);
          const [pending] = read('deals-pending-all.json').deals;
          assert.ok(pending.approvalBlock.reasons.some(reason => reason.startsWith('Aktionszeitraum widersprüchlich')));
          assert.equal(pending.expires, candidate.expires);
          assert.equal(pending.validUntil, candidate.validUntil);
          assert.equal(pending.description, '', 'held input never becomes its own proof');
          assert.equal(pending.pipelineLifecycle.manualDecision, 'approved');
        } else {
          const [live] = read('deals.json').deals;
          assert.ok(live, `${mode}: complete fixture publishes inside temporary directory`);
          assert.equal(live.description, prepareIamstudentApprovalCopy(source, extract()).description);
          assert.equal(live.reviewedSourceCopy.method, 'reviewed-source-template-v1');
          assert.equal(live.pipelineLifecycle.stage, 'published');
          assert.ok(live.pipelineLifecycle.publishedAt);
          assert.ok(live.approvedAt);
          assert.equal(read('deals-pending-all.json').deals.length, 0);
        }
      }
    }
  } finally {
    globalThis.fetch = previousFetch; console.log = previousLog;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    rmSync(temp, { recursive: true, force: true });
  }
});
