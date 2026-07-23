import '../sentry/instrument.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, cleanUiNoiseText, normalizeDealRecord } from './deal-normalization-utils.js';
import {
  canonicalSocialPostKey,
  extractStructuredOwnerUsername,
  getPublicationEvidence,
  getViennaEvidence,
  mergeDealEvidence,
} from './deal-evidence-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

const CANDIDATES_OUTPUT_PATH = path.join(DOCS_DIR, 'deal-candidates-index.json');
const HEALTH_OUTPUT_PATH = path.join(DOCS_DIR, 'deal-source-health.json');

const EXCLUDED_PENDING_FILES = new Set([
  'deals-pending-all.json',
  'deals-pending-firecrawl.json',
  'deals-pending-merged.json',
  'deals-pending-instagram.json',
]);

const SOURCE_LABEL_OVERRIDES = {
  events: 'Kirchen Events',
  firecrawl2: 'Firecrawl Key 3 - Consumables',
  firecrawl4: 'Firecrawl Key 4 - Instagram Direct',
  firecrawl5: 'Firecrawl Key 5 - Instagram Gastro',
  flights: 'Flights Vienna',
  food3: 'Firecrawl Key 2 - Food',
  freikirchen: 'Freikirchen Wien',
  gastro2: 'Firecrawl Key 1 - Gastro',
  gemeinde: 'Kirchen Verzeichnis',
  google: 'Google Deals',
  gottesdienste: 'Kirchen Gottesdienste',
  gutscheine: 'Gutscheine.at',
  'instagram-discovery': 'Daily Sync Instagram Discovery',
  'instagram-ai': 'Instagram AI Agent',
  'instagram-web': 'Daily Sync Instagram Web',
  joe: 'jö Bonus Club',
  'member-benefits': 'Member Benefits',
  power: 'Power Scraper',
  tiktok: 'TikTok Scanner',
  'vienna-promo-radar': 'Vienna Promo Radar',
};

const FOOD_DRINK_CATEGORIES = new Set(['essen', 'kaffee', 'supermarkt']);
const PROMO_PATTERNS = [
  /\bgratis\b/i,
  /\bkostenlos\b/i,
  /\bfree\b/i,
  /\b1\s*\+\s*1\b/i,
  /\bbogo\b/i,
  /\bzwei\s*f[uü]r\s*eins\b/i,
  /\bfreebie\b/i,
  /\bgeschenk\b/i,
  /\bbonus\b/i,
  /\baktion\b/i,
  /\bdeal\b/i,
];
const FOOD_DRINK_PATTERNS = [
  /\bpizza\b/i,
  /\bburger\b/i,
  /\bd[öo]ner\b/i,
  /\bkebab\b/i,
  /\bkaffee\b/i,
  /\bcoffee\b/i,
  /\bdrink\b/i,
  /\bcocktail\b/i,
  /\bbrunch\b/i,
  /\bbreakfast\b/i,
  /\beis(kugel|creme|)\b/i,
  /\bice cream\b/i,
  /\bcone\b/i,
  /\bschnitzel\b/i,
  /\bwrap\b/i,
  /\bsushi\b/i,
  /\bcroissant\b/i,
  /\bbakery\b/i,
  /\bcake\b/i,
  /\bmeal\b/i,
  /\bfood\b/i,
];
const DAY_MS = 24 * 60 * 60 * 1000;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sourceKeyFromFile(file) {
  return file.replace(/^deals-pending-/, '').replace(/\.json$/, '');
}

function normalizeUrl(url) {
  const text = cleanText(url);
  if (!text || !/^https?:\/\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return text;
  }
}

