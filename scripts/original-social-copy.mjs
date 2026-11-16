import { canonicalInstagramPostKey, decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const offerWords = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const exactInstagramUrl = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]{5,20}\/?$/;
const recordedClock = /^(?:instagram-graph-timestamp|url\.instagramShortcode)$/;
const additionalTerms = /[\d€%]|\b(?:nur|nicht|kein\w*|ausschlie[ßs]lich|mindestens|maximal|ausgewählt\w*|beschränkt\w*|begrenzt\w*|limitiert\w*|vorrat|ausgenommen|solange|g[üu]ltig\w*|heute|morgen|abgelaufen|vorbei|zeitraum|verl[äa]ngert\w*|wochenend\w*|werktag\w*|wochentag\w*|bis|ab|erst|statt|aktion\w*|kostenlos|gratis|rabatt\w*|mindest\w*|bonus\w*|gutschein\w*|code\w*|coupon\w*|passwort\w*|filial\w*|standort\w*|reservier\w*|bedingung\w*|voraussetz\w*|teilnahm\w*|mitglieder?\w*|neukund\w*|pro\s+(?:person|bestellung|gast|tisch)|bei\s+(?:kauf|bestellung|abholung)|zur\s+abholung|für\s+(?:kunden|mitglieder)|nicht\s+kombinierbar)\b/iu;
const redemptionSignals = /\b(?:einl[öo]s\w*|gegen vorlage|folg\w*|markier\w*|teil\w*|kommentier\w*|erhalten|gewinnspiel\w*|registrier\w*|anmeld\w*|installier\w*|aktivier\w*|bestell\w*|bezahl\w*|scann?\w*|app|musst|müsst|only|today|tomorrow|until|exclusive\w*|selected|membership|restrict\w*|eligib\w*|require\w*)\b/iu;
const conditionalTag = /(?:^|\s)#(?:nur|only|code|coupon|gutschein|bedingungen|teilnahme|gewinnspiel|begrenz|biszum|heute)[\p{L}\p{N}_]*/iu;

