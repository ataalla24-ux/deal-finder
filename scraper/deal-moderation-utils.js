import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DEFAULT_MODERATION_PATH = path.join(ROOT, 'docs', 'deal-moderation.json');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLoose(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeId(value) {
  return cleanText(value).toLowerCase();
}

function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return text.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function normalizeModerationList(value) {
  return Array.isArray(value) ? value : [];
}

function entryValue(entry, key) {
  if (typeof entry === 'string') return key === 'value' ? entry : '';
  if (!entry || typeof entry !== 'object') return '';
  return cleanText(entry[key] || entry.value || '');
}

function entryReason(entry, fallback = 'moderiert') {
  if (!entry || typeof entry !== 'object') return fallback;
  return cleanText(entry.reason || entry.note || entry.notes || fallback);
}

function loadDealModeration(filePath = DEFAULT_MODERATION_PATH) {
  if (!fs.existsSync(filePath)) {
    return {
      updatedAt: '',
      blockedIds: [],
      blockedUrls: [],
      blockedProviders: [],
      blockedText: [],
      hiddenDeals: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function dealSignal(deal = {}) {
  return normalizeLoose([
    deal.id,
    deal.submissionId,
    deal.slackTs,
    deal.brand,
    deal.title,
    deal.description,
    deal.category,
    deal.type,
    deal.source,
    deal.originSource,
    deal.url,
    deal.expires,
    deal.expiresOriginal,
    deal.expiryDisplayText,
    deal.location,
    deal.distance,
  ].filter(Boolean).join(' '));
}

function dealIds(deal = {}) {
  return [
    deal.id,
    deal.submissionId,
    deal.slackTs,
  ].map(normalizeId).filter(Boolean);
}

function moderationReasonForDeal(deal = {}, moderation = loadDealModeration()) {
  const ids = new Set(dealIds(deal));
  const url = normalizeUrl(deal.url || '');
  const signal = dealSignal(deal);

  for (const entry of normalizeModerationList(moderation.hiddenDeals)) {
    const id = normalizeId(entryValue(entry, 'id'));
    if (id && ids.has(id)) return entryReason(entry, `Deal-ID ${id} ausgeblendet`);

    const submissionId = normalizeId(entryValue(entry, 'submissionId'));
    if (submissionId && ids.has(submissionId)) return entryReason(entry, `Submission ${submissionId} ausgeblendet`);

    const slackTs = normalizeId(entryValue(entry, 'slackTs'));
    if (slackTs && ids.has(slackTs)) return entryReason(entry, `Slack-Deal ${slackTs} ausgeblendet`);

    const entryUrl = normalizeUrl(entryValue(entry, 'url'));
    if (entryUrl && url && entryUrl === url) return entryReason(entry, 'URL ausgeblendet');

    const provider = normalizeLoose(entryValue(entry, 'provider'));
    if (provider && signal.includes(provider)) return entryReason(entry, `Provider ${provider} ausgeblendet`);

    const text = normalizeLoose(entryValue(entry, 'text'));
    if (text && signal.includes(text)) return entryReason(entry, `Textsignal ${text} ausgeblendet`);
  }

  for (const entry of normalizeModerationList(moderation.blockedIds)) {
    const id = normalizeId(entryValue(entry, 'value'));
    if (id && ids.has(id)) return entryReason(entry, `Deal-ID ${id} blockiert`);
  }

  for (const entry of normalizeModerationList(moderation.blockedUrls)) {
    const blockedUrl = normalizeUrl(entryValue(entry, 'value'));
    if (blockedUrl && url && blockedUrl === url) return entryReason(entry, 'URL blockiert');
  }

  for (const entry of normalizeModerationList(moderation.blockedProviders)) {
    const provider = normalizeLoose(entryValue(entry, 'value'));
    if (provider && signal.includes(provider)) return entryReason(entry, `Provider ${provider} blockiert`);
  }

  for (const entry of normalizeModerationList(moderation.blockedText)) {
    const text = normalizeLoose(entryValue(entry, 'value'));
    if (text && signal.includes(text)) return entryReason(entry, `Textsignal ${text} blockiert`);
  }

  return '';
}

function filterModeratedDeals(deals = [], moderation = loadDealModeration()) {
  const kept = [];
  const removed = [];
  for (const deal of Array.isArray(deals) ? deals : []) {
    const reason = moderationReasonForDeal(deal, moderation);
    if (reason) {
      removed.push({
        id: cleanText(deal?.id || ''),
        title: cleanText(deal?.title || deal?.brand || ''),
        brand: cleanText(deal?.brand || ''),
        url: cleanText(deal?.url || ''),
        reason,
      });
    } else {
      kept.push(deal);
    }
  }
  return { deals: kept, removed };
}

function moderationCounts(removed = []) {
  const counts = {};
  for (const item of removed) {
    const reason = cleanText(item.reason || 'moderiert');
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

export {
  DEFAULT_MODERATION_PATH,
  cleanText,
  filterModeratedDeals,
  loadDealModeration,
  moderationCounts,
  moderationReasonForDeal,
  normalizeUrl,
};
