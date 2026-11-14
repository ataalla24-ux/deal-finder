import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { offerPeriodFields, hasReviewedOfferPeriod } from './offer-period-fields.js';

// One reviewed public voucher, not a general reader for login-only coupons.
const URL = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const TITLE = '1+1 gratis Pasta mit VAPIANO Studentenrabatt genießen!';
const INTRO = 'Für extra viel Amore: Hol dir diesen verführenden VAPIANO Studentenrabatt aus dem neuen Gutscheinheft mit 1+1 gratis Pasta über die VAPIANO Lovers App. So gönnst du dir und deiner Begleitung eine wohlverdiente Pause vom Studi-Alltag!';
// Full visible terms, including registration-only code, pasta choices, 30-day
// redemption, Austria excluding Linz and one use per person. Changed terms need
// a new review; unrelated page fragments cannot replace a missing condition.
const TERMS_HASH = '3343bc62eb9c5f17b92bc0bd2db0b64cb698cab2946111393a318fd6f958adef';
const CAPTION_HASH = '78eb8feac3d6ec7106841a64606100ba60da5ac93452b56700ae7d3076892033';
const REVIEWED_TITLE = 'VAPIANO: 1+1 Pasta für App-Neukunden';
const QUEUE_TITLE = '1+1 gratis Pasta bei Neuanmeldung in der VAPIANO Lovers App (Pomodoro, Carbonara, Bolognese oder Bolognese vegan)';
const REVIEWED_DESCRIPTION = 'Bei Neuanmeldung in der VAPIANO Lovers App den Joining Code PASTALOVER während der Registrierung eingeben. Für Studierende: Zwei Pasta-Gerichte bestellen, eines gratis (Pomodoro, Carbonara, Bolognese oder Bolognese vegan). Die Prämie unter „Prämien“ in den Warenkorb legen oder einem Vapianisti Bescheid sagen. Binnen 30 Tagen nach Anmeldung einlösen, einmal pro Person. Gültig in allen VAPIANO-Restaurants in Österreich außer Linz.';
const clean = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const hash = value => createHash('sha256').update(value).digest('hex');

export function isSupportedIamstudentApprovalUrl(value) {
  return value === URL;
}

export function isReviewedIamstudentApprovalEvidence(deal, evidence) {
  return isSupportedIamstudentApprovalUrl(deal?.url) && evidence?.sourceUrl === deal.url
    && evidence.sourceKind === 'iamstudent-public-voucher' && evidence.voucherId === '13585'
    && !evidence.blockingReason && evidence.contentHash === CAPTION_HASH
    && typeof evidence.caption === 'string' && hash(evidence.caption) === CAPTION_HASH;
}

// Reusable only with the exact current reviewed source; callers still enforce
// their own live/manual-field and evidence-age protections.
export function reviewedIamstudentCopy(evidence) {
  return isReviewedIamstudentApprovalEvidence({ url: URL }, evidence)
    ? { title: REVIEWED_TITLE, description: REVIEWED_DESCRIPTION } : null;
}

