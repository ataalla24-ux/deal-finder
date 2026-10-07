// Independent of GitHub's best-effort cron; never bypasses the collector's
// shared quota, source validation, manual approval or an explicit pause.
export async function runDiscoveryWatchdog(env, { fetchImpl = fetch, now = new Date() } = {}) {
  if (env.META_DISCOVERY_WATCHDOG_ENABLED !== '1') return { status: 'disabled' };
  const token = env.GITHUB_WORKFLOW_TOKEN || env.GITHUB_TOKEN;
  if (!token || !env.REFERRAL_KV) throw new Error('Discovery watchdog credentials/storage missing');
  const owner = encodeURIComponent(env.GITHUB_OWNER || 'ataalla24-ux');
  const repo = encodeURIComponent(env.GITHUB_REPO || 'deal-finder');
  const ref = env.GITHUB_REF || 'main';
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
    'user-agent': 'freefinder-discovery-watchdog', 'x-github-api-version': '2022-11-28' };
  const read = async (path) => {
    const response = await fetchImpl(`${base}${path}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Watchdog GitHub read failed (${response.status})`);
    return response.json();
  };
  const enabled = await read('/actions/variables/ENABLE_META_INSTAGRAM_DISCOVERY');
  if (enabled.value !== '1') {
    const report = { checkedAt: now.toISOString(), status: 'paused' };
    await env.REFERRAL_KV.put('watchdog:discovery:health', JSON.stringify(report));
    return report;
  }
  const results = [];
  for (const [workflow, intervalMinutes] of [['meta-instagram-deals.yml', 60], ['daily-digest.yml', 30]]) {
    try {
      const key = `watchdog:discovery:${workflow}`;
      const previous = await env.REFERRAL_KV.get(key, 'json') || {};
      const cooldown = Date.parse(previous.requestedAt || '');
      if (Number.isFinite(cooldown) && +now - cooldown < intervalMinutes * 60000) {
        results.push({ workflow, action: 'cooldown' }); continue;
      }
      const metadata = await read(`/actions/workflows/${workflow}`);
      if (metadata.state !== 'active') { results.push({ workflow, action: 'disabled' }); continue; }
      const payload = await read(`/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&per_page=20`);
      if (!Array.isArray(payload.workflow_runs)) throw new Error('Watchdog received invalid run history');
      const runs = payload.workflow_runs;
      if (runs.some((run) => run.status !== 'completed')) {
        results.push({ workflow, action: 'already-running' }); continue;
      }
      const newest = Math.max(0, ...runs.map((run) => Date.parse(run.created_at) || 0));
      if (+now - newest < intervalMinutes * 60000) {
        results.push({ workflow, action: 'recent' }); continue;
      }
      // Record intent first: a lost success response must not cause immediate
      // duplicate dispatch. A later interval can retry the ambiguous outcome.
      await env.REFERRAL_KV.put(key, JSON.stringify({ requestedAt: now.toISOString(), status: 'requesting' }));
      const response = await fetchImpl(`${base}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ref }), signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 204) throw new Error(`Watchdog GitHub dispatch failed (${response.status})`);
      await env.REFERRAL_KV.put(key, JSON.stringify({ requestedAt: now.toISOString(), status: 'requested' }));
      results.push({ workflow, action: 'requested' });
    } catch (error) {
      results.push({ workflow, action: 'failed', error: String(error.message).slice(0, 200) });
    }
  }
  const report = { checkedAt: now.toISOString(), status: results.some((row) => row.action === 'failed') ? 'degraded' : 'ok', results };
  await env.REFERRAL_KV.put('watchdog:discovery:health', JSON.stringify(report));
  return report;
}
