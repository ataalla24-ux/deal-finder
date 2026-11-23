import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { load } from 'cheerio';
import { readPowerBrowserPage } from '../scraper/power-browser-page.js';
import { crawlFoodSource } from '../scraper/power-food-crawler.js';
import { POWER_FOOD_SOURCES } from '../scraper/power-food-sources.js';

const source = POWER_FOOD_SOURCES.find(row => row.name === 'Burger King');
const ready = 'main [data-testid="static-page"]';
const readiness = { renderReadySelector: ready, renderReadyHeading: 'BURGER KING App', renderReadySection: 'Rewards & Coupons' };
const actual = fs.readFileSync(new URL('./fixtures/power-bkapp-rendered.html', import.meta.url), 'utf8');
const shell = '<noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div>';

async function fixture(t, body, status = 200) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  // Any unhandled request fails locally, including accidental redirects/assets.
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [];
  await context.route('**/*', route => {
    requests.push(route.request().url());
    assert.equal(route.request().url(), source.url);
    return route.fulfill({ status, contentType: 'text/html', body });
  });
  return { page, requests };
}

test('waits for delayed actual BK main content in the same navigation', async t => {
  const { page, requests } = await fixture(t, shell + '<script>setTimeout(() => document.querySelector("#root").innerHTML = ' + JSON.stringify(actual) + ', 160)</script>');
  const result = await readPowerBrowserPage(page, source.url, { ...readiness, timeoutMs: 1800 });
  const $ = load(result.html);
  assert.equal($(ready).find('h1').length, 1, 'the DOM must contain the rendered offer area, not only a script template');
  assert.match($(ready).text(), /Rewards & Coupons/);
  assert.equal(result.finalUrl, source.url);
  assert.deepEqual(requests, [source.url]);
});

for (const [name, html] of [
  ['empty React shell', shell],
  ['cookie dialog without page content', shell + '<dialog open><h1>Datenschutz</h1><p>Alle Cookies akzeptieren oder Cookie-Einstellungen ändern. Mehr Informationen zur Verwendung von Cookies auf dieser Website.</p></dialog>'],
  ['hidden template', '<div style="display:none">' + actual + '</div>'],
  ['loading heading without loaded body', '<main><div data-testid="static-page"><h1>App</h1><p>Laden …</p></div></main>'],
  ['login inside the same main template', '<main><div data-testid="static-page"><h1>Anmeldung erforderlich</h1><p>Bitte melde dich an, um die Seite aufzurufen. Gib deine registrierte E-Mail-Adresse und dein Passwort ein, um fortzufahren und dein Konto zu öffnen.</p><form><input type="password"></form></div></main>'],
  ['authentication over the real landing page', actual + '<form><input type="password"></form>'],
  ['maintenance page with substantial text', actual.replace(/<h1>[\s\S]*?<\/h1>/, '<h1>Wartungsarbeiten</h1>')],
  ['app heading before its actual content section loads', actual.replace(/Rewards &amp; Coupons/g, 'Laden …')],
]) {
  test(`${name} is a read failure, never a healthy no-offers result`, async t => {
    const { page, requests } = await fixture(t, html);
    const result = await crawlFoodSource(source, {
      maxPages: 1,
      fetchPage: async () => ({ html: shell, finalUrl: source.url }),
      renderPage: url => readPowerBrowserPage(page, url, { ...readiness, timeoutMs: 220 }),
    });
    assert.equal(result.status, 'error');
    assert.equal(result.operationalStatus, 'degraded');
    assert.match(result.error, /browser-render-incomplete/);
    assert.equal(result.deals, 0);
    assert.deepEqual(requests, [source.url]);
  });
}

test('actual readable BK app copy has zero concrete offers and does not invent one', async t => {
  const { page, requests } = await fixture(t, actual);
  const result = await crawlFoodSource(source, {
    maxPages: 1,
    fetchPage: async () => ({ html: shell, finalUrl: source.url }),
    renderPage: url => readPowerBrowserPage(page, url, { ...readiness, timeoutMs: 1000 }),
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.operationalStatus, 'no-offers');
  assert.equal(result.deals, 0);
  assert.deepEqual(requests, [source.url]);
});

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} still stops before waiting or following another URL`, async t => {
    const { page, requests } = await fixture(t, actual, status);
    await assert.rejects(readPowerBrowserPage(page, source.url, { ...readiness, timeoutMs: 500 }), error => error.httpStatus === status);
    assert.deepEqual(requests, [source.url]);
  });
}

test('an already refused initial fetch never invokes the renderer', async () => {
  let renders = 0;
  const result = await crawlFoodSource(source, {
    fetchPage: async () => { throw Object.assign(new Error('HTTP 403'), { httpStatus: 403 }); },
    renderPage: async () => { renders++; throw new Error('must not render'); },
  });
  assert.equal(result.status, 'error');
  assert.equal(renders, 0);
});

test('unconfigured browser fallbacks retain their existing read behavior and byte cap', async t => {
  const { page } = await fixture(t, '<main>Normal server-rendered page</main>');
  const result = await readPowerBrowserPage(page, source.url, { maxBytes: 30, timeoutMs: 500 });
  assert.equal(result.bytes, 30);
});

test('BK readiness is configured only for its existing landing page', () => {
  assert.equal(source.renderReadySelector, ready);
  assert.equal(source.renderReadyHeading, readiness.renderReadyHeading);
  assert.equal(source.renderReadySection, readiness.renderReadySection);
  assert.equal(POWER_FOOD_SOURCES.filter(row => row.renderReadySelector).length, 1);
});

test('render readiness uses only the remaining navigation timeout', async () => {
  let remaining;
  await readPowerBrowserPage({
    goto: async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return { status: () => 200 };
    },
    waitForFunction: async (predicate, selector, options) => { remaining = options.timeout; },
    content: async () => actual,
    url: () => source.url,
  }, source.url, { ...readiness, timeoutMs: 500 });
  assert.ok(remaining > 0 && remaining <= 480, 'does not add a second full timeout');
});
