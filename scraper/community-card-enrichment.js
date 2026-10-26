import crypto from 'node:crypto';
import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import { isCommunitySubmission } from './community-review-utils.js';
import { concreteFoodOfferTitle } from './offer-title-utils.js';
import { discoveryRejection } from './deal-discovery-policy.js';

const text = value => String(value || '').replace(/\s+/g, ' ').trim();
const linkOnly = value => !text(value).replace(/https?:\/\/\S+/gi, '').trim();
const genericTitle = value => !text(value) || /(?:^Community-Deal|[- ]Deal geteilt$|^Instagram$|^TikTok$)/i.test(text(value));
const genericBrand = value => !text(value) || /^(?:Community Fund|Instagram|TikTok|Facebook)$/i.test(text(value));
const genericPlace = value => !text(value) || /^(?:Wien|Bitte prüfen)$/i.test(text(value));
const expiryFields = ['expires', 'expiresOriginal', 'expiresSource', 'expirySource', 'expiryKind', 'expiryDisplayText', 'validOn', 'validFrom', 'validUntil', 'dateConfidence'];
const copyFields = ['title', 'brand', 'description', 'distance', 'address', 'category', ...expiryFields];
const fingerprint = deal => JSON.stringify(copyFields.map(key => text(deal[key])));

export function communityHasHumanDecision(deal) {
  return Boolean(deal.editedInSlack || deal.slackEditedAt || deal.slackFormEditTs
    || deal.slackEditedFields?.length || deal.liveEditedAt || deal.liveEditedFields?.length
    || deal.approvedAt || deal.rejectedAt || deal.pipelineLifecycle?.publishedAt
    || deal.pipelineLifecycle?.manualDecision || deal.manualDecision);
}

function missingFields(deal) {
  return [
    genericTitle(deal.title) && 'Angebot/Titel',
    genericBrand(deal.brand) && 'Anbieter',
    linkOnly(deal.description) && 'Beschreibung/Bedingungen',
    genericPlace(deal.address || deal.distance) && 'Genaue Adresse/Standorte',
    !text(deal.expires || deal.validOn || deal.validFrom || deal.validUntil) && 'Gültigkeit',
  ].filter(Boolean);
}

// Exact-post evidence only. This is a review draft, never an approval or proof of validity.
export function enrichCommunityCard(deal, graphEvidence = new Map()) {
  if (!isCommunitySubmission(deal) || communityHasHumanDecision(deal)) return deal;
  const key = canonicalInstagramPostKey(deal.url);
  const graph = key && graphEvidence.get(key);
  if (!graph || canonicalInstagramPostKey(graph.url) !== key || graph.blockingReason || graph.graphAccepted === false) return deal;
  const caption = [graph.caption, graph.ocrText].map(text).filter(Boolean).join('\n');
  if (!caption || caption.length > 5000) return deal;
  const next = { ...deal };
  const title = concreteFoodOfferTitle(caption);
  if (genericTitle(next.title) && title && title.length <= 100) next.title = title;
  if (linkOnly(next.description)) next.description = caption;
  else if (!text(next.description).includes(text(caption))) {
    const combined = `${next.description}\n\nOriginalbeitrag:\n${caption}`;
    if (combined.length <= 6000) next.description = combined;
  }
  next.missingFields = missingFields(next);
  next.communityExtraction = { ...deal.communityExtraction, sourceStatus: 'graph-evidence',
    status: genericTitle(next.title) ? 'needs-review' : 'draft', requiresReview: true };
  return next;
}

function originalPlaceholderCopy(deal) {
  const submitted = deal.submittedContent;
  if (!submitted || !genericTitle(submitted.title) || !genericTitle(deal.title)) return deal;
  const next = { ...deal };
  // Recover old generic-brand substitutions, including URLs damaged by that substitution.
  if (genericBrand(submitted.brand)) next.brand = submitted.brand;
  const substitutedUrl = text(submitted.description).replaceAll(text(submitted.brand), text(deal.brand));
  const substitutedLowerUrl = text(submitted.description).replaceAll(text(submitted.brand).toLowerCase(), text(deal.brand));
  if (linkOnly(submitted.description) && (linkOnly(deal.description)
    || text(deal.description) === substitutedUrl || text(deal.description) === substitutedLowerUrl)) next.description = submitted.description;
  return next;
}