function normalizedWords(value) {
  return cleanUiNoiseText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableDealSignature(deal) {
  const socialPostKey = canonicalSocialPostKey(deal?.url || deal?.post_url || deal?.postUrl)
    || canonicalSocialPostKey(deal?.post_url || deal?.postUrl);
  if (socialPostKey) return socialPostKey;
  const normalizedUrl = normalizeUrl(deal?.url || deal?.post_url)
    .toLowerCase()
    .replace(/^https?:\/\//, '');
  const title = normalizedWords(deal?.title);
  const brand = normalizedWords(deal?.brand);
  const type = normalizedWords(deal?.type);
  const distance = normalizedWords(deal?.distance || deal?.location || deal?.ort);
  return [normalizedUrl, brand, title, type, distance].filter(Boolean).join('|');
}

function alternateDealSignature(deal) {
  const title = normalizedWords(deal?.title);
  const brand = normalizedWords(deal?.brand);
  const type = normalizedWords(deal?.type);
  const distance = normalizedWords(deal?.distance || deal?.location || deal?.ort);
  return [brand, title, type, distance].filter(Boolean).join('|');
}

function fallbackDealSignature(deal, sourceKey) {
  const title = normalizedWords(deal?.title);
  const brand = normalizedWords(deal?.brand);
  const url = normalizeUrl(deal?.url || deal?.post_url).toLowerCase();
  const location = normalizedWords(deal?.distance || deal?.location || deal?.ort);
  return [sourceKey, url, brand, title, location].filter(Boolean).join('|');
}

function inferSourceLabel(sourceKey, deal, fileData) {
  if (SOURCE_LABEL_OVERRIDES[sourceKey]) return SOURCE_LABEL_OVERRIDES[sourceKey];
  const explicit = cleanText(deal?.source || fileData?.source || '');
  if (explicit) return explicit;
  return sourceKey;
}

function parseTimestamp(value) {
  const text = cleanText(value);
  if (!text) return null;
  const ts = Date.parse(text);
  if (Number.isNaN(ts)) return null;
  return ts;
}

function ageDays(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / DAY_MS));
}

function loadVerifiedViennaRegistryUsernames() {
  const registry = readJson(path.join(DOCS_DIR, 'instagram-merchant-registry.json'), {}) || {};
  return new Set((Array.isArray(registry.accounts) ? registry.accounts : [])
    .filter((account) => account?.viennaVerified === true)
    .map((account) => cleanText(account?.username).toLowerCase())
    .filter(Boolean));
}

function hasFoodDrinkSignal(deal) {
  const category = cleanUiNoiseText(deal.category || '').toLowerCase();
  if (FOOD_DRINK_CATEGORIES.has(category)) return true;
  const haystack = [deal.brand, deal.title, deal.description].map(cleanText).join(' ');
  return FOOD_DRINK_PATTERNS.some((pattern) => pattern.test(haystack));
}

function hasPromoSignal(deal) {
  const type = cleanUiNoiseText(deal.type || '').toLowerCase();
  if (['gratis', 'bogo', 'freebie'].includes(type)) return true;
  const haystack = [deal.title, deal.description, deal.expires].map(cleanText).join(' ');
  return PROMO_PATTERNS.some((pattern) => pattern.test(haystack));
}

function compactCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const key = cleanUiNoiseText(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([value, count]) => ({ value, count }));
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function buildIssues(stats) {
  const issues = [];
  if (stats.totalDeals === 0) issues.push('liefert aktuell 0 Deals');
  if (stats.totalDeals > 0 && stats.fresh1dRate < 0.2) issues.push('wenige Deals sind frischer als 1 Tag');
  if (stats.totalDeals > 0 && stats.foodDrinkRate < 0.45) issues.push('geringe Food-/Drink-Relevanz');
  if (stats.totalDeals > 0 && stats.promoRate < 0.35) issues.push('wenige klare Gratis-/Promo-Signale');
  if (stats.totalDeals > 0 && stats.viennaRate < 0.8) issues.push('Wien-Signal ist zu schwach');
  if (stats.totalDeals > 0 && stats.duplicateRate > 0.3) issues.push('hohe Überschneidung mit anderen Quellen');
  if (stats.totalDeals > 0 && stats.missingUrlRate > 0.2) issues.push('zu viele Deals ohne stabile URL');
  return issues;
}

