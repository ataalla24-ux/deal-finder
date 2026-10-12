import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { fetchMerchantPage, robotsAllowsDiscovery } from './discover-vienna-merchants.mjs';
import { sourceURL } from './verified-expiry-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const fold = value => clean(value).normalize('NFKC').toLocaleLowerCase('de');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hour = 3_600_000;
const recurring = /geburtstag|birthday|dauerhaft|wöchentlich|woechentlich|monatlich|jeden\b|mitglied|member|laufend|recurring|verlängert|verlaengert|extended|bis auf weiteres|voraussichtlich/i;
const types = node => [node?.['@type']].flat().filter(Boolean);
const typeIs = (node, type) => types(node).some(t => String(t).split(/[/#]/).pop() === type);
const schemaName = node => typeof node === 'string' ? clean(node) : clean(node?.name);

function day(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value || '')) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function expiryFingerprint(deal) {
  // Interaction counters and feed stamps do not alter the identity of an offer.
  const fields = ['id', 'brand', 'title', 'description', 'url', 'sourceUrl', 'evidencePostUrl',
    'distance', 'address', 'location', 'expiryKind', 'validOn', 'validFrom', 'validUntil',
    'expires', 'expiresOriginal', 'expiryDisplayText', 'approvedAt', 'forceKeep'];
  return hash(fields.map(key => [key, deal[key] ?? null]));
}

export function protectedExpiryDeal(deal, edits = []) {
  return Boolean(deal.forceKeep || deal.isBusinessAdvertisement || deal.campaignId ||
    /business|merchant|promo-campaign/i.test(`${deal.source || ''} ${deal.originSource || ''}`) ||
    edits.some(edit => edit.hidden !== true && (
      String(edit.dealId || edit.id || edit.restoreDeal?.id || '') === String(deal.id) ||
      (deal.url && edit.url === deal.url))));
}

export function assessStructuredExpiry(deal, response, { now = new Date(), edits = [] } = {}) {
  const review = reason => ({ status: 'review', reason, automaticRemovalEligible: false });
  if (protectedExpiryDeal(deal, edits)) return review('Manuell korrigiertes, geschütztes oder Business-Angebot');
  const source = sourceURL(deal);
  if (!source || /(^|\.)(instagram\.com|tiktok\.com|facebook\.com|thefork\.[a-z.]+)$/i.test(new URL(source).hostname)) return review('Keine geeignete unabhängige Originalseite');
  if (response?.status !== 200 || response.url !== source || !/text\/html/i.test(response.headers?.['content-type'] || '')) return review('Quelle nicht direkt und vollständig als HTML erreichbar');
  const $ = load(response.body || '');
  const canonical = $('link[rel="canonical"]').map((_, el) => $(el).attr('href')).get();
  try {
    if (canonical.length !== 1 || new URL(canonical[0], source).href !== source) return review('Keine eindeutige kanonische Angebotsseite');
  } catch { return review('Ungültige kanonische URL'); }
  const nodes = [];
  const collect = (node, parent = null) => {
    if (Array.isArray(node)) { node.forEach(item => collect(item, parent)); return; }
    if (!node || typeof node !== 'object') return;
    nodes.push({ node, parent });
    for (const value of Object.values(node)) if (value && typeof value === 'object') collect(value, node);
  };
  try {
    for (const el of $('script[type="application/ld+json"]').toArray()) collect(JSON.parse($(el).text()));
  } catch { return review('Ungültige strukturierte Angebotsdaten'); }
  const offers = nodes.filter(({ node }) => typeIs(node, 'Offer'));
  if (offers.length !== 1 || nodes.some(({ node }) => ['AggregateOffer', 'ItemList', 'Event'].some(type => typeIs(node, type)))) return review('Keine einzelne eindeutig zuordenbare Aktion');
  const { node: offer, parent } = offers[0];
  const product = typeIs(parent, 'Product') ? parent : offer.itemOffered;
  const name = schemaName(offer.name || product?.name);
  const brand = schemaName(offer.seller || product?.brand || product?.manufacturer);
  if (!clean(deal.title) || fold(name) !== fold(deal.title) || !clean(deal.brand) || fold(brand) !== fold(deal.brand)) return review('Angebotstitel und Anbieter stimmen nicht exakt mit der Quelle überein');
  if (offer.url !== source && product?.url !== source) return review('Strukturiertes Angebot gehört nicht genau zu dieser URL');
  const end = day(offer.validThrough);
  if (!end || (offer.priceValidUntil && offer.priceValidUntil !== end)) return review('Kein widerspruchsfreies Enddatum mit Jahr');
  if (offer.validFrom && (!day(offer.validFrom) || offer.validFrom > end)) return review('Ungültiger strukturierter Angebotszeitraum');
  // A price end date alone does not prove the whole deal expired.
  const storedEnds = [deal.validUntil, deal.validOn].filter(Boolean);
  if (storedEnds.length === 0 || storedEnds.some(value => value !== end)) return review('Bestätigter Angebotszeitraum und Quelle stimmen nicht überein');
  if (now.getTime() < Date.parse(`${end}T23:59:59.999Z`) + 72 * hour) return review('Enddatum noch nicht mindestens drei Tage vergangen');
  $('script, style, nav, header, footer, aside, [hidden], [aria-hidden="true"]').remove();
  const main = $('main');
  if (main.length !== 1) return review('Kein einzelner Angebots-Hauptinhalt');
  main.find('p, div, section, article, br, li, h1, h2, h3, h4, h5, h6').append(' ');
  const visible = clean(main.text());
  if (visible.length > 5000 || recurring.test(`${deal.title} ${deal.description} ${deal.expiryKind} ${visible}`)) return review('Mehrdeutige, wiederkehrende oder verlängerte Aktion');
  const blocks = main.find('p, section, article, div').toArray()
    .filter(el => $(el).find('p, section, article, div').length === 0)
    .map(el => clean($(el).text()))
    .filter(text => text.length <= 1200 && fold(text).includes(fold(name)) && fold(text).includes(fold(brand)) &&
      /(?:gültig bis|aktion endet am|angebot endet am|valid until)\s*:?\s*\d{1,2}\.\d{1,2}\.20\d{2}\b/i.test(text));
  if (!blocks.length) return review('Sichtbarer Titel, Anbieter und Ablaufhinweis fehlen im selben Angebotsabschnitt');
  const dates = [...visible.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g)].map(m => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  dates.push(...[...visible.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(m => m[0]));
  const endHints = [...visible.matchAll(/(?:gültig bis|aktion endet am|angebot endet am|valid until)\s*:?\s*/gi)];
  if (endHints.some(m => !/^\d{1,2}\.\d{1,2}\.20\d{2}\b/.test(visible.slice(m.index + m[0].length)))) return review('Zusätzlicher Ablaufhinweis ohne eindeutiges Jahr');
  if (!dates.length || dates.some(value => value !== end)) return review('Zusätzliche oder widersprüchliche Datumsangaben auf der Angebotsseite');
  const evidence = { sourceUrl: source, validUntil: end, title: name, brand, evidenceText: visible,
    bodyHash: hash(response.body), evidenceHash: hash([source, name, brand, end, visible]), fingerprint: expiryFingerprint(deal) };
  return { status: 'candidate', reason: 'Eine konkrete Aktion mit übereinstimmendem sichtbarem und strukturiertem Enddatum',
    automaticRemovalEligible: false, ...evidence };
}

export function confirmExpiry(current, previous, now = new Date()) {
  const age = now.getTime() - Date.parse(previous?.checkedAt || '');
  return current.status === 'candidate' && previous?.status === 'candidate' &&
    current.evidenceHash === previous.evidenceHash && current.fingerprint === previous.fingerprint &&
    age >= 24 * hour && age <= 72 * hour;
}

export async function fetchExpirySource(url) {
  const robotsUrl = new URL('/robots.txt', url).href;
  // Starting at the last allowed hop rejects every redirect, including robots redirects.
  const robots = await fetchMerchantPage(robotsUrl, 3);
  if (robots.status !== 404 && (robots.status !== 200 || !robotsAllowsDiscovery(robots.body, url))) throw Error('Robots policy deferred');
  const delay = robots.status === 200 ? robotsParser(robotsUrl, robots.body).getCrawlDelay('FreeFinder-source-discovery/1.0') || 0 : 0;
  if (delay > 10) throw Error('Long crawl delay deferred');
  await new Promise(resolve => setTimeout(resolve, Math.max(500, delay * 1000)));
  return fetchMerchantPage(url, 3);
}

export async function verifyExpiryBatch(deals, previous = {}, edits = [], { now = new Date(), inspect = fetchExpirySource, apply = false, budget = 30 } = {}) {
  const entries = [];
  const removed = [];
  const cap = Math.min(5, Math.max(1, Math.floor(deals.length * .1)));
  const ordered = [...deals].sort((a, b) => (Date.parse(previous.entries?.[a.id]?.checkedAt) || 0) - (Date.parse(previous.entries?.[b.id]?.checkedAt) || 0));
  for (const deal of ordered.slice(0, budget)) {
    let assessment;
    try {
      const source = sourceURL(deal);
      assessment = assessStructuredExpiry(deal, source && !protectedExpiryDeal(deal, edits) ? await inspect(source) : null, { now, edits });
    } catch { assessment = { status: 'review', reason: 'Quelle konnte nicht verlässlich geprüft werden', automaticRemovalEligible: false }; }
    const prior = previous.entries?.[deal.id];
    const confirmed = confirmExpiry(assessment, prior, now);
    const entry = { id: deal.id, checkedAt: now.toISOString(), ...assessment, automaticRemovalEligible: confirmed };
    if (apply && confirmed && removed.length < cap) removed.push({ ...entry, originalDeal: deal, priorEvidence: prior, removedAt: now.toISOString() });
    // An immediate rerun must not erase the earlier independent observation.
    if (assessment.status === 'candidate' && prior?.status === 'candidate' && assessment.evidenceHash === prior.evidenceHash &&
      assessment.fingerprint === prior.fingerprint && now.getTime() - Date.parse(prior.checkedAt) < 24 * hour) {
      entry.checkedAt = prior.checkedAt;
      entry.recheckedAt = now.toISOString();
    }
    entries.push(entry);
  }
  const removedIds = new Set(removed.map(e => e.id));
  const currentIds = new Set(deals.map(d => d.id));
  const savedEntries = Object.fromEntries(Object.entries(previous.entries || {}).filter(([id]) => currentIds.has(id)));
  for (const entry of entries) savedEntries[entry.id] = entry;
  return { deals: deals.filter(d => !removedIds.has(d.id)), removed,
    state: { schemaVersion: 1, checkedAt: now.toISOString(), entries: savedEntries },
    report: { mode: apply ? 'strict_source_verified' : 'preview', checkedAt: now.toISOString(), checked: entries.length, candidates: entries.filter(e => e.status === 'candidate').length,
      removed: removed.map(e => ({ id: e.id, title: e.originalDeal.title, sourceUrl: e.sourceUrl, validUntil: e.validUntil })), entries } };
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function save(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }

async function main() {
  const docs = path.resolve(process.env.LIVE_DEAL_DOCS_DIR || path.join(root, 'docs'));
  const reviews = path.resolve(process.env.VERIFIED_EXPIRY_STATE_DIR || path.join(root, 'reviews'));
  const feed = await readJSON(path.join(docs, 'deals.json'), null);
  const deals = Array.isArray(feed) ? feed : feed?.deals;
  if (!Array.isArray(deals)) throw Error('Invalid feed');
  const edits = (await readJSON(path.join(docs, 'live-deal-edits.json'), {})).edits || [];
  const state = await readJSON(path.join(reviews, 'verified-expiry-state.json'), {});
  const result = await verifyExpiryBatch(deals, state, edits, { apply: process.env.VERIFIED_EXPIRY_APPLY === '1' });
  // Persist originals before changing the feed; the workflow commits the entire batch atomically.
  if (result.removed.length) {
    const archive = await readJSON(path.join(reviews, 'verified-expiry-archive.json'), { schemaVersion: 1, entries: [] });
    archive.entries.push(...result.removed);
    await save(path.join(reviews, 'verified-expiry-archive.json'), archive);
    await save(path.join(docs, 'deals.json'), Array.isArray(feed) ? result.deals : { ...feed, deals: result.deals, totalDeals: result.deals.length });
  }
  await save(path.join(reviews, 'verified-expiry-state.json'), result.state);
  await save(path.join(reviews, 'verified-expiry-report.json'), result.report);
  console.log(JSON.stringify({ checked: result.report.checked, candidates: result.report.candidates, removed: result.removed.length, mode: result.report.mode }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
