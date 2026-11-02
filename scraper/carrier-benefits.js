import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { discoveryRejection } from './deal-discovery-policy.js';
import { sourceHttpError, sourceFailureFields } from './source-http-policy.js';

export const CARRIER_SOURCES = [
  { key:'drei-plus', source:'Drei Plus', membership:'Drei Kund:innen; angebotsspezifische Tarifvoraussetzungen', url:'https://www.drei.at/de/dreiplus/', distance:'Österreich' },
  { key:'magenta-moments', source:'Magenta Moments', membership:'Magenta Kund:innen mit Mein Magenta App und Moments-Teilnahme (ab 18)', url:'https://www.magenta.at/magenta-moments', distance:'Österreich' },
  { key:'a1-smile', source:'A1 Vorteilswelt', membership:'Berechtigte A1 Privatkund:innen; B.free nur bei ausgewählten Aktionen', url:'https://www.a1.net/treue', distance:'Österreich' },
  { key:'hot-vorteile', source:'HoT Vorteile', membership:'Angebotsspezifische Voraussetzungen von HoT', url:'https://www.hot.at/hot-fix/?tarif=vergleich', distance:'Österreich' },
];
const USER_AGENT = 'FreeFinderBenefitsBot/1.0 (+https://freefinder.at)';
const clean = value => String(value || '').normalize('NFC').replace(/\s+/g,' ').trim();
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const keyText = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const benefit = /\d+\s*\+\s*\d+|\d+\s*%|\b(?:gratis|kostenlos|geschenkt|Rabatt|Ersparnis|Gutschein)\b/i;
const concreteBenefit = /\d+\s*\+\s*\d+|\d+\s*%|\b(?:gratis|kostenlos|geschenkt)\b|\b\d+\s+.{0,35}zum Preis von\s+\d/i;
const forbiddenDrei = /\/(?:gewinnspiele|ersparnisse\/(?:hellocash|care01|autoscout24))(?:\/|$)/i;
const today = now => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vienna'}).format(now);
const PAUSE_PATH = new URL('../docs/carrier-benefit-pause.json', import.meta.url);

