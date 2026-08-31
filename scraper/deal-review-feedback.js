import fs from 'node:fs';
import path from 'node:path';

import { canonicalSocialPostKey } from './deal-evidence-utils.js';

export const APPROVAL_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark', 'check']);
export const REJECTION_REACTIONS = new Set([
  'x',
  'negative_squared_cross_mark',
  'no_entry_sign',
  'thumbsdown',
  '-1',
]);

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isoTimestamp(value, fallback = '') {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function reviewFeedbackKey(deal = {}) {
  const postKey = canonicalSocialPostKey(deal.url);
  if (postKey) return postKey;
  const slackTs = cleanText(deal.slackTs, 80);
  if (slackTs) return `slack:${slackTs}`;
  const id = cleanText(deal.id, 240);
  if (id) return `deal:${id}`;
  return '';
}

export function normalizeReviewFeedbackStore(value = {}) {
  const events = ensureArray(value?.events)
    .filter((event) => event && typeof event === 'object' && cleanText(event.key, 300))
    .map((event) => ({
      ...event,
      key: cleanText(event.key, 300),
      decision: ['approved', 'rejected'].includes(cleanText(event.decision, 20))
        ? cleanText(event.decision, 20)
        : '',
    }));
  return {
    version: 1,
    updatedAt: isoTimestamp(value?.updatedAt),
    events,
  };
}

export function loadReviewFeedback(filePath) {
  try {
    return normalizeReviewFeedbackStore(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return normalizeReviewFeedbackStore();
  }
}

export function writeReviewFeedback(filePath, store) {
  const normalized = normalizeReviewFeedbackStore(store);
  normalized.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return normalized;
}

function humanUsersForReaction(reactions, names, botUserId) {
  const users = [];
  for (const reaction of ensureArray(reactions)) {
    if (!names.has(cleanText(reaction?.name, 80))) continue;
    for (const user of ensureArray(reaction?.users)) {
      const normalized = cleanText(user, 120);
      if (normalized && normalized !== botUserId && !users.includes(normalized)) users.push(normalized);
    }
  }
  return users;
}

export function resolveHumanReviewDecision(options = {}) {
  const botUserId = cleanText(options.botUserId, 120);
  const eventReaction = cleanText(options.eventReaction, 80);
  const eventUser = cleanText(options.eventUser, 120);
  if (eventUser && eventUser !== botUserId) {
    if (APPROVAL_REACTIONS.has(eventReaction)) {
      return { decision: 'approved', user: eventUser, source: 'targeted-event' };
    }
    if (REJECTION_REACTIONS.has(eventReaction)) {
      return { decision: 'rejected', user: eventUser, source: 'targeted-event' };
    }
  }

  const rejectedBy = humanUsersForReaction(options.reactions, REJECTION_REACTIONS, botUserId);
  if (rejectedBy.length > 0) return { decision: 'rejected', user: rejectedBy[0], source: 'reaction-scan' };
  const approvedBy = humanUsersForReaction(options.reactions, APPROVAL_REACTIONS, botUserId);
  if (approvedBy.length > 0) return { decision: 'approved', user: approvedBy[0], source: 'reaction-scan' };
  return { decision: '', user: '', source: '' };
}

export function upsertReviewFeedback(store, deal, update = {}) {
  const normalized = normalizeReviewFeedbackStore(store);
  const key = reviewFeedbackKey(deal);
  if (!key) return normalized;
  const now = isoTimestamp(update.at, new Date().toISOString());
  const index = normalized.events.findIndex((event) => event.key === key);
  const previous = index >= 0 ? normalized.events[index] : {};
  const decision = ['approved', 'rejected'].includes(cleanText(update.decision, 20))
    ? cleanText(update.decision, 20)
    : cleanText(previous.decision, 20);
  const event = {
    ...previous,
    key,
    dealId: cleanText(deal.id, 240) || cleanText(previous.dealId, 240),
    postKey: canonicalSocialPostKey(deal.url) || cleanText(previous.postKey, 300),
    url: cleanText(deal.url, 1500) || cleanText(previous.url, 1500),
    title: cleanText(deal.title, 240) || cleanText(previous.title, 240),
    brand: cleanText(deal.brand, 160) || cleanText(previous.brand, 160),
    category: cleanText(deal.category, 80) || cleanText(previous.category, 80),
    source: cleanText(deal.source, 160) || cleanText(previous.source, 160),
    originSource: cleanText(deal.originSource, 160) || cleanText(previous.originSource, 160),
    ownerUsername: cleanText(deal.ownerUsername, 100) || cleanText(previous.ownerUsername, 100),
    sourceAccountType: cleanText(deal.sourceAccountType, 40) || cleanText(previous.sourceAccountType, 40),
    scoutUsername: cleanText(deal.scoutUsername, 100) || cleanText(previous.scoutUsername, 100),
    merchantUsername: cleanText(deal.merchantUsername, 100) || cleanText(previous.merchantUsername, 100),
    socialFoodReview: deal.socialFoodReview === true || previous.socialFoodReview === true,
    slackTs: cleanText(deal.slackTs, 80) || cleanText(previous.slackTs, 80),
    slackThreadTs: cleanText(deal.slackThreadTs, 80) || cleanText(previous.slackThreadTs, 80),
    slackSentAt: isoTimestamp(update.slackSentAt || deal.pipelineLifecycle?.slackSentAt || previous.slackSentAt),
    decision,
    decidedAt: update.decision ? now : isoTimestamp(previous.decidedAt),
    decisionUser: update.decision
      ? cleanText(update.user, 120)
      : cleanText(previous.decisionUser, 120),
    decisionSource: update.decision
      ? cleanText(update.decisionSource, 80)
      : cleanText(previous.decisionSource, 80),
    publicationStatus: cleanText(update.publicationStatus, 80)
      || cleanText(previous.publicationStatus, 80)
      || (decision === 'rejected' ? 'rejected' : 'pending'),
    validationReasons: update.validationReasons
      ? ensureArray(update.validationReasons).map((reason) => cleanText(reason, 300)).filter(Boolean).slice(0, 12)
      : ensureArray(previous.validationReasons),
    updatedAt: now,
  };
  if (index >= 0) normalized.events[index] = event;
  else normalized.events.push(event);
  normalized.updatedAt = now;
  return normalized;
}
