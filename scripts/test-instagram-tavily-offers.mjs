import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyInstagramTavilyOffers } from './check-instagram-tavily-offers.mjs';
import { INSTAGRAM_TAVILY_INVESTIGATION } from '../scraper/instagram-tavily-investigation.js';

const now = new Date();
const clock = () => now;
const day = 86_400_000;
const url = id => 'https://www.instagram.com/p/' + id + '/';
const original = url('NewViennesePost');
const date = new Date(+now - 40 * 60_000).toISOString();
const end = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric',
  timeZone: 'Europe/Vienna' }).format(new Date(+now + 2 * day));
const caption = 'Café Morgenrot in 1070 Wien: Zweiter Kaffee gratis beim Kauf eines großen Cappuccinos. '
  + 'Gültig bis ' + end + '. Nur vor Ort am Neubaugasse 55, keine Lieferung.';
const title = 'Café Morgenrot auf Instagram';

function page(post, { publication = date, titleText = title, captionText = caption, extra = '', canonical = post } = {}) {
  return '<head><link rel="canonical" href="' + canonical + '">'
    + '<script type="application/ld+json">' + JSON.stringify({ '@type': 'SocialMediaPosting', url: post,
      datePublished: publication, headline: titleText, description: captionText })
    + '</script></head><body><main>' + extra + '</main></body>';
}

const html = content => new Response(content, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const forbid = () => assert.fail('no source request expected');
const verify = options => verifyInstagramTavilyOffers({ now, clock, ...options });

test('no canonical results perform no source reads and produce an empty candidate artifact', async () => {
  const result = await verify({ links: ['https://www.instagram.com/profile/', url('TrackerOnly') + '?utm_source=fixture'],
    fetcher: forbid });
  assert.equal(result.report.canonicalLinks, 0);
  assert.equal(result.report.sourceReads, 0);
  assert.equal(result.report.verifiedNewOffers, 0);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.webAccessChanged, false);
});

test('already live, pending, indexed, Slack-seen or Graph-screened exact posts take no slots', async () => {
  const keys = ['LiveOriginal', 'PendingOriginal', 'IndexedOriginal', 'SeenOriginal', 'GraphRejected', 'GraphAccepted'];
  const result = await verify({ links: keys.map(url),
    inventory: { live: [{ url: url(keys[0]) }], pending: [{ url: url(keys[1]) }],
      indexed: [{ postUrl: url(keys[2]) }], seen: { seenPostKeys: ['instagram:reel:' + keys[3]] },
      graphPosts: [{ url: 'https://www.instagram.com/reel/' + keys[4] + '/', graphAccepted: false,
        graphRejection: 'excluded-promotion-type' }, { permalink: url(keys[5]), graphAccepted: true }] }, fetcher: forbid });
  assert.equal(result.report.knownLinks, 6);
  assert.equal(result.report.sourceReads, 0);
  assert.deepEqual(result.report.rows.map(entry => entry.reason),
    ['already-live', 'previously-pending', 'previously-indexed', 'previously-seen', 'previously-seen-graph',
      'previously-seen-graph']);
});

test('manual redirects never follow challenges, and a blocked first response stops later originals', async () => {
  for (const [response, expected, waitFor] of [
    [new Response(null, { status: 302, headers: { location: '/accounts/login/' } }), 'login-wall', 6 * 3600],
    [new Response(null, { status: 429, headers: { 'retry-after': '200000' } }), 'http-429', 200000],
    [html('<form><input type="password"></form>'), 'login-wall', 6 * 3600],
  ]) {
    const called = [];
    const result = await verify({ links: [original, url('AnotherCandidate')], fetcher: async (target, init) => {
      called.push(target);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.headers.cookie, undefined);
      return response;
    } });
    assert.deepEqual(called, [original]);
    assert.equal(result.report.rows[0].reason, expected);
    assert.equal(result.report.rows[1].reason, 'web-access-cooldown');
    assert.equal(result.webAccessChanged, true);
    assert.equal(result.webAccessChanges.all.nextRetryAt, new Date(+now + waitFor * 1000).toISOString());
  }
});

test('existing related access pause defers all originals without rewriting state', async () => {
  const nextRetryAt = new Date(+now + 3600_000).toISOString();
  const result = await verify({ links: [original], fetcher: forbid,
    previousReport: { search: { nextRetryAt: '2099-12-25T00:00:00Z' } },
    relatedReport: { webAccess: { all: { nextRetryAt, reason: 'http-403' } } } });
  assert.equal(result.report.rows[0].nextRetryAt, nextRetryAt);
  assert.equal(result.webAccessChanged, false);
});

