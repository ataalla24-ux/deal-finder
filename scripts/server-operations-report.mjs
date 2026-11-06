import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { duplicateDealKey } from '../scraper/deal-evidence-utils.js';
import { loadAiCreditPolicy, modelForTask } from '../scraper/ai-credit-budget.js';
import { inspectSourceBackedQuality } from '../scraper/source-backed-quality.js';
import { loadDealMapReviewContext, reviewDealMap } from './deal-map-review.mjs';
import { maintenanceEvidenceFor } from './refresh-maintenance-evidence.mjs';

const read = (root, file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch(e) { if(e.code === 'ENOENT') return fallback; throw e; } };
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const rows = value => Array.isArray(value) ? value : value?.deals || [];
const countBy = values => values.reduce((result, key) => ({ ...result, [key]: (result[key] || 0) + 1 }), {});

export function buildRecoveryQueue(live, pending, { mapContext } = {}) {
  const existing = new Set(live.map(duplicateDealKey).filter(Boolean));
  const ids = new Set(live.map(d => d.id)), seen = new Set();
  const idCounts = countBy(pending.map(deal => deal.id));
  return pending.filter(d => !ids.has(d.id)).map(deal => {
    // This is a cheap local inspection. Never borrow a prior row by ID: source
    // queues, dates and venue evidence can change between audit and report.
    const map = mapContext ? reviewDealMap(deal, mapContext) : null;
    const audit = inspectSourceBackedQuality(deal, { mapReview: map, today: mapContext?.today || '' });
    const key = duplicateDealKey(deal);
    const duplicate = key && (existing.has(key) ? 'already-live' : seen.has(key) ? 'same-pending-source' : null);
    if (key) seen.add(key);
    const issues = audit.issues.map(i => i.code);
    if (!mapContext?.today) issues.push('audit-context-missing');
    if (idCounts[deal.id] > 1) issues.push('duplicate-pending-id');
    const priority = duplicate || issues.includes('duplicate-pending-id') ? 'duplicate-review'
      : issues.includes('audit-context-missing') ? 'audit-needed' : !issues.length ? 'human-review-ready'
      : issues.includes('source-blocked') ? 'blocked-source'
      : issues.includes('evidence-missing') ? 'source-evidence-needed'
      : issues.includes('map-incomplete') ? 'venue-verification-needed' : 'copy-or-period-review';
    return { id: deal.id, title: deal.title, source: deal.originSource || deal.source || 'unknown',
      url: deal.url, duplicateOf: duplicate || null, priority, issues,
      fingerprint: hash([deal, audit.fingerprint, issues, key, priority]), automaticPublicationAllowed: false };
  }).sort((a,b) => Number(b.priority === 'human-review-ready') - Number(a.priority === 'human-review-ready') || a.id.localeCompare(b.id));
}

export function updatePublicationPilot(previous, queue, { now = new Date(), event = '', runId = '', sha = '' } = {}) {
  const state = structuredClone(previous || { version: 1, samples: [], regularRuns: [] });
  // Only actual scheduled GitHub events count toward the multi-run observation.
  if (event === 'schedule' && /^\d+$/.test(runId) && /^[a-f0-9]{40}$/.test(sha)
    && !state.regularRuns.some(r => r.runId === runId)) state.regularRuns.push({ runId, sha, observedAt: now.toISOString() });
  const current=new Map(queue.map(row=>[row.id,row]));
  for(const sample of state.samples){
    const row=current.get(sample.id);
    sample.source=row?.source||sample.source||'unknown';
    sample.currentFingerprintMatches=Boolean(row&&row.fingerprint===sample.fingerprint);
  }
  const groups=new Map();
  for(const row of queue){const key=row.priority+'|'+row.source;groups.set(key,[...(groups.get(key)||[]),row]);}
  const representative=[];
  while([...groups.values()].some(rows=>rows.length))for(const rows of groups.values())if(rows.length)representative.push(rows.shift());
  for (const row of representative) {
    if (state.samples.length >= 50) break;
    if (!state.samples.some(s => s.id === row.id)) state.samples.push({
      id: row.id, fingerprint: row.fingerprint, expected: null, observed: row.priority,
      source:row.source||'unknown',currentFingerprintMatches:true,
      issues: row.issues, sampledAt: now.toISOString(), reviewStatus: 'awaiting-independent-human-label' });
  }
  state.automaticPublicationEnabled = false;
  state.evaluatedCases = state.samples.filter(s => ['approve', 'reject', 'hold'].includes(s.expected)
    && s.reviewStatus === 'human-reviewed' && s.reviewedBy && s.reviewedAt && s.currentFingerprintMatches).length;
  state.status = 'shadow-only';
  state.requirements = { atLeastHumanReviewedCases: 30, targetCases: 50, atLeastRegularRuns: 3,
    activationRequiresSeparateDecision: true, cannotInferHumanApprovalFromFeedPresence: true };
  return state;
}

