import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSocialFoodFunnel,
  buildSocialFoodReviewDeal,
  buildStratifiedAuditSample,
  cleanText,
  dedupeAuditRows,
  normalizeSocialAuditCandidate,
} from './social-food-audit-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DEFAULT_AUDIT_PATH = path.join(DOCS_DIR, 'social-food-candidate-audit.json');
const DEFAULT_REVIEW_PATH = path.join(DOCS_DIR, 'deals-review-social-food.json');
const DEFAULT_FEEDBACK_PATH = path.join(DOCS_DIR, 'deal-review-feedback.json');
const DEFAULT_REVIEW_POSTS_PER_DAY = 16;

const SOURCE_SPECS = [
  {
    key: 'instagram-ai',
    label: 'Instagram AI Agent',
    report: 'instagram-ai-report.json',
    output: 'deals-pending-instagram-ai.json',
  },
  {
    key: 'tiktok',
    label: 'TikTok Deal Scanner',
    report: 'tiktok-scanner-report.json',
    output: 'deals-pending-tiktok.json',
  },
  {
    key: 'meta-instagram',
    label: 'Meta Instagram Graph',
    report: 'meta-instagram-report.json',
    output: 'deals-pending-meta-instagram.json',
    graphEvidence: 'instagram-graph-post-evidence.json',
  },
  {
    key: 'wien-combined',
    label: 'Wien Deals Combined',
    report: 'wien-deals-combined-report.json',
    output: 'deals-pending-wien-combined.json',
  },
];

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function sourceRejectedRows(report = {}) {
  if (Array.isArray(report.candidateAudit)) {
    return report.candidateAudit.filter((row) => row?.status !== 'collector-accepted' && row?.status !== 'accepted');
  }
  return Array.isArray(report.rejected) ? report.rejected : [];
}

function sourceAcceptedAuditRows(report = {}) {
  if (!Array.isArray(report.candidateAudit)) return [];
  return report.candidateAudit.filter((row) => row?.status === 'collector-accepted' || row?.status === 'accepted');
}

function pendingDeals(payload = {}) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.deals) ? payload.deals : [];
}

function normalizeUsername(value) {
  return cleanText(value, 80).replace(/^@/, '').toLowerCase();
}

function verifiedMerchantRegistry(docsDir) {
  const registry = readJson(path.join(docsDir, 'instagram-merchant-registry.json'), {});
  return new Map((Array.isArray(registry?.accounts) ? registry.accounts : [])
    .filter((account) => (
      account?.accountType === 'merchant'
      && account?.viennaVerified === true
      && account?.blockedByModeration !== true
    ))
    .map((account) => [normalizeUsername(account.username), account])
    .filter(([username]) => username));
}

function flattenCandidate(row = {}, status, merchantRegistry = new Map()) {
  const ownerUsername = normalizeUsername(
    row.ownerUsername || row.accountHandle || row.username || row.sourceAccount,
  );
  const verifiedMerchant = merchantRegistry.get(ownerUsername);
  return {
    ...row,
    status,
    rejectionReason: row.rejectionReason || row.reason,
    text: row.text || row.textSample || row.caption || row.description,
    mediaEvidence: row.mediaEvidence || row.evidence?.mediaEvidence || row.evidence?.socialMediaEvidence,
    ...(verifiedMerchant ? {
      ownerUsername,
      ownerRole: 'merchant',
      merchantUsername: row.merchantUsername || ownerUsername,
      viennaVerified: true,
      registryViennaEvidence: verifiedMerchant.verificationSource || 'verified-merchant-registry',
    } : {}),
  };
}

function sourceRunMetrics(spec, report = {}) {
  const media = report.mediaEvidence || report.sources?.instagramGraph?.mediaEvidence || {};
  const classifier = report.aiUsage || {};
  return {
    source: spec.key,
    generatedAt: cleanText(report.generatedAt || report.lastUpdated, 80),
    discovered: Number(
      report.discoveredCandidates
      ?? report.apiCandidates
      ?? report.freshPostsFetched
      ?? report.uniquePosts
      ?? 0
    ),
    collectorAccepted: Number(report.acceptedDeals ?? report.accepted ?? report.verifiedDeals ?? report.totalDeals ?? 0),
    mediaEligible: Number(media.eligible || 0),
    mediaSelected: Number(media.selected || 0),
    mediaAnalyzed: Number(media.analyzed || 0),
    mediaAiCalls: Number(media.aiCalls || 0),
    mediaAiAccepted: Number(media.aiAccepted || 0),
    mediaRescued: Number(media.rescuedDeals || report.rescuedDeals || 0),
    mediaInputTokens: Number(media.inputTokens || 0),
    mediaOutputTokens: Number(media.outputTokens || 0),
    mediaTotalTokens: Number(media.totalTokens || 0),
    mediaErrors: Array.isArray(media.errors) ? media.errors.slice(0, 20) : [],
    classifierInputTokens: Number(classifier.inputTokens || 0),
    classifierOutputTokens: Number(classifier.outputTokens || 0),
    classifierTotalTokens: Number(classifier.totalTokens || 0),
    totalAiTokens: Number(media.totalTokens || 0) + Number(classifier.totalTokens || 0),
  };
}