test('ordinary session verification defers without its session and confines cookies to the exact original', async () => {
  const unavailable = await verify({ links: [original], requireSession: true, fetcher: forbid });
  assert.equal(unavailable.report.rows[0].reason, 'ordinary-session-unavailable');
  assert.equal(unavailable.webAccessChanged, false);
  const knownCookie = 'sessionid=offline-fixture-not-a-secret';
  const fixture = await verify({ links: [original, 'https://external.test/p/MaliciousFake/'],
    requireSession: true, cookieHeader: knownCookie, fetcher: async (target, init) => {
      assert.equal(target, original);
      assert.equal(init.headers.cookie, knownCookie);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'same-origin');
      return new Response(null, { status: 302, headers: { location: 'https://external.test/' } });
    } });
  assert.equal(fixture.report.sourceReads, 1);
  assert.equal(fixture.report.rows[0].reason, 'original-http-or-identity-unverified');
  assert.doesNotMatch(JSON.stringify(fixture), /offline-fixture-not-a-secret|external\.test/);
});

test('rejects a stale original, unlinked neighboring timestamp and mismatched canonical identity', async () => {
  const stale = url('StaleOriginal');
  const irrelevant = url('IrrelevantDate');
  const mismatch = url('MismatchSource');
  const pages = new Map([
    [stale, page(stale, { publication: new Date(+now - 8 * day).toISOString() })],
    [irrelevant, page(irrelevant, { publication: null, extra:
      '<time datetime="' + date + '"></time><a href="' + stale + '"><time datetime="' + date + '"></time></a>' })],
    [mismatch, page(mismatch, { canonical: stale })],
  ]);
  const result = await verify({ links: [...pages.keys()], fetcher: async target => html(pages.get(target)) });
  assert.equal(result.report.sourceReads, 3);
  assert.deepEqual(result.report.rows.map(entry => entry.reason), [
    'original-post-outside-freshness-window', 'missing-bound-original-date', 'original-identity-mismatch',
  ]);
  assert.deepEqual(result.candidates, []);
});

test('a concrete new public offer preserves the exact source clock and original conditions', async () => {
  let reads = 0;
  const result = await verify({ links: [original],
    fetcher: async () => { reads++; return html(page(original)); } });
  assert.equal(reads, 1);
  assert.equal(result.report.verifiedNewOffers, 1, JSON.stringify(result.report));
  assert.equal(result.report.modelCalls, 0);
  assert.equal(result.report.publishedDeals, 0);
  const [deal] = result.candidates;
  assert.equal(deal.url, original);
  assert.equal(deal.sourcePublishedAt, date);
  assert.equal(deal.sourcePublishedAtSource, 'instagram-public-html-datePublished');
  assert.equal(deal.caption, caption);
  assert.match(deal.distance, /1070 Wien|Wien/);
  assert.match(deal.type, /bogo|gratis/);
  assert.equal(deal.slackTs, undefined);
});

test('an exact timestamp and metadata header do not certify the surrounding page as the original caption', async () => {
  const header = '314 likes, 10 comments - satansbratan am November 25, 2026';
  const result = await verify({ links: [original],
    fetcher: async () => html(page(original, { captionText: '', extra: '<p>' + caption + '</p>' })
      .replace('</head>', '<meta property="og:description" content="' + header + '"></head>')) });
  assert.equal(result.report.rows[0].reason, 'open-graph-header-only');
  assert.equal(result.report.verifiedNewOffers, 0);
  assert.deepEqual(result.candidates, []);
});

test('an over-limit original caption is held instead of cutting off mandatory conditions', async () => {
  const longCaption = caption + ' Zusätzlicher Text.'.repeat(100) + ' Nur bei Kauf eines zweiten Produkts.';
  const result = await verify({ links: [original], fetcher: async () => html(page(original, { captionText: longCaption })) });
  assert.equal(result.report.rows[0].reason, 'original-caption-over-limit');
  assert.deepEqual(result.candidates, []);
  assert.doesNotMatch(JSON.stringify(result), /Zusätzlicher Text/);
});

test('the seventh novel canonical URL is deferred; ordinary 404 does not pause the host', async () => {
  const links = Array.from({ length: 8 }, (_, i) => url('Candidate' + i));
  let checks = 0;
  const result = await verify({ links, fetcher: async () => {
    checks++;
    return new Response(null, { status: 404 });
  } });
  assert.equal(checks, 6);
  assert.equal(result.report.sourceReads, 6);
  assert.deepEqual(result.report.rows.slice(6).map(entry => entry.reason), ['source-read-cap', 'source-read-cap']);
  assert.equal(result.webAccessChanged, false);
});

