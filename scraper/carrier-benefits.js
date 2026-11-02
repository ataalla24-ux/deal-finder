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
export const CARRIER_DETAIL_SOURCES = {
  'magenta-moments': [
    'https://www.megaplex.at/inhalt/magenta-moments',
    'https://www.magenta.at/meinmagenta-webview/tv/tv-mini',
  ],
};
const CARRIER_ORIGINS = new Set([...CARRIER_SOURCES.map(source=>new URL(source.url).origin),
  ...Object.values(CARRIER_DETAIL_SOURCES).flat().map(url=>new URL(url).origin)]);
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
    if (!CARRIER_ORIGINS.has(origin)
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
    if (!CARRIER_ORIGINS.has(u.origin)) return false;
    if (robots) return u.pathname === '/robots.txt' && !u.search;
    if (Object.values(CARRIER_DETAIL_SOURCES).flat().includes(value)) return true;
    if (u.hostname === 'www.drei.at') return !u.search && !forbiddenDrei.test(u.pathname)
      && (/^\/de\/dreiplus\/$/.test(u.pathname)
        || /^\/de\/dreiplus\/(?:ersparnisse|services)\/[a-z0-9-]+\/$/.test(u.pathname)
        || /^\/de\/privat\/produkte-und-services\/(?:reiseschutz|mobilitaetsschutz)\/$/.test(u.pathname));
    return CARRIER_SOURCES.some(s=>s.url === value);
  } catch { return false; }
}

export function carrierBenefitPostKey(deal = {}) {
  // Slack history retains IDs/URLs but not custom evidence fields.
  const id=String(deal.id || '');
  return deal.url===CARRIER_SOURCES[2].url && /^benefit-a1-smile-[a-f0-9]{16}$/.test(id)
    ? `carrier-offer:${id}` : '';
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
  if (/pizza|wrap|nordsee|lieferando|foodora|restaurant|speisen/i.test(text)) return 'essen';
  if (/kaffee|coffee|café|cafe|heißgetränk/i.test(text)) return 'kaffee';
  if (/fitness|clever\s*fit|padel|therme/i.test(text)) return 'fitness';
  if (/hundetraining/i.test(text)) return 'freizeit';
  if (/kino|museum|tussauds|belvedere|mumok|leopold|eintritt|ticket/i.test(text)) return 'kultur';
  if (/flixbus|übernachtung|hotel|reise/i.test(text)) return 'reisen';
  if (/stream|\btv\b|internet|wlan|haushaltsgeräte|software|app|daten/i.test(text)) return 'technik';
  return 'shopping';
}

