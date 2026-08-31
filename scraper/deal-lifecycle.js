const STAGE_FIELDS = {
  discovered: 'discoveredAt',
  extracted: 'extractedAt',
  'validator-passed': 'validatorPassedAt',
  'slack-sent': 'slackSentAt',
  'manually-approved': 'manualDecisionAt',
  'manually-rejected': 'manualDecisionAt',
  published: 'publishedAt',
};

const STAGE_ORDER = [
  'discovered',
  'extracted',
  'validator-passed',
  'slack-sent',
  'manually-approved',
  'published',
];

function cleanText(value, max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isoTimestamp(value, fallback = '') {
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return fallback;
}

function lifecycleStage(existingStage, requestedStage) {
  if (requestedStage === 'manually-rejected') return requestedStage;
  if (existingStage === 'manually-rejected') return existingStage;
  const existingIndex = STAGE_ORDER.indexOf(existingStage);
  const requestedIndex = STAGE_ORDER.indexOf(requestedStage);
  return requestedIndex >= existingIndex ? requestedStage : existingStage;
}

export function advanceDealLifecycle(deal = {}, stage, options = {}) {
  if (!STAGE_FIELDS[stage]) throw new Error(`Unknown deal lifecycle stage: ${stage}`);
  const timestamp = isoTimestamp(options.at, new Date().toISOString());
  const previous = deal.pipelineLifecycle && typeof deal.pipelineLifecycle === 'object'
    ? deal.pipelineLifecycle
    : {};
  const discoveredAt = isoTimestamp(
    previous.discoveredAt || deal.discoveredAt,
    stage === 'discovered' || stage === 'extracted' ? timestamp : '',
  );
  const lifecycle = {
    version: 1,
    stage: lifecycleStage(cleanText(previous.stage, 40), stage),
    discoveredAt,
    extractedAt: isoTimestamp(previous.extractedAt),
    validatorPassedAt: isoTimestamp(previous.validatorPassedAt),
    slackSentAt: isoTimestamp(previous.slackSentAt),
    manualDecision: cleanText(previous.manualDecision, 40),
    manualDecisionAt: isoTimestamp(previous.manualDecisionAt),
    manualDecisionUser: cleanText(previous.manualDecisionUser, 120),
    publishedAt: isoTimestamp(previous.publishedAt),
  };

  lifecycle[STAGE_FIELDS[stage]] = timestamp;
  if (stage === 'manually-approved' || stage === 'manually-rejected') {
    lifecycle.manualDecision = stage === 'manually-approved' ? 'approved' : 'rejected';
    lifecycle.manualDecisionUser = cleanText(options.user || lifecycle.manualDecisionUser, 120);
  }

  return {
    ...deal,
    discoveredAt: discoveredAt || deal.discoveredAt,
    pipelineLifecycle: lifecycle,
  };
}

export function lifecycleState(deal = {}) {
  const lifecycle = deal.pipelineLifecycle && typeof deal.pipelineLifecycle === 'object'
    ? deal.pipelineLifecycle
    : {};
  return {
    stage: cleanText(lifecycle.stage, 40),
    manualDecision: cleanText(lifecycle.manualDecision, 40),
    discoveredAt: isoTimestamp(lifecycle.discoveredAt || deal.discoveredAt),
    extractedAt: isoTimestamp(lifecycle.extractedAt),
    validatorPassedAt: isoTimestamp(lifecycle.validatorPassedAt),
    slackSentAt: isoTimestamp(lifecycle.slackSentAt),
    manualDecisionAt: isoTimestamp(lifecycle.manualDecisionAt),
    publishedAt: isoTimestamp(lifecycle.publishedAt),
  };
}