export function readCarrierPauses(file = PAUSE_PATH) {
  let state;
  try { state = JSON.parse(readFileSync(file)); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid carrier source pauses');
  for (const [origin, row] of Object.entries(state)) {
    if (!CARRIER_SOURCES.some(source => new URL(source.url).origin === origin)
        || !row || !Number.isFinite(Date.parse(row.retryAt))) throw new Error('Invalid carrier source pause');
  }
  return state;
}

export function recordCarrierPauses(state, file = PAUSE_PATH) {
  const merged = readCarrierPauses(file);
  for (const [origin, row] of Object.entries(state)) {
    if (!Number.isFinite(Date.parse(row.retryAt))) throw new Error('Invalid carrier source pause');
    if (!(Date.parse(merged[origin]?.retryAt) >= Date.parse(row.retryAt))) merged[origin] = row;
  }
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
}

export function isCarrierUrl(value, { robots = false } = {}) {
  try {
    const u = new URL(value);
    if (u.href !== value || u.protocol !== 'https:' || u.username || u.password || u.hash) return false;
    if (!CARRIER_SOURCES.some(s=>new URL(s.url).origin === u.origin)) return false;
    if (robots) return u.pathname === '/robots.txt' && !u.search;
    if (u.hostname === 'www.drei.at') return !u.search && !forbiddenDrei.test(u.pathname)
      && (/^\/de\/dreiplus\/$/.test(u.pathname)
        || /^\/de\/dreiplus\/(?:ersparnisse|services)\/[a-z0-9-]+\/$/.test(u.pathname)
        || /^\/de\/privat\/produkte-und-services\/(?:reiseschutz|mobilitaetsschutz)\/$/.test(u.pathname));
    return CARRIER_SOURCES.some(s=>s.url === value);
  } catch { return false; }
}

function textOf($, node) {
  const copy = node.clone();
  copy.find('script,style,noscript,nav,footer').remove();
  copy.find('p,li,br,h1,h2,h3').after(' ');
  return clean(copy.text());
}

export function parseDreiListing(html, url = CARRIER_SOURCES[0].url) {
  if (url !== CARRIER_SOURCES[0].url) throw new Error('Untrusted carrier listing');
  const $ = load(html), entries = new Map();
  $('.column-element__content').each((_, el) => {
    const node = $(el), brand = clean(node.find('.column-element__text h2').text()).replace(/\.$/,'');
    const offer = textOf($, node.find('.column-element__text p'));
    const href = node.find('.column-element__button a[href]').attr('href');
    if (!brand || !offer || !href || !benefit.test(offer)) return;
    const detail = new URL(href,url).href;
    if (isCarrierUrl(detail) && detail !== url) entries.set(detail,{ url:detail,brand,offer });
  });
  return [...entries.values()];
}

function expiry(text, now) {
  const ends = [...text.matchAll(/\bbis\s+(?:(?:zum|inkl\.?|einschließlich|inklusive)\s+)*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\b/gi)]
    .map(m=>`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  for (const value of ends) {
    const date = new Date(value+'T12:00:00Z');
    if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== value) return { reason:'invalid-source-date' };
  }
  const past = ends.filter(d=>d < today(now));
  if (past.length) return { reason: ends.some(d=>d >= today(now)) || /bis auf widerruf/i.test(text) ? 'conflicting-source-validity' : 'expired-benefit' };
  return { validUntil:ends.sort()[0] || '', expires:ends.sort()[0] || (/jeden|bis auf widerruf|regelmäßig/i.test(text) ? 'Regelmäßig / laut Anbieterbedingungen' : 'Gültigkeit laut Anbieter prüfen') };
}

function category(text) {
  if (/pizza|wrap|nordsee|lieferando|restaurant|speisen/i.test(text)) return 'essen';
  if (/kaffee|coffee|café|cafe|heißgetränk/i.test(text)) return 'kaffee';
  if (/fitness|cleverfit|padel|therme/i.test(text)) return 'fitness';
  if (/kino|museum|tussauds|belvedere|mumok|leopold|eintritt|ticket/i.test(text)) return 'kultur';
  if (/flixbus|übernachtung|hotel|reise/i.test(text)) return 'reisen';
  if (/stream|\btv\b|internet|software|app|daten/i.test(text)) return 'technik';
  return 'shopping';
}

function makeDeal(source, { url,brand,title,facts,scope='Österreich',dates={},identity='',viennaContext='' }, previous, now) {
  const old = previous.filter(d=>d.originSource === 'member-benefits-scraper' && d.url === url
    && (d.carrierProvider === source.key || (source.key === 'drei-plus' && String(d.id).startsWith('benefit-drei-plus-'))));
  const id = old.length === 1 ? old[0].id : `benefit-${source.key}-${fingerprint(url+'|'+identity).slice(0,16)}`;
  const membership = `Berechtigung: ${source.membership}. Die Voraussetzungen dieses Angebots gelten zusätzlich; ein Tarif im selben Mobilfunknetz genügt nicht automatisch. FreeFinder Pro ersetzt die Anbieterberechtigung nicht.`;
  const description = `${facts}\n\n${membership}`;
  const type = /\d+\s*\+\s*\d+/.test(title) ? 'bogo' : /gratis|kostenlos/i.test(title) ? 'gratis' : 'rabatt';
  return { id,brand,title,description,type,category:category(brand+' '+title),source:source.source,
    originSource:'member-benefits-scraper',carrierProvider:source.key,membershipRequired:source.membership,
    url,distance:scope,expires:dates.expires || 'Gültigkeit laut Anbieter prüfen',
    ...(dates.validUntil ? { validUntil:dates.validUntil } : {}),
    votes:0,hot:false,isNew:true,priority:4,qualityScore:65,needsReview:true,lastCheckedAt:now.toISOString(),
    reviewMissingFields:dates.validUntil ? [] : ['Ablauf'],
    evidence:{ type:'official-carrier-benefit',sourceUrl:url,provider:source.key,contentHash:fingerprint(description),checkedAt:now.toISOString(),
      ...(viennaContext ? {viennaContext} : {}) } };
}

export function parseDreiDetail(html, url, { previous = [], now = new Date() } = {}) {
  if (!isCarrierUrl(url) || new URL(url).hostname !== 'www.drei.at' || url === CARRIER_SOURCES[0].url) return {reason:'untrusted-benefit-url'};
  const $ = load(html), blocks = $('main .text-element');
  const primary = blocks.filter((_,e)=>$(e).find('h1').length === 1);
  if (primary.length !== 1 || !blocks.length) return {reason:'missing-carrier-detail-blocks'};
  const crumb = primary.children('p').first().clone(); crumb.find('a').remove();
  const brand = clean(crumb.text()).replace(/^\/\s*/,'');
  const bullets = primary.find('ul li').map((_,e)=>textOf($,$(e))).get();
  const offer = bullets.find(t=>concreteBenefit.test(t)) || textOf($, primary.find('p.text-primary'));
  const allText = textOf($,blocks);
  const factual = blocks.map((_,e)=>({text:textOf($,$(e)),primary:$(e).find('h1').length===1})).get()
    .filter(({text,primary})=>text && !/^Für alle, die noch mehr/i.test(text)
      && (primary || /\b(?:gültig|Widerruf|ausgenommen|Bedingungen?|Voraussetzung|Vertrag|Gutschein|SMS|Code|Aktion|kündig\w*)\b/i.test(text)))
    .map(({text})=>text);
  const facts = factual.join('\n\n');
  if (!brand || brand.length > 100 || !concreteBenefit.test(offer) || facts.length > 16000
      || !factual.some(t=>/gültig|ausgenommen|Voraussetzung|Vertrag|Gebühr|kündig|Widerruf|Code|SMS/i.test(t))) return {reason:'missing-offer-conditions'};
  const rejected = discoveryRejection({title:offer,description:facts});
  if (rejected) return {reason:rejected};
  if (/\/ars-electronica\/|\/joanneum\/|\/playworld\/|\/allegria\//.test(url)
      && !/\bWien\b/.test(facts)) return {reason:'regional-benefit-outside-vienna'};
  if (/\bgratis.*monat|monat.*gratis/i.test(offer) && !/danach|ab dem \d|monatlich.{0,30}(?:€|Euro)|(?:€|Euro).{0,30}monatlich/i.test(facts)) return {reason:'paid-follow-up-terms-missing'};
  const dates = expiry(facts,now); if (dates.reason) return dates;
  let title = `Drei: ${offer.replace(/gibt[’']?s /i,'')} (${brand})`;
  if (/\/pizza-mann\//.test(url)) {
    if (!/2\s*\+\s*1\s+Pizza gratis/i.test(facts)) return {reason:'pizza-quantity-unconfirmed'};
    title = 'Drei: donnerstags 2+1 Pizza gratis bei Pizza Mann';
  }
  if (/\/kinodonnerstag\//.test(url) && /2 Kinotickets zum Preis von 1/.test(facts) && /jeden Donnerstag/i.test(facts)) title = 'Drei: donnerstags 1+1 Kinotickets bei Cineplexx';
  if (/\/nordsee\//.test(url) && /2 Wraps zum Preis von 1/.test(facts) && /Thunfisch/.test(facts)) title = 'Drei: 1+1 Thunfisch-Wrap bei NORDSEE';
  if (/\/therme-wien\//.test(url) && /50\s*%/.test(facts) && /Mittwoch ab 18 Uhr/.test(facts)) title = 'Drei: mittwochs ab 18 Uhr 2. Thermenticket 50 % günstiger';
  if (/\/padelzone\//.test(url) && /25\s*%/.test(facts) && /10\s*%/.test(facts)) title = 'Drei: 10–25 % Rabatt auf 2 Stunden Padel (je nach Tag)';
  if (/\/flixbus\//.test(url) && /10\s*%/.test(facts)) title = 'Drei: 10 % Rabatt bei Buchung in der FlixBus-App';
  if (/Mindestlaufzeit von 6 Monaten/i.test(facts)) title = 'Drei: 10 Nachhilfestunden beim 6-Monatsvertrag gratis';
  if (title.length > 210) return {reason:'offer-title-needs-manual-review'};
  const scope = /\bWien\b|Wiener\b/.test(allText) ? 'Wien / teilnehmende Standorte laut Anbieter' : 'Österreich';
  const viennaContext = allText.match(/[^.!?]{0,100}(?:Standorten von Wien|Adresse:\s*[^.!?]{0,100}\bWien|Museum[^.!?]{0,80}\bWien|Therme Wien)[^.!?]{0,80}/i)?.[0] || '';
  return {deal:makeDeal(CARRIER_SOURCES[0],{url,brand,title,facts,dates,scope,viennaContext},previous,now)};
}

// Public teasers are not a complete app catalog and partner logos are not offers.
export function parseCarrierTeasers(html, source, { previous = [], now = new Date() } = {}) {
  const $ = load(html), deals=[], held=[];
  if (source.key === 'hot-vorteile') {
    const text = textOf($,$('main'));
    const start = text.indexOf('Nach erfolgreichem Abschluss der Rufnummernübertragung');
    const end = text.indexOf('Pro Person werden maximal 5 Gutscheine ausgegeben',start);
    if (start >= 0 && end > start) {
      const facts = text.slice(start,end+'Pro Person werden maximal 5 Gutscheine ausgegeben'.length)+'.';
      if (/HoT|HOFER/i.test(facts) && /10 Euro/i.test(facts) && /Buchung eines Tarifpakets/i.test(facts))
        deals.push(makeDeal(source,{url:source.url,brand:'HoT / HOFER',title:'10 € HOFER-Gutschein bei erster HoT-Portierung und Tarifbuchung',facts},previous,now));
    }
    if (!deals.length) held.push({reason:'expected-porting-offer-not-confirmed'});
  } else {
    const selector = source.key === 'a1-smile' ? 'h2,h3' : '.cmp-text';
    $(selector).each((_,e)=>{
      const node=$(e), text=textOf($,node);
      if (benefit.test(text)) {
        const context = source.key === 'a1-smile' ? node.closest('.inner,a1-teaser-card') : node;
        const sourceText = textOf($,context.length ? context : node);
        held.push({reason:discoveryRejection({title:text,description:sourceText}) || 'app-terms-or-specific-offer-not-public',
          preview:text.slice(0,180),sourceText:sourceText.slice(0,2500)});
      }
    });
  }
  return { deals, held, catalogCompleteness:'partial-public-only', appOnly:source.key !== 'hot-vorteile' };
}

export function createCarrierFetcher({ state={}, now=new Date(), fetchImpl=fetch,
  sleep=ms=>new Promise(r=>setTimeout(r,ms)), maxRequests=48, recordPause=()=>{} } = {}) {
  let requests=0, queue=Promise.resolve(); const robots=new Map();
  async function request(url) {
    if (requests >= maxRequests) throw new Error('Carrier request limit');
    requests++;
    await sleep(650);
    const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(12000),
      headers:{'user-agent':USER_AGENT,'accept-language':'de-AT,de;q=0.9'}});
    if (!response.ok) {
      await response.body?.cancel();
      if (new URL(url).pathname === '/robots.txt' && response.status === 404) return '';
      const error=sourceHttpError(response.status,response.headers.get('retry-after'),now);
      if ([401,403,429].includes(response.status)) {
        error.retryAt=new Date(Math.max(+now+86400000,Date.parse(error.retryAt)||0)).toISOString();
        state[new URL(url).origin]={retryAt:error.retryAt,httpStatus:response.status,checkedAt:now.toISOString()};
        recordPause(state);
      }
      throw error;
    }
    if (new URL(url).pathname !== '/robots.txt' && !/text\/html/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw new Error('Carrier response is not HTML');
    }
    let size=0;const chunks=[];
    for await(const part of response.body){size+=part.length;if(size>2500000)throw new Error('Carrier HTML limit');chunks.push(part);}
    return Buffer.concat(chunks).toString('utf8');
  }
  const fetchPage = url => {
    const job=queue.catch(()=>{}).then(async()=>{
      if (!isCarrierUrl(url)) throw new Error('Untrusted carrier URL');
      const origin=new URL(url).origin, retry=state[origin]?.retryAt;
      if (retry && !Number.isFinite(Date.parse(retry))) throw new Error('Invalid carrier source pause');
      if (Date.parse(retry)>+now) throw Object.assign(new Error('Carrier source cooldown'),{...state[origin]});
      if (!robots.has(origin)) robots.set(origin,robotsParser(origin+'/robots.txt',await request(origin+'/robots.txt')));
      if (robots.get(origin).isAllowed(url,USER_AGENT) === false) throw new Error('Carrier robots disallow');
      return { html:await request(url),finalUrl:url };
    });
    queue=job;return job;
  };
  return {fetchPage,state,get requests(){return requests;}};
}

export async function collectCarrierBenefits({ previous=[],live=[],now=new Date(),state={},fetchPage,
  maxDeals=80,sources=CARRIER_SOURCES } = {}) {
  const client=fetchPage ? null : createCarrierFetcher({state,now,recordPause:recordCarrierPauses});
  const get=fetchPage || client.fetchPage, deals=[], report=[];
  for (const source of sources) {
    const row={provider:source.key,source:source.source,url:source.url,checkedAt:now.toISOString(),
      pagesRead:0,discoveredDetails:0,verifiedCandidates:0,knownLive:0,newCandidates:0,rejected:[],errors:[],complete:false};
    try {
      const page=await get(source.url); row.pagesRead++;
      if (page.finalUrl && page.finalUrl !== source.url) throw new Error('Foreign carrier redirect');
      if (source.key === 'drei-plus') {
        const entries=parseDreiListing(page.html,source.url);row.discoveredDetails=entries.length;
        if (!entries.length) row.errors.push({reason:'empty-or-changed-public-benefit-index'});
        for (const entry of entries) {
          if (row.verifiedCandidates >= maxDeals) {row.errors.push({reason:'candidate-limit'});break;}
          try {
            const detail=await get(entry.url);row.pagesRead++;
            if (detail.finalUrl && detail.finalUrl !== entry.url) throw new Error('Foreign carrier redirect');
            const parsed=parseDreiDetail(detail.html,entry.url,{previous,now});
            if (parsed.deal) {deals.push(parsed.deal);row.verifiedCandidates++;}
            else row.rejected.push({url:entry.url,reason:parsed.reason});
          } catch(error) {
            row.errors.push({url:entry.url,error:error.message,...sourceFailureFields(error)});
            if ([401,403,429].includes(error.httpStatus) || error.retryAt || /limit|cooldown/i.test(error.message)) break;
          }
        }
        row.complete=entries.length>0 && row.errors.length===0 && row.pagesRead===entries.length+1;
      } else {
        const parsed=parseCarrierTeasers(page.html,source,{previous,now});
        deals.push(...parsed.deals);row.verifiedCandidates=parsed.deals.length;
        row.rejected=parsed.held;row.appCatalogOnly=parsed.appOnly;
      }
      const items=deals.filter(d=>d.carrierProvider===source.key);
      row.knownLive=items.filter(d=>live.some(old=>old.id===d.id || old.url===d.url)).length;
      row.newCandidates=items.length-row.knownLive;
      row.newToPending=items.filter(d=>!previous.some(old=>old.id===d.id || old.url===d.url)).length;
    } catch(error) {row.errors.push({url:source.url,error:error.message,...sourceFailureFields(error)});}
    row.status=row.errors.length ? 'incomplete-or-blocked' : row.complete ? 'public-index-processed' : 'partial-public-only';
    report.push(row);
  }
  return {deals,report:{checkedAt:now.toISOString(),complete:false,providers:report,requests:client?.requests ?? null},state};
}

let defaultClient;
export async function verifyCarrierBenefit(deal, {now=new Date(),fetchPage,cache=new Map()} = {}) {
  if (deal.evidence?.type !== 'official-carrier-benefit' && !deal.carrierProvider) return null;
  const source=CARRIER_SOURCES.find(s=>s.key===deal.carrierProvider);
  if (!source || !isCarrierUrl(deal.url) || new URL(source.url).origin !== new URL(deal.url).origin
      || deal.evidence?.type !== 'official-carrier-benefit' || deal.evidence.sourceUrl !== deal.url
      || deal.evidence.provider !== source.key) return {ok:false,reason:'untrusted-carrier-evidence'};
  const url=source.key==='drei-plus' ? deal.url : source.url;
  try {
    const get=fetchPage || (defaultClient ||= createCarrierFetcher({now,state:readCarrierPauses(),recordPause:recordCarrierPauses})).fetchPage;
    if (!cache.has('carrier:'+url)) cache.set('carrier:'+url,Promise.resolve().then(()=>get(url)));
    const page=await cache.get('carrier:'+url);
    if (page.finalUrl && page.finalUrl!==url) return {ok:false,reason:'foreign-carrier-redirect'};
    const current=source.key==='drei-plus' ? parseDreiDetail(page.html,url,{previous:[deal],now}).deal
      : parseCarrierTeasers(page.html,source,{previous:[deal],now}).deals.find(d=>d.id===deal.id);
    if (!current) return {ok:false,reason:'carrier-offer-not-current'};
    if (['brand','title','description','membershipRequired'].some(k=>clean(current[k])!==clean(deal[k])))
      return {ok:false,reason:'carrier-facts-or-conditions-changed'};
    return {ok:true,current:true,deal:current,
      ...(current.evidence.viennaContext ? {viennaBranchEvidence:current.evidence.viennaContext,branchEvidenceUrl:url} : {})};
  } catch(error) {return {ok:false,reason:error.message,...sourceFailureFields(error)};}
}