export function creditSnapshot(ledger, policy, now = new Date()) {
  if (!ledger || ledger.creditPeriod !== policy.periodId || !Array.isArray(ledger.reservations)
    || ledger.reservations.some(r => !Number.isFinite(r.usd) || r.usd < 0 || !Number.isFinite(r.at) || r.at > +now)) {
    return { status: 'unavailable-or-invalid', providerBalanceKnown: false };
  }
  const all = ledger.reservations, recent = all.filter(r => r.at > +now - 86400000);
  const sum = values => Number(values.reduce((total,r) => total + r.usd, 0).toFixed(6));
  return { status: 'internal-ledger', observedAt: now.toISOString(), providerBalanceKnown: false,
    periodId: policy.periodId, periodLimitUsd: policy.periodLimitUsd, rollingDayLimitUsd: policy.rollingDayLimitUsd,
    periodReservedOrSettledUsd: sum(all), rollingDayReservedOrSettledUsd: sum(recent),
    unsettledReservations: all.filter(r => r.status !== 'settled').length,
    expiresAt: policy.expiresAt, expired: +now >= Date.parse(policy.expiresAt),
    modelsLast24Hours: countBy(recent.map(r => r.model || 'unknown')) };
}

async function readCreditLedger(request) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo || '')) return null;
  try {
    const response = await request(`https://api.github.com/repos/${repo}/contents/openai-free-credit-budget.json?ref=automation%2Fopenai-free-credit-budget`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.encoding !== 'base64' || data.size > 3000000) return null;
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  } catch { return null; }
}

function sourceSummary(root, file, now) {
  const report = read(root, file, null);
  if (!report) return { file, status: 'missing-report' };
  const at = report.generatedAt || report.finishedAt || report.lastUpdated;
  const ageHours = Number.isFinite(Date.parse(at)) ? Number(((+now-Date.parse(at))/3600000).toFixed(2)) : null;
  const counts = {};
  for (const key of ['fetchedRecords','freshAcceptedDeals','pendingDeals','duplicatePosts','unchangedPosts','providerErrors',
    'discoveredCandidates','acceptedDeals','aiRescueCandidates','aiRescued','healthySources','failedSources','deferredSources','rawDeals']) {
    const value = report[key] ?? report.summary?.[key];
    if (Number.isFinite(value)) counts[key] = value;
  }
  return { file, observedAt: at || null, ageHours, stale: ageHours === null || ageHours < 0 || ageHours > 30,
    status: report.status || 'see-source-results', counts,
    caveat: 'Collector counts are not unique new deals or Slack delivery receipts.' };
}

