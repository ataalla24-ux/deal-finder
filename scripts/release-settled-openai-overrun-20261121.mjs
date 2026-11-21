import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { creditPeriodExposure, loadAiCreditPolicy, meteredUsageUsd, validateCreditPolicy } from '../scraper/ai-credit-budget.js';

const repo = 'ataalla24-ux/deal-finder';
const branch = 'automation/openai-free-credit-budget';
const file = 'openai-free-credit-budget.json';
const incidentCommit = 'c0b4829031f8fbb4db9d86744670bd8e111d9ffa';
const incidentBlob = 'd83286ea9853cf374b21753532b3f75070a7e596';
const period = 'subscription-2026-11-20';
const end = Date.parse('2026-12-19T23:00:00Z');
const incident = {
  reservationId: '2d864fd3-9a11-4b8e-8e11-20764a607266', model: 'gpt-6.2-sol',
  reservedUsd: 0.117935, actualUsd: 0.141308,
};

// Run 44905506480 reported 23157 total tokens on its only call. At the wrapper's
// rates the recorded cost corresponds to exactly 12035 input + 11122 output.
export function releaseSettledOverrun(state, policy, now = Date.now()) {
  validateCreditPolicy(policy, now);
  assert.deepEqual([policy.periodId, Date.parse(policy.expiresAt), policy.periodLimitUsd, policy.rollingDayLimitUsd,
    policy.astraEnrichment.rollingDayLimitUsd, policy.requestLimitUsd, policy.providerGuard.monthlyLimitUsd],
  [period, end, 100, 2, 38, 1, 100], 'Budget policy changed');
  assert.equal(state.version, 1);
  assert.equal(state.creditPeriod, period);
  assert.equal(state.pausedUntil, end);
  assert.deepEqual(state.costOverrun, incident, 'Different overrun or pause');
  const { reservations } = state;
  const affected = reservations.filter(row => row.id === incident.reservationId);
  assert.equal(affected.length, 1);
  const row = affected[0];
  assert.equal(row.at, 1795265195768);
  assert.deepEqual([row.creditPeriod, row.model, row.status, row.count, row.reservedUsd, row.usd, row.expiresAt],
    [period, incident.model, 'settled', 1, incident.reservedUsd, incident.actualUsd, end]);
  assert.equal(meteredUsageUsd(incident.model, 12035, 11122), row.usd);
  assert.ok(reservations.every(r => Number.isFinite(r.usd) && r.usd >= 0 && Number.isFinite(r.at) &&
    r.at <= now && (r === row || r.at < row.at)), 'Concurrent or invalid reservation');
  assert.ok(!(state.astraPausedUntil > now) && Object.values(state.modelPausedUntil || {}).every(t => t <= now),
    'A separate provider pause is active');
  const sum = rows => rows.reduce((n, r) => n + Math.round(r.usd * 1e6), 0) / 1e6;
  const daily = reservations.filter(r => r.at > now - 86400000);
  assert.ok(sum(creditPeriodExposure(reservations, period)) < 100 &&
    sum(daily.filter(r => r.profile !== 'astra-deal-enrichment')) < 2 && sum(daily) < 38, 'Spend limit reached');
  const { costOverrun, ...next } = state;
  return { ...next, pausedUntil: 0 };
}

export function requireRecoveryGeneration(head, parent, bytes, expected) {
  if (head === incidentCommit) return 'ready';
  if (parent === incidentCommit && bytes === expected) return 'already-applied';
  throw Error('Ledger has a different generation. No write permitted.');
}

function api(route, input) {
  const args = ['api', route];
  if (input) args.push('--input', '-');
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8e6,
    input: input ? JSON.stringify(input) : undefined }));
}

function main(args) {
  assert.ok(args.length === 0 || args.length === 1 && args[0] === '--apply', 'Use no flag or --apply');
  const base = 'repos/' + repo;
  const readFile = sha => api(base + '/contents/' + file + '?ref=' + sha);
  const readBytes = result => Buffer.from(result.content, 'base64').toString('utf8');
  const source = readFile(incidentCommit);
  assert.equal(source.sha, incidentBlob);
  const expected = JSON.stringify(releaseSettledOverrun(JSON.parse(readBytes(source)), loadAiCreditPolicy())) + '\n';
  const head = api(base + '/git/ref/heads/' + branch).object.sha;
  const parent = sha => api(base + '/git/commits/' + sha).parents[0]?.sha;
  const decision = head === incidentCommit ? 'ready' :
    requireRecoveryGeneration(head, parent(head), readBytes(readFile(head)), expected);
  if (decision === 'already-applied' || args.length === 0) {
    console.log(JSON.stringify({ decision, changed: false, runId: '44905506480', meteredUsd: incident.actualUsd, head }));
    return;
  }
  const input = { branch: { repositoryNameWithOwner: repo, branchName: branch }, expectedHeadOid: incidentCommit,
    message: { headline: 'Release settled budget overrun from run 44905506480 [skip ci]' },
    fileChanges: { additions: [{ path: file, contents: Buffer.from(expected).toString('base64') }] } };
  const data = api('graphql', { query: 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input:$input) { commit { oid } } }',
    variables: { input } });
  const sha = data.data.createCommitOnBranch.commit.oid;
  assert.equal(parent(sha), incidentCommit);
  assert.equal(readBytes(readFile(sha)), expected);
  console.log(JSON.stringify({ decision: 'applied', changed: true, runId: '44905506480', meteredUsd: incident.actualUsd, commit: sha }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
