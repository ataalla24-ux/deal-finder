const HOUR = 3600000;
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

function cooldownFor(result, previous, now) {
  const failures = [result, ...(result.pages || [])].filter(item => item.error);
  if (!failures.length) return null;
  const statuses = failures.map(item => Number(item.httpStatus || String(item.error).match(/HTTP (\d{3})/)?.[1] || 0));
  const blocked = statuses.some(status => status === 401 || status === 403);
  const missing = statuses.some(status => status === 404 || status === 410);
  const limited = statuses.includes(429);
  const count = Math.min(10, Math.max(0, Number(previous?.consecutiveFailures) || 0) + 1);
  const baseHours = blocked || missing ? 72 : limited ? 24 : 6;
  const delay = Math.min(7 * 24, baseHours * 2 ** (count - 1)) * HOUR;
  // A merchant's Retry-After is a minimum, even when longer than our backoff cap.
  const next = Math.max(+now + delay, ...failures.map(item => timestamp(item.retryAt)));
  return {
    consecutiveFailures: count,
    lastAttemptAt: now.toISOString(),
    nextRetryAt: new Date(next).toISOString(),
    reason: blocked ? 'access-denied' : missing ? 'missing-endpoint' : limited ? 'rate-limited' : 'source-error',
    lastError: result.error || failures[0].error,
  };
}

export function prioritizePowerSources(sources) {
  const isFood = source => source.officialFood || ['essen', 'trinken', 'kaffee'].includes(source.category);
  return [...sources].sort((a, b) => Number(isFood(b)) - Number(isFood(a)));
}

export async function runScheduledPowerSource(source, previousReport, collect, now = new Date()) {
  const previous = previousReport?.sources?.find(item => item.source === source.name && item.url === source.url);
  const previousTime = timestamp(previousReport?.finishedAt);
  const cooldown = previous?.cooldown || (previous?.status === 'error' && previousTime
    ? cooldownFor(previous, null, new Date(previousTime)) : null);
  if (timestamp(cooldown?.nextRetryAt) > +now) {
    return {
      source: source.name, url: source.url, status: 'deferred',
      operationalStatus: 'cooldown', deals: 0, rows: [], durationMs: 0,
      ...(source.officialFood ? { sourceKind: 'official-food' } : {}),
      cooldown,
    };
  }
  const result = await collect(source);
  return { ...result, cooldown: cooldownFor(result, cooldown, now) };
}