export async function writeOperationsReport({ root = process.cwd(), now = new Date(), request = fetch, apply = true } = {}) {
  const quality = read(root,'reviews/server-quality-audit.json',{});
  const live = rows(read(root,'docs/deals.json',{})), pending = rows(read(root,'docs/deals-pending-all.json',{}));
  const mapContext = loadDealMapReviewContext({root,now});
  const queue = buildRecoveryQueue(live,pending,{mapContext});
  const qualitySnapshot = { checkedAt:quality.checkedAt || null,
    feedMatches:quality.feedHash === hash(live), mapContextMatches:quality.mapContextHash === hash(mapContext),
    sourceEvidenceMatches:quality.sourceEvidenceHash === hash([...maintenanceEvidenceFor(live,
      read(root,'reviews/maintenance-source-evidence.json',{}),now)]) };
  const age = +now - Date.parse(quality.checkedAt);
  qualitySnapshot.status = qualitySnapshot.feedMatches && qualitySnapshot.mapContextMatches && qualitySnapshot.sourceEvidenceMatches
    && Number.isFinite(age) && age >= 0 && age < 86400000 ? 'current' : 'stale-or-missing';
  const currentQuality = qualitySnapshot.status === 'current' ? quality : {};
  const pilot = updatePublicationPilot(read(root,'reviews/automatic-publication-pilot.json',null),queue,
    {now,event:process.env.GITHUB_EVENT_NAME,runId:process.env.GITHUB_RUN_ID,sha:process.env.GITHUB_SHA});
  const prior = read(root,'reviews/server-operations-report.json',null);
  const added = prior?.liveIds ? live.filter(d => !prior.liveIds.includes(d.id)).map(d => d.id) : null;
  const maintenance = read(root,'docs/automatic-deal-maintenance-report.json',{});
  const report = { version:1, checkedAt:now.toISOString(), liveCount:live.length, liveIds:live.map(d=>d.id),
    addedSincePreviousObservedFeed:added, addedAreNotAttributedToThisJob:true,
    qualitySnapshot,
    sourceRecovery:{ total:queue.length, uniqueIds:new Set(queue.map(row=>row.id)).size, auditMode:'fresh-offline-check',
      byPriority:countBy(queue.map(r=>r.priority)), bySource:countBy(queue.map(r=>r.source)), rows:queue },
    maintenance:{ checkedAt:maintenance.checkedAt, corrected:maintenance.corrected || [], hidden:maintenance.hidden || [], ai:maintenance.ai || null },
    missingInformation:currentQuality.live?.filter(r=>r.requiresReview) || [],
    images:{ status:qualitySnapshot.status, checkedAt:qualitySnapshot.checkedAt,
      shared:currentQuality.sharedWebsiteImages || [], review:currentQuality.live?.filter(r=>r.websitePhoto?.status === 'needs-review').map(r=>r.id) || [],
      native:currentQuality.nativeContracts||{status:'requires-native-contract-audit'},
      nativeSelection:currentQuality.nativeSelection||{status:'missing-current-quality-audit',reviewedPlatformImages:0},
      nativeReview:currentQuality.live?.filter(r=>Object.values(r.nativePhoto?.platforms||{}).some(p=>p.status==='needs-review')
        || (r.nativePhoto?.originalPhoto && r.nativePhoto.originalPhoto.status!=='visual-match')).map(r=>({id:r.id,review:r.nativePhoto}))||[] },
    publicationPilot:{ status:pilot.status, sampled:pilot.samples.length, independentlyReviewed:pilot.evaluatedCases, regularRuns:pilot.regularRuns.length, automaticPublicationEnabled:false },
    blog:{...read(root,'reviews/server-blog-report.json',{status:'not-run',automaticPublicationEnabled:false,localBlogReplacementReady:false}),
      lastPublicReceipt:read(root,'reviews/server-blog-public-receipt.json',null)},
    sources:['apify-discovery','meta-instagram','power-scraper','instagram-ai'].map(name=>sourceSummary(root,`docs/${name}-report.json`,now)),
    credits:creditSnapshot(await readCreditLedger(request),loadAiCreditPolicy(),now),
    routing:Object.fromEntries(['extract','vision','editor','review'].map(role=>[role,modelForTask(role)])),
    slack:{ newlyDelivered:null, status:'not-proven-by-this-report', reason:'Only actual message IDs/run-linked receipts count, never candidate counts.' } };
  const markdown = `# FreeFinder Betriebsbericht\n\nStand: ${report.checkedAt}\n\n- ${live.length} Live-Angebote; ${queue.length} nicht-live Entwuerfe geprueft.\n- ${added === null ? 'Erste Bestandsaufnahme' : added.length+' neue IDs seit letzter Bestandsaufnahme'}; keine automatische Erfolgszuordnung.\n- ${queue.filter(r=>r.priority==='human-review-ready').length} Entwuerfe ohne formale Pruefluecke, weiterhin menschliche Freigabe.\n- Pilot: ${pilot.samples.length} Faelle gesammelt, ${pilot.evaluatedCases} unabhaengig bewertet, ${pilot.regularRuns.length} regulaere Qualitaetslaeufe beobachtet. Automatische Freigabe AUS.\n- Neue Slack-Zustellungen: hier nicht nachgewiesen.\n- API: ${report.credits.status}; ${report.credits.rollingDayReservedOrSettledUsd ?? 'unbekannt'} USD intern gebucht/reserviert in 24 Stunden. Kein Anbieter-Kontostand.\n\n## Naechste Schritte\n\n${Object.entries(report.sourceRecovery.byPriority).map(([key,n])=>'- '+key+': '+n).join('\n')}\n`;
  if(apply) {
    for(const [file,value] of [['server-operations-report.json',report],['automatic-publication-pilot.json',pilot]]) fs.writeFileSync(path.join(root,'reviews',file),JSON.stringify(value,null,2)+'\n');
    const native=report.images.nativeSelection;
    const imageSummary=qualitySnapshot.status==='current'
      ? `\n## Native Bilder\n\n- Auswahlpruefung: ${native.status}; ${native.observedDeals||0} aktuelle Angebote.\n- ${native.reviewedPlatformImages||0} Plattformbilder inhaltlich geprueft (einschliesslich Cache).\n- ${native.lowResolutionDeals?.length||0} Angebote mit zu kleinen Originalbildern; ${native.sharedAssignments?.length||0} mehrfach verwendete Plattformmotive.\n- Kein Nachweis der installierten App-Version oder der Darstellung beim Empfaenger.\n`
      : '\n## Native Bilder\n\n- Aktueller Pruefstand fehlt; historische Bildzaehler werden nicht als heutiges Ergebnis ausgegeben. Keine Entwarnung oder bestaetigte Bildqualitaet.\n';
    const freshnessSummary=`\n## Aktualitaet\n\n- Entwurfsregeln frisch und lokal geprueft, ohne Modell- oder Quellenaufruf. ${report.sourceRecovery.uniqueIds} unterschiedliche IDs in ${queue.length} Eintraegen; doppelte IDs bleiben Prueffaelle.\n- Live-/Bildpruefstand: ${qualitySnapshot.status}; letzte Pruefung ${qualitySnapshot.checkedAt || 'unbekannt'}. Bei veraltetem Stand sind leere Hinweisliste und Bildzaehler KEIN Entwarnungsnachweis.\n`;
    fs.writeFileSync(path.join(root,'reviews/server-operations-report.md'),markdown+imageSummary+freshnessSummary);
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown+imageSummary+freshnessSummary);
  }
  return report;
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report=await writeOperationsReport({apply:!process.argv.includes('--read-only')});
  console.log(JSON.stringify({live:report.liveCount,queue:report.sourceRecovery.byPriority,pilot:report.publicationPilot,credits:report.credits},null,2));
}
