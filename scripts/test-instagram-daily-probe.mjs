import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateInstagramAuth, classifyOwnProfileResult } from './check-instagram-auth.mjs';

const cookies = [{ name: 'sessionid', value: 'offline-fixture' }];
const env = { INSTAGRAM_AUTH_METHOD: 'own-profile-ui', INSTAGRAM_USERNAME: 'fixture_account' };

for (const state of ['challenge', 'email-code', 'two-factor']) {
  test(`own-profile ${state} is explicit, private and never retries or proceeds`, async () => {
    let probes = 0;
    const result = await validateInstagramAuth(cookies, { env,
      fetchImpl: () => assert.fail('No legacy endpoint'),
      browserProbe: async () => {
        probes++;
        throw Object.assign(new Error('private@example.test 123456'), {
          status: 'blocked', details: { pageState: state, account: 'private-account', body: 'private@example.test' },
        });
      },
    });
    assert.equal(probes, 1);
    assert.equal(result.validationFailure, state);
    assert.equal(result.userInteractionRequired, true);
    assert.equal(result.canProceed, false);
    assert.equal(result.shouldRefreshCookies, false);
    assert.equal(result.credentialsState, 'unknown');
    assert.doesNotMatch(JSON.stringify(result), /private|123456/);
  });
}

test('ordinary HTTP refusal is not misreported as an expired session or user challenge', async () => {
  const result = await validateInstagramAuth(cookies, { env,
    browserProbe: async () => { throw Object.assign(new Error('private response'), { status: 'validation-failed', details: { httpStatus: 403 } }); },
  });
  assert.equal(result.validationFailure, 'http-403');
  assert.equal(result.userInteractionRequired, false);
  assert.equal(result.canProceed, false);
  assert.equal(result.credentialsState, 'unknown');
});

test('unknown diagnostic values cannot copy provider text to reports', async () => {
  const result = await validateInstagramAuth(cookies, { env,
    browserProbe: async () => { throw Object.assign(new Error('private token'), { details: { pageState: 'private@example.test', httpStatus: '403 private' } }); },
  });
  assert.equal(result.validationFailure, 'own-profile-unconfirmed');
  assert.equal(result.userInteractionRequired, false);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('browser UI diagnostics accept only fixed enum and boolean fields', async () => {
  const result = await validateInstagramAuth(cookies, { env, browserProbe: async () => {
    throw Object.assign(new Error('private token'), { details: { ownProfileSignals: {
      location: 'own-profile', httpStatus: 200, documentState: 'complete', sessionCookiePresent: true,
      ownerCookiePresent: true, editControlVisible: false, editProfileHrefVisible: true,
      bodyHasText: 'private@example.test', cookie: 'private token', html: 'private account data',
    } } });
  } });
  assert.deepEqual(result.browserSignals, { sessionCookiePresent: true, ownerCookiePresent: true,
    editControlVisible: false, editProfileHrefVisible: true, location: 'own-profile', documentState: 'complete', httpStatus: 200 });
  assert.equal(result.canProceed, false);
  assert.doesNotMatch(JSON.stringify(result), /private|cookie"|html"/);
});

test('observed unresolved consent stays blocked without inventing expiry or a newer observation', () => {
  const report = { updatedAt: '2026-11-23T12:12:13.076Z', validationMethod: 'own-profile-ui', ok: false, canProceed: false,
    status: 'validation-unconfirmed', userInteractionRequired: false,
    browserSignals: { route: 'consent', httpStatus: 200, documentState: 'complete', optionalCookiesDeclined: false } };
  const classified = classifyOwnProfileResult(report);
  assert.equal(classified.status, 'blocked');
  assert.equal(classified.validationFailure, 'consent-unconfirmed');
  assert.equal(classified.credentialsState, 'unknown');
  assert.equal(classified.shouldRefreshCookies, false);
  assert.equal(classified.updatedAt, report.updatedAt);
  assert.equal(classified.canProceed, false);
  assert.equal(classified.userInteractionRequired, false, 'unknown consent is not proof of a particular required owner choice');
  for (const changed of [{ ok: true }, { canProceed: true }, { validationMethod: 'other' }, { browserSignals: { route: 'home' } }]) {
    const other = { ...report, ...changed };
    assert.equal(classifyOwnProfileResult(other), other);
  }
});

test('bounded manual probe leaves scheduled limits and auth gates intact without paid providers', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/firecrawl-daily-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /instagram_probe:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/);
  assert.match(workflow, /IG_MAX_SOURCES_TOTAL: \$\{\{ inputs.instagram_probe && '3' \|\| '220' \}\}/);
  assert.match(workflow, /IG_MAX_PAGE_VISITS: \$\{\{ inputs.instagram_probe && '12' \|\| '40' \}\}/);
  assert.match(workflow, /IG_MAX_RUN_MINUTES: \$\{\{ inputs.instagram_probe && '10' \|\| '80' \}\}/);
  assert.match(workflow, /Run Instagram Daily Sync\n\s+if:.*instagram-access.outputs.proceed == 'true'.*instagram-auth.outputs.ok == 'true'/);
  assert.match(workflow, /Run jö Scraper\n\s+if: \$\{\{ !inputs.instagram_probe \}\}/);
  assert.match(workflow, /Run Vienna Promo Radar\n\s+if:.*!inputs.instagram_probe/);
  assert.match(workflow, /INSTAGRAM_AUTH_NOTIFY_SLACK: \$\{\{ inputs.instagram_probe && '0' \|\| '1' \}\}/);
  assert.doesNotMatch(workflow, /secrets\.(?:OPENAI|ANTHROPIC|FIRECRAWL|APIFY)|refresh-instagram-cookies|--interactive-update/);
  assert.match(workflow, /cron: '20 5 \* \* \*'/);
});
