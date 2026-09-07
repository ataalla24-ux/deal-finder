import { randomUUID } from 'node:crypto';

const HOUR = 3600000;
const LEASE = 5 * 60000;
const LIMIT = 150;
const BRANCH = 'automation/instagram-quota';
const FILE = 'instagram-quota.json';
const pause = (reason) => Object.assign(new Error(`Instagram shared quota paused: ${reason}`), { code: 'SCAN_BUDGET' });

// A dedicated branch keeps operational reservations out of main. Content SHA
// compare-and-swap makes reservations safe across independent GitHub runners.
export function githubQuotaStore(env, fetchImpl = globalThis.fetch) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !token) throw pause('missing GitHub quota credentials');
  const base = `https://api.github.com/repos/${repo}`;
  const request = async (route, method = 'GET', body) => {
    const response = await fetchImpl(`${base}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    let data = {};
    try { data = await response.json(); } catch { /* handled by status */ }
    return { status: response.status, data };
  };
  let initialized = false;
  const initialize = async () => {
    if (initialized) return;
    const ref = await request(`/git/ref/heads/${BRANCH}`);
    if (ref.status === 404) {
      const main = await request('/git/ref/heads/main');
      if (main.status !== 200) throw pause('cannot initialize quota branch');
      const created = await request('/git/refs', 'POST', { ref: `refs/heads/${BRANCH}`, sha: main.data.object.sha });
      if (![201, 422].includes(created.status)) throw pause('cannot create quota branch');
    } else if (ref.status !== 200) throw pause('quota branch unavailable');
    initialized = true;
  };
  return {
    async read() {
      await initialize();
      const result = await request(`/contents/${FILE}?ref=${encodeURIComponent(BRANCH)}`);
      if (result.status === 404) {
        // On rollout, old runners may still spend for up to 45 minutes. Drain
        // that overlap plus a full hour before admitting untracked new calls.
        await this.compareAndSwap(null, { version: 1, reservations: [], pausedUntil: Date.now() + HOUR + 45 * 60000 });
        const initialized = await request(`/contents/${FILE}?ref=${encodeURIComponent(BRANCH)}`);
        if (initialized.status !== 200) throw pause('quota initialization unavailable');
        const state = JSON.parse(Buffer.from(initialized.data.content, 'base64').toString('utf8'));
        if (state.version !== 1 || !Array.isArray(state.reservations) || !Number.isFinite(state.pausedUntil)) throw pause('invalid initialized quota');
        return { state, revision: initialized.data.sha };
      }
      if (result.status !== 200) throw pause('quota state unavailable');
      const state = JSON.parse(Buffer.from(result.data.content, 'base64').toString('utf8'));
      if (state.version !== 1 || !Array.isArray(state.reservations) || !Number.isFinite(state.pausedUntil)
        || state.reservations.some((r) => !Number.isFinite(r.expiresAt) || !Number.isInteger(r.count) || r.count < 1)) throw pause('invalid quota state');
      return { state, revision: result.data.sha };
    },
    async compareAndSwap(revision, state) {
      const result = await request(`/contents/${FILE}`, 'PUT', {
        branch: BRANCH, message: 'Update shared Instagram quota [skip ci]',
        content: Buffer.from(`${JSON.stringify(state)}\n`).toString('base64'), ...(revision ? { sha: revision } : {}),
      });
      if ([200, 201].includes(result.status)) return true;
      if ([409, 422].includes(result.status)) return false;
      throw pause('quota reservation unavailable');
    },
  };
}

function usage(headers) {
  let max = 0;
  const visit = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (['call_count', 'total_time', 'total_cputime'].includes(key) && Number.isFinite(Number(value))) max = Math.max(max, Number(value));
      else if (typeof value === 'object') visit(value);
    }
  };
  for (const name of ['x-app-usage', 'x-business-use-case-usage']) {
    try { visit(JSON.parse(headers.get(name) || '{}')); } catch { /* optional */ }
  }
  return max;
}

export function createSharedQuotaFetch(fetchImpl, { store, clock = Date.now, blockSize = 5 } = {}) {
  let remaining = 0;
  let leaseUntil = 0;
  const block = Math.max(1, Math.min(5, Math.floor(blockSize) || 5));
  const stats = { limitPerHour: LIMIT, requests: 0, reserved: 0, stopped: false, reason: '', highestUsagePercent: 0 };
  const acquire = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { state, revision } = await store.read();
      const now = clock();
      if (state.pausedUntil > now) throw pause('shared cooldown');
      // Even a previously reserved block observes other jobs' cooldowns.
      if (remaining > 0 && now < leaseUntil) { remaining -= 1; return; }
      const reservations = state.reservations.filter((r) => r.expiresAt > now);
      const available = LIMIT - reservations.reduce((sum, r) => sum + r.count, 0);
      if (available <= 0) throw pause('rolling-hour budget exhausted');
      const count = Math.min(block, available);
      const until = now + LEASE;
      // Every call must start before the lease deadline. Keep its reservation
      // for another full hour, so no rolling hour can exceed 150 admitted calls.
      reservations.push({ id: randomUUID(), count, expiresAt: until + HOUR });
      if (await store.compareAndSwap(revision, { version: 1, pausedUntil: state.pausedUntil, reservations })) {
        leaseUntil = until;
        remaining = count;
        stats.reserved += count;
        // Recheck time and shared pause after potentially slow storage I/O.
      }
    }
    throw pause('quota contention');
  };
  const cooldown = async (duration) => {
    const pausedUntil = clock() + duration;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { state, revision } = await store.read();
      if (state.pausedUntil >= pausedUntil) return;
      if (await store.compareAndSwap(revision, { ...state, pausedUntil })) return;
    }
    throw pause('cannot persist shared cooldown');
  };
  // Serialize this wrapper's calls so concurrent callers cannot spend the same
  // locally reserved slot. Other processes coordinate through compare-and-swap.
  let tail = Promise.resolve();
  const wrapped = (...args) => {
    const task = tail.then(async () => {
      try {
        if (stats.stopped) throw pause(stats.reason);
        await acquire();
        stats.requests += 1;
        const response = await fetchImpl(...args);
        stats.highestUsagePercent = Math.max(stats.highestUsagePercent, usage(response.headers));
        let code = 0;
        if (!response.ok) { try { code = Number((await response.clone().json())?.error?.code); } catch { /* non-JSON response */ } }
        if (response.status === 429 || [4, 17, 32, 613, 80002].includes(code) || stats.highestUsagePercent >= 85) {
          stats.stopped = true;
          stats.reason = 'Meta usage or rate limit';
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const retryMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - clock();
          await cooldown(Math.max(HOUR, Number.isFinite(retryMs) ? retryMs : 0));
        }
        return response;
      } catch (error) {
        // Storage errors must never cause an unbudgeted Graph request.
        if (error?.code === 'SCAN_BUDGET' || stats.requests === 0) {
          stats.stopped = true;
          stats.reason = error?.code === 'SCAN_BUDGET' ? error.message : 'quota unavailable';
        }
        throw error?.code === 'SCAN_BUDGET' ? error : pause('request or quota unavailable');
      }
    });
    tail = task.catch(() => {});
    return task;
  };
  wrapped.quotaStats = stats;
  return wrapped;
}

export function sharedInstagramFetch(fetchImpl, env = process.env) {
  if (env.INSTAGRAM_SHARED_QUOTA_ENABLED !== '1') return fetchImpl;
  const shared = createSharedQuotaFetch(fetchImpl, { store: githubQuotaStore(env) });
  const wrapped = (url, ...args) => {
    const hostname = new URL(typeof url === 'string' ? url : url.url).hostname;
    return ['graph.facebook.com', 'graph.instagram.com'].includes(hostname) ? shared(url, ...args) : fetchImpl(url, ...args);
  };
  wrapped.quotaStats = shared.quotaStats;
  return wrapped;
}
