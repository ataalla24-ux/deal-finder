import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { creditPeriodExposure, loadAiCreditPolicy, meteredUsageUsd, validateCreditPolicy } from '../scraper/ai-credit-budget.js';

const repository = 'ataalla24-ux/deal-finder';
const branch = 'automation/openai-free-credit-budget';
const file = 'openai-free-credit-budget.json';
const receiptRef = 'd68282e191a06888dc8fae29670e276bc528fdfd';
const runId = '44816571241';
const period = 'subscription-2026-11-20';
const model = 'gpt-6.2-sol';
const reservationId = '4513a121-cb88-48ec-81d1-8dcaf179f3ac';
const reservationAt = Date.parse('2026-11-20T21:04:35.190Z');
const incidentStart = Date.parse('2026-11-20T21:01:23Z');
const incidentEnd = Date.parse('2026-11-20T21:06:33Z');
const expiredAt = Date.parse('2026-12-19T23:00:00Z');
const reservedUsd = 0.111105;
const input = 16259;
const output = 9891;
const total = rows => rows.reduce((sum, row) => sum + row.usd, 0);

// Reconcile one historically metered call. No live model call, budget increase,
// grant reset or write to provider billing. Reject any unproven ledger change.
export function reconcileKnownOverrun(state, report, policy, now = Date.now()) {
  validateCreditPolicy(policy, now);
  const deny = () => { throw new Error('Incident evidence or unchanged budget no longer matches; do not clear the pause'); };
  if (policy.periodId !== period || Date.parse(policy.expiresAt) !== expiredAt ||
      policy.periodLimitUsd !== 100 || policy.rollingDayLimitUsd !== 2 || policy.requestLimitUsd !== 1 ||
      policy.astraEnrichment?.rollingDayLimitUsd !== 38 || state.version !== 1 || state.creditPeriod !== period ||
      state.pausedUntil !== expiredAt || state.costOverrun || !Array.isArray(state.reservations) ||
      report?.runProvenance?.repository !== repository || report.runProvenance.runId !== runId ||
      report.runProvenance.event !== 'schedule' || report.runProvenance.runAttempt !== '1' ||
      report.config?.model !== model || report.aiUsage?.inputTokens !== input ||
      report.aiUsage?.outputTokens !== output || report.aiUsage?.totalTokens !== input + output ||
      report.aiHealth?.budgetReason !== 'runner-paused' || report.aiHealth?.completedCandidates !== 4 ||
      state.reservations.some(r => !Number.isFinite(r.at) || !Number.isFinite(r.usd) || r.usd < 0 || r.at > now)) deny();
  const incident = state.reservations.filter(r => r.at >= incidentStart);
  const row = incident[0];
  if (incident.length !== 1 || row.id !== reservationId || state.reservations.filter(r => r.id === reservationId).length !== 1 ||
      row.at > incidentEnd || row.at !== reservationAt || row.model !== model ||
      row.creditPeriod !== period || row.expiresAt !== expiredAt || row.usd !== reservedUsd ||
      row.status !== 'reserved' || row.count !== 1 || row.profile) deny();
  const actualUsd = meteredUsageUsd(model, input, output);
  if (!(actualUsd > reservedUsd && actualUsd <= policy.requestLimitUsd)) deny();
  const reservations = state.reservations.map(r => r === row ? { ...r, usd: actualUsd, status: 'settled' } : r);
  const rolling = reservations.filter(r => r.at > now - 86400000);
  const usage = { reservedUsd, actualUsd, periodUsd: total(creditPeriodExposure(reservations, period)),
    regularDayUsd: total(rolling.filter(r => r.profile !== 'astra-deal-enrichment')), combinedDayUsd: total(rolling) };
  if (usage.periodUsd >= policy.periodLimitUsd || usage.regularDayUsd >= policy.rollingDayLimitUsd ||
      usage.combinedDayUsd >= policy.astraEnrichment.rollingDayLimitUsd) deny();
  return { next: { ...state, pausedUntil: 0, reservations }, usage };
}

function main(args) {
  if (args.length && !(args.length === 1 && args[0] === '--apply')) throw new Error('Use no flags for dry-run, or --apply once');
  const endpoint = `repos/${repository}/contents/${file}`;
  const get = route => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8', maxBuffer: 8e6 }));
  const parse = response => JSON.parse(Buffer.from(response.content, 'base64').toString('utf8'));
  const snapshot = get(`${endpoint}?ref=${encodeURIComponent(branch)}`);
  const receipt = JSON.parse(execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw+json',
    `repos/${repository}/contents/docs/instagram-ai-report.json?ref=${receiptRef}`], { encoding: 'utf8', maxBuffer: 8e6 }));
  const { next, usage } = reconcileKnownOverrun(parse(snapshot), receipt, loadAiCreditPolicy());
  if (args[0] !== '--apply') return console.log(JSON.stringify({ dryRun: true, runId, ...usage, openAiCalls: 0 }));
  if (!/^[a-f0-9]{40}$/.test(snapshot.sha || '')) throw new Error('Missing compare-and-swap revision');
  const result = JSON.parse(execFileSync('gh', ['api', endpoint, '--method', 'PUT', '--input', '-'], {
    encoding: 'utf8', maxBuffer: 8e6,
    input: JSON.stringify({ branch, sha: snapshot.sha,
      message: `Reconcile metered OpenAI usage from run ${runId} [skip ci]`,
      content: Buffer.from(JSON.stringify(next) + '\n').toString('base64') }),
  }));
  // Read the immutable CAS commit first: unrelated rows must be byte-values
  // equivalent, even if another worker appends or settles a call immediately.
  if (!/^[a-f0-9]{40}$/.test(result.commit?.sha || '') ||
      !isDeepStrictEqual(parse(get(`${endpoint}?ref=${result.commit.sha}`)), next)) {
    throw new Error('Committed ledger does not match the intended reconciliation');
  }
  const readback = parse(get(`${endpoint}?ref=${encodeURIComponent(branch)}`));
  const reconciled = readback.reservations.find(r => r.id === reservationId && r.at === reservationAt);
  if (reconciled?.status !== 'settled' || reconciled.usd !== usage.actualUsd) throw new Error('Reconciliation readback failed');
  console.log(JSON.stringify({ applied: true, commit: result.commit.sha, runId, ...usage,
    sharedPauseActive: readback.pausedUntil > Date.now(), openAiCalls: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
