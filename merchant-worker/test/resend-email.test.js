import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { sendResendEmail } from '../src/resend-email.js';

const env = { ACCOUNT_EMAIL_TRANSPORT_ENABLED: '1', RESEND_API_KEY: 're_fixture_only_not_a_real_key' };
const now = 1791918000000;
const id = '64d94e34-6f9c-4a77-9c01-8cfd4b93b5be';
const providerId = '491ddf9a-ad88-41cb-a7b4-a71e644099e4';
const delivery = { id, createdAt: now - 1000, to: 'qa@example.test', subject: 'FreeFinder Test',
  text: 'Eine lokale Testnachricht.', html: '<p>Eine lokale Testnachricht.</p>' };
const noNetwork = async () => assert.fail('must not send');

test('Resend remains disabled without an exact transport opt-in and protected key', async () => {
  for (const flag of [undefined, '', '0', true, 1, 'true']) {
    assert.equal((await sendResendEmail({ ...env, ACCOUNT_EMAIL_TRANSPORT_ENABLED: flag }, delivery,
      { transport: noNetwork, now })).reason, 'disabled');
  }
  for (const key of [undefined, '', 'bad', 're_secret\r\nAuthorization: stolen']) {
    assert.equal((await sendResendEmail({ ...env, RESEND_API_KEY: key }, delivery,
      { transport: noNetwork, now })).reason, 'not_configured');
  }
});

test('only one validated recipient, bounded content and an opaque delivery ID are accepted', async () => {
  for (const patch of [{ to: ['a@example.test', 'b@example.test'] }, { to: 'a@example.test,b@example.test' },
    { to: 'Name <a@example.test>' }, { to: 'a@example.test\r\nBcc:other@example.test' }, { to: 'a@-host.test' },
    { to: '.a@example.test' }, { to: 'a..b@example.test' }, { to: 'x'.repeat(65) + '@example.test' },
    { id: 'private-email@example.test' }, { subject: 'Hello\r\nBcc:test' }, { subject: '' },
    { subject: 'x'.repeat(201) }, { text: ' ' }, { text: '\0' }, { text: 'x'.repeat(32001) },
    { html: '' }, { html: 'x'.repeat(64001) }]) {
    assert.equal((await sendResendEmail(env, { ...delivery, ...patch }, { transport: noNetwork, now })).reason,
      'invalid_delivery', JSON.stringify(patch).slice(0, 100));
  }
});

test('unresolved deliveries cannot be retried beyond the bounded provider deduplication window', async () => {
  for (const createdAt of [undefined, String(now), NaN, now + 1, now - 23 * 3600000, now - 48 * 3600000]) {
    assert.equal((await sendResendEmail(env, { ...delivery, createdAt }, { transport: noNetwork, now })).reason,
      'delivery_window_closed');
  }
});

test('fixed sender, reply address and immutable idempotency header; no extra recipients or attachments', async () => {
  const captured = [];
  const transport = async (url, options) => { captured.push({ url, options }); return Response.json({ id: providerId }); };
  const message = { ...delivery, from: 'evil@example.test', cc: 'other@example.test', bcc: 'another@example.test',
    headers: { private: 'ignored' }, attachments: ['ignored'], unsubscribeURL: 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/email/unsubscribe?token=opaque-fixture' };
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await sendResendEmail(env, message, { transport, now: now + i * 1000 }),
      { outcome: 'accepted', providerId, status: 200 });
  }
  assert.equal(captured.length, 2);
  const { url, options } = captured[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers.authorization, `Bearer ${env.RESEND_API_KEY}`);
  assert.equal(options.headers['idempotency-key'], `freefinder-email-v1-${id}`);
  assert.equal(options.body, captured[1].options.body);
  assert.deepEqual(JSON.parse(options.body), { from: 'FreeFinder <hallo@freefinder.at>', to: [delivery.to],
    reply_to: 'freefinder.at@gmail.com', subject: delivery.subject, text: delivery.text, html: delivery.html,
    headers: { 'List-Unsubscribe': `<${message.unsubscribeURL}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
});

test('unsubscribe headers reject external origins, unsafe syntax and unsupported routes', async () => {
  for (const unsubscribeURL of ['http://freefinder.at/email/unsubscribe', 'https://evil.test/email/unsubscribe',
    'https://freefinder.at.evil.test/email/unsubscribe', 'https://x:secret@freefinder.at/email/unsubscribe',
    'https://freefinder.at/email/unsubscribe#secret', 'https://freefinder.at/email/other',
    'https://freefinder.at/email/unsubscribe\r\nOther: yes', 'not a url']) {
    assert.equal((await sendResendEmail(env, { ...delivery, unsubscribeURL }, { transport: noNetwork, now })).reason,
      'invalid_unsubscribe_url');
  }
});

test('provider errors and ambiguous responses are sanitized, never retried automatically', async () => {
  for (const [status, outcome] of [[301,'unknown'],[302,'unknown'],[303,'unknown'],[307,'unknown'],[308,'unknown'],
    [400,'not_sent'],[401,'not_sent'],[403,'not_sent'],[404,'not_sent'],[409,'unknown'],[422,'not_sent'],
    [429,'not_sent'],[500,'unknown'],[503,'unknown']]) {
    let count = 0;
    const result = await sendResendEmail(env, delivery, { now, transport: async () => {
      count++; return new Response('private upstream response', { status, headers: { location: 'https://evil.test' } });
    } });
    assert.equal(result.outcome, outcome); assert.equal(count, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.deepEqual(await sendResendEmail(env, delivery, { now, transport: async () => { throw Error(env.RESEND_API_KEY); } }),
    { outcome: 'unknown', reason: 'transport_error' });
  for (const body of ['{', '{}', '{"id":"not-an-id"}', 'x'.repeat(4097)]) {
    const result = await sendResendEmail(env, delivery, { now, transport: async () => new Response(body) });
    assert.equal(result.outcome, 'unknown'); assert.equal(result.reason, 'invalid_response');
  }
});

test('actual Workers fetch stays on Resend and supports bounded successful responses', async t => {
  let status = 200;
  const requests = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2025-12-01',
    modules: [{ type: 'ESModule', path: 'runtime.js', contents: `
      import { sendResendEmail } from './resend-email.js';
      export default { async fetch(request, env) {
        return Response.json(await sendResendEmail(env, await request.json(), {now:${now}}));
      } };
    ` }, { type: 'ESModule', path: 'resend-email.js', contents: await readFile(new URL('../src/resend-email.js', import.meta.url), 'utf8') }],
    bindings: env, log: new Log(LogLevel.NONE), outboundService: async request => {
      requests.push(request.url);
      assert.equal(request.url, 'https://api.resend.com/emails');
      assert.equal(request.headers.get('authorization'), `Bearer ${env.RESEND_API_KEY}`);
      assert.equal(request.headers.get('idempotency-key'), `freefinder-email-v1-${id}`);
      assert.deepEqual((await request.json()).to, [delivery.to]);
      return status === 200 ? Response.json({ id: providerId }) :
        new Response('', { status, headers: { location: 'https://evil.test' } });
    },
  }));
  t.after(() => mf.dispose());
  for (const code of [200,301,302,303,307,308]) {
    status = code;
    const before = requests.length;
    const result = await (await mf.dispatchFetch('https://fixture.test', { method: 'POST',
      body: JSON.stringify(delivery) })).json();
    assert.equal(result.outcome, code === 200 ? 'accepted' : 'unknown');
    assert.equal(requests.length, before + 1);
  }
});
