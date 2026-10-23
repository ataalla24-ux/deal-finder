import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { discoveryRejection } from './deal-discovery-policy.js';
import { extractFoodExpiry } from './power-food-extraction.js';
import { sourceHttpError, sourceFailureFields } from './source-http-policy.js';

const ORIGIN = 'https://vorteilsclub.wien.at';
const clean = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const CATEGORIES = ['restaurants', 'kaffeehaeuser'];
const HELD = new Set(['dunkel-restaurant-vier-sinne_1', 'alt-wiener-schmankerl-reise-im-hotel-stefanie', 'feuerdorf', 'vino-wien', 'drei-boegen']);
export const CLUB_MEMBERSHIP = 'Kostenlose Mitgliedschaft im Vorteilsclub der Stadt Wien erforderlich (ab 16 Jahren, Wohnsitz in Österreich). Nicht durch FreeFinder Pro ersetzt.';

export function isViennaBenefitUrl(value, detail = true) {
  try {
    const url = new URL(value);
    return url.href === String(value) && url.origin === ORIGIN && !url.username && !url.password && !url.hash
      && (detail ? /^\/meine-vorteile\/[a-z0-9_-]+$/.test(url.pathname) && !url.search
        : url.pathname === '/meine-vorteile' && CATEGORIES.includes(url.searchParams.get('kategorien'))
          && [...url.searchParams.keys()].every(key => ['kategorien','p'].includes(key))
          && /^[1-8]$/.test(url.searchParams.get('p') || '1'));
  } catch { return false; }
}

export function parseViennaBenefitListing(html, pageUrl) {
  if (!isViennaBenefitUrl(pageUrl, false)) throw new Error('Untrusted benefit listing');
  const $ = load(html), links = new Set();
  $('.wm-card').each((_, card) => {
    if (!clean($(card).find('.benefit-card-info').text())) return;
    const href = $(card).find('.wm-card__heading a').attr('href');
    if (!href) return;
    const url = new URL(href, pageUrl).href;
    if (isViennaBenefitUrl(url)) links.add(url);
  });
  let pages = 1;
  $('a[href]').each((_, element) => {
    const url = new URL($(element).attr('href'), pageUrl);
    if (isViennaBenefitUrl(url.href, false) && url.searchParams.get('kategorien') === new URL(pageUrl).searchParams.get('kategorien'))
      pages = Math.max(pages, Number(url.searchParams.get('p')) || 1);
  });
  return { urls: [...links], pages };
}

