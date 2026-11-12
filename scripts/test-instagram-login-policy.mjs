import assert from 'node:assert/strict';
import test from 'node:test';
import { instagramLoginCredentials, instagramLoginPageState, loginConfigurationAudit, workflowMaskValue } from './lib/instagram-login-policy.mjs';

test('preserves password bytes including significant whitespace', () => {
  const password = '  fixture  with\ttab %\r\n';
  const env = { INSTAGRAM_USERNAME: ' dermarollerdesign ', INSTAGRAM_PASSWORD: password };
  assert.deepEqual(instagramLoginCredentials(env), { username: 'dermarollerdesign', password });
  assert.equal(loginConfigurationAudit(env).legacyPasswordNormalizationWouldChange, true);
  assert.equal(JSON.stringify(loginConfigurationAudit(env)).includes(password), false);
});

test('legacy names and empty credentials stay explicit', () => {
  assert.deepEqual(instagramLoginCredentials({ IG_USERNAME: 'legacy', IG_PASSWORD: 'fixture' }), { username: 'legacy', password: 'fixture' });
  assert.throws(() => instagramLoginCredentials({}), /USERNAME/);
  assert.throws(() => instagramLoginCredentials({ INSTAGRAM_USERNAME: 'user' }), /PASSWORD/);
  assert.equal(loginConfigurationAudit({}).legacyPasswordNormalizationWouldChange, null);
  assert.equal(loginConfigurationAudit({ INSTAGRAM_PASSWORD: 'fixture' }).legacyPasswordNormalizationWouldChange, false);
});

test('workflow mask escapes command characters without normalizing the secret', () => {
  assert.equal(workflowMaskValue(' x%\r\ny '), ' x%25%0D%0Ay ');
});

for (const text of [
  'Die eingegebenen Login-Informationen sind nicht korrekt.',
  'Sorry, your password was incorrect.',
  'Your login info is not correct.',
  'Das Passwort ist falsch.',
]) test(`rejects the actual login response: ${text}`, () => {
  assert.equal(instagramLoginPageState('https://www.instagram.com/', text), 'login-rejected');
});

test('does not treat root URL, a required field or ordinary login labels as success/challenge', () => {
  assert.equal(instagramLoginPageState('https://www.instagram.com/', 'Username required. Handynummer, Benutzername oder E-Mail-Adresse Passwort Anmelden'), 'unknown');
  assert.equal(instagramLoginPageState('https://www.instagram.com/', ''), 'unknown');
});

test('email and authenticator challenges require different handlers', () => {
  assert.equal(instagramLoginPageState('https://www.instagram.com/auth_platform/codeentry/', 'Sieh in deinen E-Mails nach. Gib den Code ein.'), 'email-code');
  assert.equal(instagramLoginPageState('https://www.instagram.com/auth_platform/codeentry/', 'Enter the code from your authentication app'), 'two-factor');
  assert.equal(instagramLoginPageState('https://www.instagram.com/auth_platform/codeentry/', 'Gib den Code ein'), 'challenge');
  assert.equal(instagramLoginPageState('https://www.instagram.com/accounts/login/two_factor/', 'Enter code'), 'two-factor');
});

test('rate limits and unexplained challenges stop instead of retrying credentials', () => {
  assert.equal(instagramLoginPageState('https://www.instagram.com/', 'Please wait a few minutes before you try again.'), 'rate-limited');
  assert.equal(instagramLoginPageState('https://www.instagram.com/challenge/', 'Confirm it is you'), 'challenge');
});
