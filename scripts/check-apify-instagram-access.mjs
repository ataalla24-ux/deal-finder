import { pathToFileURL } from 'node:url';

// Metadata GETs only. This probe cannot start Actors, touch datasets, change
// limits, or fall back to another account's token.
export async function checkApifyInstagramAccess(env = process.env, fetchImpl = globalThis.fetch) {
  const token = String(env.APIFY_TOKEN || '').trim();
  const actorId = String(env.APIFY_INSTAGRAM_VIENNA_ACTOR_ID || '').trim();
  const report = { checkedAt: new Date().toISOString(), mode: 'read-only-access',
    tokenConfigured: Boolean(token), actorConfigured: Boolean(actorId),
    authenticated: false, actorAccessible: false, runListAccessible: false,
    requests: 0, actorRunsStarted: 0, runPermissionVerified: false, collectionRecoveryVerified: false };
  if (!token || !actorId) return { ...report, status: 'configuration-missing' };
  // Scoped collector tokens deliberately cannot read the private account profile.
  // Actor metadata plus its authenticated run list suffice for a read-only probe.
  const actorRoute = `/acts/${encodeURIComponent(actorId)}`;
  let resolvedActorId;
  for (const [step, route] of [['actor', actorRoute], ['runs', `${actorRoute}/runs?limit=1&desc=1`]]) {
    report.requests += 1;
    let response;
    try {
      response = await fetchImpl(`https://api.apify.com/v2${route}`, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    } catch {
      return { ...report, status: 'transport-unavailable', step };
    }
    if (!response.ok) return { ...report, step, httpStatus: response.status,
      status: response.status === 401 ? 'authentication-invalid'
        : response.status === 403 ? 'access-denied' : response.status === 404 ? 'resource-not-found'
          : response.status === 429 ? 'rate-limited' : 'provider-unavailable' };
    let data;
    try { data = (await response.json())?.data; } catch { /* no raw provider response in diagnostics */ }
    if (step === 'actor') {
      if (!data || typeof data.id !== 'string' || !data.id
        || (actorId !== data.id && actorId !== `${data.username}~${data.name}`)) {
        return { ...report, step, status: 'unverified-response' };
      }
      resolvedActorId = data.id;
      report.actorAccessible = true;
    } else {
      if (!Array.isArray(data?.items) || data.items.length > 1
        || data.items.some(run => !run || typeof run.id !== 'string' || !run.id || run.actId !== resolvedActorId)) {
        return { ...report, step, status: 'unverified-response' };
      }
      report.authenticated = true;
      report.runListAccessible = true;
    }
  }
  return { ...report, status: 'access-verified' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await checkApifyInstagramAccess();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'access-verified' ? 0 : 1;
}
