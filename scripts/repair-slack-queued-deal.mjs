import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { canonicalDealUrl, canonicalSocialPostKey } from '../scraper/deal-evidence-utils.js';
import { buildSlackMessage } from '../scraper/slack-notify.js';
import { buildDealFromPost } from '../scraper/tiktok-deals-scanner.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_QUEUE_PATH = path.join(ROOT, 'docs', 'deals-pending-all.json');
const DEFAULT_SOURCE_PATH = path.join(ROOT, 'docs', 'deals-pending-tiktok.json');

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function ensureDeals(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.deals) ? payload.deals : [];
}

function exactDealKey(value) {
  const url = typeof value === 'string' ? value : value?.url;
  return canonicalSocialPostKey(url) || canonicalDealUrl(url);
}

function hasHumanSlackEdit(deal) {
  return deal?.editedInSlack === true || (Array.isArray(deal?.slackEditedFields) && deal.slackEditedFields.length > 0);
}

function normalizedDay(value = '') {
  return cleanText(value).match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || cleanText(value);
}

function presentationFingerprint(deal = {}) {
  return JSON.stringify({
    brand: cleanText(deal.brand),
    title: cleanText(deal.title),
    description: cleanText(deal.description),
    type: cleanText(deal.type),
    category: cleanText(deal.category),
    distance: cleanText(deal.distance),
    validFrom: normalizedDay(deal.validFrom),
    validUntil: normalizedDay(deal.validUntil || deal.expires),
  });
}

function presentationQualityScore(deal = {}) {
  const brand = cleanText(deal.brand);
  const title = cleanText(deal.title);
  const description = cleanText(deal.description);
  let score = Number(deal.qualityScore || 0) / 10;
  if (brand && !/^@/.test(brand) && !/^(?:tiktok|instagram|wien|vienna)$/i.test(brand)) score += 8;
  if (title && !/\bangebot\s*$/i.test(title)) score += 10;
  if (/\b(?:gratis|kostenlos|free|1\s*\+\s*1|rabatt|happy hour)\b/i.test(title)) score += 6;
  if (description.length >= 80) score += 2;
  if (normalizedDay(deal.validFrom)) score += 3;
  if (normalizedDay(deal.validUntil || deal.expires)) score += 4;
  return score;
}

function selectBestSource(deals) {
  return [...deals].sort((left, right) => (
    presentationQualityScore(right) - presentationQualityScore(left)
    || Date.parse(right.pubDate || right.sourcePublishedAt || '') - Date.parse(left.pubDate || left.sourcePublishedAt || '')
  ))[0] || null;
}

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlAttribute(tag, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return decodeHtml(match?.[2] || '');
}

function htmlMetaContent(html, keys) {
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const key = cleanText(htmlAttribute(tag, 'property') || htmlAttribute(tag, 'name')).toLowerCase();
    if (!keys.includes(key)) continue;
    const content = cleanText(htmlAttribute(tag, 'content'));
    if (content) return content;
  }
  return '';
}