export function collectSocialFoodObservations(options = {}) {
  const docsDir = options.docsDir || DOCS_DIR;
  const now = options.now instanceof Date ? options.now : new Date();
  const observations = [];
  const runMetrics = [];
  const merchantRegistry = verifiedMerchantRegistry(docsDir);
  for (const spec of options.sourceSpecs || SOURCE_SPECS) {
    const report = readJson(path.join(docsDir, spec.report), {});
    const output = readJson(path.join(docsDir, spec.output), {});
    const defaults = { source: spec.key, sourceLabel: spec.label };
    for (const row of sourceRejectedRows(report)) {
      observations.push(normalizeSocialAuditCandidate({
        ...flattenCandidate(row, 'rejected', merchantRegistry),
        auditSource: spec.key,
        sourceLabel: spec.label,
      }, defaults, now));
    }
    for (const row of sourceAcceptedAuditRows(report)) {
      observations.push(normalizeSocialAuditCandidate({
        ...flattenCandidate(row, 'collector-accepted', merchantRegistry),
        auditSource: spec.key,
        sourceLabel: spec.label,
      }, defaults, now));
    }
    const acceptedAuditKeys = new Set(sourceAcceptedAuditRows(report)
      .map((row) => cleanText(row.url || row.permalink, 1200))
      .filter(Boolean));
    for (const deal of pendingDeals(output)) {
      if (acceptedAuditKeys.has(cleanText(deal.url, 1200))) continue;
      observations.push(normalizeSocialAuditCandidate({
        ...flattenCandidate(deal, 'collector-accepted', merchantRegistry),
        auditSource: spec.key,
        sourceLabel: spec.label,
      }, defaults, now));
    }
    if (spec.graphEvidence) {
      const graphEvidence = readJson(path.join(docsDir, spec.graphEvidence), {});
      for (const post of Array.isArray(graphEvidence.posts) ? graphEvidence.posts : []) {
        observations.push(normalizeSocialAuditCandidate({
          id: post.mediaId,
          auditSource: spec.key,
          sourceLabel: spec.label,
          status: post.graphAccepted === true ? 'collector-accepted' : 'rejected',
          url: post.url,
          caption: post.caption,
          ownerUsername: post.ownerUsername,
          pubDate: post.sourcePublishedAt,
          rejectionReason: post.graphRejection || post.blockingReason,
          mediaEvidence: {
            ocrText: post.ocrText,
            analyzedAt: post.verifiedAt,
          },
        }, defaults, now));
      }
    }
    runMetrics.push(sourceRunMetrics(spec, report));
  }
  return { observations, runMetrics };
}