export function prepareCommunityCardRefresh(deal, candidates, graphEvidence = new Map()) {
  if (!isCommunitySubmission(deal) || communityHasHumanDecision(deal) || deal.approvalBlock
    || deal.metaGraphBlockingReason || deal.validity?.status === 'blocked') return null;
  const key = canonicalInstagramPostKey(deal.url);
  if (!key) return null;
  let next = originalPlaceholderCopy(deal);
  const used = [];
  for (const candidate of candidates) {
    if (!isCommunitySubmission(candidate) || canonicalInstagramPostKey(candidate.url) !== key
      || communityHasHumanDecision(candidate) || candidate.approvalBlock || candidate.metaGraphBlockingReason) continue;
    const before = fingerprint(next);
    next = { ...next };
    if (genericTitle(next.title) && !genericTitle(candidate.title)) next.title = candidate.title;
    if (genericBrand(next.brand) && !genericBrand(candidate.brand)) next.brand = candidate.brand;
    if (genericPlace(next.address || next.distance) && !genericPlace(candidate.address || candidate.distance)) {
      next.address = candidate.address || candidate.distance;
      next.distance = candidate.distance || candidate.address;
    }
    if (!text(next.expires || next.validOn || next.validFrom || next.validUntil)
      && text(candidate.expires || candidate.validOn || candidate.validFrom || candidate.validUntil)) {
      for (const field of expiryFields) if (candidate[field] !== undefined) next[field] = candidate[field];
    }
    if (linkOnly(next.description) && !linkOnly(candidate.description)) next.description = candidate.description;
    if (fingerprint(next) !== before) {
      if (!linkOnly(candidate.description) && !text(next.description).includes(text(candidate.description))) {
        const combined = `${next.description}\n\nErgänzende Einreichung:\n${candidate.description}`;
        if (combined.length <= 6000) next.description = combined;
      }
      used.push(candidate);
    }
  }
  next = enrichCommunityCard(next, graphEvidence);
  if (/^(?:wien|shopping|sonstiges)?$/i.test(text(next.category)) && concreteFoodOfferTitle(next.title)) next.category = 'essen';
  if (fingerprint(next) === fingerprint(deal)) return null;
  const hash = crypto.createHash('sha256').update(fingerprint(next)).digest('hex');
  // Intake replays and Slack round-trips must not repeatedly rewrite an unchanged card.
  if (deal.communityCardRefresh?.copyHash === hash) return null;
  return { ...next, missingFields: missingFields(next),
    communityExtraction: { ...next.communityExtraction, requiresReview: true },
    communityCardRefresh: { version: 1, copyHash: hash },
    communityLinkedSubmissionIds: [...new Set([
      ...(deal.communityLinkedSubmissionIds || []),
      ...used.map(candidate => candidate.submissionId || String(candidate.id).replace(/^community:/, '')),
    ])],
  };
}

export function untouchedCommunityThread(result, deal, replacement) {
  if (!result?.ok || result.has_more || result.response_metadata?.next_cursor) return false;
  const messages = result.messages;
  if (!Array.isArray(messages) || !messages.length
    || messages.some(message => !message.bot_id || message.reactions?.length)) return false;
  const target = messages.find(message => message.ts === deal.slackTs);
  if (!target?.text?.includes(`Deal-ID: ${deal.id}`)) return false;
  return [deal.title, deal.submittedContent?.title, replacement?.title]
    .filter(Boolean).some(title => target.text.includes(title));
}

export async function refreshQueuedCommunityCards(queue, candidates, {
  graphEvidence = new Map(), liveDeals = [], isUntouched, updateMessage, persist,
  maxChecks = 8, maxUpdates = 4, now = new Date(),
}) {
  const liveIds = new Set(liveDeals.map(deal => deal.id));
  const livePosts = new Set(liveDeals.map(deal => canonicalInstagramPostKey(deal.url)).filter(Boolean));
  const next = [...queue];
  let checked = 0;
  let updated = 0;
  for (let i = 0; i < next.length && checked < maxChecks && updated < maxUpdates; i++) {
    const deal = next[i];
    if (!deal.slackTs || !deal.slackThreadTs || liveIds.has(deal.id)
      || livePosts.has(canonicalInstagramPostKey(deal.url))) continue;
    const replacement = prepareCommunityCardRefresh(deal, candidates, graphEvidence);
    if (!replacement || discoveryRejection(replacement)) continue;
    checked++;
    try {
      if (!await isUntouched(deal, replacement)) continue;
      if (!await updateMessage(replacement)) continue;
    } catch { continue; }
    next[i] = { ...replacement, communityCardRefresh: {
      ...replacement.communityCardRefresh, updatedAt: now.toISOString(),
    } };
    // A failed disk write must fail the job; ACK happens only after persisted Slack success.
    await persist(next);
    updated++;
  }
  return { deals: next, checked, updated };
}

export function postedCommunitySubmissionIds(deals) {
  return [...new Set(deals.filter(deal => isCommunitySubmission(deal) && deal.slackTs).flatMap(deal =>
    [deal.submissionId || String(deal.id).replace(/^community:/, ''), ...(deal.communityLinkedSubmissionIds || [])]
      .filter(Boolean).map(id => String(id).replace(/^community:/, ''))))];
}