function queuedAtDate(deal, fallbackNow) {
  const seconds = Number(cleanText(deal?.slackTs).split('.')[0]);
  if (Number.isFinite(seconds) && seconds > 0) {
    const date = new Date(seconds * 1000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallbackNow;
}

export async function rebuildTikTokQueuedSource(target, options = {}) {
  const url = cleanText(target?.url);
  const match = url.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([^/]+)\/video\/\d+/i);
  if (!match) return null;
  const fetchImpl = options.fetchImpl || fetch;
  let title = cleanText(target.title);
  let description = cleanText(target.description);
  try {
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; FreeFinderSlackRepair/1.0; +https://freefinder.at)',
        'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });
    if (response.ok) {
      const html = await response.text();
      title = htmlMetaContent(html, ['og:title', 'twitter:title']) || title;
      description = htmlMetaContent(html, ['og:description', 'description', 'twitter:description']) || description;
    }
  } catch {}

  const sourcePublishedAt = cleanText(target.sourcePublishedAt || target.pubDate);
  if (!sourcePublishedAt || !description) return null;
  const actualNow = options.now instanceof Date ? options.now : new Date();
  const reconstructionNow = queuedAtDate(target, actualNow);
  const rebuilt = buildDealFromPost(url, {
    accountHandle: match[1],
    title,
    description,
    bodyText: [description, target.distance, target.city, target.postalCode, 'Wien'].filter(Boolean).join(' '),
    timeDateTime: sourcePublishedAt,
    jsonLdUploadDate: '',
    jsonLdDatePublished: '',
    createTimes: [],
  }, { now: reconstructionNow });
  return rebuilt.deal || null;
}

function preserveQueueMetadata(current, replacement) {
  const protectedFields = [
    'slackTs',
    'slackThreadTs',
    'slackPostFormatVersion',
    'order',
    'submissionId',
  ];
  const next = { ...current, ...replacement };
  for (const field of protectedFields) {
    if (current[field] !== undefined) next[field] = current[field];
  }
  return next;
}

function assertSlackResult(result, operation, allowedErrors = []) {
  if (result?.ok || allowedErrors.includes(cleanText(result?.error))) return;
  throw new Error(`Slack ${operation} failed: ${cleanText(result?.error || 'unknown_error')}`);
}

export async function repairQueuedSlackDeal(options = {}) {
  const action = cleanText(options.action).toLowerCase();
  const targetUrl = cleanText(options.url);
  const channel = cleanText(options.channel);
  const queuePayload = options.queuePayload && typeof options.queuePayload === 'object'
    ? structuredClone(options.queuePayload)
    : { deals: [] };
  const queueDeals = ensureDeals(queuePayload);
  const targetKey = exactDealKey(targetUrl);
  if (!['update', 'delete'].includes(action)) throw new Error('Action must be update or delete');
  if (!targetKey) throw new Error('A valid exact deal URL is required');
  if (!channel) throw new Error('Slack channel is required');
  if (typeof options.slackApi !== 'function') throw new Error('Slack API client is required');

  const targetIndex = queueDeals.findIndex((deal) => exactDealKey(deal) === targetKey && cleanText(deal.slackTs));
  if (targetIndex < 0) throw new Error(`Queued Slack deal not found for ${targetUrl}`);
  const target = queueDeals[targetIndex];

  if (action === 'delete') {
    assertSlackResult(await options.slackApi('chat.delete', {
      channel,
      ts: cleanText(target.slackTs),
    }), 'delete deal message', ['message_not_found']);

    const remainingDeals = queueDeals.filter((_, index) => index !== targetIndex);
    const threadTs = cleanText(target.slackThreadTs);
    const threadStillUsed = threadTs && remainingDeals.some((deal) => cleanText(deal.slackThreadTs) === threadTs);
    if (threadTs && threadTs !== cleanText(target.slackTs) && !threadStillUsed) {
      assertSlackResult(
        await options.slackApi('chat.delete', { channel, ts: threadTs }),
        'delete empty digest',
        ['message_not_found', 'cant_delete_message'],
      );
    }

    return {
      changed: true,
      action,
      deal: target,
      queuePayload: {
        ...queuePayload,
        deals: remainingDeals,
        totalDeals: remainingDeals.length,
        updatedAt: (options.now instanceof Date ? options.now : new Date()).toISOString(),
      },
    };
  }

  if (hasHumanSlackEdit(target)) {
    throw new Error('Queued deal has human Slack edits and will not be overwritten');
  }
  const sourceDeals = ensureDeals(options.sourceDeals).filter((deal) => exactDealKey(deal) === targetKey);
  if (sourceDeals.length === 0) {
    const rebuildSource = options.rebuildSource || rebuildTikTokQueuedSource;
    const rebuilt = await rebuildSource(target, {
      now: options.now instanceof Date ? options.now : new Date(),
      fetchImpl: options.fetchImpl,
    });
    if (rebuilt) sourceDeals.push(rebuilt);
  }
  if (sourceDeals.length === 0) throw new Error(`No current or reconstructable source deal found for ${targetUrl}`);
  const validate = options.validate || validateDealsForSlack;
  const validation = await validate(sourceDeals, {
    now: options.now instanceof Date ? options.now : new Date(),
  });
  const replacement = selectBestSource(validation.allowedDeals || []);
  if (!replacement) {
    const reasons = (validation.blockedDeals || [])
      .flatMap((deal) => deal?.validity?.reasons || [])
      .map(cleanText)
      .filter(Boolean);
    throw new Error(`Current source deal failed validation${reasons.length ? `: ${reasons.join('; ')}` : ''}`);
  }

  const repaired = preserveQueueMetadata(target, replacement);
  if (presentationFingerprint(repaired) === presentationFingerprint(target)) {
    return { changed: false, action, deal: target, queuePayload };
  }
  const message = buildSlackMessage(repaired, Number(target.order || targetIndex + 1));
  assertSlackResult(await options.slackApi('chat.update', {
    channel,
    ts: cleanText(target.slackTs),
    text: message,
  }), 'update deal message');

  const repairedDeals = [...queueDeals];
  repairedDeals[targetIndex] = repaired;
  return {
    changed: true,
    action,
    deal: repaired,
    queuePayload: {
      ...queuePayload,
      deals: repairedDeals,
      totalDeals: repairedDeals.length,
      updatedAt: (options.now instanceof Date ? options.now : new Date()).toISOString(),
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function resolveDocsJsonPath(value, fallback, expectedPattern) {
  const resolved = path.resolve(ROOT, value || fallback);
  const docsRoot = `${path.join(ROOT, 'docs')}${path.sep}`;
  if (!resolved.startsWith(docsRoot) || !expectedPattern.test(path.basename(resolved))) {
    throw new Error(`Path must be an allowed docs JSON file: ${resolved}`);
  }
  return resolved;
}

async function callSlackApi(token, method, payload, attempt = 0) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if ((response.status === 429 || data.error === 'ratelimited') && attempt < 5) {
    const waitMs = Math.max(1000, Number(response.headers.get('retry-after') || data.retry_after || 2) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return callSlackApi(token, method, payload, attempt + 1);
  }
  return data;
}

async function main() {
  const action = cleanText(process.env.SLACK_QUEUE_REPAIR_ACTION).toLowerCase();
  const url = cleanText(process.env.SLACK_QUEUE_REPAIR_URL);
  const token = cleanText(process.env.SLACK_BOT_TOKEN);
  const channel = cleanText(process.env.SLACK_CHANNEL_ID);
  const queuePath = resolveDocsJsonPath(
    process.env.SLACK_QUEUE_REPAIR_QUEUE_PATH,
    DEFAULT_QUEUE_PATH,
    /^deals-pending-all\.json$/,
  );
  const sourcePath = resolveDocsJsonPath(
    process.env.SLACK_QUEUE_REPAIR_SOURCE_PATH,
    DEFAULT_SOURCE_PATH,
    /^deals-pending-[a-z0-9_.-]+\.json$/i,
  );
  if (!token) throw new Error('SLACK_BOT_TOKEN is required');
  if (!fs.existsSync(queuePath)) throw new Error(`Queue file not found: ${queuePath}`);
  if (action === 'update' && !fs.existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);

  const result = await repairQueuedSlackDeal({
    action,
    url,
    channel,
    queuePayload: readJson(queuePath),
    sourceDeals: action === 'update' ? readJson(sourcePath) : [],
    slackApi: (method, payload) => callSlackApi(token, method, payload),
  });
  if (result.changed) writeJsonAtomic(queuePath, result.queuePayload);
  console.log(JSON.stringify({
    action: result.action,
    changed: result.changed,
    id: cleanText(result.deal?.id),
    title: cleanText(result.deal?.title),
    url: cleanText(result.deal?.url),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Slack queue repair failed: ${error.message}`);
    process.exit(1);
  });
}
