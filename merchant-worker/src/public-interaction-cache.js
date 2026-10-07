// Cache only the public projection, never the mutable records used by POSTs.
const namespaces = new WeakMap();
export const PUBLIC_INTERACTION_TTL_MS = 30_000;
const MAX_ENTRIES = 256;

export function createPublicInteractionCache({ ttl = PUBLIC_INTERACTION_TTL_MS, maxEntries = MAX_ENTRIES, now = Date.now } = {}) {
  const entries = new Map();
  return {
    async get(id, load) {
      let entry = entries.get(id);
      if (entry && (entry.pending || now() < entry.expiresAt)) {
        entries.delete(id);
        entries.set(id, entry);
        return entry.pending || entry.value;
      }
      entry = {};
      entries.delete(id);
      entries.set(id, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      entry.pending = Promise.resolve().then(load).then(value => {
        if (entries.get(id) === entry) {
          entry.value = value;
          entry.expiresAt = now() + ttl;
          entry.pending = null;
        }
        return value;
      }, error => {
        if (entries.get(id) === entry) entries.delete(id);
        throw error;
      });
      return entry.pending;
    },
    invalidate(id) { entries.delete(id); },
  };
}

export function publicInteractionCache(storage) {
  let cache = namespaces.get(storage);
  if (!cache) {
    cache = createPublicInteractionCache();
    namespaces.set(storage, cache);
  }
  return cache;
}
