const HOUR = 3600000;
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const httpStatus = result => Number(result.httpStatus || String(result.error).match(/HTTP (\d{3})/)?.[1] || 0);

function cooldownFor(result, previous, now) {
  // An obsolete optional page is not a merchant-wide outage. Access denials
  // and throttles still pause the entire source, including alternate pages.
  const candidates = (result.pages?.length ? result.pages : [result]).filter(item => item.error);
  if (!candidates.length && result.status !== 'ok' && result.error) candidates.push(result);
  const failures = candidates
    .filter(item => result.status !== 'ok' || item.url === result.url || [401, 403, 429].includes(httpStatus(item)));
  if (!failures.length) return null;
  const statuses = failures.map(httpStatus);
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
  const sameMerchant = previousReport?.sources?.filter(item => item.source === source.name) || [];
  const previous = sameMerchant.find(item => item.url === source.url)
    || sameMerchant.find(item => ['access-denied', 'rate-limited'].includes(item.cooldown?.reason)
      || [401, 403, 429].includes(httpStatus(item)));
  const previousTime = timestamp(previousReport?.finishedAt);
  const cooldown = previous?.cooldown || (previous?.status === 'error' && previousTime
    ? cooldownFor(previous, null, new Date(previousTime)) : null);
  if (timestamp(cooldown?.nextRetryAt) > +now) {
    return {
      source: source.name, url: source.url, status: 'deferred',
      operationalStatus: 'cooldown', deals: 0, rows: [], durationMs: 0,
      ...(source.officialFood ? { sourceKind: 'official-food' } : {}),
      cooldown,
      ...(previous?.pageCooldowns ? { pageCooldowns: previous.pageCooldowns } : {}),
    };
  }
  const pageCooldowns = Object.fromEntries(Object.entries(previous?.pageCooldowns || {})
    .filter(([, value]) => timestamp(value.nextRetryAt) > +now));
  const result = await collect({ ...source, pageCooldowns });
  for (const page of result.pages || []) {
    if (page.status === 'ok') delete pageCooldowns[page.url];
    else if (page.error && page.url !== source.url && ![401, 403, 429].includes(httpStatus(page))) {
      const pause = cooldownFor(page, previous?.pageCooldowns?.[page.url], now);
      if (pause) pageCooldowns[page.url] = pause;
    }
  }
  return { ...result, ...(Object.keys(pageCooldowns).length ? { pageCooldowns } : {}),
    cooldown: cooldownFor(result, cooldown, now) };
}