function platformMerchant(url) {
  if (!/^https:\/\//.test(url)) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
  const host = parsed.hostname.replace(/^www\./, '');
  const path = parsed.pathname;
  const match = host === 'foodora.at' ? path.match(/^\/restaurant\/[a-z0-9]+\/([a-z][a-z0-9-]{2,48})\/?$/)
    : host === 'lieferando.at' ? path.match(/^\/speisekarte\/([a-z][a-z0-9-]{2,48})\/?$/)
      : host === 'wolt.com' ? path.match(/^\/de\/aut\/vienna\/restaurant\/([a-z][a-z0-9-]{2,48})\/?$/) : null;
  return match ? { platform: host.split('.')[0], slug: match[1] } : null;
}

function agreedMerchant(caption, displayedBrand) {
  const vendors = new Map();
  for (const [url] of caption.matchAll(/https:\/\/[^\s<>]+/g)) {
    const match = platformMerchant(url);
    if (!match) continue;
    if (vendors.has(match.platform) && vendors.get(match.platform) !== match.slug) return null;
    vendors.set(match.platform, match.slug);
  }
  const counts = new Map();
  for (const slug of vendors.values()) counts.set(slug, (counts.get(slug) || 0) + 1);
  const agreed = [...counts].filter(([, count]) => count >= 2);
  if (agreed.length !== 1) return null;
  const [[slug]] = agreed;
  if ([...vendors].some(([platform, candidate]) => candidate !== slug
    && !(platform === 'wolt' && candidate === `${slug}-bio-streetfood`))) return null;
  const tag = slug.replace(/-/g, '');
  if (![...caption.matchAll(/(?:^|\s)#([a-z0-9_]+)/gi)].some(([, value]) => value.toLowerCase() === tag)) return null;
  const oldBrand = clean(displayedBrand).toLowerCase();
  // Change a platform mislabel only when that platform is named as a link.
  if (oldBrand && oldBrand !== slug.replace(/-/g, ' ') && !vendors.has(oldBrand)) return null;
  return { brand: slug.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '), oldBrand };
}

function exactAcceptedCaption(deal, source, now) {
  if (source?.graphAccepted !== true || source.blockingReason || deal.metaGraphBlockingReason
    || !exactInstagramUrl.test(deal.url || '') || !exactInstagramUrl.test(source.url || '')
    || canonicalInstagramPostKey(deal.url) !== canonicalInstagramPostKey(source.url)) return '';
  const tiedPosts = [deal.evidencePostUrl, deal.evidence?.originalPost?.url, deal.postVerification?.originalPostUrl].filter(Boolean);
  if (tiedPosts.some(url => canonicalInstagramPostKey(url) !== canonicalInstagramPostKey(source.url))) return '';
  const mediaId = String(deal.evidence?.mediaId || deal.metaGraphMediaId || '');
  if (!/^\d{10,}$/.test(mediaId) || String(source.mediaId || '') !== mediaId
    || deal.metaGraphMediaId && String(deal.metaGraphMediaId) !== mediaId) return '';
  if (deal.id !== `meta-ig-${mediaId}` || !recordedClock.test(deal.sourcePublishedAtSource || '')
    || source.sourcePublishedAtSource !== 'instagram-graph-timestamp') return '';
  const decoded = decodeInstagramShortcodeDate(deal.url);
  const approved = Date.parse(deal.approvedAt);
  const verified = Date.parse(source.verifiedAt);
  const clocks = [Date.parse(deal.sourcePublishedAt), Date.parse(source.sourcePublishedAt)];
  if (!decoded || !Number.isFinite(approved) || approved < +decoded || approved > +now
    || !Number.isFinite(verified) || verified < +decoded || verified > +now
    || clocks.some(value => !Number.isFinite(value) || value > +now || Math.abs(value - +decoded) > 60000)) return '';
  if ([deal, source].some(value => value.isRepost || value.isReshare || value.repost
    || value.reshare || value.isOriginal === false || /story|repost|reshare/i.test(value.mediaProductType || ''))) return '';
  if (clean(source.ocrText)) return ''; // Image terms require review as well.
  const caption = clean(source.caption);
  // A compact or manually enriched description can carry independent terms.
  return clean(deal.description) === caption ? caption : '';
}

export function assessOriginalSocialCopy(deal, source, now = new Date()) {
  const caption = exactAcceptedCaption(deal, source, now);
  if (!caption || caption.length > 2400) return null;
  const merchant = agreedMerchant(caption, deal.brand);
  if (!merchant) return null;
  const matches = [...caption.matchAll(/\bZu (jeder|jedem) ([\p{L}][\p{L} -]{1,30}?) legen wir (?:dir|euch) (ein(?:en|e)?) ([\p{L}][\p{L} -]{1,40}?) gratis dazu[.!](?=\s|$)/giu)];
  if (matches.length !== 1) return null;
  const [sentence, each, item, article, extra] = matches[0];
  const title = `Gratis ${extra} zu ${each.toLowerCase()} ${item}`;
  if (title.length > 50 || additionalTerms.test(item) || additionalTerms.test(extra)) return null;
  const heading = offerWords(caption.slice(0, matches[0].index));
  if (heading && heading !== offerWords(`${item} gratis ${extra}`)) return null;
  const remaining = caption.slice(matches[0].index + sentence.length);
  if (conditionalTag.test(remaining)) return null;
  let tail = remaining
    .replace(/https:\/\/[^\s<>]+/g, '')
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, ' ');
  // Keep the stated location and time verbatim. Other numbers in the
  // caption may be conditions, and are never dropped by this template.
  const place = tail.match(/📍\s*([\p{L}][\p{L} .'-]{1,50}\s+\d{1,4}[a-z]?,\s*1\d{3}\s+Wien)\b/u);
  const hours = tail.match(/\p{Extended_Pictographic}\s*((?:Mo|Di|Mi|Do|Fr|Sa|So) bis (?:Mo|Di|Mi|Do|Fr|Sa|So),\s*(?:[01]?\d|2[0-3]):[0-5]\d bis (?:[01]?\d|2[0-3]):[0-5]\d)\b/u);
  if (place) tail = tail.replace(place[0], '');
  if (hours) tail = tail.replace(hours[0], '');
  if (additionalTerms.test(tail) || redemptionSignals.test(tail)) return null;
  const description = [`Zu ${each.toLowerCase()} ${item} gibt es ${article.toLowerCase()} ${extra} gratis dazu.`,
    place && `${place[1]}.`, hours && `${hours[1]}.`].filter(Boolean).join(' ');
  const proposed = { title, description, brand: merchant.brand };
  if (merchant.oldBrand !== merchant.brand.toLowerCase() && /^(?:foodora|wolt|lieferando)$/.test(merchant.oldBrand)
    && /^https:\/\/freefinder\.at\/assets\/brand-logos\//.test(deal.logoUrl || '')
    && new URL(deal.logoUrl).pathname.split('/').at(-1).startsWith(`${merchant.oldBrand}-`)) proposed.logoUrl = '';
  const patch = Object.fromEntries(Object.entries(proposed).filter(([field, value]) => deal[field] !== value));
  return Object.keys(patch).length ? { patch, caption, sentence } : null;
}