function makeDeal(source, { url,brand,title,facts,scope='Österreich',dates={},identity='',viennaContext='',missing=[] }, previous, now) {
  const old = previous.filter(d=>d.originSource === 'member-benefits-scraper' && d.url === url
    && (!identity || d.carrierOfferKey === identity)
    && (d.carrierProvider === source.key || (source.key === 'drei-plus' && String(d.id).startsWith('benefit-drei-plus-'))));
  const id = old.length === 1 ? old[0].id : `benefit-${source.key}-${fingerprint(url+'|'+identity).slice(0,16)}`;
  const membership = `Berechtigung: ${source.membership}. Die Voraussetzungen dieses Angebots gelten zusätzlich; ein Tarif im selben Mobilfunknetz genügt nicht automatisch. FreeFinder Pro ersetzt die Anbieterberechtigung nicht.`;
  const description = `${facts}\n\n${membership}`;
  const type = /\d+\s*\+\s*\d+/.test(title) ? 'bogo' : /gratis|kostenlos/i.test(title) ? 'gratis' : 'rabatt';
  return { id,brand,title,description,type,category:category(brand+' '+title),source:source.source,
    originSource:'member-benefits-scraper',carrierProvider:source.key,...(identity ? {carrierOfferKey:identity} : {}),membershipRequired:source.membership,
    url,distance:scope,expires:dates.expires || 'Gültigkeit laut Anbieter prüfen',
    ...(dates.validUntil ? { validUntil:dates.validUntil } : {}),
    votes:0,hot:false,isNew:true,priority:4,qualityScore:65,needsReview:true,lastCheckedAt:now.toISOString(),
    reviewMissingFields:[...(dates.validUntil ? [] : ['Ablauf']),...missing],
    ...(missing.length ? {missingFields:missing} : {}),
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

function a1PublicOffer($, node, source, previous, now) {
  const heading=clean(node.text()), box=node.closest('.inner,a1-teaser-card');
  if (!box.length || box.find('h2,h3').length !== 1) return null;
  const body=textOf($,box.find('p'));
  const text=`${heading} ${body}`;
  if (discoveryRejection({title:heading,description:body})) return null;
  const discount=heading.match(/(?:^|[\s–-])(\d{1,2})\s*%/);
  if(discount && !(Number(discount[1])>0 && Number(discount[1])<100)) return null;
  let title, facts, identity;
  const missing=['Aktuelle Freischaltung und zusätzliche Anbieterbedingungen'];
  if (/^A1 Mesh WLAN Set jetzt \d+% günstiger$/.test(heading)) {
    const prices=body.match(/€\s*(\d+(?:[,.]\d{1,2})?)[,.-]*\s+statt\s*€\s*(\d+(?:[,.]\d{1,2})?)/);
    if (!prices || !discount) return null;
    const price=Number(prices[1].replace(',','.')), reference=Number(prices[2].replace(',','.'));
    if (!(price>0 && reference>price) || Math.round(100*(1-price/reference))!==Number(discount[1])) return null;
    title=`A1: Mesh WLAN Set für ${prices[1]} € statt ${prices[2]} €`;
    facts=`A1 bewirbt das Mesh WLAN Set in seiner Vorteilswelt für ${prices[1]} Euro statt ${prices[2]} Euro (${discount[1]} % Rabatt). Vor der Bestellung im verlinkten A1 Angebot prüfen, ob der Vorteil für den eigenen Anschluss verfügbar ist und welche Bestell- und Lieferbedingungen gelten. Die öffentliche Vorteilskarte enthält kein Enddatum.`;
    identity='a1-mesh-wlan-set';
  } else if (/ausgewählte Bosch Haushaltsgeräte/.test(heading) && discount
      && new RegExp(`${discount[1]}\\s*%\\s*Rabatt`,'i').test(body)) {
    title=`A1: ${discount[1]} % auf ausgewählte Bosch-Haushaltsgeräte`;
    facts=`Die A1 Vorteilswelt nennt ${discount[1]} % Rabatt auf ausgewählte Bosch-Haushaltsgeräte. Nicht das gesamte Bosch-Sortiment ist gemeint. Die konkrete Geräteauswahl, Freischaltung und Einlösung vor dem Einkauf im Bereich Vorteile der Mein A1 App prüfen. Auf der öffentlichen Vorteilskarte fehlen eine vollständige Produktliste und ein Enddatum.`;
    identity='a1-bosch-selected-appliances';
    missing.push('Produktsortiment in der Mein A1 App');
  } else if (/foodora PRO 3-Monatsplan/i.test(heading) && discount
      && /foodora PRO/i.test(body) && new RegExp(`${discount[1]}\\s*%\\s*Rabatt`,'i').test(body)) {
    title=`A1: ${discount[1]} % Rabatt auf den foodora-PRO-3-Monatsplan`;
    facts=`A1 bewirbt ${discount[1]} % Rabatt auf den kostenpflichtigen foodora-PRO-3-Monatsplan. Es handelt sich nicht um drei kostenlose Monate und nicht um FreeFinder Pro. Die Freischaltung, den tatsächlichen Gesamtpreis sowie eine mögliche Verlängerung, Folgekosten und Kündigungsbedingungen vor Abschluss in der Mein A1 App beziehungsweise bei foodora prüfen. Die öffentliche Vorteilskarte nennt diese Vertragsdetails und ein Enddatum nicht.`;
    identity='a1-foodora-pro-three-months';
    missing.push('Gesamtpreis, Verlängerung und Kündigung bei foodora');
  } else if (/Hundetraining\.me/.test(heading) && discount && /Premium-Jahresabo/i.test(body) && /online/i.test(body)
      && new RegExp(`${discount[1]}\\s*%\\s*Rabatt`,'i').test(body)) {
    title=`A1: ${discount[1]} % auf das Hundetraining.me-Premium-Jahresabo`;
    facts=`In der A1 Vorteilswelt werden ${discount[1]} % Rabatt auf das kostenpflichtige Premium-Jahresabo von Hundetraining.me beworben. Das Training wird online angeboten. Freischaltung und Einlösung erfolgen über den Vorteile-Bereich der Mein A1 App. Vor Abschluss den Gesamtpreis, die Verlängerung und Kündigungsbedingungen beim Anbieter prüfen; diese Angaben und ein Enddatum sind auf der öffentlichen Vorteilskarte nicht enthalten.`;
    identity='a1-hundetraining-premium-annual';
    missing.push('Gesamtpreis, Verlängerung und Kündigung beim Anbieter');
  }
  if (!identity || !box.find('a[href]').length) return null;
  const dates=expiry(text,now); if (dates.reason) return null;
  const deal=makeDeal(source,{url:source.url,brand:identity.includes('bosch')?'Bosch':identity.includes('foodora')?'foodora':identity.includes('hundetraining')?'Hundetraining.me':'A1',
    title,facts,identity,dates,missing},previous,now);
  deal.evidence.publicOfferOnly=true;
  deal.evidence.offerHeading=heading;
  return deal;
}

export function parseCarrierDetail(html, url, provider, {previous=[],now=new Date()}={}) {
  const source=CARRIER_SOURCES.find(row=>row.key===provider);
  if (!source || !(CARRIER_DETAIL_SOURCES[provider] || []).includes(url)) return {deals:[],held:[{reason:'untrusted-provider-detail'}]};
  const $=load(html), held=[], deals=[];
  if (url==='https://www.megaplex.at/inhalt/magenta-moments') {
    const heading=$('h1.main-content-title');
    const article=heading.parent().find('.editor-content');
    const text=textOf($,article);
    if (heading.length!==1 || article.length!==1 || !/Magenta Moments: Kinotickets 1\+1 gratis/.test(clean(heading.text()))
        || !/Jeden Dienstag für Magenta Moments Mitglieder 1\+1 Kinoticket gratis in allen Hollywood Megaplex und im Metropol Kino/.test(text)
        || !/Vollpreis-Ticket/.test(text) || !/QR Code vor dem Bezahlvorgang direkt an der Kinokassa/.test(text)
        || !/nicht für Sondervorstellungen/.test(text) || !/nicht mit anderen Rabatten und Aktionen kombinierbar/.test(text))
      return {deals,held:[{url,reason:'cinema-conditions-not-confirmed'}]};
    const dates=expiry(text,now);if(dates.reason)return {deals,held:[{url,reason:dates.reason}]};
    const vienna=$('a[href]').filter((_,el)=>['/kinoprogramm/gasometer','/kinoprogramm/scn'].includes($(el).attr('href'))
      && /^Wien (?:Gasometer|SCN)$/.test(clean($(el).text()))).map((_,el)=>clean($(el).text())).get();
    if(!vienna.length)return {deals,held:[{url,reason:'vienna-cinema-participation-unconfirmed'}]};
    let facts='Für Magenta-Moments-Mitglieder gibt es dienstags beim Kauf eines Vollpreis-Kinotickets ein zweites Ticket gratis. Der persönliche QR-Code muss vor dem Bezahlen an der Kinokassa vorgezeigt werden. Die Aktion gilt in allen Hollywood-Megaplex-Kinos sowie im Metropol Kino, darunter die auf der offiziellen Seite aufgeführten Wiener Kinos. Sondervorstellungen sind ausgeschlossen. Eine Kombination mit anderen Rabatten oder Aktionen ist nicht möglich. Gültig bis auf Widerruf; aktuelle Freischaltung und QR-Code in der Mein Magenta App unter Moments prüfen.';
    if(/an allen anderen Tagen gibt es 20% Rabatt auf den Ticketvollpreis/i.test(text)) facts+=' An Tagen außer Dienstag nennt der Anbieter außerdem 20 % Rabatt auf den regulären Ticketpreis.';
    if(/an allen Tagen 10% Rabatt auf den gesamten Einkauf am Kinobuffet/.test(text)) facts+=' Für jeden Wochentag wird zusätzlich ein Kinobuffet-Rabatt von 10 % auf den gesamten Einkauf genannt.';
    const deal=makeDeal(source,{url,brand:'Hollywood Megaplex / Metropol',title:'Dienstags 1+1 Kinotickets für Magenta-Moments-Mitglieder',facts,dates,
      scope:'Wien / teilnehmende Hollywood-Megaplex-Kinos',identity:'magenta-megaplex-cinema',viennaContext:vienna.join(', ')},previous,now);
    const legacy=[...new Map(previous.filter(row=>String(row.id).startsWith('benefit-magenta-moments-')
      && row.url===source.url && /1\s*\+\s*1/.test(row.title) && /kino/i.test(row.title)).map(row=>[row.id,row])).values()];
    if(legacy.length===1)deal.id=legacy[0].id;
    deals.push(deal);
  } else {
    const paragraphs=[...new Set($('p').map((_,el)=>textOf($,$(el))).get())];
    const terms=paragraphs.filter(text=>/^\*{0,2}\s*Gültig bis auf Widerruf bei Neuanmeldung von TV Mini mit Magenta Moments Code\./.test(text));
    const prices=[...new Set(terms.map(text=>text.match(/Ab dem 4\. Monat €\s*(\d+,\d{2})\s*mtl\. Grundgebühr/)?.[1]).filter(Boolean))];
    const allText=textOf($,$('.cmp-text'));
    if(!$('h1').text().includes('TV Mini') || !/3 Monate TV Mini geschenkt/.test(allText) || prices.length!==1
        || !terms.length || terms.some(text=>!text.includes(`Ab dem 4. Monat € ${prices[0]} mtl. Grundgebühr`))
        || !terms.every(text=>/Magenta Internetzugang \(exkl\. KLAX\) erforderlich/.test(text) && /Unternehmer:innen sind vom Angebot ausgeschlossen/.test(text))
        || !/Innerhalb von Österreich im Netz von Magenta nutzbar/.test(allText)
        || !/nicht mit anderen Aktionen\/bestehenden Rabatten kombinierbar/.test(allText)
        || !/ohne Bindung\s*jederzeit kündigen/.test(allText)) return {deals,held:[{url,reason:'tv-mini-price-or-terms-unconfirmed'}]};
    const box=paragraphs.find(text=>/^TV Box:/.test(text) && /3 Monaten Mindestvertragsdauer/.test(text));
    const boxPrice=box?.match(/zzgl\. € (\d+(?:,\d{2})?) mtl\./)?.[1];
    if(!boxPrice)return {deals,held:[{url,reason:'optional-tv-box-terms-unconfirmed'}]};
    const dates=expiry(terms.join(' '),now);if(dates.reason)return {deals,held:[{url,reason:dates.reason}]};
    const facts=`Berechtigte Privatkunden erhalten bei einer Neuanmeldung von Magenta TV Mini mit ihrem persönlichen Magenta-Moments-Code die ersten drei Monate ohne Grundgebühr. Danach werden ab dem vierten Monat ${prices[0]} Euro Grundgebühr pro Monat verrechnet. Voraussetzung sind ein geeigneter Magenta-Internetzugang (KLAX ausgenommen), technische Verfügbarkeit, ein kompatibles Gerät und ein Mein-Magenta-Zugang. Das Angebot ist innerhalb Österreichs im Magenta-Netz nutzbar; verbrauchtes Datenvolumen wird nach dem bestehenden Internettarif verrechnet. Unternehmen sind ausgeschlossen. Den Code zunächst in Moments freischalten und bei der TV-Mini-Bestellung eingeben. Das TV-Produkt ist ohne Bindung kündbar; eine optional mitbestellte TV Box kostet zusätzlich ${boxPrice} Euro monatlich und hat drei Monate Mindestvertragsdauer. Nicht mit anderen Aktionen oder bestehenden Rabatten kombinierbar. Es gelten die Anbieter-AGB und Entgeltbestimmungen einschließlich Wertsicherung. Gültig bis auf Widerruf. Kein FreeFinder-Abo; vor Abschluss die Vertragsbedingungen beim Anbieter prüfen.`;
    deals.push(makeDeal(source,{url,brand:'Magenta TV Mini',title:`Magenta: TV Mini 3 Monate gratis, danach ${prices[0]} €/Monat`,facts,dates,identity:'magenta-tv-mini-three-months'},previous,now));
  }
  return {deals,held};
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
        if (source.key==='a1-smile') {
          const deal=a1PublicOffer($,node,source,previous,now);
          if(deal){deals.push(deal);return;}
        }
        const context = source.key === 'a1-smile' ? node.closest('.inner,a1-teaser-card') : node;
        const sourceText = textOf($,context.length ? context : node);
        held.push({reason:discoveryRejection({title:text,description:sourceText}) || 'app-terms-or-specific-offer-not-public',
          preview:text.slice(0,180),sourceText:sourceText.slice(0,2500)});
      }
    });
  }
  const unique=new Map(), conflicted=new Set();
  for(const deal of deals){
    if(unique.has(deal.id) && unique.get(deal.id).evidence.contentHash!==deal.evidence.contentHash)conflicted.add(deal.id);
    unique.set(deal.id,deal);
  }
  for(const id of conflicted){held.push({reason:'conflicting-public-carrier-offer',id});unique.delete(id);}
  return { deals:[...unique.values()], held, catalogCompleteness:'partial-public-only', appOnly:source.key !== 'hot-vorteile' };
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
  const identities=[...new Map([...live,...previous].map(deal=>[deal.id,deal])).values()];
  for (const source of sources) {
    const row={provider:source.key,source:source.source,url:source.url,checkedAt:now.toISOString(),
      pagesRead:0,discoveredDetails:0,verifiedCandidates:0,knownLive:0,newCandidates:0,rejected:[],errors:[],complete:false,
      fullCatalogRequiresApp:['magenta-moments','a1-smile'].includes(source.key)};
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
            const parsed=parseDreiDetail(detail.html,entry.url,{previous:identities,now});
            if (parsed.deal) {deals.push(parsed.deal);row.verifiedCandidates++;}
            else row.rejected.push({url:entry.url,reason:parsed.reason});
          } catch(error) {
            row.errors.push({url:entry.url,error:error.message,...sourceFailureFields(error)});
            if ([401,403,429].includes(error.httpStatus) || error.retryAt || /limit|cooldown/i.test(error.message)) break;
          }
        }
        row.complete=entries.length>0 && row.errors.length===0 && row.pagesRead===entries.length+1;
      } else {
        const parsed=parseCarrierTeasers(page.html,source,{previous:identities,now});
        deals.push(...parsed.deals.slice(0,maxDeals));row.verifiedCandidates=Math.min(parsed.deals.length,maxDeals);
        if(parsed.deals.length>maxDeals)row.errors.push({reason:'candidate-limit'});
        row.rejected=parsed.held;row.appCatalogOnly=parsed.appOnly;
      }
    } catch(error) {row.errors.push({url:source.url,error:error.message,...sourceFailureFields(error)});}
    // A partner's public terms remain independently readable if the app overview fails.
    for (const url of CARRIER_DETAIL_SOURCES[source.key] || []) {
      row.discoveredDetails++;
      if (deals.filter(deal=>deal.carrierProvider===source.key).length>=maxDeals) {row.errors.push({reason:'candidate-limit'});break;}
      try {
        const page=await get(url);row.pagesRead++;
        if(page.finalUrl && page.finalUrl!==url)throw new Error('Foreign carrier redirect');
        const parsed=parseCarrierDetail(page.html,url,source.key,{previous:identities,now});
        deals.push(...parsed.deals);row.rejected.push(...parsed.held);
      } catch(error) {row.errors.push({url,error:error.message,...sourceFailureFields(error)});}
    }
    const items=deals.filter(d=>d.carrierProvider===source.key);
    row.verifiedCandidates=items.length;
    row.appCatalogOnly=row.fullCatalogRequiresApp && items.length===0;
    const sameOffer=(old,deal)=>old.id===deal.id || old.url===deal.url && (!deal.carrierOfferKey || old.carrierOfferKey===deal.carrierOfferKey);
    row.knownLive=items.filter(deal=>live.some(old=>sameOffer(old,deal))).length;
    row.newCandidates=items.length-row.knownLive;
    row.newToPending=items.filter(deal=>!previous.some(old=>sameOffer(old,deal))).length;
    row.status=row.errors.length ? 'incomplete-or-blocked' : row.complete ? 'public-index-processed' : 'partial-public-only';
    report.push(row);
  }
  return {deals,report:{checkedAt:now.toISOString(),complete:false,providers:report,requests:client?.requests ?? null},state};
}