export function parseViennaFoodBenefit(html, url, { now = new Date() } = {}) {
  if (!isViennaBenefitUrl(url)) return { reason: 'untrusted-benefit-url' };
  const slug = new URL(url).pathname.split('/').pop();
  if (HELD.has(slug)) return { reason: 'specialized-or-wine-focused-review' };
  const $ = load(html);
  $('script,style,noscript,svg').remove();
  const headings = $('h1.wm-stage__heading');
  const offerNodes = $('.wm-site-content .wm-text-background strong');
  const details = $('.wm-accordion__header').filter((_, e) => clean($(e).text()) === 'Details');
  if (headings.length !== 1 || offerNodes.length !== 1 || details.length !== 1) return { reason: 'ambiguous-benefit-page' };
  const brand = clean(headings.text()), offer = clean(offerNodes.text());
  const terms = clean(details.next('.wm-accordion__panel').text());
  const context = clean(offerNodes.closest('.wm-block').find('p').text());
  const addresses = [...new Set($('.wm-card--partner .wm-icon-text__content').map((_, e) => clean($(e).text())).get()
    .filter(value => /\b1(?:0[1-9]|1[0-9]|2[0-3])0\s+Wien\b/i.test(value)))];
  if (!brand || brand.length > 150 || !terms || terms.length > 2000 || addresses.length !== 1) return { reason: 'missing-benefit-facts' };
  if (!/speise|gericht|getränk|nudelbox|torte|kuchen|kaffee|coffee|café|sushi|burger|pizz(?:a|eri)|lebensmittel|bäckerei|gebäck|frühstück|küche|restaurant/i.test(`${brand} ${offer} ${terms} ${context}`)) return {reason:'not-food-benefit'};
  if (!/^20 Prozent Ermäßigung (?:auf (?:die (?:Einzelrechnung|Gesamtrechnung)|Take-Away-Bestellungen|Nudelboxen|eine Speise|Speisen und Getränke bei Abholung|Torten bei Abholung|gemischte Packungen)|jeden Dienstag auf alle Produkte)/.test(offer)) return { reason: 'unsupported-benefit' };
  if (!/mitglied|vorteilskarte/i.test(`${offer} ${terms}`)) return { reason: 'missing-membership-condition' };
  const dates = extractFoodExpiry(`${offer} ${terms}`, now);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
  if (dates.validUntil && dates.validUntil < today) return { reason:'expired-benefit' };
  const title = `20 % Rabatt bei ${brand} (Vorteilsclub)`;
  const description = `${offer}. ${terms} ${CLUB_MEMBERSHIP}`;
  if (discoveryRejection({ title, description })) return { reason:'excluded-benefit-content' };
  const contentHash = digest(JSON.stringify({ brand, offer, terms, address:addresses[0] }));
  return { deal: {
    id:`benefit-vienna-food-${digest(url).slice(0,16)}`, brand, title, description,
    category:'essen', type:'rabatt', source:'Vorteilsclub der Stadt Wien', originSource:'vienna-food-benefits', url,
    address:addresses[0], distance:addresses[0], city:'Wien', votes:0, hot:false, isNew:true, priority:4, qualityScore:70,
    membershipRequired:'Vorteilsclub der Stadt Wien (kostenlos, ab 16, Wohnsitz Österreich)',
    expires:dates.validUntil || 'Enddatum nicht angegeben; aktuelle Bedingungen beim Anbieter prüfen',
    ...(dates.validUntil ? {validUntil:dates.validUntil} : {}), ...(dates.validFrom ? {validFrom:dates.validFrom} : {}),
    needsReview:true, reviewMissingFields:dates.validUntil ? [] : ['Ablauf'],
    lastCheckedAt:now.toISOString(),
    evidence:{ type:'official-vienna-food-benefit', sourceUrl:url, contentHash, offerText:offer, terms, checkedAt:now.toISOString() },
  } };
}

