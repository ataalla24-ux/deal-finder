import { createHash } from 'node:crypto';
import { canonicalInstagramPostKey, decodeInstagramShortcodeDate } from '../scraper/deal-evidence-utils.js';
import { parseExpiryShape } from '../scraper/expiry-utils.js';
import { viennaInstant } from '../scraper/explicit-offer-period.js';
import { basicCopyHold, contradictedOfferPriceHold } from '../scraper/approval-two-stage.js';
import { titleClaimGuard } from '../scraper/deal-card-editor.js';
import { offerPeriodFields } from '../scraper/offer-period-fields.js';
import { createMaintenanceSourceEntry } from './refresh-maintenance-evidence.mjs';
import { readApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const fold = value => clean(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').toLowerCase();
const sha = value => createHash('sha256').update(value).digest('hex');
const age = (value, now) => +now - Date.parse(value);
const knownTime = (value, now) => Number.isFinite(age(value, now)) && age(value, now) >= 0;
const exactDay = value => /^20\d{2}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sameDay = (left, right) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(left)
  === new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(right);
const blocked = row => row && (row.blockingReason || row.graphAccepted === false || row.isRepost || row.isReshare);
const matchingEdits = (deal, edits) => edits.filter(row => clean(row.dealId)
  ? clean(row.dealId) === clean(deal.id) : Boolean(deal.url && row.url === deal.url));
const protectedOffer = (deal, policy, edits) => Boolean(deal.forceKeep || deal.liveForceKeep || deal.isBusiness
  || deal.isBusinessAdvertisement || deal.campaignId
  || matchingEdits(deal, edits).some(edit => edit.forceKeep || edit.restoreDeal || edit.hidden)
  || (policy.protectedMerchants || []).some(brand => fold(brand) === fold(deal.brand)));
const manualPeriod = deal => [deal.expiresSource, deal.expirySource, deal.validity?.expirySource].includes('manual');
function protectedFields(deal, edits) {
  const fields = new Set([...(deal.liveEditedFields || []), ...(deal.slackEditedFields || [])]);
  for (const edit of matchingEdits(deal, edits)) {
    for (const key of Object.keys(edit)) if (!['dealId', 'url', 'updatedAt', 'createdAt', 'editedBy'].includes(key)) fields.add(key);
    for (const key of edit.clearFields || []) fields.add(key);
  }
  if (deal.liveEditedAt && !deal.liveEditedFields?.length
    || (deal.editedInSlack || deal.slackEditedAt || deal.slackFormEditTs) && !deal.slackEditedFields?.length) fields.add('*');
  return fields;
}

function graphProof(deal, row, now, current) {
  const key = canonicalInstagramPostKey(deal.url), decoded = decodeInstagramShortcodeDate(deal.url);
  const text = current ? row.caption : deal.metaGraphCaption;
  const owner = current ? row.ownerUsername : deal.ownerUsername;
  const mediaId = current ? row.mediaId : deal.metaGraphMediaId;
  const verifiedAt = current ? row.verifiedAt : deal.metaGraphVerifiedAt;
  const publishedAt = current ? row.sourcePublishedAt : deal.sourcePublishedAt;
  const ownerType = current ? row.sourceAccountType : deal.sourceAccountType;
  const publishedKind = current ? row.sourcePublishedAtSource : deal.sourcePublishedAtSource;
  if (!key || !decoded || !knownTime(deal.approvedAt, now) || !knownTime(publishedAt, now)
    || !knownTime(verifiedAt, now) || Date.parse(verifiedAt) < +decoded
    || Math.abs(Date.parse(publishedAt) - +decoded) > 300000
    || !sameDay(new Date(publishedAt), decoded)
    || !['instagram-graph-timestamp', 'url.instagramShortcode'].includes(publishedKind)
    || !clean(text) || text.length > 16000 || ownerType !== 'merchant'
    || !owner || owner !== deal.ownerUsername || owner !== deal.merchantUsername
    || !mediaId || mediaId !== deal.metaGraphMediaId
    || current && (canonicalInstagramPostKey(row.url) !== key || row.graphAccepted !== true
      || row.isRepost !== false || age(verifiedAt, now) > 86400000)
    || !current && (deal.metaGraphVerified !== true || deal.metaGraphAccepted !== true
      || deal.metaGraphIsRepost !== false || deal.evidence?.mediaId !== mediaId
      || deal.evidence?.username !== owner)) return null;
  return { text, sourceUrl: current ? row.url : deal.url, verifiedAt,
    kind: current ? 'current-merchant-graph-caption' : 'approved-merchant-graph-caption',
    sourceHash: sha(text), current: current || age(verifiedAt, now) <= 86400000 };
}

// No description, arbitrary queue caption, model summary, or unbound OCR is
// promoted to a source. A newer failed read also vetoes an older good receipt.
function selectProof(deal, latest, now) {
  if (deal.metaGraphBlockingReason || deal.metaGraphIsRepost || blocked(latest)) return { reason: 'source-blocked-or-repost' };
  if (latest) {
    const graph = graphProof(deal, latest, now, true);
    if (graph) return { proof: graph };
    const evidence = latest.approvalSourceEvidence;
    if (latest.sourceUrl === deal.url && typeof latest.officialText === 'string' && clean(latest.officialText)
      && latest.officialText === evidence?.caption
      && latest.contentHash === sha(latest.officialText || '') && knownTime(latest.verifiedAt, now)
      && age(latest.verifiedAt, now) <= 86400000 && createMaintenanceSourceEntry(deal, evidence, now)) {
      return { proof: { text: latest.officialText, sourceUrl: latest.sourceUrl, verifiedAt: latest.verifiedAt,
        sourceHash: latest.contentHash, kind: 'current-approved-source-page', current: true } };
    }
    return { reason: 'current-source-not-bound-or-not-fresh' };
  }
  const receipt = readApprovedExpiryEvidence(deal, { now });
  if (receipt) return { proof: { text: receipt.sourceText, sourceUrl: receipt.sourceUrl,
    verifiedAt: receipt.verifiedAt, sourceHash: receipt.sourceHash, kind: 'approved-original-receipt',
    current: age(receipt.verifiedAt, now) <= 86400000 } };
  if (deal.approvedExpiryEvidence) return { reason: 'original-receipt-binding-changed' };
  const graph = graphProof(deal, null, now, false);
  if (graph) return { proof: graph };
  const e = deal.evidence;
  if (knownTime(deal.approvedAt, now) && e?.source === 'official-merchant-page'
    && e.sourceUrl === deal.url && fold(e.merchantSourceKey) === fold(deal.brand)
    && ['merchant-card', 'official-campaign-footnote', 'official-reviewed-coupon-card'].includes(e.extractionMethod)
    && knownTime(e.checkedAt, now) && clean(e.textSample) && e.textSample.length <= 16000
    && e.contentHash === sha(e.textSample)) {
    return { proof: { text: e.textSample, sourceUrl: e.sourceUrl, verifiedAt: e.checkedAt,
      sourceHash: e.contentHash, kind: 'bound-official-offer-card', current: age(e.checkedAt, now) <= 86400000 } };
  }
  return { reason: 'independent-bound-source-unavailable' };
}

const ratios = value => [...new Set([...fold(value).matchAll(/(?<!\d)(\d{1,2})\s*\+\s*(\d{1,2})(?!\d)/g)]
  .map(match => `${Number(match[1])}+${Number(match[2])}`))];
const money = '(?:(\\d+(?:[.,]\\d{1,2})?)\\s*(?:€|euros?|eur)|(?:€|euros?|eur)\\s*(\\d+(?:[.,]\\d{1,2})?))';
const amount = value => Number(String(value).replace(',', '.'));
const productNouns = '(?:kaffees?|melange|pizzas?|pizzen|doners?|doeners?|shawarmas?|bowls?|buffets?|burgers?|donuts?)';
const productKey = value => value.replace(/^doener/, 'doner').replace(/^pizzen$/, 'pizza').replace(/s$/, '');
function voucherTiers(value) {
  const pattern = new RegExp(`${money}\\s+geschenkt\\s+ab\\s+${money}\\s+konsumation`, 'g');
  return [...fold(value).matchAll(pattern)].map(m => [amount(m[1] || m[2]), amount(m[3] || m[4])]);
}

// Deliberately requires an explicit same product on both sides. A different
// dish's price, an absent number, or a quantity is never a contradictory quote.
function productPrices(value) {
  const pattern = new RegExp(`\\b(${productNouns})\\s+(?:kostet|kosten|fur|um)\\s+(?:nur\\s+)?${money}`, 'g');
  const result = new Map();
  for (const match of fold(value).matchAll(pattern)) {
    const product = productKey(match[1]);
    if (!result.has(product)) result.set(product, new Set());
    result.get(product).add(amount(match[2] || match[3]));
  }
  return result;
}
function productRatios(value) {
  const pattern = new RegExp(`(?<!\\d)(\\d{1,2})\\s*\\+\\s*(\\d{1,2})\\s*(?:(?:auf|gratis|fur|die|alle)\\s+){0,3}(${productNouns})\\b`, 'g');
  const result = new Map();
  for (const match of fold(value).matchAll(pattern)) {
    const product = productKey(match[3]);
    if (!result.has(product)) result.set(product, new Set());
    result.get(product).add(`${Number(match[1])}+${Number(match[2])}`);
  }
  return result;
}

function explicitSourceEnd(text) {
  const normalized = fold(text);
  // These qualifications can change which date ends the offer. Retain them for
  // review instead of treating the last date in the paragraph as authoritative.
  if (/\b(?:verlanger\w*|verlaenger\w*|extended|mindestens|fruhestens|nicht\s+(?:(?:nur|mehr|erst)\s+)?(?:(?:gultig|gueltig)\s+)?bis|endet nicht|voraussichtlich|teilnahmeschluss|einsendeschluss|weiterhin|fortgesetzt|lauft weiter|geht weiter)\b/.test(normalized)) return null;
  const date = '(?:\\d{1,2}\\.\\d{1,2}\\.20\\d{2}|\\d{1,2}\\.?\\s+(?:januar|jänner|jaenner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\\s+20\\d{2})';
  const pattern = new RegExp(`\\bbis\\s+(?:(?:einschließlich|einschliesslich|inklusive|inkl\\.)\\s+)?(?:[a-zäöü]+,\\s*)?(${date})\\b`, 'gi');
  const found = [...text.matchAll(pattern)].filter(match => {
    const before = fold(text.slice(Math.max(0, match.index - 100), match.index));
    const after = fold(text.slice(match.index + match[0].length, match.index + match[0].length + 30));
    if (/\b(?:offnungszeiten|oeffnungszeiten|geoffnet|geoeffnet|vorbestell\w*|bestellfrist|anmeld\w*|reservier\w*|abhol\w*|opening hours)\b/.test(before)) return false;
    return /\b(?:gultig|gueltig|aktion|angebot|gutschein\w*|coupon\w*|von|vom)\b[^!?]{0,100}$/.test(before)
      || /^\s*(?:gultig|gueltig)\b/.test(after);
  }).map(match => ({ quote: match[0],
    day: parseExpiryShape(`Gültig ${match[0]}`).validUntil })).filter(row => exactDay(row.day));
  if (new Set(found.map(row => row.day)).size !== 1) return null;
  // An unrelated historical date in the same source is an ambiguity, not a fix.
  const shape = parseExpiryShape(text);
  if (shape.validUntil && shape.validUntil !== found[0].day) return null;
  return found[0];
}

function datePatch(deal, end) {
  // A period edit invalidates an existing receipt. Rebinding linked documents
  // or images needs their original artifacts; this checker never fabricates a
  // new receipt or silently leaves nested validity metadata inconsistent.
  if (deal.approvedExpiryEvidence || deal.validity || manualPeriod(deal) || deal.validOn || deal.validFrom && deal.validFrom > end.day
    || /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*Uhr\b/i.test(`${deal.title} ${deal.description}`)) return null;
  const expires = clean(deal.expires);
  // Do not erase a real time when only a calendar end has been read.
  if (expires && /T/.test(expires) && !/(?:T(?:22|23):59:59\.999Z)$/.test(expires)) return null;
  const lastMinute = viennaInstant(end.day, '23:59');
  if (!lastMinute) return null;
  return { validUntil: end.day, expires: new Date(Date.parse(lastMinute) + 59999).toISOString(),
    expiryKind: deal.validFrom ? 'range' : 'end', expiresOriginal: end.quote,
    expiryDisplayText: end.quote, dateConfidence: 'high' };
}

function conflictingPublicDate(deal, end) {
  const months = ['januar', 'janner', 'jaenner', 'februar', 'marz', 'maerz', 'april', 'mai', 'juni', 'juli',
    'august', 'september', 'oktober', 'november', 'dezember'];
  const monthNumber = name => ({ janner: 1, jaenner: 1, marz: 3, maerz: 3 }[name]
    || ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'].indexOf(name) + 1);
  const marker = '\\b(?:bis(?:\\s+(?:einschliesslich|inklusive|inkl\\.))?|(?:nur\\s+|ausschliesslich\\s+)?am)\\s+';
  const numeric = new RegExp(`${marker}(\\d{1,2})[./](\\d{1,2})(?:[./](20\\d{2})(?!\\d)|\\.(?!\\d)|(?![\\d./]))`, 'g');
  const named = new RegExp(`${marker}(\\d{1,2})\\.?\\s+(${months.join('|')})(?:\\s+(20\\d{2}))?\\b(?!\\s+\\d)`, 'g');
  for (const field of ['title', 'description']) {
    const value = fold(deal[field]);
    for (const [pattern, namedMonth] of [[numeric, false], [named, true]]) {
      for (const match of value.matchAll(pattern)) {
        const month = namedMonth ? monthNumber(match[2]) : Number(match[2]);
        const year = match[3] || end.day.slice(0, 4);
        const day = `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
        // The source supplies the year only for this comparison. A yearless
        // visible statement never supplies a year to a publication date field.
        if (exactDay(day) && day !== end.day) return { field, publicQuote: match[0] };
      }
    }
  }
  return null;
}

/** Pure, conservative comparison of public claims with independently bound text.
 * `consistent` means no contradiction among the narrow checks below, not a
 * current redemption certification or proof that every condition is complete.
 */
export function assessLiveDealSourceConsistency(deal, { now = new Date(), latestEvidence, edits = [], policy = {} } = {}) {
  const result = { id: deal.id, status: 'review', quarantineEligible: false, issues: [], patch: null,
    checks: ['explicit-negation', 'same-product-price', 'offer-benefit-type', 'explicit-calendar-end'],
    currentAvailabilityVerified: false };
  const selected = selectProof(deal, latestEvidence, now);
  if (!selected.proof) return { ...result, reason: selected.reason };
  const proof = selected.proof, text = proof.text, fields = protectedFields(deal, edits);
  result.provenance = { kind: proof.kind, sourceUrl: proof.sourceUrl, sourceHash: proof.sourceHash,
    verifiedAt: proof.verifiedAt, currentRead: proof.current };
  const conflict = (code, message, fields, quote = text) => result.issues.push({ code, message, fields,
    severity: 'confirmedConflict', sourceQuote: quote });
  const deniedPrice = contradictedOfferPriceHold(deal, { caption: text });
  if (deniedPrice) conflict('explicitly-denied-product-price', deniedPrice, ['title', 'description']);
  const deniedFree = basicCopyHold(deal, { caption: text });
  if (/Gratis-Titel widerspricht dem ausdrücklich nicht kostenlosen Produkt/.test(deniedFree)
    && !/\b(?:ausser|ausgenommen|except|wieder|jedoch|aber)\b/.test(fold(text))) {
    const positiveCurrent = new RegExp(`\\b(?:jetzt|aktuell|heute|ab sofort)\\b[^.!?]{0,80}\\b${productNouns}\\b[^.!?]{0,30}\\b(?:gratis|kostenlos)\\b`);
    if (!positiveCurrent.test(fold(text))) {
    conflict('explicitly-denied-free-product', deniedFree, ['title']);
    }
  }
  const titlePrices = productPrices(deal.title), sourcePrices = productPrices(text);
  const sourceAmounts = new Set([...fold(text).matchAll(new RegExp(money, 'g'))].map(match => amount(match[1] || match[2])));
  for (const [product, prices] of titlePrices) {
    const source = sourcePrices.get(product);
    if (prices.size === 1 && source?.size === 1 && !source.has([...prices][0])
      && sourceAmounts.size === 1
      && !/\b(?:statt|ab|bis zu|ausgewahlte|verschiedene|je nach|fruher|nicht mehr)\b/.test(fold(text))) {
      conflict('same-product-price-conflict', `Preis für ${product} widerspricht dem eindeutigen Quellenpreis.`, ['title']);
    }
  }
  const titleRatios = ratios(deal.title), sourceRatios = ratios(text);
  for (const [product, values] of productRatios(deal.title)) {
    const original = productRatios(text).get(product);
    if (values.size === 1 && original?.size === 1 && !original.has([...values][0])
      && !/\b(?:nicht|fruher|statt|ausser|wahlweise|oder|je nach)\b/.test(fold(text))) {
      conflict('same-product-bogo-conflict', `Kaufmenge für ${product} widerspricht der eindeutigen 1+1-/Mehrkaufbedingung.`, ['title']);
    }
  }
  const tiers = voucherTiers(text);
  if (titleRatios.length === 1 && sourceRatios.length === 0 && tiers.length >= 2
    && /wertgutschein/i.test(text) && /von eurer rechnung abgezogen/i.test(text)
    && !/\b(?:zweite\w*|second)\b[^.!?]{0,70}(?:gratis|kostenlos|free)|\bbuy\s+(?:one|1)\b[^.!?]{0,70}\bget\s+(?:one|1)\b[^.!?]{0,30}\bfree\b|\btwo\s*(?:-|\s)?for\s*(?:-|\s)?one\b|\b2\s+for\s+1\b|\bbogo\b|\bzu jedem\b[^.!?]{0,70}(?:gratis|kostenlos)/i.test(text)) {
    conflict('voucher-tier-instead-of-bogo', 'Die Originalaktion gewährt gestaffelte Wertgutscheine; der Titel behauptet stattdessen einen 1+1-Kaufvorteil.', ['title']);
  }
  const sourceEnd = explicitSourceEnd(text), storedEnd = deal.validUntil || deal.validOn;
  const publicDateConflict = sourceEnd && conflictingPublicDate(deal, sourceEnd);
  if (publicDateConflict) {
    // An "am" day can be the event while "bis" is a separate redemption
    // deadline. Never rewrite or quarantine this mixed copy without resolving
    // those roles, even when the stored end itself appears to disagree.
    result.issues.push({ code: 'public-offer-date-conflict', severity: 'review',
      message: 'Abweichende öffentliche End-/Einzeltagangabe benötigt eine eindeutige Zuordnung zur Quellenfrist.',
      fields: [publicDateConflict.field], sourceQuote: sourceEnd.quote, publicQuote: publicDateConflict.publicQuote });
  }
  if (sourceEnd && !publicDateConflict && exactDay(storedEnd) && sourceEnd.day !== storedEnd) {
    conflict('explicit-offer-end-conflict', 'Gespeichertes Ende widerspricht dem eindeutigen Aktionsende mit Jahr.', ['validUntil', 'validOn', 'expires'], sourceEnd.quote);
    if (!protectedOffer(deal, policy, edits) && !fields.has('*') && !offerPeriodFields.some(key => fields.has(key))
      && !result.issues.some(row => row.code !== 'explicit-offer-end-conflict')) result.patch = datePatch(deal, sourceEnd);
  }
  if (result.issues.some(row => row.severity === 'confirmedConflict')) {
    result.status = 'confirmedConflict';
    result.quarantineEligible = !result.patch && !protectedOffer(deal, policy, edits) && !fields.has('*')
      && !result.issues.some(row => row.fields.some(field => fields.has(field))
        || row.code === 'explicit-offer-end-conflict' && (manualPeriod(deal) || offerPeriodFields.some(field => fields.has(field))));
    result.reason = 'positive-source-contradiction';
    return result;
  }
  // A failed numeric/title gate can reflect an incomplete quote, another offer,
  // spelling, or an optional detail. It is advisory, never an automatic hide.
  if (result.issues.length || !titleClaimGuard(deal.title, text) || deniedFree) {
    result.reason = publicDateConflict ? 'public-period-needs-review' : 'claims-or-conditions-need-review';
    result.issues.push({ code: 'source-claim-review', severity: 'review', message: deniedFree || 'Titelbehauptungen nicht vollständig durch diesen Beleg gedeckt.' });
  } else {
    result.status = 'consistent';
    result.reason = 'no-conflict-in-bounded-checks';
  }
  return result;
}

export function auditLiveDealSourceConsistency(deals, { now = new Date(), sourceEvidence = new Map(), edits = [], policy = {} } = {}) {
  const entries = deals.map(deal => assessLiveDealSourceConsistency(deal, { now, latestEvidence: sourceEvidence.get(deal.id), edits, policy }));
  return { version: 1, checkedAt: now.toISOString(), total: entries.length, entries,
    confirmedConflicts: entries.filter(row => row.status === 'confirmedConflict').length,
    reviewNeeded: entries.filter(row => row.status === 'review').length, requests: 0, modelCalls: 0 };
}
