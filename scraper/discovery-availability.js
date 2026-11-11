export function discoveryAvailability(instagram = {}, tiktok = {}, now = new Date()) {
  const lane = (name, report, part, counts = {}) => {
    const observedAt = report.lastUpdated || report.generatedAt || '';
    const observed = Date.parse(observedAt);
    const stale = !Number.isFinite(observed) || observed > +now || +now - observed > 48 * 3600000;
    const reason = String(part?.stoppedReason || part?.reason || '');
    const retryAt = part?.nextRetryAt || '';
    const paused = Date.parse(retryAt) > +now;
    return { name, observedAt, status: stale ? 'unknown-stale-report' : !part ? 'unknown-missing-lane' : paused ? 'paused'
      : reason ? 'recovery-not-yet-proven' : 'no-block-reported', reason, retryAt, ...counts,
      deliveredToSlack: null };
  };
  return {
    note: 'Transport evidence, not deal yield. Retry eligibility is not recovery. Candidate counts are not Slack deliveries. No extra runs or quota resets.',
    lanes: [
      lane('instagram-search', instagram, instagram.search, { attempted: instagram.search?.attemptedQueries ?? null, discovered: instagram.search?.discovered ?? null }),
      lane('instagram-profiles', instagram, instagram.profileDiscovery, { attempted: instagram.profileDiscovery?.accountsVisited ?? null }),
      lane('instagram-previews', instagram, instagram.previewFetch, { attempted: instagram.previewFetch?.attempted ?? null }),
      lane('tiktok-public-search', tiktok, tiktok.apiDiscovery, { attempted: tiktok.apiDiscovery?.attemptedRequests ?? null, rawItems: tiktok.apiDiscovery?.rawItems ?? null }),
      lane('tiktok-web-search', tiktok, tiktok.searchDiscovery, { attempted: tiktok.searchDiscovery?.attemptedQueries ?? null }),
    ],
  };
}
