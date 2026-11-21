import { createHash } from 'node:crypto';
import { load } from 'cheerio';

const indexUrl = 'https://www.marktguru.at/cashback';
const detailPattern = /^https:\/\/www\.marktguru\.at\/mb\/[a-z0-9-]+-cashback-(\d+)$/;
const foodProduct = /knödel|aufstrich|limonade|espresso|kaffee|schokolade|knoppers|toffifee|joghurt|nudeln|käse|müsli|keks|pralin|pasta|fruchtsaft|mineralwasser|tee\b/i;
const excludedProduct = /gewinnspiel|jackpot|al[ck]ohol|\bbier\b|wein\b|spirituosen|tierfutter|hundefutter|katzenfutter/i;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const dateInVienna = value => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));

function paragraphs(element) {
  const copy = element.clone();
  copy.find('p,li,br').before(' ').after(' ');
  return clean(copy.text());
}

function visiblePage(html, pageUrl) {
  const $ = load(html);
  if ($('head link[rel="canonical"]').length !== 1 || $('head link[rel="canonical"]').attr('href') !== pageUrl) return null;
  const dataScripts = $('script[type="application/json"]').toArray().flatMap(el => {
    try { return [JSON.parse($(el).text()).data].filter(Boolean); } catch { return []; }
  });
  if (dataScripts.length !== 1) return null;
  $('script,style,template,noscript,[hidden],[aria-hidden="true"]').remove();
  $('[style]').filter((_, el) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style'))).remove();
  return { $, state: dataScripts[0] };
}

function benefit(campaign) {
  if (campaign.type === 'percent' && Number.isInteger(campaign.cashbackValue)
      && campaign.cashbackValue >= 30 && campaign.cashbackValue <= 100) return campaign.cashbackValue + ' %';
  if (campaign.type === 'quantity' && campaign.cashbackValue === 100
      && campaign.quantityBuy === 1 && campaign.quantityGet === 1) return '1+1';
  return '';
}

export function discoverCashbackLinks(html, url, previousDetailUrl) {
  if (url !== indexUrl) return [];
  const page = visiblePage(html, url);
  if (!page || !Array.isArray(page.state.items)) return [];
  const { $, state } = page;
  const items = new Map(state.items.filter(c => c && benefit(c) && c.isLoyaltyCampaign === false
    && foodProduct.test(c.name) && !excludedProduct.test(c.name)).map(c => [c.id, c]));
  const links = new Set();
  $('main a.cashback[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href.startsWith('/mb/')) return;
    const link = new URL(href, indexUrl).href;
    const id = detailPattern.exec(link)?.[1];
    if (id && items.has(Number(id)) && $(el).attr('title')?.startsWith(items.get(Number(id)).name + ' mit ')) links.add(link);
  });
  const ordered = [...links].sort((a, b) => Number(detailPattern.exec(b)[1]) - Number(detailPattern.exec(a)[1]));
  if (!ordered.length) return [];
  // Power has two scheduled scans a day. One detail slot rotates through
  // eligible campaigns instead of always spending it on the first card.
  const start = (ordered.indexOf(previousDetailUrl) + 1) % ordered.length;
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

export function extractCashbackCampaign(html, source, url, now) {
  const id = detailPattern.exec(url)?.[1];
  if (!id) return null;
  const page = visiblePage(html, url);
  if (!page) return null;
  const { $, state } = page;
  const campaign = state.cashback?.data;
  if (state.cashback?.status !== 200 || !campaign || campaign.id !== Number(id)
    || campaign.workflowState !== 'published' || campaign.isReceiptCampaign !== true
    || !Number.isInteger(campaign.campaignAvailability) || campaign.campaignAvailability < 1 || campaign.campaignAvailability > 100
    || !Number.isInteger(campaign.userRedeemLimit) || campaign.userRedeemLimit < 1
    || !Number.isFinite(Date.parse(campaign.validFrom)) || Date.parse(campaign.validFrom) > +now
    || campaign.cutoffDate !== null || campaign.receiptEndValidityDate !== null) return null;
  const info = $('main.app-main > .cashback-details > .info');
  const terms = $('main.app-main > .box').filter((_, el) => clean($(el).children('.title').children('h2').text()) === 'Bedingungen').children('.desc');
  const product = clean(info.find('h1').text());
  const value = benefit(campaign);
  if (info.length !== 1 || info.find('h1').length !== 1 || terms.length !== 1 || !value
    || !foodProduct.test(product) || excludedProduct.test(product) || product !== campaign.detailTitle
    || clean(info.find('.cashback-badge').text()).replace(/\s/g, '') !== (value.replace(/\s/g, '') + 'Cashback')
    || clean(info.find('.cashback-details-info .progress').text()) !== campaign.campaignAvailability + '% verfügbar'
    || clean(info.find('.cashback-details-info').children().not('.progress').text()) !== campaign.userRedeemLimit + 'x Einlösbar pro Person') return null;
  const facts = paragraphs(terms);
  if (facts !== paragraphs(load(campaign.conditionsDescription || '').root())) return null;
  const lines = terms.find('li').map((_, el) => clean($(el).text())).get();
  const start = dateInVienna(campaign.validFrom);
  const [year, month, day] = start.split('-').map(Number);
  const localDate = day + '.' + month + '.' + year;
  const offer = lines.find(line => line.startsWith('Aktion: '))?.slice(8) || '';
  const stores = lines.find(line => line.startsWith('Wo gültig: '))?.slice(11) || '';
  const location = 'Gültig beim Kauf in Österreich ab dem ' + localDate + ' bei folgenden Händlern: ' + stores;
  const positive = value === '1+1' ? /^1\+1 gratis beim Kauf von zwei\b/i : new RegExp('^' + campaign.cashbackValue + '\\s*% Cashback beim Kauf von ', 'i');
  const productWords = product.toLocaleLowerCase('de-AT').match(/[\p{L}]{4,}/gu) || [];
  const namesProduct = productWords.some(word => !['premium', 'packung', 'füllung', 'flaschen'].includes(word)
    && offer.toLocaleLowerCase('de-AT').includes(word));
  if (!namesProduct || !positive.test(offer) || !lines.includes('Start der Aktion: ' + localDate)
    || !stores || !stores.split(/,\s*/).every(s => /^(?:Billa(?: Plus)?|Eurospar|Interspar|Spar|Sutterlüty|MPreis|Hofer|Lidl|Penny)$/i.test(s))
    || !lines.includes(location) || !/\bOnlinekäufe sind erlaubt, solange die Lieferadresse in Österreich ist\b/.test(facts)
    || !/Aktion gültig nur solange der Vorrat und das Budget reicht/.test(facts)
    || /\b(?:bis(?:\s+(?:einschließlich|inklusive|zum))?\s+\d{1,2}[.\/-]|nur in|ausschließlich in|nicht (?:mehr )?gültig|nicht (?:mehr )?einlösbar|nicht (?:mehr )?verfügbar|Aktion (?:vorzeitig )?beendet)/i.test(facts)
    || !/\bKassenbon/.test(facts) || /(?:ausgenommen|außer|nicht in|nicht für|ohne|exkl\.?)\s+(?:wien|österreich)|(?:wien|österreich)\s+(?:ausgenommen|ausgeschlossen)|\b(?:abgelaufen|beendet|vergriffen|pausiert|storniert)\b|\bkein(?:e[ns]?|en)?\s+(?:cashback|rabatt|1\+1)\b/i.test(facts)) return null;
  const redeemText = paragraphs(load(campaign.redeemDescription || '').root());
  if (!/Rechnung mit der App/.test(redeemText)) return null;
  const limit = campaign.userRedeemLimit + ' Einlösung' + (campaign.userRedeemLimit === 1 ? '' : 'en') + ' pro Person.';
  const title = product + ' – ' + value + ' Cashback mit der marktguru-App';
  // Preserve unrecognised conditions verbatim. Compact only the recurring
  // receipt boilerplate, so the reader can see purchase and payout conditions.
  const rules = lines.filter(line => ![location, 'Aktion: ' + offer, 'Wo gültig: ' + stores,
    'Start der Aktion: ' + localDate, 'Sichere dir ' + offer].includes(line)).map(line => {
    if (line === 'Der Cashback-Betrag ergibt sich aus dem Produktpreis abzüglich aller Rabatte.')
      return 'Berechnung nach Abzug aller Rabatte.';
    if (line === 'Pro Einlösung kann nur eine Rechnung eingereicht werden.') return 'Eine Rechnung je Einlösung.';
    if (line === 'Aktion gültig nur solange der Vorrat und das Budget reicht') return 'Solange Vorrat und Budget reichen.';
    return line;
  });
  const description = [offer + '.', 'Teilnehmende Händler: ' + stores + '.', limit, ...rules, redeemText].join(' ');
  const evidenceText = [product, limit, facts, redeemText].join('\n');
  return {
    id: 'power-food-' + createHash('sha1').update(source.name + '|' + id).digest('hex').slice(0, 12),
    source: source.name, brand: 'marktguru', originSource: 'power-official-food', url, title,
    description,
    category: 'essen', type: value === '1+1' ? 'bogo' : 'rabatt', logo: '🛒', qualityScore: 78,
    validFrom: start, expires: 'Solange Vorrat und Aktionsbudget reichen',
    distance: 'Österreich, bei teilnehmenden Händlern', missingFields: ['Ablauf', 'Filialteilnahme'],
    discoveredAt: now.toISOString(), lastCheckedAt: now.toISOString(),
    evidence: { source: 'official-merchant-page', sourceUrl: url, merchantSourceKey: source.name,
      extractionMethod: 'published-receipt-campaign', checkedAt: now.toISOString(), textSample: evidenceText,
      contentHash: createHash('sha256').update(evidenceText).digest('hex'),
      locationScope: 'austria-wide', locationEvidenceUrl: url,
      offerTiming: { kind: 'ongoing', validFrom: start, matchedText: 'Start der Aktion: ' + localDate + '. ' + lines.find(line => line.includes('solange der Vorrat und das Budget reicht')) } },
  };
}
