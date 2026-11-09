import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeCommunityRecord } from '../referrals-worker/src/community-review-state.js';
import { privateCommunityRow } from './community-public-boundary.mjs';
export { privateCommunityRow };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.community-internal');
const publicQueue = path.join(root, 'docs/deals-pending-all.json');
const privateQueue = path.join(dir, 'queue.json');
const privateIntake = path.join(dir, 'intake.json');
const snapshot = path.join(dir, 'before.json');

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function reviewDiff(before, after, now = Date.now()) {
  const current = new Map(after.filter(row => activeCommunityRecord(row, now + 90000)).map(row => [row.id, row]));
  const previous = new Map(before.map(row => [row.id, row]));
  return {
    upserts: [...current.values()].filter(row => JSON.stringify(row) !== JSON.stringify(previous.get(row.id))),
    removes: [...previous.keys()].filter(id => !current.has(id)),
  };
}

async function request(scope, body) {
  const config = read(path.join(root, 'docs/push-config.json'));
  const base = process.env.COMMUNITY_API_BASE || config.referralApiBase;
  const token = process.env.COMMUNITY_SYNC_TOKEN;
  if (!base || !token) throw new Error('Missing community service configuration');
  const target = new URL('/api/deals/submissions/admin/review-state', base);
  if (target.protocol !== 'https:') throw new Error('Community API requires HTTPS');
  target.searchParams.set('scope', scope);
  const response = await fetch(target, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Private community state HTTP ${response.status}`);
  const json = await response.json();
  if (!json.ok) throw new Error('Private community state refused');
  return json;
}

async function get(scope) {
  const { deals } = await request(scope);
  if (!Array.isArray(deals) || deals.some(row => !privateCommunityRow(row) || !/^community:/.test(row.id))) {
    throw new Error('Unexpected private community state');
  }
  return deals;
}

async function save(scope, changes) {
  for (const name of ['upserts', 'removes']) {
    for (let i = 0; i < changes[name].length; i += 6) {
      const batch = changes[name].slice(i, i + 6);
      const result = await request(scope, { upserts: [], removes: [], [name]: batch });
      if (name === 'upserts' && result.updated !== batch.length) throw new Error('Private community write was incomplete');
    }
  }
}

async function main(action) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (action === 'load-intake') {
    write(privateIntake, { deals: await get('intake') });
  } else if (action === 'save-intake') {
    const before = await get('intake');
    const after = read(privateIntake).deals;
    await save('intake', reviewDiff(before, after));
  } else if (action === 'hydrate') {
    const [queue, intake] = await Promise.all([get('queue'), get('intake')]);
    const initial = read(publicQueue);
    write(privateQueue, { ...initial, deals: [...initial.deals.filter(row => !privateCommunityRow(row)), ...queue] });
    write(privateIntake, { deals: intake });
    write(snapshot, queue);
  } else if (['persist', 'stage-public', 'save-queue'].includes(action)) {
    const before = read(snapshot);
    const result = read(privateQueue);
    if (action !== 'stage-public') await save('queue', reviewDiff(before, result.deals.filter(privateCommunityRow)));
    const deals = result.deals.filter(row => !privateCommunityRow(row));
    if (action !== 'save-queue' && JSON.stringify(read(publicQueue).deals) !== JSON.stringify(deals)) {
      write(publicQueue, { ...result, deals, totalDeals: deals.length });
    }
  } else if (action === 'prune-slack') {
    const { timestamps } = await request('receipts');
    const channel = process.env.SLACK_CHANNEL_ID;
    const token = process.env.SLACK_BOT_TOKEN;
    if (!Array.isArray(timestamps) || !/^[CG][A-Z0-9]+$/.test(channel || '') || !token) throw new Error('Missing Slack cleanup configuration');
    const removed = [];
    let failed = 0;
    for (const ts of timestamps) {
      if (!/^\d{10}\.\d{6}$/.test(ts)) throw new Error('Invalid Slack cleanup timestamp');
      try {
        const response = await fetch('https://slack.com/api/chat.delete', {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ channel, ts }), redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        const payload = await response.json();
        if (response.ok && (payload.ok || payload.error === 'message_not_found')) removed.push(ts);
        else { failed++; if (response.status === 429) break; }
      } catch { failed++; }
    }
    for (let i = 0; i < removed.length; i += 15) {
      await request('receipts', { timestamps: removed.slice(i, i + 15) });
    }
    console.log(`Slack community cleanup: ${removed.length} confirmed absent; ${timestamps.length - removed.length} pending.`);
    if (failed) throw new Error('Community Slack cleanup incomplete; retry next run');
  } else throw new Error('Unknown private state action');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
