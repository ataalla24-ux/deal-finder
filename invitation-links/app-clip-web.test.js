import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { invitationCode } from './public/_worker.js';
import { APP_ASSOCIATION, appClipLanding, releasedAppClip, previewOfferPeriod } from './public/app-clip.js';
import { resolveDealLink } from './public/deals.js';

const code = 'RM-0123456789ABCDEF01234567';
const invite = 'ASNFZ4mrze8BI0Vn';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const release = { APP_CLIP_RELEASE_ENABLED: '1', APP_CLIP_APPROVED_VERSION: '1.42',
  APP_CLIP_RELEASE_VERIFIED_AT: '2026-11-01T00:00:00Z' };
const request = (path, agent = ios, method = 'GET') => new Request('https://www.freefinder.at' + path,
  { method, headers: { 'user-agent': agent } });
const respond = (req, body, status, headers = {}) => new Response(req.method === 'HEAD' ? null : body, { status, headers });

test('both AASA locations and hosts retain the full app and associate only the intended Clip', async () => {
  assert.deepEqual(APP_ASSOCIATION.applinks,
    { apps: [], details: [{ appID: '78C2SA4JP3.com.stefanataalla.freefinderwien', paths: ['*'] }] });
  assert.deepEqual(APP_ASSOCIATION.appclips.apps, ['78C2SA4JP3.com.stefanataalla.freefinderwien.Clip']);
  for (const path of ['/apple-app-site-association', '/.well-known/apple-app-site-association']) {
    const local = JSON.parse(fs.readFileSync(new URL('../docs' + path, import.meta.url), 'utf8'));
    assert.deepEqual(local, APP_ASSOCIATION);
    for (const method of ['GET', 'HEAD']) {
      const response = worker.fetch(request(path, ios, method));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('set-cookie'), null);
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else assert.deepEqual(await response.json(), local);
    }
  }
});

test('a missing or incomplete release switch preserves existing iOS redirects without advertising a Clip', async () => {
  assert.match(fs.readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8'), /APP_CLIP_RELEASE_ENABLED\s*=\s*"0"/);
  for (const env of [{}, { APP_CLIP_RELEASE_ENABLED: '1' }, { ...release, APP_CLIP_RELEASE_ENABLED: '0' },
    { ...release, APP_CLIP_APPROVED_VERSION: '' }, { ...release, APP_CLIP_RELEASE_VERIFIED_AT: '2099-01-01T00:00:00Z' }]) {
    assert.equal(releasedAppClip(env), false);
    const response = worker.fetch(request('/i/' + invite + '?deal=pizza-1'), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `https://freefinder.at/invite.html?invite=${code}&deal=pizza-1`);
    assert.equal(await response.text(), '');
  }
  const apex = fs.readFileSync(new URL('../docs/invite.html', import.meta.url), 'utf8');
  assert.match(apex, /name="apple-itunes-app" content="app-id=6758958213"/);
  assert.doesNotMatch(apex, /app-clip-bundle-id|automatisch.*übernommen/i);
});

test('the released invitation landing keeps its invocation URL and preserves the full-app fallback', async () => {
  let network = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw Error('Invitation links must not read account or provider data'); };
  try {
    const response = worker.fetch(request('/i/' + invite + '?deal=pizza-1'), release);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    const html = await response.text();
    assert.match(html, /app-id=6758958213, app-clip-bundle-id=com\.stefanataalla\.freefinderwien\.Clip, app-clip-display=card/);
    assert.ok(html.includes('https://www.freefinder.at/i/' + invite + '?deal=pizza-1'));
    assert.ok(html.includes(`freefinder://invite?invite=${code}&amp;deal=pizza-1`));
    assert.match(html, /Vorschau allein startet kein Probeabo/);
    assert.match(html, /reine Installation über einen Weblink speichert keine Einladung/);
    assert.equal(network, 0);
    assert.equal(await worker.fetch(request('/i/' + invite, ios, 'HEAD'), release).text(), '');
  } finally { globalThis.fetch = previous; }
});

