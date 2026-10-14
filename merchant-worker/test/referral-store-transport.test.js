import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { workerBundleOptions } from './bundled-apple-claims.js';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';

test('real Workers Store transports keep credentials on their original hosts, including OAuth and deferral', async t => {
  const googleKey = await generateKeyPair('RS256', { extractable: true });
  const appleKey = await generateKeyPair('ES256', { extractable: true });
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    ...workerBundleOptions });
  const outbound = [];
  let redirectHost = null;
  let redirectStatus = 307;
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-03-09', compatibilityFlags: ['nodejs_compat'],
    modules: [{ type: 'ESModule', path: 'runtime.js', contents: `
      import { ReferralMonths } from './worker.js';
      export default { async fetch(request, env) {
        const ledger = new ReferralMonths({ storage: {} }, env);
        const action = new URL(request.url).pathname.slice(1);
        try {
          const result = action === 'apple' ? await ledger.appleTransaction('100000001') :
            action === 'order' ? await ledger.playOrder('GPA.1111-2222-3333-44444') :
            action === 'defer' ? await ledger.deferPlay('fixture-purchase-token',
              {product:'freefinder.pro.monthly', etag:'fixture-etag', expires:1000}, 2000) :
            await ledger.playPurchase('fixture-purchase-token');
          return Response.json(result);
        } catch { return Response.json({ok:false}, {status:503}); }
      } };
    ` }, { type: 'ESModule', path: 'worker.js', contents: bundled.outputFiles[0].text }],
    bindings: {
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fixture@example.test', private_key: await exportPKCS8(googleKey.privateKey) }),
      APP_STORE_CONNECT_ISSUER_ID: '00000000-0000-4000-8000-000000000001',
      APP_STORE_CONNECT_KEY_ID: 'TESTKEY001', APP_STORE_CONNECT_PRIVATE_KEY: await exportPKCS8(appleKey.privateKey),
    }, log: new Log(LogLevel.NONE), outboundService: async request => {
      const { host, pathname } = new URL(request.url);
      outbound.push({ host, pathname, method: request.method });
      if (host === redirectHost) return new Response(null, {status:redirectStatus, headers:{location:'https://untrusted.example.test/collect'}});
      if (host === 'oauth2.googleapis.com') {
        assert.equal(request.method, 'POST');
        assert.ok(new URLSearchParams(await request.text()).get('assertion'));
        return Response.json({access_token:'fixture-access'});
      }
      if (host === 'androidpublisher.googleapis.com') {
        assert.equal(request.headers.get('authorization'), 'Bearer fixture-access');
        return pathname.endsWith(':defer') ? Response.json({itemExpiryTimeDetails:[{productId:'freefinder.pro.monthly', expiryTime:new Date(2000).toISOString()}]}) :
          Response.json({fixture:true});
      }
      if (host === 'api.storekit.itunes.apple.com' || host === 'api.storekit-sandbox.itunes.apple.com') {
        assert.match(request.headers.get('authorization'), /^Bearer /);
        return Response.json({signedTransactionInfo:'fixture.signed.info'});
      }
      // Record, but never make a real request to an unexpected redirect target.
      return Response.json({unexpected:true});
    },
  }));
  t.after(() => mf.dispose());
  for (const action of ['purchase', 'order', 'defer', 'apple']) {
    await t.test(action + ' succeeds with authenticated original-host responses', async () => {
      redirectHost = null; outbound.length = 0;
      const response = await mf.dispatchFetch('https://test/' + action);
      assert.equal(response.status, 200);
      const result = await response.json();
      if (['defer', 'apple'].includes(action)) assert.equal(result.ok, true);
      else assert.equal(result.fixture, true);
      assert.deepEqual(outbound.map(x => x.host), action === 'apple' ? ['api.storekit.itunes.apple.com'] :
        ['oauth2.googleapis.com', 'androidpublisher.googleapis.com']);
      if (action !== 'apple') assert.equal(outbound[1].method, action === 'defer' ? 'POST' : 'GET');
    });
  }
  for (const [action, host] of [['purchase','oauth2.googleapis.com'], ['purchase','androidpublisher.googleapis.com'],
    ['order','androidpublisher.googleapis.com'], ['defer','androidpublisher.googleapis.com'], ['apple','api.storekit.itunes.apple.com']]) {
    for (const status of [301, 302, 303, 307, 308]) {
      await t.test(action + ' rejects HTTP ' + status + ' from ' + host, async () => {
        redirectHost = host; redirectStatus = status; outbound.length = 0;
        const response = await mf.dispatchFetch('https://test/' + action);
        const result = await response.json();
        assert.equal(outbound.some(x => x.host === 'untrusted.example.test'), false, 'credential-bearing redirect must not be followed');
        if (action === 'apple') {
          assert.equal(result.ok, false);
          assert.equal(outbound.length, 1, 'a redirect is not evidence of a sandbox transaction');
        } else if (action === 'defer') {
          assert.equal(result.ok, false);
          assert.equal(result.definitive, false, 'unexpected response must not permit a financial replay');
        } else assert.equal(response.status, 503);
        if (host === 'oauth2.googleapis.com') assert.equal(outbound.length, 1, 'rejected OAuth response must not reach the Store API');
      });
    }
  }
});
