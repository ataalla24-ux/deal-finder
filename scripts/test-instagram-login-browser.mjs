import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { fillLoginForm, submitLoginForm, waitForLoginAttemptResult, emailCodeChallengeVisible, twoFactorInputVisible, diagnosePage, validateBrowserSession } from './refresh-instagram-cookies.mjs';
import { publishScraperSession } from './refresh-instagram-local.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, html) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  t.after(() => context.close());
  // Every request is fulfilled locally, including the Instagram-shaped test URL.
  await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/');
  return { page, context };
}

const login = `<button type="submit" onclick="window.unrelated=true">Newsletter</button>
<form id="login"><input name="username" autocomplete="username"><input name="password" type="password"><button>Anmelden</button></form>
<div id="result"></div><script>window.submits=0; document.querySelector('form').addEventListener('submit', event => {
event.preventDefault(); window.submits++; RESPONSE
});</script>`;

test('fills exact values and makes only one submit on the actual root-page rejection', async t => {
  const { page, context } = await fixture(t, login.replace('RESPONSE', `document.querySelector('#result').textContent='Die eingegebenen Login-Informationen sind nicht korrekt.';`));
  const { passwordInput } = await fillLoginForm(page, 'fixture-user', '  fixture  password  ', { openPage: false });
  assert.equal(await passwordInput.inputValue(), '  fixture  password  ');
  await assert.rejects(submitLoginForm(page, context, passwordInput), e => e.status === 'login-rejected');
  assert.equal(await page.evaluate(() => window.submits), 1);
  assert.equal(await page.evaluate(() => Boolean(window.unrelated)), false);
});

test('root login form without session is not a successful transition and never resubmits', async t => {
  const { page, context } = await fixture(t, login.replace('RESPONSE', ''));
  const { passwordInput } = await fillLoginForm(page, 'fixture-user', 'fixture-password', { openPage: false });
  await assert.rejects(submitLoginForm(page, context, passwordInput, { resultTimeout: 100 }), e => e.status === 'login-unconfirmed');
  assert.equal(await page.evaluate(() => window.submits), 1);
});

test('a click failure may already have submitted and must not trigger a fallback submit', async () => {
  let clicks = 0;
  let enters = 0;
  const button = { first() { return this; }, isVisible: async () => true, click: async () => { clicks++; throw new Error('ambiguous navigation timeout'); } };
  const form = { count: async () => 1, getByRole: () => button, locator: () => button };
  const passwordInput = { locator: () => form, press: async () => { enters++; } };
  await assert.rejects(submitLoginForm({}, {}, passwordInput), e => e.status === 'login-unconfirmed');
  assert.equal(clicks, 1);
  assert.equal(enters, 0);
});

test('a verified session cookie completes waiting without another submit', async t => {
  const { page, context } = await fixture(t, login.replace('RESPONSE', ''));
  await context.addCookies([{ name: 'sessionid', value: 'offline-fixture', domain: '.instagram.com', path: '/' }]);
  assert.equal(await waitForLoginAttemptResult(page, context, 100), 'session');
});

test('email one-time-code input is not treated as authenticator 2FA', async t => {
  const { page, context } = await fixture(t, '<p>Sieh in deinen E-Mails nach</p><input autocomplete="one-time-code">');
  assert.equal(await emailCodeChallengeVisible(page), true);
  assert.equal(await twoFactorInputVisible(page), false);
  assert.equal(await waitForLoginAttemptResult(page, context, 100), 'email-code');
});

test('phone-number login fields do not falsely require TOTP', async t => {
  const { page } = await fixture(t, '<p>Bei Instagram anmelden</p><input type="tel"><input type="password">');
  assert.equal(await twoFactorInputVisible(page), false);
});

test('diagnostics exclude email, code and page content', async t => {
  const { page } = await fixture(t, '<title>secret-title</title><p>Check your email: private@example.test, code 123456</p><input autocomplete="one-time-code">');
  const result = await diagnosePage(page);
  assert.match(result, /state=email-code/);
  assert.doesNotMatch(result, /private|123456|secret-title/);
});

test('input changed by a page is rejected before any submit', async t => {
  const { page } = await fixture(t, login.replace('RESPONSE', '') + `<script>document.querySelector('[name=password]').addEventListener('input', e => e.target.value='changed');</script>`);
  await assert.rejects(fillLoginForm(page, 'fixture-user', 'fixture-password', { openPage: false }), e => e.status === 'form-mismatch');
  assert.equal(await page.evaluate(() => window.submits), 0);
});

test('manual session requires own-profile controls, matching location and cookie owner', async t => {
  const { page, context } = await fixture(t, '<a href="/accounts/edit/">Profil bearbeiten</a>');
  await context.addCookies([{ name: 'sessionid', value: 'fixture-session', domain: '.instagram.com', path: '/' }, { name: 'ds_user_id', value: 'fixture-owner', domain: '.instagram.com', path: '/' }]);
  await assert.rejects(validateBrowserSession(page, { username: 'dermarollerdesign', expectedUserId: 'different-owner', timeout: 100 }), e => e.status === 'wrong-account');
  const result = await validateBrowserSession(page, { username: 'dermarollerdesign', expectedUserId: 'fixture-owner' });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'own-profile-ui');
  assert.equal(Object.hasOwn(result, 'userId'), false);
  assert.equal(Object.hasOwn(result, 'bodySample'), false);
});

test('other accounts, public login walls and profile errors cannot validate a session', async t => {
  const { page, context } = await fixture(t, '<button>Follow</button>');
  await context.addCookies([{ name: 'sessionid', value: 'fixture-session', domain: '.instagram.com', path: '/' }, { name: 'ds_user_id', value: 'fixture-owner', domain: '.instagram.com', path: '/' }]);
  await assert.rejects(validateBrowserSession(page, { username: 'dermarollerdesign', timeout: 100 }), e => e.status === 'wrong-account');
  await page.route('**/dermarollerdesign/', route => route.fulfill({ status: 429, body: 'Too many requests' }));
  await assert.rejects(validateBrowserSession(page, { username: 'dermarollerdesign', timeout: 100 }), e => e.status === 'rate-limited');
});

test('local secret transfer is restricted to the two scraper secrets using stdin', () => {
  const calls = [];
  publishScraperSession({ cookieString: 'fixture-cookies', sessionId: 'fixture-session' }, (command, args, options) => {
    calls.push({ command, args, input: options.input });
    assert.equal(args.includes(options.input), false);
    return { status: 0 };
  });
  assert.deepEqual(calls.map(call => call.args[2]), ['INSTAGRAM_COOKIES', 'INSTAGRAM_SESSIONID']);
  assert.equal(calls.every(call => call.args.at(-1) === 'ataalla24-ux/deal-finder'), true);
  assert.throws(() => publishScraperSession({ cookieString: 'fixture' }, () => assert.fail('No partial update')), /unvollständig/);
  assert.throws(() => publishScraperSession({ cookieString: 'fixture', sessionId: 'fixture' }, () => ({ status: 1, stderr: 'sensitive-error' })), e => !e.message.includes('sensitive-error'));
});