test('Android, older iOS and desktop preserve existing full-app routing even after release', () => {
  for (const agent of ['Android', 'Macintosh', 'iPhone OS 13_7']) {
    const response = worker.fetch(request('/i/' + invite, agent), release);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://freefinder.at/invite.html?invite=' + code);
  }
});

test('released deal preview reads only the existing public feed and never redirects to another offer', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://freefinder.at/deals.json');
    assert.equal(options.redirect, 'manual');
    return Response.json({ deals: [{ id: 'pizza-1', title: '<script>alert(1)</script> Gratis Kaffee',
      brand: 'Café "Wien"', description: 'Nur mit App-Coupon & solange der Vorrat reicht.' }] });
  };
  try {
    const response = await worker.fetch(request('/d/UoJ7Ip8gAf8e?i=' + invite), release);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; Gratis Kaffee'));
    assert.ok(html.includes('Nur mit App-Coupon &amp; solange der Vorrat reicht.'));
    assert.ok(html.includes(`freefinder://invite?invite=${code}&amp;deal=pizza-1`));
    assert.doesNotMatch(html, /<script>alert/);
    assert.equal(calls, 1);
    const legacy = await worker.fetch(request('/d/UoJ7Ip8gAf8e?r=ABC123'), release);
    assert.equal(legacy.status, 302);
    assert.match(legacy.headers.get('location'), /ref=FF-ABC123/);
    const missing = await resolveDealLink(request('/d/UoJ7Ip8gAf8e'), invitationCode, respond, async () => [], appClipLanding);
    assert.equal(missing.status, 410);
    assert.equal(missing.headers.get('location'), null);
    for (const suffix of ['?i=' + invite + '&i=' + invite, '?enabled=1', '?next=https://evil.test']) {
      assert.equal((await worker.fetch(request('/d/UoJ7Ip8gAf8e' + suffix), release)).status, 404);
    }
    assert.equal(calls, 2, 'invalid requests and missing fixture offers make no extra public/provider reads');
  } finally { globalThis.fetch = previous; }
});

test('structured calendar days remain inclusive in Vienna while actual clock deadlines stay exact', async () => {
  const deal = { id: 'pizza-1', title: 'Döner gratis', description: 'Nur gegen Vorlage des Gutscheins.',
    validOn: '2026-11-27', validUntil: '2026-11-27', validFrom: '2026-11-27',
    expires: '2026-11-27T18:00:00.000Z', expiresPrecision: 'day',
    expiryDisplayText: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr',
    url: 'https://www.example.com/offer', address: 'Unverified', enrichmentFields: ['map'] };
  assert.equal(previewOfferPeriod(deal).expiresAt, Date.parse(deal.expires));
  const target = 'https://freefinder.at/?deal=pizza-1';
  const before = appClipLanding(request('/d/UoJ7Ip8gAf8e'), target, respond, deal, Date.parse(deal.expires) - 1);
  const html = await before.text();
  assert.equal(before.status, 200);
  assert.ok(html.includes(deal.expiryDisplayText));
  assert.match(html, /19:00/);
  assert.match(html, /Wien · Standort folgt/);
  assert.doesNotMatch(html, /Unverified/);
  assert.match(html, /Originalangebot ansehen/);
  assert.ok(html.includes(deal.description));
  assert.equal(appClipLanding(request('/d/UoJ7Ip8gAf8e'), target, respond, deal, Date.parse(deal.expires)).status, 410);
  const calendar = { validUntil: '2026-03-29', expires: '2026-03-29T23:59:59.999Z', expiresPrecision: 'day' };
  assert.equal(previewOfferPeriod(calendar).expiresAt, Date.parse('2026-03-29T22:00:00Z'));
  assert.equal(previewOfferPeriod({ validUntil: '2026-11-27' }).expiresAt, Date.parse('2026-11-27T23:00:00Z'));
  assert.equal(previewOfferPeriod({ validUntil: '2026-02-30' }).expiresAt, null);
  assert.match(previewOfferPeriod({ validFrom: '2026-12-01' }).text, /Kein bestätigtes Enddatum/);
});
