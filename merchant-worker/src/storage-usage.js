const originals = new WeakMap();
const limits = new WeakMap();
const RETRY_MS = 60_000;
const ROUTES = new Set([
  '/api/merchant/health', '/api/merchant/campaigns', '/api/deals/review',
  '/api/deals/interactions', '/api/analytics/events', '/api/analytics/summary',
  '/api/instagram-agent/health', '/api/instagram-agent/deals',
]);
const KEY_GROUPS = [
  ['deal-interaction-community:', 'community'],
  ['deal-interaction-ratings:', 'ratings'],
  ['deal-interaction-rate:', 'interaction_rate'],
  ['deal-interaction:', 'interactions'],
  ['product-analytics:event:', 'analytics_events'],
  ['product-analytics:dedupe:', 'analytics_dedupe'],
  ['product-analytics:rate:', 'analytics_rate'],
  ['campaign:', 'campaigns'], ['transaction:', 'transactions'],
  ['instagram-agent:', 'instagram'],
];

export class StorageQuotaError extends Error {
  constructor() { super('Storage daily quota exhausted'); }
}

export function storageIdentity(storage) { return originals.get(storage) || storage; }

export function measureStorage(request, storage, { now = Date.now } = {}) {
  const path = new URL(request.url).pathname;
  const route = ROUTES.has(path) ? path : path.startsWith('/api/merchant/promos/') ? '/api/merchant/promos/*' : 'other';
  const report = {
    event: 'merchant_storage_usage',
    route,
    method: ['GET', 'POST', 'OPTIONS'].includes(request.method) ? request.method : 'other',
    operations: {}, errors: 0, quotaErrors: 0, suppressed: 0,
  };
  if (!storage) return { storage, report };
  const source = storageIdentity(storage);
  let blocked = limits.get(source);
  if (!blocked) { blocked = new Map(); limits.set(source, blocked); }
  const measured = new Proxy(source, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (!['get', 'getWithMetadata', 'put', 'delete', 'list'].includes(property)) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args) => {
        const operation = property === 'getWithMetadata' ? 'get' : property;
        if ((blocked.get(operation) || 0) > now()) {
          report.suppressed++;
          throw new StorageQuotaError();
        }
        const key = property === 'list' ? args[0]?.prefix : args[0];
        const group = KEY_GROUPS.find(([prefix]) => String(key || '').startsWith(prefix))?.[1] || 'other';
        const counts = report.operations[group] ||= {};
        counts[operation] = (counts[operation] || 0) + (Array.isArray(key) ? key.length : 1);
        try {
          return await value.apply(target, args);
        } catch (error) {
          report.errors++;
          if (/KV\s+(?:get|put|list|delete)\(\)\s+limit exceeded for the day/i.test(String(error?.message))) {
            report.quotaErrors++;
            blocked.set(operation, now() + RETRY_MS);
            throw new StorageQuotaError();
          }
          throw error;
        }
      };
    },
  });
  originals.set(measured, source);
  return { storage: measured, report };
}
