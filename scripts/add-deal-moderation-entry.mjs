#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { cleanText, normalizeUrl } from '../scraper/deal-moderation-utils.js';
import { canonicalDealUrl, extractStructuredOwnerUsername } from '../scraper/deal-evidence-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const MODERATION_PATH = path.join(ROOT, 'docs', 'deal-moderation.json');

function parseArgs(argv) {
  const parsed = {
    id: cleanText(process.env.DEAL_MODERATION_ID),
    url: cleanText(process.env.DEAL_MODERATION_URL),
    provider: cleanText(process.env.DEAL_MODERATION_PROVIDER),
    text: cleanText(process.env.DEAL_MODERATION_TEXT),
    reason: cleanText(process.env.DEAL_MODERATION_REASON) || 'removed',
    removedBy: cleanText(process.env.DEAL_MODERATION_BY || process.env.GITHUB_ACTOR) || 'admin',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--id') parsed.id = cleanText(argv[++i]);
    else if (arg === '--url') parsed.url = cleanText(argv[++i]);
    else if (arg === '--provider') parsed.provider = cleanText(argv[++i]);
    else if (arg === '--text') parsed.text = cleanText(argv[++i]);
    else if (arg === '--reason') parsed.reason = cleanText(argv[++i]) || parsed.reason;
    else if (arg === '--by') parsed.removedBy = cleanText(argv[++i]) || parsed.removedBy;
  }

  return parsed;
}

function readModeration() {
  if (!fs.existsSync(MODERATION_PATH)) {
    return {
      updatedAt: '',
      blockedIds: [],
      blockedUrls: [],
      blockedProviders: ['neotaste'],
      blockedText: [],
      hiddenDeals: [],
    };
  }
  return JSON.parse(fs.readFileSync(MODERATION_PATH, 'utf8'));
}

function entryKey(entry) {
  return [
    cleanText(entry.id).toLowerCase(),
    normalizeUrl(entry.url),
    cleanText(entry.provider).toLowerCase(),
    cleanText(entry.text).toLowerCase(),
  ].join('|');
}

function dealRows(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.deals) ? parsed.deals : []);
  } catch {
    return [];
  }
}

function findDealContext(input) {
  const targetId = cleanText(input.id).toLowerCase();
  const targetUrl = canonicalDealUrl(input.url) || normalizeUrl(input.url);
  const files = fs.readdirSync(DOCS_DIR)
    .filter((name) => name === 'deals.json' || /^deals-pending-.*\.json$/.test(name));
  for (const fileName of files) {
    for (const deal of dealRows(path.join(DOCS_DIR, fileName))) {
      const ids = [deal?.id, deal?.submissionId, deal?.slackTs].map((value) => cleanText(value).toLowerCase()).filter(Boolean);
      const dealUrl = canonicalDealUrl(deal?.url) || normalizeUrl(deal?.url);
      if ((targetId && ids.includes(targetId)) || (targetUrl && dealUrl === targetUrl)) {
        return {
          ownerUsername: extractStructuredOwnerUsername(deal),
          originSource: cleanText(deal?.originSource || deal?.source),
        };
      }
    }
  }
  return { ownerUsername: '', originSource: '' };
}

const input = parseArgs(process.argv.slice(2));
if (!input.id && !input.url && !input.provider && !input.text) {
  console.log('No moderation target provided; nothing to add.');
  process.exit(0);
}

const moderation = readModeration();
const hiddenDeals = Array.isArray(moderation.hiddenDeals) ? moderation.hiddenDeals : [];
const context = findDealContext(input);
const entry = {
  id: input.id,
  url: input.url,
  provider: input.provider,
  text: input.text,
  reason: input.reason,
  removedAt: new Date().toISOString(),
  removedBy: input.removedBy,
  ...(context.ownerUsername ? { ownerUsername: context.ownerUsername } : {}),
  ...(context.originSource ? { originSource: context.originSource } : {}),
};

const nextKey = entryKey(entry);
const exists = hiddenDeals.some((item) => entryKey(item) === nextKey);
if (!exists) hiddenDeals.push(entry);

const next = {
  updatedAt: new Date().toISOString(),
  blockedIds: Array.isArray(moderation.blockedIds) ? moderation.blockedIds : [],
  blockedUrls: Array.isArray(moderation.blockedUrls) ? moderation.blockedUrls : [],
  blockedProviders: Array.isArray(moderation.blockedProviders) ? moderation.blockedProviders : ['neotaste'],
  blockedText: Array.isArray(moderation.blockedText) ? moderation.blockedText : [],
  hiddenDeals,
};

fs.writeFileSync(MODERATION_PATH, `${JSON.stringify(next, null, 2)}\n`);
console.log(exists ? 'Moderation entry already existed.' : 'Moderation entry added.');
