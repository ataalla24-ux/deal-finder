const signature = value => JSON.stringify(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeRecord(base, remote, local) {
  const merged = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (signature(remote[key]) === signature(base[key])) {
      if (Object.hasOwn(local, key)) merged[key] = local[key];
      else delete merged[key];
    } else if (object(remote[key]) && object(local[key])) {
      merged[key] = mergeRecord(object(base[key]) ? base[key] : {}, remote[key], local[key]);
    }
    // Concurrent conflicts retain the newer remote decision, never a stale overwrite.
  }
  return merged;
}

export function mergeSourceOutbox(basePayload, remotePayload, localPayload) {
  if (Array.isArray(remotePayload) !== Array.isArray(localPayload)) throw Error('source-outbox-shape-conflict');
  const rows = payload => Array.isArray(payload) ? payload : payload?.deals;
  const key = row => row?.id ? `id:${row.id}` : row?.url && row?.title ? `url:${row.url}|${row.title}` : '';
  const index = payload => {
    const list = rows(payload);
    if (!Array.isArray(list) || list.some(row => !object(row) || !key(row))) throw Error('invalid-source-outbox');
    const map = new Map(list.map(row => [key(row), row]));
    if (map.size !== list.length) throw Error('ambiguous-source-outbox');
    return map;
  };
  const base = index(Object.keys(basePayload || {}).length ? basePayload : { deals: [] });
  const remote = index(remotePayload), local = index(localPayload);
  const merged = new Map(remote);
  for (const [id, previous] of base) {
    if (!local.has(id) && signature(remote.get(id)) === signature(previous)) merged.delete(id);
  }
  for (const [id, row] of local) {
    if (!base.has(id)) merged.set(id, remote.has(id) ? mergeRecord({}, remote.get(id), row) : row);
    else if (remote.has(id)) merged.set(id, mergeRecord(base.get(id), remote.get(id), row));
    // A remote removal of a base record remains removed even after local enrichment.
  }
  const deals = [...merged.values()];
  if (Array.isArray(localPayload)) return deals;
  const payload = mergeRecord(basePayload, remotePayload, localPayload);
  payload.deals = deals;
  for (const field of ['totalDeals', 'count']) if (field in payload) payload[field] = deals.length;
  for (const field of ['updatedAt', 'lastUpdated', 'generatedAt']) {
    const dates = [remotePayload[field], localPayload[field]].filter(value => Number.isFinite(Date.parse(value)));
    if (dates.length) payload[field] = dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  }
  return payload;
}
