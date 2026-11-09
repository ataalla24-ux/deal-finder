const DAY_MS = 86400000;
export const COMMUNITY_RETENTION_MS = 14 * DAY_MS;
const PREFIX = 'community:review:';
const ID = /^[0-9a-z][0-9a-z-]{0,79}$/i;
const SCOPES = new Set(['intake', 'queue', 'edit']);
const RECEIPTS = 'community:slack-retention:';
const SLACK_TS = /^\d{10}\.\d{6}$/;

export function communityId(value) {
  const id = String(value || '').replace(/^community:/, '');
  return ID.test(id) ? id : '';
}

export function communityExpiry(record) {
  const timestamp = record?.submittedAt ?? record?.createdAt;
  const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  return Number.isFinite(time) && time > 0 ? time + COMMUNITY_RETENTION_MS : 0;
}

export function activeCommunityRecord(record, now = Date.now()) {
  const expiry = communityExpiry(record);
  return expiry > now && expiry <= now + COMMUNITY_RETENTION_MS;
}

export async function listCommunityKeys(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, limit: 500, ...(cursor ? { cursor } : {}) });
    keys.push(...page.keys);
    if (page.list_complete !== false) return keys;
    if (!page.cursor || page.cursor === cursor) throw new Error('Community list cursor stalled');
    cursor = page.cursor;
  } while (keys.length < 10000);
  throw new Error('Community list exceeds safety limit');
}

export async function getCommunityReview(kv, scope, id, now = Date.now()) {
  if (!SCOPES.has(scope) || !communityId(id)) return null;
  const record = await kv.get(`${PREFIX}${scope}:${communityId(id)}`, 'json');
  return activeCommunityRecord(record, now) ? record : null;
}

export async function putCommunityReview(kv, scope, row, now = Date.now()) {
  const id = communityId(row?.id);
  if (!SCOPES.has(scope) || !id || row.id !== `community:${id}` || !activeCommunityRecord(row, now)) return false;
  const key = `${PREFIX}${scope}:${id}`;
  const previous = await kv.get(key, 'json');
  const expiry = Math.min(communityExpiry(row), communityExpiry(previous) || Infinity);
  // KV enforces a minimum of 60 seconds for an absolute expiration.
  if (expiry <= now + 60000) return false;
  if (JSON.stringify(previous) === JSON.stringify(row)) return true;
  await kv.put(key, JSON.stringify(row), { expiration: Math.floor(expiry / 1000) });
  return true;
}

export async function readCommunityReviewScope(kv, scope, now = Date.now()) {
  if (!SCOPES.has(scope)) throw new Error('Invalid community scope');
  const prefix = `${PREFIX}${scope}:`;
  const keys = await listCommunityKeys(kv, prefix);
  return (await readCommunityKeys(kv, keys.map(({ name }) => name))).filter(row => activeCommunityRecord(row, now));
}

export async function readCommunityKeys(kv, keys) {
  const rows = [];
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const values = await kv.get(batch, 'json');
    rows.push(...batch.map(name => values.get(name)));
  }
  return rows;
}

export async function updateCommunityReviewScope(kv, scope, input, now = Date.now()) {
  if (!['intake', 'queue'].includes(scope) || !Array.isArray(input?.upserts)
      || !Array.isArray(input?.removes) || input.upserts.length + input.removes.length > 6) {
    throw new Error('Invalid community review batch');
  }
  const ids = [...input.upserts.map(row => row?.id), ...input.removes];
  if (ids.some(id => !communityId(id) || id !== `community:${communityId(id)}`)
      || new Set(ids).size !== ids.length) throw new Error('Invalid community review identifiers');
  let updated = 0;
  for (const row of input.upserts) {
    if (!await putCommunityReview(kv, scope, row, now)) continue;
    if (scope === 'queue') {
      for (const ts of [row.slackTs, row.approvalBlock?.noticeTs]) {
        if (!SLACK_TS.test(ts || '') || ts === row.slackThreadTs) continue;
        const key = RECEIPTS + ts;
        if (!await kv.get(key, 'json')) {
          const deleteAfter = communityExpiry(row);
          await kv.put(key, JSON.stringify({ ts, deleteAfter }), {
            expiration: Math.floor((deleteAfter + 30 * DAY_MS) / 1000),
          });
        }
      }
    }
    updated++;
  }
  for (const id of input.removes) await kv.delete(`${PREFIX}${scope}:${communityId(id)}`);
  return updated;
}

export async function dueCommunitySlackReceipts(kv, now = Date.now()) {
  const keys = await listCommunityKeys(kv, RECEIPTS);
  return (await readCommunityKeys(kv, keys.map(({ name }) => name)))
    .filter(row => SLACK_TS.test(row?.ts || '') && row.deleteAfter <= now)
    .slice(0, 50).map(row => row.ts);
}

export async function acknowledgeCommunitySlackCleanup(kv, timestamps, now = Date.now()) {
  if (!Array.isArray(timestamps) || timestamps.length > 15 || timestamps.some(ts => !SLACK_TS.test(ts))) {
    throw new Error('Invalid Slack receipts');
  }
  for (const ts of timestamps) {
    const key = RECEIPTS + ts;
    const row = await kv.get(key, 'json');
    if (row?.deleteAfter <= now) await kv.delete(key);
  }
}

export async function purgeExpiredCommunitySubmissions(kv, now = Date.now()) {
  const keys = await listCommunityKeys(kv, 'deal:submission:');
  const rows = await readCommunityKeys(kv, keys.map(({ name }) => name));
  let removed = 0;
  for (const [index, { name }] of keys.entries()) {
    const expiry = communityExpiry(rows[index]);
    if (!expiry || expiry > now) continue;
    await kv.delete(name);
    if (++removed >= 30) break;
  }
  return removed;
}
