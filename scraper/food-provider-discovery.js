import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { FoodProviderClient, ProviderError } from './food-provider-client.js';
import { CAPS, DAY, freeBudget, planRequests, validateLedger, sourceAvailable } from './food-provider-policy.js';
import { POWER_FOOD_SOURCES } from './power-food-sources.js';
import { extractFoodOffers } from './power-food-extraction.js';
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
  verify = verifyOfficialFoodDeal, save = async () => {},
} = {}) {
  const results = [], candidates = [], direct = new Map(), verificationCache = new Map();
  const reservation = state.reservations.find(r => r.runId === plan.runId);
  if (!reservation || reservation.startedAt || reservation.mode !== plan.mode
      || JSON.stringify(reservation.tasks) !== JSON.stringify(plan.tasks)) throw new Error('reservation-mismatch-or-started');
  if (+now - Date.parse(reservation.at) > 30 * 60_000 || Date.parse(reservation.at) > +now) throw new Error('stale-reservation');
  reservation.startedAt = now.toISOString();
  await save();
  for (const task of plan.tasks) {
    const source = POWER_FOOD_SOURCES.find(s => s.name === task.source);
    const row = { provider: task.provider, source: source.name, url: source.url, reserved: task.cap };
    if (!sourceAvailable(source, powerReport, state, now)) { results.push({ ...row, status: 'source-paused' }); continue; }
    try {
      if (!direct.has(source.name)) direct.set(source.name, await fetchPage(source.url, source));
      const baseline = direct.get(source.name);
      const parsedDirect = extractFoodOffers(baseline.html, source, { now, pageUrl: baseline.finalUrl });
      state.sources[source.name] = { attemptedAt: now.toISOString() };
      if (plan.mode === 'scan' && parsedDirect.deals.length) {
        results.push({ ...row, status: 'direct-sufficient', directCandidates: parsedDirect.deals.length });
        continue;
      }
      const client = clientFor(task.provider);
      const usage = await client.usage();
      // This request's allocation is already reserved. Keep all other allocations
      // charged, including timeouts and cancelled runs; never refund optimistically.
      const remainingState = { ...state, reservations: state.reservations.map(r => r !== reservation ? r :
        { ...r, tasks: r.tasks.filter(t => t !== task && !(t.provider === task.provider && t.source === task.source)) }) };
      const blocked = freeBudget(task.provider, usage, remainingState, task.cap, now, plan.mode);
      if (blocked) { results.push({ ...row, status: 'budget-stopped', reason: blocked }); continue; }
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
      row.rejected = parsed.rejected;
      row.verifiedCandidates = 0;
      row.unverifiedCandidates = 0;
      row.candidates = [];
      for (const deal of parsed.deals) {
        const confirmation = await verify(deal, { now, cache: verificationCache });
        row.candidates.push({ id: deal.id, title: deal.title, confirmed: confirmation?.ok === true,
          reason: confirmation?.ok ? '' : confirmation?.reason || 'verification-unavailable' });
        if (!confirmation?.ok) { row.unverifiedCandidates++; continue; }
        row.verifiedCandidates++;
        candidates.push({ ...confirmation.deal, votes: 0, approved: false, reviewRequired: true,
          providerDiscovery: { provider: task.provider, checkedAt: now.toISOString() } });
      }
      results.push(row);
    } catch (error) {
      const status = Number(error.httpStatus) || 0;
      const retryAt = new Date(Math.max(Date.parse(error.retryAt) || 0,
        +now + ([401, 403, 404, 410].includes(status) ? 3 * DAY : DAY))).toISOString();
      state.sources[source.name] = { attemptedAt: now.toISOString(), retryAt };
      if (error instanceof ProviderError && (/cost/.test(error.message) || [401, 403, 429].includes(status)))
        state.providerPauses[task.provider] = retryAt;
      results.push({ ...row, status: 'failed', reason: reason(error), httpStatus: status, retryAt });
    }
    await save();
  }
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
    const usage = await usages(mode === 'benchmark' ? ['scraperapi', 'scrapingbee', 'zyte'] : ['scraperapi']);
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
  const deals = output.candidates.filter(d => !known.has(d.id));
  await write(FILES.pending, { updatedAt: now.toISOString(), deals, totalDeals: deals.length });
  const report = { ...plan, finishedAt: new Date().toISOString(), status: output.results.some(r => r.status === 'failed') ? 'partial' : 'completed',
    results: output.results, uniqueVerifiedCandidates: output.candidates.length,
    alreadyKnown: output.candidates.length - deals.length, newPendingCandidates: deals.length,
    slackMessagesSent: 0, note: 'New pending candidates still require central Slack validation and human approval.' };
  await write(FILES.report, report);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]).catch(() => { console.error('food-provider-run-failed; see sanitized report and reserved ledger'); process.exitCode = 1; });