test('CLI claims exact receipt once and rejects every replay before another source read', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-tavily-verification-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./check-instagram-tavily-offers.mjs', import.meta.url));
  const claimFile = path.join(directory, 'source-state/instagram-tavily-verification-claim.json');
  const receipt = path.join(directory, 'receipt.json');
  const output = path.join(directory, 'github-output');
  const fetchLog = path.join(directory, 'fetches');
  const preload = path.join(directory, 'offline.mjs');
  const runId = '123456';
  const stubSession = 'offline-fixture-not-a-secret';
  const graphOriginal = 'https://www.instagram.com/reel/GraphRejected/';
  const input = JSON.stringify({ investigation: INSTAGRAM_TAVILY_INVESTIGATION, links: [original, graphOriginal] });
  fs.writeFileSync(receipt, input);
  fs.writeFileSync(preload, `
    import fs from 'node:fs';
    globalThis.fetch = async (target, init) => {
      if (target !== ${JSON.stringify(original)} || init.method !== 'GET' || init.redirect !== 'manual') {
        throw new Error('Unexpected offline request shape');
      }
      fs.appendFileSync(${JSON.stringify(fetchLog)}, target + '\\n');
      return new Response(null, { status: 404 });
    };
  `);
  fs.mkdirSync(path.join(directory, 'docs'));
  for (const name of ['deals.json', 'deal-candidates-index.json', 'slack-seen-posts.json']) {
    fs.writeFileSync(path.join(directory, 'docs', name), '{}');
  }
  fs.writeFileSync(path.join(directory, 'docs/instagram-graph-post-evidence.json'), JSON.stringify({
    posts: [{ url: graphOriginal, graphAccepted: false, graphRejection: 'excluded-promotion-type' }],
  }));
  const invoke = (args = [], env = {}) => spawnSync(process.execPath, ['--import', preload, script, receipt, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: runId, GITHUB_OUTPUT: output,
      INSTAGRAM_SESSIONID: stubSession, ...env },
  });
  const denied = (args, env) => {
    const result = invoke(args, env);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(stubSession));
  };

  denied();
  denied(['--claim'], { GITHUB_REF: 'refs/heads/invalid' });
  denied(['--claim'], { GITHUB_RUN_ATTEMPT: '2' });
  denied(['--claim'], { GITHUB_RUN_ID: '../invalid' });
  fs.writeFileSync(receipt, JSON.stringify({ investigation: 'another-investigation', links: [] }));
  denied(['--claim']);
  assert.equal(fs.existsSync(claimFile), false);
  assert.equal(fs.existsSync(fetchLog), false);
  fs.writeFileSync(receipt, input);
  const claimRun = invoke(['--claim']);
  assert.equal(claimRun.status, 0, claimRun.stderr);
  const claimBytes = fs.readFileSync(claimFile, 'utf8');
  const claim = JSON.parse(claimBytes);
  assert.equal(claim.investigation, INSTAGRAM_TAVILY_INVESTIGATION);
  assert.equal(claim.runId, runId);
  assert.equal(claim.receiptSha256, createHash('sha256').update(input).digest('hex'));
  assert.equal(claim.maximumSourceReads, 6);
  assert.equal(fs.readFileSync(output, 'utf8'), 'claimed=true\n');
  const secondClaim = invoke(['--claim'], { GITHUB_RUN_ID: '654321' });
  assert.equal(secondClaim.status, 0, secondClaim.stderr);
  assert.match(secondClaim.stdout, /already claimed/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'claimed=true\n');
  denied([], { GITHUB_RUN_ID: '654321' });
  denied([], { GITHUB_RUN_ATTEMPT: '2' });
  fs.writeFileSync(receipt, input + '\n');
  denied();
  assert.equal(fs.existsSync(fetchLog), false);

  fs.writeFileSync(receipt, input);
  const verifyRun = invoke();
  assert.equal(verifyRun.status, 0, verifyRun.stderr);
  const report = JSON.parse(verifyRun.stdout);
  assert.equal(report.sourceReads, 1);
  assert.equal(report.knownLinks, 1);
  assert.equal(report.rows[1].reason, 'previously-seen-graph');
  assert.equal(report.verifiedNewOffers, 0);
  assert.doesNotMatch(verifyRun.stdout, new RegExp(stubSession));
  denied();
  assert.equal(fs.readFileSync(fetchLog, 'utf8'), original + '\n');
  assert.equal(fs.readFileSync(claimFile, 'utf8'), claimBytes);
});
