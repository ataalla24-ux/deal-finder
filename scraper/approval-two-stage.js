import { inspectDealContentQuality } from './deal-content-quality-utils.js';
import { hasOnlyPreviewDescription } from './approval-source-evidence.js';
import { ENRICHMENT_MODE, updateDealEnrichment } from './deal-enrichment-state.js';

const normalized = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Deferred editorial polish may not hide a known material redemption condition.
export function basicCopyHold(deal, sourceEvidence, { now = new Date() } = {}) {
  const source = sourceEvidence?.caption || deal.metaGraphCaption || deal.evidence?.textSample || '';
  const canonical = value => String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const title = canonical(deal.title);
  const description = canonical(deal.description);
  // Current official verification already compared the complete original offer
  // identity, amounts, timing and text on this exact run, before editorial copy.
  if (deal.originSource === 'power-official-food' && deal.officialFoodReverifiedAt === now.toISOString()) return '';
  if (!source) return 'Grundprüfung: Für die offene Inhaltsprüfung liegt noch kein ausreichender Angebotsbeleg vor.';
  const original = canonical(source);
  const completeCopy = description && [description, `${title} ${description}`,
    `${canonical(deal.prePublicationTitleEdit?.originalTitle)} ${description}`.trim()].includes(original);
  // A genuine title-only source has no additional known terms to hide. Every
  // other incomplete/paraphrased source must finish grounded review first;
  // keyword overlap cannot prove amounts, weekdays or redemption restrictions.
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titleBound = title && new RegExp(`(?<![\\p{L}\\p{N},.+-])${escapedTitle}(?![\\p{L}\\p{N}]${/\d$/.test(title) ? '|[,.+\\-]\\d' : ''})`, 'u').test(original);
  if (!titleBound || !completeCopy && !(hasOnlyPreviewDescription(deal) && original === title)) {
    return 'Grundprüfung: Vollständige Pflichtbedingungen und Beträge müssen vor der Veröffentlichung belegt sein.';
  }
  const issues = inspectDealContentQuality({ ...deal, metaGraphCaption: source });
  return issues.some(issue => ['source-condition-missing', 'unresolved-merchant', 'street-as-merchant', 'location-as-merchant'].includes(issue.code))
    ? 'Grundprüfung: Anbieter oder notwendige Einlösebedingungen sind noch nicht ausreichend belegt.' : '';
}

export function prepareTwoStagePublication(deal, { now = new Date(), sourceEvidence } = {}) {
  const pendingCopy = hasOnlyPreviewDescription(deal) || deal.approvalCopyReview?.deferred || deal.approvalCopyReview?.waitingForSlot;
  return updateDealEnrichment({ ...deal, approvalPublicationMode: ENRICHMENT_MODE }, {
    pendingFields: pendingCopy ? ['description'] : [], now,
  });
}