// One polite direct-request lane, also shared by concurrent Slack verification.
let nextRequest = Promise.resolve();
let blockedUntil = 0;
const PAUSE_PATH = new URL('../docs/vienna-food-benefit-pause.json', import.meta.url);
export function readViennaFoodPause(file = PAUSE_PATH) {
  try {
    const {retryAt} = JSON.parse(readFileSync(file));
    if (!retryAt) return 0;
    if (typeof retryAt !== 'string') throw new Error('Invalid benefit source pause');
    const parsed = Date.parse(retryAt);
    if (!Number.isFinite(parsed)) throw new Error('Invalid benefit source pause');
    return parsed;
  } catch(error) { if(error.code==='ENOENT') return 0; throw error; }
}
export function recordViennaFoodPause(error, file = PAUSE_PATH) {
  const retryAt = Date.parse(error.retryAt);
  if (!Number.isFinite(retryAt)) throw new Error('Missing benefit source pause');
  if (readViennaFoodPause(file) >= retryAt) return;
  writeFileSync(file, JSON.stringify({retryAt:new Date(retryAt).toISOString(),httpStatus:error.httpStatus || 0,checkedAt:new Date().toISOString()},null,2)+'\n');
}
function savedCooldown() {
  try {
    const value = JSON.parse(readFileSync(new URL('../docs/deals-pending-member-benefits.json', import.meta.url))).viennaFoodReport?.retryAt;
    if (!value) return 0;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error('Invalid benefit source pause');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}
export function fetchViennaBenefitPage(url, { sleep = ms => new Promise(r => setTimeout(r,ms)), fetchImpl = fetch, recordPause = recordViennaFoodPause } = {}) {
  if (!isViennaBenefitUrl(url) && !isViennaBenefitUrl(url,false)) return Promise.reject(new Error('Untrusted benefit URL'));
  const request = nextRequest.catch(() => {}).then(async () => {
    const pause = Math.max(blockedUntil, savedCooldown(), readViennaFoodPause());
    if (pause > Date.now()) throw Object.assign(new Error('Benefit source cooldown'), { retryAt:new Date(pause).toISOString() });
    await sleep(650);
    const response = await fetchImpl(url,{ redirect:'manual', signal:AbortSignal.timeout(10000), headers:{ 'user-agent':'FreeFinder/1.0 (+https://freefinder.at)', 'accept-language':'de-AT,de;q=0.9' } });
    if (!response.ok) {
      await response.body?.cancel();
      const error = sourceHttpError(response.status,response.headers.get('retry-after'));
      if ([401,403,429].includes(response.status) || error.retryAt) {
        blockedUntil = Math.max(Date.now()+86400000,Date.parse(error.retryAt)||0);
        error.retryAt = new Date(blockedUntil).toISOString();
        recordPause(error);
      }
      throw error;
    }
    if (!/text\/html/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('Benefit response is not HTML'); }
    let size=0; const chunks=[];
    for await (const value of response.body) { size+=value.length; if(size>2500000) throw new Error('Benefit HTML limit'); chunks.push(value); }
    return { html:Buffer.concat(chunks).toString('utf8'), finalUrl:url };
  });
  nextRequest=request;
  return request;
}

export async function collectViennaFoodBenefits({ now = new Date(), fetchPage = fetchViennaBenefitPage, maxDeals = 80 } = {}) {
  const urls=new Set(), deals=[], rejected=[], errors=[]; let requests=0, limited=false, attemptedUrl='';
  const limit=Number.isFinite(Number(maxDeals)) ? Math.min(80,Math.max(0,Math.floor(Number(maxDeals)))) : 0;
  try {
    for (const category of CATEGORIES) {
      let pages=1;
      for (let page=1;page<=pages;page++) {
        if (requests>=16) { limited=true; break; }
        const url=`${ORIGIN}/meine-vorteile?kategorien=${category}&p=${page}`;
        attemptedUrl=url;
        requests++;
        const {html}=await fetchPage(url);
        const parsed=parseViennaBenefitListing(html,url);
        pages=parsed.pages;
        for (const value of parsed.urls) urls.add(value);
      }
    }
    // The existing per-source cap remains 80. Rotate the bounded detail set so
    // entries late in the listing are not permanently starved.
    const sorted=[...urls].sort();
    const offset=sorted.length ? Math.floor(now.getTime()/86400000)%sorted.length : 0;
    const rotated=[...sorted.slice(offset),...sorted.slice(0,offset)];
    for (const url of rotated) {
      if (requests>=96 || deals.length>=limit) { limited=true; break; }
      requests++;
      attemptedUrl=url;
      const {html}=await fetchPage(url);
      const parsed=parseViennaFoodBenefit(html,url,{now});
      if (parsed.deal) deals.push(parsed.deal); else rejected.push({url,reason:parsed.reason});
    }
  } catch(error) { errors.push({source:'Vorteilsclub der Stadt Wien', url:attemptedUrl, error:error.message, ...sourceFailureFields(error)}); }
  return { deals, report:{checkedAt:now.toISOString(), discovered:urls.size, checked:deals.length+rejected.length, accepted:deals.length, requests,limited,rejected,errors,retryAt:errors.find(error=>error.retryAt)?.retryAt || ''} };
}

export async function verifyViennaFoodBenefit(deal, { now = new Date(), cache = new Map(), fetchPage = fetchViennaBenefitPage } = {}) {
  if (deal.originSource !== 'vienna-food-benefits') return null;
  if (!isViennaBenefitUrl(deal.url)) return {ok:false,reason:'untrusted-benefit-url'};
  const key=`vienna-benefit|${deal.url}`;
  if(!cache.has(key)) cache.set(key,fetchPage(deal.url).catch(()=>null));
  const page=await cache.get(key);
  if(!page || page.finalUrl && page.finalUrl !== deal.url) return {ok:false,reason:'benefit-source-unavailable'};
  const match=parseViennaFoodBenefit(page.html,deal.url,{now}).deal;
  if(!match || ['brand','title','description'].some(field=>match[field]!==deal[field]) || match.evidence.contentHash!==deal.evidence?.contentHash || match.membershipRequired!==deal.membershipRequired)
    return {ok:false,reason:'benefit-not-on-current-page'};
  return {ok:true,current:true,deal:match};
}
