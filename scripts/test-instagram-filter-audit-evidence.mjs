import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIT_TARGETS, captureInstagramFilterAudit, priorAuditEvidence } from './check-instagram-filter-audit-evidence.mjs';

const now = new Date('2026-11-28T08:29:00Z');
const dates = ['2026-11-25T13:51:32.000Z', '2026-11-25T11:31:19.000Z',
  '2026-11-25T09:21:26.000Z', '2026-11-21T06:34:50.000Z'];
const audience = AUDIT_TARGETS.map((url, i) => ({ url, sourcePublishedAt: dates[i],
  httpStatus: 200, status: 'rejected', reason: 'prior-filter-outcome' }));
const receipt = rows => ({ rows, browserNavigations: 2, verifiedNewOffers: 0, modelCalls: 0, tavilySearches: 0 });
const acceptedPriors = priorAuditEvidence({ links: AUDIT_TARGETS }, [receipt(audience.slice(0, 2)), receipt(audience.slice(2))]);
const cookies = [{ name: 'sessionid', value: 'offline-fixture-private-value', domain: '.instagram.com' }];
const originalCaption = 'Beim Kauf eines veganen Menüs gibt es eine Suppe gratis.\nNur im 7. Bezirk.';
const graphState = { sources: { 'account:lisa.maria.b': { updatedAt: '2026-11-28T03:09:58.735Z', rows: [{
  permalink: AUDIT_TARGETS[3], timestamp: '2026-11-21T06:34:50+0000', username: 'lisa.maria.b', caption: 'Offline Giveaway.',
}] } } };