let defaultClient;
export async function verifyCarrierBenefit(deal, {now=new Date(),fetchPage,cache=new Map()} = {}) {
  if (deal.evidence?.type !== 'official-carrier-benefit' && !deal.carrierProvider) return null;
  const source=CARRIER_SOURCES.find(s=>s.key===deal.carrierProvider);
  if(!source || !isCarrierUrl(deal.url)) return {ok:false,reason:'untrusted-carrier-evidence'};
  const ownUrl=source.key==='drei-plus' ? new URL(deal.url).origin===new URL(source.url).origin
    : deal.url===source.url || (CARRIER_DETAIL_SOURCES[source.key] || []).includes(deal.url);
  if (!source || !isCarrierUrl(deal.url) || !ownUrl
      || deal.evidence?.type !== 'official-carrier-benefit' || deal.evidence.sourceUrl !== deal.url
      || deal.evidence.provider !== source.key) return {ok:false,reason:'untrusted-carrier-evidence'};
  const url=deal.url;
  try {
    const get=fetchPage || (defaultClient ||= createCarrierFetcher({now,state:readCarrierPauses(),recordPause:recordCarrierPauses})).fetchPage;
    if (!cache.has('carrier:'+url)) cache.set('carrier:'+url,Promise.resolve().then(()=>get(url)));
    const page=await cache.get('carrier:'+url);
    if (page.finalUrl && page.finalUrl!==url) return {ok:false,reason:'foreign-carrier-redirect'};
    const current=source.key==='drei-plus' ? parseDreiDetail(page.html,url,{previous:[deal],now}).deal
      : (url===source.url ? parseCarrierTeasers(page.html,source,{previous:[deal],now})
        : parseCarrierDetail(page.html,url,source.key,{previous:[deal],now})).deals.find(d=>d.id===deal.id);
    if (!current) return {ok:false,reason:'carrier-offer-not-current'};
    if (['brand','title','description','membershipRequired'].some(k=>clean(current[k])!==clean(deal[k])))
      return {ok:false,reason:'carrier-facts-or-conditions-changed'};
    return {ok:true,current:true,deal:current,
      ...(current.evidence.viennaContext ? {viennaBranchEvidence:current.evidence.viennaContext,branchEvidenceUrl:url} : {})};
  } catch(error) {return {ok:false,reason:error.message,...sourceFailureFields(error)};}
}