// Correct only the captured, unedited machine period on this one pending row.
// The current source proves availability and a personal 30-day redemption rule,
// not a calendar end. Neither a saved correction nor a copy memo is fresh proof.
export function prepareIamstudentApprovalPeriod(deal, evidence, { existingIds = new Set(), now } = {}) {
  if (!isReviewedIamstudentApprovalEvidence(deal, evidence) || deal.id !== 'g2-15kbyb4'
    || deal.source !== 'Slack Digest' || deal.originSource !== 'Firecrawl Gastro #2'
    || deal.pipelineLifecycle?.manualDecision !== 'approved'
    || existingIds.has(deal.id) || deal.pipelineLifecycle.publishedAt || deal.pipelineLifecycle.stage === 'published'
    || deal.editedInSlack || deal.slackEditedAt || deal.slackFormEditTs || deal.liveEditedAt
    || deal.isBusiness || deal.campaignId || deal.forceKeep || hasReviewedOfferPeriod(deal)
    || [...(deal.slackEditedFields || []), ...(deal.liveEditedFields || [])].length
    || clean(deal.title) !== QUEUE_TITLE || clean(deal.description)
    || deal.expires !== '2027-02-28' || deal.expiresOriginal !== 'bis 28.02.2027'
    || deal.validUntil !== '2027-02-28T12:00:00.000Z' || deal.expiryDisplayText !== '2027-02-28'
    || deal.expiryKind !== 'end' || deal.dateConfidence !== 'medium'
    || deal.expiresSource !== 'deal.structured' || deal.expirySource !== 'deal.structured'
    || ['validOn', 'validFrom', 'end_date', 'validity_date', 'validityText', 'expiresPrecision'].some(key => clean(deal[key]))
    || deal.expiresDetectedFromUrl || Object.keys(deal.evidence || {}).length
    || !(now instanceof Date) || !Number.isFinite(now.getTime())
    || now.getTime() >= Date.parse('2027-02-28T00:00:00.000Z')) return deal;
  const previousPeriod = Object.fromEntries(offerPeriodFields.filter(key => Object.hasOwn(deal, key)).map(key => [key, deal[key]]));
  const corrected = { ...deal };
  for (const key of offerPeriodFields) delete corrected[key];
  corrected.expiryKind = 'unknown';
  // Audit only: validators read the top-level offer period, never this history.
  corrected.unverifiedPeriodCorrection = { method: 'iamstudent-unverified-machine-end-v1',
    checkedAt: now.toISOString(), sourceUrl: URL, contentHash: CAPTION_HASH,
    previousPeriod, previousPeriodHash: hash(JSON.stringify(previousPeriod)) };
  return corrected;
}

// Reviewed fixed wording for this one complete current offer. This is not
// an AI review memo and is not permission to publish, change dates or add pins.
// The caller supplies evidence only from this attempt's successful health GET.
export function prepareIamstudentApprovalCopy(deal, evidence, { existingIds = new Set() } = {}) {
  // The ordinary reaction runner sets approvedAt before validation. Only live
  // membership or an actual publication lifecycle marks an already live deal.
  if (!isReviewedIamstudentApprovalEvidence(deal, evidence) || deal.pipelineLifecycle?.manualDecision !== 'approved'
    || existingIds.has(deal.id) || deal.pipelineLifecycle.publishedAt || deal.pipelineLifecycle.stage === 'published'
    || deal.editedInSlack || deal.slackEditedAt
    || deal.slackFormEditTs || deal.liveEditedAt || deal.isBusiness || deal.campaignId || deal.forceKeep
    || [...(deal.slackEditedFields || []), ...(deal.liveEditedFields || [])].length
    || !['', TITLE, QUEUE_TITLE, REVIEWED_TITLE].includes(clean(deal.title))) return deal;
  const patch = {};
  if (!clean(deal.title) || [TITLE, QUEUE_TITLE].includes(clean(deal.title))) patch.title = REVIEWED_TITLE;
  if (!clean(deal.description)) patch.description = REVIEWED_DESCRIPTION;
  if (!Object.keys(patch).length) return deal;
  return { ...deal, ...patch, reviewedSourceCopy: { method: 'reviewed-source-template-v1',
    sourceUrl: URL, contentHash: CAPTION_HASH, fields: Object.keys(patch) } };
}

// This reviewed source supplies only a personal 30-day redemption period, not
// a calendar deadline. Apart from the exact machine correction above, existing
// absolute ends remain held; never derive an end from the countdown.
export function iamstudentApprovalDateHold(deal, evidence) {
  if (!isReviewedIamstudentApprovalEvidence(deal, evidence)) return '';
  const structuredEnd = [deal.validUntil, deal.validOn, deal.evidence?.offerTiming?.validUntil].some(value => clean(value));
  const literalEnd = [deal.expires, deal.expiresOriginal, deal.expiryDisplayText, deal.end_date, deal.validity_date]
    .some(value => /\b20\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2}\b/.test(clean(value)));
  return structuredEnd || literalEnd
    ? 'Aktionszeitraum widersprüchlich: Der aktuelle IAMSTUDENT-Beleg bestätigt kein Kalenderende; das gespeicherte Enddatum bleibt zur Prüfung erhalten.'
    : '';
}