function browsers({ navigate = () => ({}), failCookies = false, capture = () => ({}) } = {}) {
  let launches = 0;
  const reads = [];
  const browserType = { async launch() {
    launches++;
    return {
      async newContext(options) {
        assert.deepEqual(options, { viewport: { width: 1366, height: 900 }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
        return {
          async addCookies() { if (failCookies) throw new Error('private setup failure'); },
          async close() {},
          async newPage() {
            return { current: '', url() { return this.current; }, async close() {},
              async evaluate(extract, args) {
                const scope = capture(this.current);
                const title = 'Cafe Lokal (@cafelokal) • Instagram';
                const meta = { 'meta[property="og:url"]': scope.identity ?? this.current,
                  'meta[property="og:title"]': title,
                  'meta[property="og:description"]': scope.caption
                    ?? '12 likes, 2 comments - cafelokal on November 25: "' + originalCaption + '"' };
                const visible = { checkVisibility: () => true, closest: () => null };
                const venue = { ...visible, href: 'https://www.instagram.com/explore/locations/123/wien/', innerText: '1070 Wien' };
                const article = { innerText: originalCaption, querySelectorAll: selector => selector === 'header a[href]' ? [venue] : [] };
                const linkTime = { ...visible, closest: selector => {
                  if (selector === 'a[href]') return { href: this.current };
                  if (selector === 'article, [role="article"]') return article;
                  return null;
                } };
                const saved = { document: globalThis.document, location: globalThis.location };
                globalThis.location = { href: this.current };
                globalThis.document = {
                  querySelector: selector => meta[selector] ? { getAttribute: () => meta[selector] } : null,
                  querySelectorAll: () => [linkTime],
                };
                try { return extract(args); }
                finally { Object.assign(globalThis, saved); }
              },
            };
          },
        };
      },
      async close() {},
    };
  } };
  return { reads, get launches() { return launches; }, run: options => captureInstagramFilterAudit({
    priors: acceptedPriors, graphState, cookies, now, clock: () => now, browserType,
    fetchRendered: async (page, url) => {
      reads.push(url);
      page.current = url;
      return { status: 200, finalUrl: url, bodyText: 'PRIVATE UNRELATED BODY', ...navigate(url) };
    },
    readLinkedDate: async (_page, url) => dates[AUDIT_TARGETS.indexOf(url)],
    ...options,
  }) };
}

test('saved receipts bind only exact original identities and strong prior dates', () => {
  assert.deepEqual(acceptedPriors.map(row => row.url), AUDIT_TARGETS);
  assert.throws(() => priorAuditEvidence({ links: AUDIT_TARGETS.slice(0, 3) }, [receipt(audience.slice(0, 2)), receipt(audience.slice(2))]), /exact rejected/);
  assert.throws(() => priorAuditEvidence({ links: AUDIT_TARGETS }, [
    receipt([{ ...audience[0], httpStatus: 403 }, audience[1]]), receipt(audience.slice(2)),
  ]), /exact rejected/);
});

test('three normal rendered reads and independent cached Graph proof preserve fields without retaining raw page data', async () => {
  const browser = browsers();
  const { report, webAccessChanges } = await browser.run();
  assert.deepEqual(browser.reads, AUDIT_TARGETS.slice(0, 3));
  assert.equal(report.browserNavigations, 3);
  assert.equal(report.capturedCount, 4);
  assert.equal(report.cachedGraphCaptures, 1);
  assert.equal(report.modelCalls + report.tavilySearches + report.publishedDeals, 0);
  assert.deepEqual(webAccessChanges, {});
  assert.equal(report.rows[0].caption, originalCaption);
  assert.equal(report.rows[0].ownerUsername, 'cafelokal');
  assert.equal(report.rows[0].locationEvidence, 'exact-post-rendered-location-link');
  assert.match(report.rows[0].title, /Cafe Lokal/);
  assert.equal(report.rows[0].sourceCapturedAt, now.toISOString());
  assert.equal(report.rows[0].sourcePublishedAt, dates[0]);
  assert.equal(report.rows[3].ownerUsername, 'lisa.maria.b');
  assert.equal(report.rows[3].freshForCurrentSevenDays, false);
  assert.equal(report.rows[3].sourcePublishedAt, dates[3]);
  assert.doesNotMatch(JSON.stringify(report), /UNRELATED BODY|offline-fixture-private-value/);
});

test('a real provider wait halts browser reads while matching retained evidence remains available', async () => {
  const browser = browsers({ navigate: () => ({ status: 429, retryAfter: '300000' }) });
  const { report, webAccessChanges } = await browser.run();
  assert.deepEqual(browser.reads, [AUDIT_TARGETS[0]]);
  assert.equal(report.browserNavigations, 1);
  assert.deepEqual(report.rows.map(row => row.status), ['blocked', 'deferred', 'deferred', 'captured']);
  assert.equal(webAccessChanges.all.reason, 'http-429');
  assert.equal(webAccessChanges.all.nextRetryAt, new Date(+now + 300_000_000).toISOString());
});

test('an unmatched or restricted capture cannot substitute a caption or fall back to the historic browser slot', async () => {
  const browser = browsers({ capture: url => url === AUDIT_TARGETS[0] ? { identity: AUDIT_TARGETS[1] }
    : { caption: 'This account is private' } });
  const { report } = await browser.run({ graphState: {}, readLinkedDate: async (_page, url) =>
    url === AUDIT_TARGETS[2] ? dates[1] : dates[AUDIT_TARGETS.indexOf(url)] });
  assert.deepEqual(browser.reads, AUDIT_TARGETS.slice(0, 3));
  assert.equal(report.capturedCount, 0);
  assert.deepEqual(report.rows.map(row => row.reason), ['public-original-identity-conflict',
    'public-audience-unproven', 'original-timestamp-conflicts-with-prior', 'exact-cached-original-unavailable']);
});

test('browser cookie setup failure never opens an original or launches a second context', async () => {
  const browser = browsers({ failCookies: true });
  const { report } = await browser.run();
  assert.equal(browser.launches, 1);
  assert.deepEqual(browser.reads, []);
  assert.equal(report.browserNavigations, 0);
  assert.equal(report.cachedGraphCaptures, 1);
});

test('the observed engagement-only Open Graph header is an unreadable caption, even with an exact post and date', async () => {
  const browser = browsers({ capture: url => url === AUDIT_TARGETS[0]
    ? { caption: '314 likes, 10 comments - satansbratan am November 25, 2026' } : {} });
  const { report } = await browser.run();
  assert.equal(report.capturedCount, 3);
  assert.equal(report.rows[0].status, 'unverified');
  assert.equal(report.rows[0].reason, 'open-graph-header-only');
  assert.equal(report.rows[0].caption, undefined);
  assert.equal(report.rows[0].sourcePublishedAt, dates[0]);
});
