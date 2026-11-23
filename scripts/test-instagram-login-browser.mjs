import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { fillLoginForm, submitLoginForm, waitForLoginAttemptResult, emailCodeChallengeVisible, twoFactorInputVisible, diagnosePage, validateBrowserSession, declineOptionalInstagramCookies } from './refresh-instagram-cookies.mjs';
import { publishScraperSession } from './refresh-instagram-local.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, html) {
  const context = await browser.newContext({ serviceWorkers: 'block', offline: true });
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

test('own-profile challenge diagnostics contain only a fixed state, not the page content', async t => {
  const { page } = await fixture(t, '<p>Check your email private@example.test for code 123456</p>');
  await assert.rejects(validateBrowserSession(page, { username: 'fixture_account', timeout: 100 }), e => {
    assert.equal(e.status, 'blocked');
    assert.deepEqual(e.details, { pageState: 'email-code' });
    assert.doesNotMatch(e.message + JSON.stringify(e.details), /private|123456/);
    return true;
  });
});

test('unconfirmed own-profile exposes only anonymous UI and cookie-presence signals', async t => {
  const { page, context } = await fixture(t, '<p>private@example.test</p><a href="/accounts/edit/">Localized own-profile control</a>');
  await context.addCookies([{ name: 'sessionid', value: 'fixture-session', domain: '.instagram.com', path: '/' }, { name: 'ds_user_id', value: 'private-owner', domain: '.instagram.com', path: '/' }]);
  await assert.rejects(validateBrowserSession(page, { username: 'fixture_account', timeout: 100 }), e => {
    assert.equal(e.status, 'wrong-account');
    assert.deepEqual(e.details.ownProfileSignals, {
      httpStatus: 200, location: 'own-profile', route: 'own-profile', optionalCookiesDeclined: false, sessionCookiePresent: true, ownerCookiePresent: true,
      ownerCookieMatchesExpected: null, editControlVisible: false, documentState: 'complete', bodyHasText: true,
      cookieTextVisible: false, paidPlanChoiceVisible: false, advertisingChoiceVisible: false, legalTermsVisible: false,
      passwordInputVisible: false, editProfileHrefVisible: true, genericErrorVisible: false, cookieDialogVisible: false,
      saveLoginPromptVisible: false, notNowVisible: false, loginLinkVisible: false, ownProfileNavigationVisible: false,
    });
    assert.doesNotMatch(JSON.stringify(e.details), /private|fixture_account|Localized|fixture-session/);
    return true;
  });
});

test('normal optional-cookie rejection is clicked once and still requires the exact own profile', async t => {
  const context = await browser.newContext({ serviceWorkers: 'block', offline: true });
  t.after(() => context.close());
  await context.addCookies([{ name: 'sessionid', value: 'fixture-session', domain: '.instagram.com', path: '/' }, { name: 'ds_user_id', value: 'fixture-owner', domain: '.instagram.com', path: '/' }]);
  let choices = 0, profileRequests = 0;
  await context.route('**/*', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/fixture-choice') { choices++; return route.fulfill({ body: 'ok' }); }
    if (pathname === '/fixture_account/') {
      profileRequests++;
      if (!choices) return route.fulfill({ contentType: 'text/html', body: '<script>history.replaceState(null,"","/consent/")</script><p>Cookies</p><button onclick="fetch(\'/fixture-choice\')">Decline optional cookies</button><button onclick="window.unwanted=true">Allow all cookies</button>' });
      return route.fulfill({ contentType: 'text/html', body: '<a href="/accounts/edit/">Profil bearbeiten</a>' });
    }
    return route.fulfill({ contentType: 'text/html', body: '<p>Cookies</p><button onclick="fetch(\'/fixture-choice\')">Decline optional cookies</button><button onclick="window.unwanted=true">Allow all cookies</button>' });
  });
  const page = await context.newPage();
  const result = await validateBrowserSession(page, { username: 'fixture_account', expectedUserId: 'fixture-owner' });
  assert.equal(result.ok, true);
  assert.equal(result.sessionUiAction, 'declined-optional-cookies');
  assert.equal(choices, 1);
  assert.equal(profileRequests, 2, 'one initial navigation and one exact profile verification');
  assert.equal(await page.evaluate(() => Boolean(window.unwanted)), false);
});

test('paid, ad-profile, legal, generic and hidden consent choices are never clicked', async t => {
  const { page } = await fixture(t, '<p>Consent settings</p>' +
    ['Subscribe', 'Use without ads', 'Use for free with ads', 'I agree', 'Continue', 'Allow all cookies', 'Jetzt nicht']
      .map(label => `<button onclick="window.unwanted=true">${label}</button>`).join('') +
    '<button hidden onclick="window.unwanted=true">Decline optional cookies</button>');
  await page.goto('https://www.instagram.com/consent/');
  assert.equal(await declineOptionalInstagramCookies(page), false);
  assert.equal(await page.evaluate(() => Boolean(window.unwanted)), false);
});

test('a challenge or foreign origin cannot borrow the optional-cookie button', async t => {
  const { page } = await fixture(t, '<p>Confirm it is you</p><button onclick="window.unwanted=true">Decline optional cookies</button>');
  for (const target of ['https://www.instagram.com/consent/', 'https://www.instagram.com/challenge/', 'https://instagram.com.example/consent/']) {
    await page.goto(target);
    assert.equal(await declineOptionalInstagramCookies(page), false);
    assert.equal(await page.evaluate(() => Boolean(window.unwanted)), false);
  }
});

test('an ambiguous optional-cookie click is never repeated', async () => {
  let clicks = 0;
  const button = { first() { return this; }, isVisible: async () => true, click: async () => { clicks++; throw new Error('private provider failure'); } };
  const page = { url: () => 'https://www.instagram.com/consent/', locator: () => ({ innerText: async () => 'Cookies' }), getByRole: () => button };
  await assert.rejects(declineOptionalInstagramCookies(page), e => e.status === 'cookie-choice-unconfirmed' && !e.message.includes('private'));
  assert.equal(clicks, 1);
});

test('cookie UI hydration is bounded and a newly appearing challenge still stops the click', async t => {
  const { page } = await fixture(t, '<div id="choice"></div><script>setTimeout(() => document.querySelector("#choice").innerHTML = \'<button onclick="window.chosen=true">Optionale Cookies ablehnen</button>\', 50)</script>');
  await page.goto('https://www.instagram.com/consent/');
  assert.equal(await declineOptionalInstagramCookies(page), true);
  assert.equal(await page.evaluate(() => window.chosen), true);
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
    '<div id="choice"></div><script>setTimeout(() => { history.replaceState(null,"","/challenge/"); document.querySelector("#choice").innerHTML = \'<button onclick="window.chosen=true">Decline optional cookies</button>\'; }, 50)</script>' }));
  await page.goto('https://www.instagram.com/consent/');
  assert.equal(await declineOptionalInstagramCookies(page), false);
  assert.equal(await page.evaluate(() => Boolean(window.chosen)), false);
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
