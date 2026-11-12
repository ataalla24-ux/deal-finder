import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationSecretFindings, assertPublicationSafe} from './repository-secret-guard.mjs';
import {compareInstagramSessions} from './instagram-session-audit.mjs';

const fake = `${12345678901}%3A${'x'.repeat(48)}`;
test('blocks cookie headers, cookie jars, Netscape exports and private file paths', () => {
  for (const text of [`sessionid=${fake}; wd=1`, JSON.stringify([{name:'sessionid',value:fake}]),
    JSON.stringify([{value:fake,name:'sessionid'}]), `.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\t${fake}`]) {
    assert.deepEqual(publicationSecretFindings('docs/debug.json', text), ['instagram-session-cookie']);
  }
  for (const file of ['.env', '.env.production', '.secrets/a.json', '.community-internal/queue.json',
    'wien_deals/instagram_cookies.txt', 'auth.storage-state.json']) {
    assert.ok(publicationSecretFindings(file, '').includes('private-runtime-path'));
  }
});
test('does not reject public cookie names, code, examples, deletions or normal queues', () => {
  for (const text of ['const sessionid = process.env.INSTAGRAM_SESSIONID;',
    '{"cookieNames":["sessionid","csrftoken"]}', 'sessionid=YOUR_SESSION_ID']) {
    assert.deepEqual(publicationSecretFindings('scripts/auth.js', text), []);
  }
  assert.deepEqual(publicationSecretFindings('.env.example', ''), []);
  assert.doesNotThrow(() => assertPublicationSafe([{path:'.env',exists:false}, {path:'docs/deals-pending-all.json',content:'{"deals":[]}'}]));
});
test('error messages cannot contain the credential itself', () => {
  assert.throws(() => assertPublicationSafe([{path:'docs/leak.txt',content:`sessionid=${fake}`}]), error =>
    error.message.includes('instagram-session-cookie') && !error.message.includes(fake));
});
test('offline audit distinguishes exact reuse from a newer session on the same account', () => {
  const historical = `ds_user_id=12345678901; sessionid=${fake}`;
  const reused = compareInstagramSessions(historical, {INSTAGRAM_SESSIONID:fake,INSTAGRAM_USERNAME:'dermarollerdesign'});
  assert.equal(reused.exactHistoricalSessionStillConfigured, true);
  assert.equal(reused.currentSecretAccountMatchesHistorical, true);
  const newer = compareInstagramSessions(historical, {INSTAGRAM_COOKIES:`sessionid=${fake}y`,INSTAGRAM_USERNAME:'freefinder.at'});
  assert.equal(newer.exactHistoricalSessionStillConfigured, false);
  assert.equal(newer.currentSecretAccountMatchesHistorical, true);
  assert.equal(newer.historicalAccountNameVerified, false);
  assert.equal(newer.providerSessionValidity, 'not-tested');
  assert.ok(!JSON.stringify(reused).includes(fake));
  assert.ok(!JSON.stringify(reused).includes('12345678901'));
  assert.equal(compareInstagramSessions(historical, {}).currentSecretAccountMatchesHistorical, null);
});
