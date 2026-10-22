import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { FoodProviderClient, ProviderError } from './food-provider-client.js';
import { DAY, SCAN_PROVIDERS, freeBudget, planRequests, validateLedger, sourceAvailable, canonicalPage, taskKey } from './food-provider-policy.js';
import { POWER_FOOD_SOURCES } from './power-food-sources.js';
import { extractFoodOffers, discoverFoodLinks } from './power-food-extraction.js';
import { fetchOfficialFoodPage, verifyOfficialFoodDeal } from './power-food-verification.js';

const FILES = { state: 'docs/food-provider-state.json', report: 'docs/food-provider-report.json',
  pending: 'docs/deals-pending-food-providers.json', plan: 'output/food-provider-plan.json' };
async function read(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function write(file, data) {
  await fs.mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(`${file}.tmp`, file);
}
const reason = error => error instanceof ProviderError ? error.message : 'source-or-processing-error';
export function applyYieldCooldown(state, results, now) {
  state.pages ||= {};
  for (const key of new Set(results.map(taskKey))) {
    const rows = results.filter(row => taskKey(row) === key);
    // Keep legacy root-only benchmark evidence compatible, but new page checks
    // must not pause every other promotion at the same merchant.
    const target = rows[0].url ? state.pages : state.sources;
    const entry = rows[0].url ? key : rows[0].source;
    if (rows.some(row => row.status === 'failed' || row.status === 'source-paused')) continue;
    const examined = rows.filter(row => ['fetched', 'direct-sufficient'].includes(row.status));
    if (!examined.length) continue;
    if (examined.some(row => row.verifiedIncrementalCandidates > 0)) {
      target[entry] = { attemptedAt: now.toISOString(), noGainCount: 0,
        retryAt: new Date(+now + DAY).toISOString() };
    } else {
      const noGainCount = Math.min(3, (target[entry]?.noGainCount || 0) + 1);
      target[entry] = { attemptedAt: now.toISOString(), noGainCount,
        retryAt: new Date(+now + Math.min(30, 7 * 2 ** (noGainCount - 1)) * DAY).toISOString(), reason: 'no-incremental-offers' };
    }
  }
}

export function rememberLinks(state, source, links, now) {
  state.discoveredPages ||= {};
  const pages = new Map((state.discoveredPages[source.name] || [])
    .filter(p => Date.parse(p.seenAt) >= +now - 14 * DAY && canonicalPage(p.url, source) === p.url).map(p => [p.url, p]));
  for (const value of links) {
    const url = canonicalPage(value, source);
    if (url) pages.set(url, { url, seenAt: now.toISOString() });
  }
  state.discoveredPages[source.name] = [...pages.values()].slice(-40);
}

export function mergeProviderPending(previous, fresh, known, now) {
  const combined = new Map();
  for (const d of [...previous, ...fresh]) {
    if (known.has(d.id) || Date.parse(d.providerDiscovery?.checkedAt || '') < +now - 2 * DAY
        || !Number.isFinite(Date.parse(d.providerDiscovery?.checkedAt || ''))) continue;
    combined.set(d.id, d);
  }
  return [...combined.values()].slice(-50);
}
async function usages(providers) {
  const result = {};
  for (const provider of providers) {
    try { result[provider] = await new FoodProviderClient(provider).usage(); }
    catch (error) { result[provider] = { provider, error: reason(error) }; }
  }
  return result;
}

export async function collectPlan(plan, state, powerReport, {
  now = new Date(), clientFor = provider => new FoodProviderClient(provider), fetchPage = fetchOfficialFoodPage,
  verify = verifyOfficialFoodDeal, save = async () => {}, clock = Date.now, maxRuntimeMs = 18 * 60_000,
} = {}) {
  const results = [], candidates = [], direct = new Map(), verificationCache = new Map();
  const clients = new Map(), attemptedFinalUrls = new Set(), started = clock(), deadline = started + maxRuntimeMs;
  const currentTime = () => new Date(+now + Math.max(0, clock() - started));
  async function confirm(deals, row, directIds, transport) {
    row.verifiedCandidates = 0;
    row.verifiedIncrementalCandidates = 0;
    row.unverifiedCandidates = 0;
    row.candidates = [];
    for (const deal of deals) {
      if (clock() >= deadline) { row.verificationStopped = true; break; }
      const confirmation = await verify(deal, { now: currentTime(), cache: verificationCache });
      row.candidates.push({ id: deal.id, title: deal.title, confirmed: confirmation?.ok === true,
        reason: confirmation?.ok ? '' : confirmation?.reason || 'verification-unavailable' });
      if (!confirmation?.ok) { row.unverifiedCandidates++; continue; }
      row.verifiedCandidates++;
      if (!directIds.has(deal.id)) row.verifiedIncrementalCandidates++;
      candidates.push({ ...confirmation.deal, votes: 0, approved: false, reviewRequired: true,
        providerDiscovery: { provider: transport === 'direct' ? 'direct' : row.provider, checkedAt: currentTime().toISOString() } });
    }
  }
  validateLedger(state);
  const reservation = state.reservations.find(r => r.runId === plan.runId);
  if (!reservation || reservation.startedAt || reservation.mode !== plan.mode
      || JSON.stringify(reservation.tasks) !== JSON.stringify(plan.tasks)) throw new Error('reservation-mismatch-or-started');
  if (+now - Date.parse(reservation.at) > 30 * 60_000 || Date.parse(reservation.at) > +now) throw new Error('stale-reservation');
  reservation.startedAt = now.toISOString();
  await save();
  for (const [index, task] of plan.tasks.entries()) {
    const source = POWER_FOOD_SOURCES.find(s => s.name === task.source);
    const url = task.url || source.url;
    const row = { provider: task.provider, source: source.name, url, reserved: task.cap };
    const unspent = () => { reservation.unspent ||= []; reservation.unspent.push(index); };
    let chargedAttempted = false;
    if (clock() >= deadline || !sourceAvailable(source, powerReport, state, currentTime())) {
      results.push({ ...row, status: clock() >= deadline ? 'runtime-stopped' : 'source-paused' });
      unspent(); await save(); continue;
    }
    try {
      if (!direct.has(url)) direct.set(url, await fetchPage(url, source));
      const baseline = direct.get(url);
      const parsedDirect = extractFoodOffers(baseline.html, source, { now, pageUrl: baseline.finalUrl });
      rememberLinks(state, source, discoverFoodLinks(baseline.html, source, baseline.finalUrl, 40), now);
      state.sources[source.name] = { ...state.sources[source.name], attemptedAt: now.toISOString() };
      if (plan.mode === 'scan' && parsedDirect.deals.length) {
        row.status = 'direct-sufficient'; row.directCandidates = parsedDirect.deals.length;
        unspent();
        await confirm(parsedDirect.deals, row, new Set(parsedDirect.deals.map(d => d.id)), 'direct');
        results.push(row);
        continue;
      }
      const finalKey = `${source.name}|${canonicalPage(baseline.finalUrl, source)}`;
      if (plan.mode === 'scan' && attemptedFinalUrls.has(finalKey)) {
        results.push({ ...row, status: 'duplicate-final-url' }); unspent(); continue;
      }
      if (!clients.has(task.provider)) clients.set(task.provider, clientFor(task.provider));
      const client = clients.get(task.provider);
      const usage = await client.usage();
      // This request's allocation is already reserved. Keep all other allocations
      // charged, including timeouts and cancelled runs; never refund optimistically.
      const remainingState = { ...state, reservations: state.reservations.map(r => r !== reservation ? r :
        { ...r, unspent: [...(r.unspent || []), index] }) };
      const blocked = freeBudget(task.provider, usage, remainingState, task.cap, currentTime(), plan.mode);
      if (blocked || clock() >= deadline) {
        results.push({ ...row, status: 'budget-stopped', reason: blocked || 'runtime-window' }); unspent(); continue;
      }
      attemptedFinalUrls.add(finalKey);
      chargedAttempted = true;
      const page = await client.scrape(source, baseline.finalUrl);
      const parsed = extractFoodOffers(page.html, source, { now, pageUrl: page.finalUrl });
      const $ = load(page.html);
      $('script,style,noscript').remove();
      row.status = 'fetched';
      row.bytes = Buffer.byteLength(page.html);
      row.visibleTextCharacters = $('body').text().replace(/\s+/g, ' ').trim().length;
      row.reportedCredits = page.cost;
      row.directCandidates = parsedDirect.deals.length;
      row.extractedCandidates = parsed.deals.length;
      row.incrementalCandidates = parsed.deals.filter(d => !parsedDirect.deals.some(existing => existing.id === d.id)).length;
      row.offerLinks = discoverFoodLinks(page.html, source, page.finalUrl, 40);
      rememberLinks(state, source, row.offerLinks, now);
      row.rejected = parsed.rejected;
      await confirm(parsed.deals, row, new Set(parsedDirect.deals.map(d => d.id)), 'provider');
      results.push(row);
    } catch (error) {
      if (!chargedAttempted && !reservation.unspent?.includes(index)) unspent();
      const status = Number(error.httpStatus) || 0;
      const retryAt = new Date(Math.max(Date.parse(error.retryAt) || 0,
        +now + ([401, 403, 404, 410].includes(status) ? 3 * DAY : DAY))).toISOString();
      state.sources[source.name] = { attemptedAt: now.toISOString(), retryAt };
      if (error instanceof ProviderError && (/cost/.test(error.message) || [401, 403, 429].includes(status)))
        state.providerPauses[task.provider] = retryAt;
      results.push({ ...row, status: 'failed', reason: reason(error), httpStatus: status, retryAt });
    } finally {
      // Only proven pre-request skips are released. Failed, timed-out or
      // interrupted requests keep their full reservation, even if likely free.
      await save();
    }
  }
  applyYieldCooldown(state, results, now);
  if (plan.mode === 'benchmark') state.benchmarkYieldApplied = true;
  await save();
  return { results, candidates: [...new Map(candidates.map(d => [d.id, d])).values()] };
}

export async function main(command = '--reserve') {
  if (!/^\d+$/.test(process.env.GITHUB_RUN_ID || '') || process.env.GITHUB_RUN_ATTEMPT !== '1')
    throw new Error('fresh-github-run-required-no-retries');
  const state = await read(FILES.state);
  validateLedger(state);
  const powerReport = await read('docs/power-scraper-report.json');
  const now = new Date();
  const runId = process.env.GITHUB_RUN_ID;
  const mode = process.env.FOOD_PROVIDER_MODE || 'scan';
  if (mode === 'benchmark' && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('manual-benchmark-only');
  if (command === '--reserve') {
    // Adopt the first benchmark's yield before scheduling another scan.
    try {
      const previous = await read(FILES.report);
      if (previous.mode === 'benchmark' && previous.finishedAt && !state.benchmarkYieldApplied) {
        applyYieldCooldown(state, previous.results || [], new Date(previous.finishedAt));
        state.benchmarkYieldApplied = true;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const usage = await usages(SCAN_PROVIDERS);
    const plan = { runId, mode, createdAt: now.toISOString(), usage, ...planRequests(state, powerReport, usage, mode, now, runId) };
    if (plan.tasks.length) state.reservations.push({ runId, mode, at: now.toISOString(), tasks: plan.tasks });
    await write(FILES.state, state);
    await write(FILES.plan, plan);
    await write(FILES.report, { ...plan, status: plan.tasks.length ? 'reserved' : 'skipped' });
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `allowed=${plan.tasks.length > 0}\n`);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (command !== '--run') throw new Error('invalid-command');
  const plan = await read(FILES.plan);
  if (plan.runId !== runId || plan.mode !== mode) throw new Error('plan-run-mismatch');
  const output = await collectPlan(plan, state, powerReport, { now, save: () => write(FILES.state, state) });
  const known = new Set();
  for (const file of await fs.readdir('docs')) {
    if (file === 'deals.json' || file.startsWith('deals-pending-') && file.endsWith('.json') && `docs/${file}` !== FILES.pending) {
      const value = await read(`docs/${file}`);
      for (const d of Array.isArray(value) ? value : value.deals || []) if (d.id) known.add(d.id);
    }
  }
  let previous = [];
  try { previous = (await read(FILES.pending)).deals || []; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const deals = mergeProviderPending(previous, output.candidates, known, now);
  await write(FILES.pending, { updatedAt: now.toISOString(), deals, totalDeals: deals.length });
  const report = { ...plan, finishedAt: new Date().toISOString(), status: output.results.some(r => r.status === 'failed') ? 'partial' : 'completed',
    results: output.results, uniqueVerifiedCandidates: output.candidates.length,
    alreadyKnown: output.candidates.filter(d => known.has(d.id)).length,
    newPendingCandidates: output.candidates.filter(d => !known.has(d.id) && !previous.some(old => old.id === d.id)).length,
    pendingCandidates: deals.length,
    slackMessagesSent: 0, note: 'New pending candidates still require central Slack validation and human approval.' };
  await write(FILES.report, report);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]).catch(() => { console.error('food-provider-run-failed; see sanitized report and reserved ledger'); process.exitCode = 1; });