// Pure parsing only: the caller must supply this run's successful existing URL
// health response. No fetch, account action, model, state write or date inference.
export function extractIamstudentApprovalSourceEvidence(html, requestedUrl, finalUrl = requestedUrl) {
  if (!isSupportedIamstudentApprovalUrl(requestedUrl)) return null;
  const hold = detail => ({ sourceUrl: requestedUrl, blockingReason: detail });
  if (finalUrl !== URL || typeof html !== 'string' || Buffer.byteLength(html) > 4000000)
    return hold('Aktueller IAMSTUDENT-Gutschein nicht eindeutig lesbar.');
  const $ = load(html);
  const canonical = $('head link[rel="canonical"]'), ogUrl = $('head meta[property="og:url"]');
  if (canonical.length !== 1 || canonical.attr('href') !== URL || ogUrl.length !== 1 || ogUrl.attr('content') !== URL)
    return hold('IAMSTUDENT-Quelle stimmt nicht mit dem geprüften Gutschein überein.');

  // These are inactive provider UI templates, not evidence that this offer has
  // expired. Visible versions remain and are checked below.
  $('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],.voucher-hidden,.hidden,.modal,.hidden-logged-out,.collapse:not(.in)').remove();
  $('[style]').filter((_, node) => /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(node).attr('style'))).remove();
  const text = node => {
    const copy = $(node).clone();
    copy.find('br').replaceWith(' ');
    copy.find('p,li,div,h2,h3').append(' ');
    return clean(copy.text());
  };
  const wrapper = $('body.voucher-detail > div[data-voucher-page="13585"][data-track-entity="voucher"][data-track-id="13585"][data-page-company="128"]');
  const main = wrapper.children('main#main-content');
  const header = main.find('.header-voucher');
  const termsPanel = main.find('#voucherAccordion > #infosTab > #infos[aria-expanded="true"] > .panel-body-accordion');
  if (wrapper.length !== 1 || $('[data-voucher-page]').length !== 1 || main.length !== 1
    || $('main#main-content').length !== 1 || header.length !== 1 || termsPanel.length !== 1)
    return hold('Öffentlicher IAMSTUDENT-Angebotstext oder Gutscheinbedingungen fehlen.');
  const visibleRefusal = main.find('[data-voucher-show="sold_out"],[data-voucher-show="sold_out_text"],[data-voucher-show="not_yet"],[data-voucher-show="no_permission"],[data-voucher-show="!permission_type"]');
  const primaryAlerts = main.find('[role="alert"],.alert').filter((_, node) => !$(node).closest('#ratingsTab,aside,#comments').length);
  if (visibleRefusal.length || /nicht mehr verfügbar|noch nicht verfügbar|vergriffen|abgelaufen|keine Berechtigung/i.test([text(header), text(primaryAlerts)].join(' ')))
    return hold('IAMSTUDENT zeigt keine aktuell öffentlich nutzbare Gutscheinaktion.');

  const title = header.children('h1');
  const saving = title.next('span.label-saving');
  const intro = saving.next('p');
  const availability = header.children('.row.infos');
  if (title.length !== 1 || text(title) !== TITLE || text(saving) !== '50% Ersparnis'
    || intro.length !== 1 || text(intro) !== INTRO || availability.length !== 1
    || !/^läuft noch [1-9]\d{0,3} (?:Tage?|Stunden?) Verfügbarkeit ∞$/.test(text(availability))
    || !header.find('[data-voucher-show="can_use"]').length)
    return hold('IAMSTUDENT-Angebot oder sichtbare Verfügbarkeit ist verändert oder widersprüchlich.');
  const heading = termsPanel.children('h2');
  if (heading.length !== 1 || text(heading) !== 'Gutscheinbedingungen')
    return hold('Öffentliche IAMSTUDENT-Gutscheinbedingungen fehlen.');
  const terms = termsPanel.clone();
  terms.children('h2').remove();
  const conditions = text(terms);
  if (hash(conditions) !== TERMS_HASH)
    return hold('IAMSTUDENT-Gutscheinbedingungen sind verändert, unvollständig oder nicht öffentlich lesbar.');
  // Countdown is solely an availability signal. It is never turned into an
  // absolute offer deadline; the source states a personal redemption period.
  const caption = `${TITLE}\n${INTRO}\n${conditions}`;
  return { sourceUrl: requestedUrl, caption, sourceKind: 'iamstudent-public-voucher',
    voucherId: '13585', contentHash: hash(caption) };
}