function recentFeedbackMetrics(events, now) {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => {
    const category = cleanText(event.category, 80).toLowerCase();
    const foodDrinkEvent = event.socialFoodReview === true
      || ['essen', 'kaffee', 'food', 'food & drink', 'restaurant'].includes(category);
    if (!foodDrinkEvent) return false;
    const timestamp = Date.parse(event.decidedAt || event.manualDecisionAt || '');
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  const approvals = recent.filter((event) => event.decision === 'approved');
  const rejections = recent.filter((event) => event.decision === 'rejected');
  const published = recent.filter((event) => event.publicationStatus === 'published');
  const reviewMinutes = approvals.map((event) => {
    const sent = Date.parse(event.slackSentAt || '');
    const decided = Date.parse(event.decidedAt || event.manualDecisionAt || '');
    return Number.isFinite(sent) && Number.isFinite(decided) && decided >= sent
      ? (decided - sent) / 60000
      : null;
  }).filter((value) => typeof value === 'number');
  return {
    windowDays: 7,
    manuallyApproved: approvals.length,
    manuallyRejected: rejections.length,
    published: published.length,
    approvalRate: approvals.length + rejections.length > 0
      ? Number((approvals.length / (approvals.length + rejections.length)).toFixed(3))
      : null,
    approvedPerDay: Number((approvals.length / 7).toFixed(2)),
    averageReviewMinutesPerApproval: reviewMinutes.length
      ? Number((reviewMinutes.reduce((sum, value) => sum + value, 0) / reviewMinutes.length).toFixed(1))
      : null,
  };
}

function reviewPriority(row) {
  const ageBonus = typeof row.ageDays === 'number' ? Math.max(0, 7 - row.ageDays) * 3 : 0;
  const mediaBonus = row.media.aiAccepted ? 24 : (row.media.attempted ? 5 : 0);
  const merchantBonus = row.merchantUsername ? 12 : 0;
  return row.foodDrinkScore * 20 + ageBonus + mediaBonus + merchantBonus + Number(row.collectorScore || 0) * 0.1;
}

function selectReviewRows(rows, limit) {
  const selected = [];
  const sourceCounts = new Map();
  const eligible = rows
    .filter((row) => row.reviewEligible)
    .sort((left, right) => reviewPriority(right) - reviewPriority(left) || left.key.localeCompare(right.key));
  for (const row of eligible) {
    const sourceCount = sourceCounts.get(row.source) || 0;
    const sourceLimit = Math.max(4, Math.ceil(limit * 0.55));
    if (sourceCount >= sourceLimit) continue;
    selected.push(row);
    sourceCounts.set(row.source, sourceCount + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function buildSocialFoodArtifacts(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const observations = Array.isArray(options.observations) ? options.observations : [];
  const uniqueRows = dedupeAuditRows(observations);
  const feedbackEvents = Array.isArray(options.feedbackEvents) ? options.feedbackEvents : [];
  const sampleLimit = Math.max(50, Math.min(100, Number(options.sampleLimit || 80)));
  const reviewLimit = Math.max(1, Math.min(100, Number(options.reviewLimit || 60)));
  const auditSample = buildStratifiedAuditSample(uniqueRows, sampleLimit);
  const reviewRows = selectReviewRows(uniqueRows, reviewLimit);
  const reviewDeals = reviewRows.map((row) => buildSocialFoodReviewDeal(row, now)).filter(Boolean);
  const runMetrics = Array.isArray(options.runMetrics) ? options.runMetrics : [];
  const totalTokens = runMetrics.reduce((sum, row) => (
    sum + Number(row.totalAiTokens ?? row.mediaTotalTokens ?? 0)
  ), 0);
  const manualMetrics = recentFeedbackMetrics(feedbackEvents, now);

  const audit = {
    version: 1,
    generatedAt: now.toISOString(),
    objective: 'Maximize manually approved, current Vienna food and drink deals per review minute.',
    primaryMetric: 'manuallyApprovedNewFoodDealsPerDay',
    guardrails: {
      ordinarySocialPostMaxAgeDays: 7,
      futureOfferException: 'Only with an explicit, evidenced future validity window.',
      technicalAcceptanceIsHumanApproval: false,
      sampleSize: auditSample.length,
    },
    funnel: buildSocialFoodFunnel(uniqueRows, feedbackEvents),
    manualOutcomeMetrics: manualMetrics,
    costMetrics: {
      mediaTokensThisSnapshot: totalTokens,
      mediaTokensPerManualApproval7d: manualMetrics.manuallyApproved > 0
        ? Math.round(totalTokens / manualMetrics.manuallyApproved)
        : null,
      apiCurrencyCostPerApproval: null,
      note: 'Currency cost remains null until provider billing data is persisted per run.',
    },
    sourceRuns: runMetrics,
    observations: {
      total: observations.length,
      uniquePosts: uniqueRows.length,
      reviewEligible: reviewRows.length,
    },
    auditSample,
  };
  const review = {
    version: 1,
    generatedAt: now.toISOString(),
    source: 'social-food-review',
    totalDeals: reviewDeals.length,
    policy: {
      maxSlackPostsPerDay: DEFAULT_REVIEW_POSTS_PER_DAY,
      maxPostAgeDays: 7,
      requiresFoodDrinkSignal: true,
      requiresDealSignal: true,
      requiresViennaSignal: true,
      hardRejectionsExcluded: true,
    },
    deals: reviewDeals,
  };
  return { audit, review };
}

export function buildAndWriteSocialFoodAudit(options = {}) {
  const docsDir = options.docsDir || DOCS_DIR;
  const now = options.now instanceof Date ? options.now : new Date();
  const collected = collectSocialFoodObservations({ ...options, docsDir, now });
  const feedback = readJson(options.feedbackPath || path.join(docsDir, path.basename(DEFAULT_FEEDBACK_PATH)), {});
  const feedbackEvents = Array.isArray(feedback.events) ? feedback.events : [];
  const artifacts = buildSocialFoodArtifacts({
    ...options,
    ...collected,
    feedbackEvents,
    now,
  });
  if (options.write !== false) {
    writeJsonAtomic(options.auditPath || path.join(docsDir, path.basename(DEFAULT_AUDIT_PATH)), artifacts.audit);
    writeJsonAtomic(options.reviewPath || path.join(docsDir, path.basename(DEFAULT_REVIEW_PATH)), artifacts.review);
  }
  return artifacts;
}

export { DEFAULT_AUDIT_PATH, DEFAULT_REVIEW_PATH, SOURCE_SPECS };
