import { publicSearchUiState, tikTokAccessRefusal } from './tiktok-browser-search.js';

const origin = 'https://www.tiktok.com';
export const publicFormKeyword = 'wien essen';
const searchName = /^(?:suchen?|search|search tiktok|auf tiktok suchen)$/i;

export function priorTikTokFormPause(report, now = Date.now()) {
  const api = report.apiDiscovery;
  const failure = api?.lastFailure;
  // The direct scanner separately backs off on unclassified application errors.
  // A provider refusal, restriction on public posts or unknown cause remains binding.
  const onlyDirectError = failure?.code === 'provider-error' && failure?.status === 200
    && failure?.providerSignal === 'unclassified' && failure?.retryAfterProvided === false;
  const times = [api?.postVisitStop?.retryAt, report.searchDiscovery?.postVisitStop?.retryAt];
  if (!onlyDirectError || api?.lastSearchResponse?.retryAfterProvided === true) times.push(api?.nextRetryAt);
  const deadline = Math.max(0, ...times.map(time => Date.parse(time) || 0));
  return deadline > now ? new Date(deadline).toISOString() : null;
}

function pageKind(raw) {
  const url = new URL(raw);
  if (url.origin !== origin || url.username || url.password) return 'other-origin';
  if (/^\/(?:foryou\/?)?$/.test(url.pathname)) return 'home';
  if (/^\/search\/?$/.test(url.pathname)) {
    const queries = url.searchParams.getAll('q');
    return queries.length === 1 && queries[0] === publicFormKeyword ? 'expected-search' : 'other-search';
  }
  return 'other-page';
}

async function visiblePublicVideoLinks(page, keyword, limit, { home = false, exclude = [] } = {}) {
  return page.evaluate(({ keyword, limit, home, exclude }) => {
    const current = new URL(location.href);
    if (current.origin !== 'https://www.tiktok.com') return [];
    if (home ? !/^\/(?:foryou\/?)?$/.test(current.pathname)
      : (!/^\/search\/?$/.test(current.pathname) || current.searchParams.getAll('q').length !== 1
        || current.searchParams.get('q') !== keyword)) return [];
    const links = new Set();
    const ignore = new Set(exclude);
    for (const anchor of document.querySelectorAll('main a[href], [role="main"] a[href]')) {
      if (anchor.closest('nav,aside,footer,[role="navigation"],[role="complementary"]')
          || !anchor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let url;
      try { url = new URL(anchor.href, current); } catch { continue; }
      if (url.username || url.password || url.origin !== current.origin
          || !/^\/@[\w.-]{2,40}\/video\/\d{8,30}\/?$/.test(url.pathname)) continue;
      const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
      if (ignore.has(canonical)) continue;
      links.add(canonical);
      if (links.size >= limit) break;
    }
    return [...links];
  }, { keyword, limit, home, exclude });
}

export async function inspectTikTokPublicForm(page, { controlsMs = 12000, resultsMs = 25000 } = {}) {
  const start = Date.now();
  const result = { keyword: publicFormKeyword, stage: 'home', openerClicked: false, submissions: 0,
    documentStatuses: [], publicVideoLinks: [] };
  let documentRefused = false;
  function recordDocument(response) {
    const request = response.request();
    if (request.resourceType() !== 'document' || request.frame() !== page.mainFrame()) return;
    const status = response.status();
    const retryAfterProvided = Object.hasOwn(response.headers(), 'retry-after');
    if (status >= 400 || retryAfterProvided) documentRefused = true;
    if (result.documentStatuses.length < 8) result.documentStatuses.push({ status, retryAfterProvided });
  }
  function finish(outcome) {
    return { ...result, outcome, pageKind: pageKind(page.url()), elapsedMs: Date.now() - start };
  }
  async function guard() {
    if (documentRefused) return 'document-refusal';
    if (pageKind(page.url()) === 'other-origin') return 'other-origin';
    const refusal = await tikTokAccessRefusal(page);
    if (refusal) return refusal.transportReason;
    const dialog = page.locator('[role="dialog"], [role="alertdialog"], dialog[open]').filter({ visible: true });
    if (await dialog.filter({ hasText: /(?:log in|sign up|anmelden|registrieren|einloggen)/i }).count()) return 'login-dialog';
    if (await dialog.filter({ hasText: /(?:cookie|consent|zustimm|einwillig)/i }).count()) return 'consent-dialog';
    return null;
  }

  const searchBox = page.getByRole('searchbox', { name: searchName });
  const searchButton = page.getByRole('button', { name: searchName });
  const textInput = page.locator('input:not([type="password"]), textarea');
  const namedInput = searchBox.or(page.getByRole('combobox', { name: searchName }))
    .or(page.getByRole('textbox', { name: searchName })).or(page.locator('input[type="search"],input[name="q"]'))
    .and(textInput).filter({ visible: true });
  const opener = searchBox.or(searchButton).and(page.locator(':not(form button:not([type="button"]),[type="submit"],a[href],input,textarea)')).filter({ visible: true });
  const activatedInput = namedInput.or(page.getByRole('combobox').and(textInput).filter({ visible: true }));
  page.on('response', recordDocument);
  try {
    const document = await page.goto(origin + '/', { timeout: 20000, waitUntil: 'domcontentloaded' });
    if (!document) return finish('home-document-unavailable');
    let until = Date.now() + controlsMs;
    let field;
    do {
      const denied = await guard();
      if (denied) return finish(denied);
      if (pageKind(page.url()) !== 'home') return finish('unexpected-landing-page');
      const input = result.openerClicked ? activatedInput : namedInput;
      if (await input.count() === 1 && await input.isEditable()) {
        field = input;
        break;
      }
      if (!result.openerClicked && await opener.count() === 1) {
        result.openerClicked = true;
        await opener.click({ timeout: controlsMs });
        continue;
      }
      await page.waitForTimeout(150);
    } while (Date.now() < until);
    if (!field) return finish('public-search-controls-unavailable');
    result.stage = 'form';
    await field.fill(publicFormKeyword, { timeout: controlsMs });
    const denied = await guard();
    if (denied) return finish(denied);
    if (pageKind(page.url()) !== 'home' || await field.inputValue() !== publicFormKeyword) return finish('unexpected-form-state');
    const homeLinks = await visiblePublicVideoLinks(page, publicFormKeyword, 500, { home: true });
    result.submissions++;
    await field.press('Enter', { timeout: controlsMs });
    result.stage = 'results';
    until = Date.now() + resultsMs;
    do {
      let outcome;
      try {
        outcome = await guard();
        if (!outcome && pageKind(page.url()) === 'expected-search') {
          const state = await publicSearchUiState(page, publicFormKeyword);
          result.state = state;
          if (state.challenge) outcome = 'access-challenge';
          else if (state.loginRequired) outcome = 'login-wall';
          else if (!state.loadingIndicator) {
            const links = await visiblePublicVideoLinks(page, publicFormKeyword, 12, { exclude: homeLinks });
            if (links.length) {
              result.publicVideoLinks = links;
              outcome = 'visible-results';
            } else if (state.explicitEmpty) outcome = 'visible-no-results';
          }
        }
      } catch (error) {
        if (!/execution context was destroyed|because of a navigation/i.test(String(error))) throw error;
      }
      if (outcome) return finish(outcome);
      await page.waitForTimeout(200);
    } while (Date.now() < until);
    return finish(pageKind(page.url()) === 'expected-search' ? 'search-results-unverified' : 'search-page-not-reached');
  } catch {
    return finish(await guard().catch(() => null) || 'browser-interaction-unavailable');
  } finally {
    page.off('response', recordDocument);
  }
}
