const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Persisted rolling windows survive hourly workflow restarts and midnight.
export function assessInstagramMediaBudget(usage, config, now = new Date()) {
  const at = +now;
  const maxPer24Hours = Math.max(0, Math.floor(Number(config.mediaLlmMaxCallsPerDay ?? 48)));
  const maxPerRun = Math.max(0, Math.floor(Number(config.mediaLlmMaxCallsPerRun ?? 8)));
  const pacingHours = Math.min(24, Math.max(1, Number(config.mediaLlmPacingHours ?? 2)));
  const windowMs = pacingHours * HOUR_MS;
  const maxPerPacingWindow = Math.ceil(maxPer24Hours * pacingHours / 24);
  const retainedUsage = (Array.isArray(usage) ? usage : []).filter((row) => {
    const timestamp = Date.parse(row?.at);
    // Future timestamps remain charged rather than granting capacity on clock rollback.
    return Number.isFinite(timestamp) && timestamp > at - DAY_MS
      && Number.isInteger(row?.calls) && row.calls > 0;
  }).map(({ at, calls }) => ({ at, calls })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const windowUsage = retainedUsage.filter((row) => Date.parse(row.at) > at - windowMs);
  const total = (rows) => rows.reduce((sum, row) => sum + row.calls, 0);
  const usedBeforeRun = total(retainedUsage);
  const usedInPacingWindow = total(windowUsage);
  const dailyRemaining = Math.max(0, maxPer24Hours - usedBeforeRun);
  const pacingRemaining = Math.max(0, maxPerPacingWindow - usedInPacingWindow);
  const allowedThisRun = Math.min(maxPerRun, dailyRemaining, pacingRemaining);
  const nextCapacity = (rows, limit, duration) => {
    let count = total(rows);
    if (count < limit) return at;
    for (const row of rows) {
      count -= row.calls;
      if (count < limit) return Date.parse(row.at) + duration;
    }
    return at;
  };
  const disabled = maxPer24Hours === 0 || maxPerRun === 0;
  const nextAvailableAt = !disabled && allowedThisRun === 0
    ? new Date(Math.max(nextCapacity(retainedUsage, maxPer24Hours, DAY_MS),
      nextCapacity(windowUsage, maxPerPacingWindow, windowMs))).toISOString()
    : null;
  return {
    retainedUsage,
    report: {
      maxPer24Hours, usedBeforeRun, allowedThisRun,
      pacingHours, maxPerPacingWindow, usedInPacingWindow,
      dailyRemaining, pacingRemaining, nextAvailableAt,
      limitReason: disabled ? 'disabled' : dailyRemaining === 0 ? 'daily-limit'
        : pacingRemaining === 0 ? 'pacing-window' : null,
    },
  };
}