function buildHealthScore(stats) {
  if (stats.totalDeals === 0) return 0;
  const score =
    stats.uniqueRate * 22 +
    stats.viennaRate * 22 +
    stats.foodDrinkRate * 20 +
    stats.promoRate * 16 +
    stats.fresh1dRate * 14 +
    (1 - stats.missingUrlRate) * 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildMissionFitScore(stats) {
  if (stats.totalDeals === 0) return 0;
  const score =
    stats.foodDrinkRate * 35 +
    stats.promoRate * 28 +
    stats.fresh1dRate * 22 +
    stats.viennaRate * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildCoverageScore(stats, maxima) {
  if (stats.totalDeals === 0) return 0;
  const totalShare = maxima.maxTotalDeals > 0 ? stats.totalDeals / maxima.maxTotalDeals : 0;
  const uniqueShare = maxima.maxUniqueDeals > 0 ? stats.uniqueDeals / maxima.maxUniqueDeals : 0;
  const freshShare = maxima.maxFresh1dCount > 0 ? stats.fresh1dCount / maxima.maxFresh1dCount : 0;
  const relevanceRate = (stats.viennaRate + stats.foodDrinkRate + stats.promoRate) / 3;
  const score =
    totalShare * 38 +
    uniqueShare * 24 +
    freshShare * 23 +
    relevanceRate * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildPrecisionScore(stats) {
  if (stats.totalDeals === 0) return 0;
  const score =
    stats.viennaRate * 28 +
    stats.foodDrinkRate * 24 +
    stats.promoRate * 22 +
    stats.fresh1dRate * 12 +
    (1 - stats.duplicateRate) * 8 +
    (1 - stats.missingUrlRate) * 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildSourceWeightScore(stats) {
  if (stats.totalDeals === 0) return 0;
  const score =
    stats.healthScore * 0.28 +
    stats.missionFitScore * 0.32 +
    stats.coverageScore * 0.2 +
    stats.precisionScore * 0.2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function main() {
  const now = Date.now();
  const verifiedViennaRegistryUsernames = loadVerifiedViennaRegistryUsernames();
  const allPendingFiles = fs.readdirSync(DOCS_DIR)
    .filter((file) => file.startsWith('deals-pending-') && file.endsWith('.json'))
    .filter((file) => !EXCLUDED_PENDING_FILES.has(file))
    .sort((a, b) => a.localeCompare(b));

  const candidates = [];
  const filesSummary = [];

  for (const file of allPendingFiles) {
    const filePath = path.join(DOCS_DIR, file);
    const fileData = readJson(filePath, {}) || {};
    const sourceKey = sourceKeyFromFile(file);
    const deals = Array.isArray(fileData.deals) ? fileData.deals : [];
    filesSummary.push({ sourceKey, file, totalDeals: deals.length });

    for (const rawDeal of deals) {
      const deal = normalizeDealRecord(rawDeal || {});
      const evidenceRecord = { ...deal, ...(rawDeal || {}) };
      const stableSignature = stableDealSignature(deal);
      const alternateSignature = alternateDealSignature(deal);
      const signature = stableSignature || alternateSignature || fallbackDealSignature(deal, sourceKey);
      const publication = getPublicationEvidence(evidenceRecord);
      const socialSignal = [deal.url, deal.post_url, deal.source, deal.originSource, sourceKey]
        .map(cleanText)
        .join(' ');
      const isSocial = /(?:instagram\.com|tiktok\.com|\binstagram\b|\btiktok\b)/i.test(socialSignal);
      const pubTs = !isSocial || publication.publicationEvidenceRank >= 4
        ? parseTimestamp(publication.sourcePublishedAt)
        : null;
      const expiresTs = parseTimestamp(deal.expires);
      const viennaEvidence = getViennaEvidence(evidenceRecord, { registryUsernames: verifiedViennaRegistryUsernames });
      const viennaConfirmed = viennaEvidence.hasViennaEvidence;
      const sourceLabel = inferSourceLabel(sourceKey, deal, fileData);
      const withUrl = Boolean(normalizeUrl(deal.url || deal.post_url));
      const candidate = {
        sourceKey,
        sourceLabel,
        file,
        id: cleanText(deal.id),
        brand: cleanText(deal.brand),
        title: cleanText(deal.title),
        description: cleanText(deal.description),
        type: cleanUiNoiseText(deal.type || '').toLowerCase(),
        category: cleanUiNoiseText(deal.category || '').toLowerCase(),
        url: normalizeUrl(deal.url || deal.post_url),
        postUrl: normalizeUrl(deal.post_url),
        distance: cleanText(deal.distance || deal.location || deal.ort),
        pubDate: Number.isFinite(pubTs) ? new Date(pubTs).toISOString() : '',
        sourcePublishedAt: Number.isFinite(pubTs) ? new Date(pubTs).toISOString() : '',
        sourcePublishedAtSource: publication.sourcePublishedAtSource,
        discoveredAt: publication.discoveredAt,
        ownerUsername: extractStructuredOwnerUsername(evidenceRecord),
        expires: Number.isFinite(expiresTs) ? new Date(expiresTs).toISOString() : cleanText(deal.expires),
        qualityScore: Number.isFinite(Number(deal.qualityScore)) ? Number(deal.qualityScore) : 0,
        votes: Number.isFinite(Number(deal.votes)) ? Number(deal.votes) : 0,
        stableSignature,
        alternateSignature,
        signature,
        hasViennaSignal: viennaConfirmed,
        viennaVerified: viennaConfirmed,
        viennaEvidence: viennaConfirmed
          ? { type: viennaEvidence.type, value: viennaEvidence.value }
          : null,
        hasFoodDrinkSignal: hasFoodDrinkSignal(deal),
        hasPromoSignal: hasPromoSignal(deal),
        withUrl,
        ageDays: ageDays(pubTs, now),
        isFresh1d: Number.isFinite(pubTs) ? pubTs <= now + 5 * 60 * 1000 && (now - pubTs) <= DAY_MS : false,
        isFresh7d: Number.isFinite(pubTs) ? pubTs <= now + 5 * 60 * 1000 && (now - pubTs) <= 7 * DAY_MS : false,
      };
      candidates.push(candidate);
    }
  }

  const signatureMap = new Map();
  for (const candidate of candidates) {
    const entry = signatureMap.get(candidate.signature) || { count: 0, sourceKeys: new Set(), titles: new Set() };
    entry.count += 1;
    entry.sourceKeys.add(candidate.sourceKey);
    if (candidate.title) entry.titles.add(candidate.title);
    signatureMap.set(candidate.signature, entry);
  }

  const sourceStats = new Map();
  for (const fileSummary of filesSummary) {
    sourceStats.set(fileSummary.sourceKey, {
      sourceKey: fileSummary.sourceKey,
      file: fileSummary.file,
      sourceLabel: SOURCE_LABEL_OVERRIDES[fileSummary.sourceKey] || fileSummary.sourceKey,
      totalDeals: 0,
      uniqueDeals: 0,
      duplicateDeals: 0,
      duplicateAcrossSources: 0,
      fresh1dCount: 0,
      fresh7dCount: 0,
      viennaCount: 0,
      foodDrinkCount: 0,
      promoCount: 0,
      missingUrlCount: 0,
      totalQualityScore: 0,
      categories: [],
      types: [],
      sampleTitles: [],
    });
  }

  for (const candidate of candidates) {
    const cluster = signatureMap.get(candidate.signature);
    const clusterSources = cluster ? [...cluster.sourceKeys] : [];
    candidate.clusterSize = cluster?.count || 1;
    candidate.sharedAcrossSources = clusterSources.length > 1;
    candidate.sharedSourceKeys = clusterSources;

    const stats = sourceStats.get(candidate.sourceKey);
    if (!stats) continue;
    stats.sourceLabel = candidate.sourceLabel || stats.sourceLabel;
    stats.totalDeals += 1;
    stats.totalQualityScore += candidate.qualityScore;
    if ((cluster?.count || 1) === 1) stats.uniqueDeals += 1;
    if ((cluster?.count || 1) > 1) stats.duplicateDeals += 1;
    if (clusterSources.length > 1) stats.duplicateAcrossSources += 1;
    if (candidate.isFresh1d) stats.fresh1dCount += 1;
    if (candidate.isFresh7d) stats.fresh7dCount += 1;
    if (candidate.hasViennaSignal) stats.viennaCount += 1;
    if (candidate.hasFoodDrinkSignal) stats.foodDrinkCount += 1;
    if (candidate.hasPromoSignal) stats.promoCount += 1;
    if (!candidate.withUrl) stats.missingUrlCount += 1;
    if (candidate.category) stats.categories.push(candidate.category);
    if (candidate.type) stats.types.push(candidate.type);
    if (stats.sampleTitles.length < 3 && candidate.title) stats.sampleTitles.push(candidate.title);
  }

  const mergedCandidateMap = new Map();
  for (const candidate of candidates) {
    const mergeable = { ...candidate, sourceKeys: [candidate.sourceKey] };
    mergedCandidateMap.set(
      candidate.signature,
      mergedCandidateMap.has(candidate.signature)
        ? mergeDealEvidence(mergedCandidateMap.get(candidate.signature), mergeable, {
          now,
          registryUsernames: verifiedViennaRegistryUsernames,
        })
        : mergeable
    );
  }
  const mergedCandidates = [...mergedCandidateMap.values()];

  const sources = [...sourceStats.values()].map((stats) => {
    const total = stats.totalDeals || 1;
    const normalized = {
      ...stats,
      uniqueRate: round(stats.uniqueDeals / total),
      duplicateRate: round(stats.duplicateAcrossSources / total),
      fresh1dRate: round(stats.fresh1dCount / total),
      fresh7dRate: round(stats.fresh7dCount / total),
      viennaRate: round(stats.viennaCount / total),
      foodDrinkRate: round(stats.foodDrinkCount / total),
      promoRate: round(stats.promoCount / total),
      missingUrlRate: round(stats.missingUrlCount / total),
      averageQualityScore: round(stats.totalQualityScore / total),
      topCategories: compactCounts(stats.categories),
      topTypes: compactCounts(stats.types),
    };
    normalized.issues = buildIssues(normalized);
    normalized.healthScore = buildHealthScore(normalized);
    normalized.missionFitScore = buildMissionFitScore(normalized);
    delete normalized.categories;
    delete normalized.types;
    delete normalized.totalQualityScore;
    return normalized;
  });

  const maxima = sources.reduce((acc, source) => ({
    maxTotalDeals: Math.max(acc.maxTotalDeals, source.totalDeals),
    maxUniqueDeals: Math.max(acc.maxUniqueDeals, source.uniqueDeals),
    maxFresh1dCount: Math.max(acc.maxFresh1dCount, source.fresh1dCount),
  }), { maxTotalDeals: 0, maxUniqueDeals: 0, maxFresh1dCount: 0 });

  for (const source of sources) {
    source.coverageScore = buildCoverageScore(source, maxima);
    source.precisionScore = buildPrecisionScore(source);
  }

  for (const source of sources) {
    source.sourceWeightScore = buildSourceWeightScore(source);
  }

  sources.sort((a, b) => b.healthScore - a.healthScore || b.totalDeals - a.totalDeals || a.sourceKey.localeCompare(b.sourceKey));

  const uniqueCandidates = candidates.filter((candidate) => (signatureMap.get(candidate.signature)?.count || 0) === 1).length;
  const distinctCandidates = mergedCandidates.length;
  const duplicateClusters = [...signatureMap.values()].filter((entry) => entry.count > 1).length;
  const recommendations = sources
    .filter((source) => source.issues.length > 0)
    .sort((a, b) => a.healthScore - b.healthScore || a.totalDeals - b.totalDeals)
    .slice(0, 6)
    .map((source) => ({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      healthScore: source.healthScore,
      issues: source.issues,
      sampleTitles: source.sampleTitles,
    }));

  const candidateIndex = {
    generatedAt: new Date(now).toISOString(),
    totalCandidates: candidates.length,
    uniqueCandidates,
    distinctCandidates,
    duplicateClusters,
    filesConsidered: allPendingFiles,
    candidates: candidates
      .sort((a, b) => {
        if (a.sourceKey !== b.sourceKey) return a.sourceKey.localeCompare(b.sourceKey);
        return b.qualityScore - a.qualityScore || a.title.localeCompare(b.title);
      }),
    mergedCandidates: mergedCandidates
      .sort((a, b) => (Date.parse(b.sourcePublishedAt || '') || 0) - (Date.parse(a.sourcePublishedAt || '') || 0)),
  };

  const healthReport = {
    generatedAt: new Date(now).toISOString(),
    summary: {
      filesConsidered: allPendingFiles.length,
      totalCandidates: candidates.length,
      uniqueCandidates,
      distinctCandidates,
      duplicateClusters,
      topHealthySources: sources.slice(0, 5).map((source) => ({
        sourceKey: source.sourceKey,
        sourceLabel: source.sourceLabel,
        healthScore: source.healthScore,
        totalDeals: source.totalDeals,
      })),
      topMissionSources: [...sources]
        .sort((a, b) => b.missionFitScore - a.missionFitScore || b.totalDeals - a.totalDeals)
        .slice(0, 5)
        .map((source) => ({
          sourceKey: source.sourceKey,
          sourceLabel: source.sourceLabel,
          missionFitScore: source.missionFitScore,
          totalDeals: source.totalDeals,
        })),
      topCoverageSources: [...sources]
        .sort((a, b) => b.coverageScore - a.coverageScore || b.totalDeals - a.totalDeals)
        .slice(0, 5)
        .map((source) => ({
          sourceKey: source.sourceKey,
          sourceLabel: source.sourceLabel,
          coverageScore: source.coverageScore,
          totalDeals: source.totalDeals,
          fresh1dCount: source.fresh1dCount,
        })),
      topPrecisionSources: [...sources]
        .sort((a, b) => b.precisionScore - a.precisionScore || b.missionFitScore - a.missionFitScore)
        .slice(0, 5)
        .map((source) => ({
          sourceKey: source.sourceKey,
          sourceLabel: source.sourceLabel,
          precisionScore: source.precisionScore,
          totalDeals: source.totalDeals,
        })),
      topWeightedSources: [...sources]
        .sort((a, b) => b.sourceWeightScore - a.sourceWeightScore || b.healthScore - a.healthScore)
        .slice(0, 5)
        .map((source) => ({
          sourceKey: source.sourceKey,
          sourceLabel: source.sourceLabel,
          sourceWeightScore: source.sourceWeightScore,
          totalDeals: source.totalDeals,
        })),
      topSourcesToFix: recommendations,
    },
    sources,
  };

  writeJson(CANDIDATES_OUTPUT_PATH, candidateIndex);
  writeJson(HEALTH_OUTPUT_PATH, healthReport);

  console.log('📊 Deal source health updated');
  console.log(`   sources: ${sources.length}`);
  console.log(`   candidates: ${candidates.length}`);
  console.log(`   unique candidates: ${uniqueCandidates}`);
  console.log(`   duplicate clusters: ${duplicateClusters}`);
  if (recommendations.length) {
    console.log('   weakest sources:');
    for (const item of recommendations.slice(0, 4)) {
      console.log(`   - ${item.sourceLabel} (${item.healthScore}) → ${item.issues.join('; ')}`);
    }
  }
}

main().catch((error) => {
  console.error('❌ build-deal-source-health failed:', error);
  process.exit(1);
});
