const states = new WeakMap();
const TTL_MS = 30000;

// Public overrides only, never identity, billing, tokens or review decisions.
// Concurrent app polls share one load in an isolate; failures are not cached.
export async function readPublicDealRecords(storage, load, clock = Date.now) {
  let state = states.get(storage);
  if (!state) { state = { generation: 0 }; states.set(storage, state); }
  if (state.value && state.expiresAt > clock()) return state.value;
  if (state.inFlight) return state.inFlight;
  const generation = state.generation;
  const loading = Promise.resolve().then(load).then((value) => {
    if (generation === state.generation) {
      state.value = value;
      state.expiresAt = clock() + TTL_MS;
    }
    return value;
  }).finally(() => {
    if (state.inFlight === loading) state.inFlight = null;
  });
  state.inFlight = loading;
  return loading;
}

export function invalidatePublicDealRecords(storage) {
  const state = states.get(storage);
  if (!state) return;
  state.generation += 1;
  state.value = null;
  state.inFlight = null;
}
