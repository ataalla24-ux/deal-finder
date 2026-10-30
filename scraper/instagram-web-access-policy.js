import { retryAfterAt } from './source-http-policy.js';
import { instagramAuthCircuitStatus } from './instagram-auth-utils.js';

const HOUR = 3600000;
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const reasonFor = status => [401, 403, 429].includes(Number(status)) ? `http-${Number(status)}` : '';

// Website access is independent of Graph API access. Never rotate cookies,
// language URLs or transports to retry a denied website request.
export function createInstagramWebAccess({ previousReport = {}, healthReport = {}, now = () => new Date() } = {}) {
  const current = () => now instanceof Date ? now : now();
  const state = {};
  const retain = (scope, value) => {
    if (!time(value?.nextRetryAt)) return;
    if (time(state[scope]?.nextRetryAt) >= time(value.nextRetryAt)) return;
    state[scope] = {
      nextRetryAt: new Date(time(value.nextRetryAt)).toISOString(),
      lastAttemptAt: time(value.lastAttemptAt) ? new Date(time(value.lastAttemptAt)).toISOString() : '',
      reason: /^(?:http-(?:401|403|429)|profile-unavailable|login-wall|transport-failures|auth-health-cooldown)$/.test(value.reason) ? value.reason : 'profile-unavailable',
      consecutiveFailures: Math.min(8, Math.max(1, Number(value.consecutiveFailures) || 1)),
    };
  };
  for (const scope of ['all', 'profiles']) retain(scope, previousReport.webAccess?.[scope]);
  const previousTime = time(previousReport.lastUpdated);
  if (previousTime) {
    const legacyReason = previousReport.previewFetch?.stoppedReason || '';
    if (previousReport.instagramAuth?.rateLimitedDuringRun || /^http-(401|403|429)$/.test(legacyReason)) {
      const status = Number(legacyReason.slice(5)) || 429;
      retain('all', { nextRetryAt: new Date(previousTime + (status === 429 ? 6 : 24) * HOUR).toISOString(),
        lastAttemptAt: previousReport.lastUpdated, reason: `http-${status}` });
    }
    if (previousReport.profileDiscovery?.stoppedReason === 'three-consecutive-profile-blocks') {
      retain('profiles', { nextRetryAt: new Date(previousTime + 6 * HOUR).toISOString(),
        lastAttemptAt: previousReport.lastUpdated, reason: 'profile-unavailable' });
    }
  }
  const health = instagramAuthCircuitStatus(healthReport, current());
  if (!health.allowed) retain('all', { nextRetryAt: health.nextRetryAt, lastAttemptAt: healthReport.updatedAt, reason: 'auth-health-cooldown' });

  return {
    snapshot: () => structuredClone(state),
    pause(scope = 'all') {
      return [state.all, ...(scope === 'profiles' ? [state.profiles] : [])]
        .filter(value => time(value?.nextRetryAt) > +current())
        .sort((a, b) => time(b.nextRetryAt) - time(a.nextRetryAt))[0] || null;
    },
    failure(scope, { status, retryAfter = '', reason = 'transport-failures' } = {}) {
      reason = reasonFor(status) || reason;
      if (reasonFor(status)) scope = 'all';
      const date = current();
      const previous = state[scope];
      const count = time(previous?.lastAttemptAt) > +date - 7 * 24 * HOUR ? Math.min(8, previous.consecutiveFailures + 1) : 1;
      const hours = reason === 'http-401' || reason === 'http-403' ? 24 : reason === 'transport-failures' ? 1 : 6;
      retain(scope, { lastAttemptAt: date.toISOString(), consecutiveFailures: count, reason,
        nextRetryAt: new Date(Math.max(+date + Math.min(168, hours * 2 ** (count - 1)) * HOUR,
          time(retryAfterAt(retryAfter, date)), time(previous?.nextRetryAt))).toISOString() });
      return state[scope];
    },
    success(scope = 'all') {
      if (state[scope] && time(state[scope].nextRetryAt) <= +current()) delete state[scope];
    },
  };
}
