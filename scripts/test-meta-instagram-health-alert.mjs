import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { notifyMetaInstagramHealth } from './notify-meta-instagram-health.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-health-alert-'));
const reportPath = path.join(tempDir, 'report.json');
const statePath = path.join(tempDir, 'state.json');
const now = new Date('2026-10-10T12:00:00.000Z');
fs.writeFileSync(reportPath, JSON.stringify({
  status: 'ok',
  tokenExpiry: {
    status: 'expiring-soon',
    expiresAt: '2026-10-21T00:00:00.000Z',
    daysRemaining: 10.5,
  },
  checks: [],
  nextAction: 'Renew token.',
}));

let calls = 0;
const first = await notifyMetaInstagramHealth({
  now,
  reportPath,
  statePath,
  env: { SLACK_BOT_TOKEN: 'test-token', SLACK_CHANNEL_ID: 'C123' },
  fetchImpl: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ ok: true, ts: '1.0' }) };
  },
});
assert.equal(first.sent, true);
assert.equal(calls, 1);

const duplicate = await notifyMetaInstagramHealth({
  now: new Date(now.getTime() + 60 * 60 * 1000),
  reportPath,
  statePath,
  env: { SLACK_BOT_TOKEN: 'test-token', SLACK_CHANNEL_ID: 'C123' },
  fetchImpl: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  },
});
assert.equal(duplicate.reason, 'deduplicated');
assert.equal(calls, 1);

fs.writeFileSync(reportPath, JSON.stringify({ status: 'ok', tokenExpiry: { status: 'ok' }, checks: [] }));
const healthy = await notifyMetaInstagramHealth({ now, reportPath, statePath, env: {} });
assert.equal(healthy.reason, 'healthy');
assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).activeKey, '');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('meta instagram health alert tests passed');
