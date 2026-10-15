import assert from 'node:assert/strict';
import { assessInstagramMediaBudget } from '../scraper/instagram-media-budget.js';

const HOUR = 3600000;
const now = new Date('2026-10-16T00:30:00Z');
const config = { mediaLlmMaxCallsPerDay: 48, mediaLlmMaxCallsPerRun: 12, mediaLlmPacingHours: 2 };
const row = (hoursAgo, calls) => ({ at: new Date(+now - hoursAgo * HOUR).toISOString(), calls });
const check = (usage, overrides = {}) => assessInstagramMediaBudget(usage, { ...config, ...overrides }, now);
assert.equal(check([]).report.allowedThisRun, 4);
assert.equal(check([], { mediaLlmMaxCallsPerDay: 96 }).report.allowedThisRun, 8);
assert.equal(check([], { mediaLlmMaxCallsPerDay: 144 }).report.allowedThisRun, 12);
assert.equal(check([], { mediaLlmMaxCallsPerRun: 2 }).report.allowedThisRun, 2, 'bounded live validation keeps its smaller ceiling');
assert.equal(check([], { mediaLlmMaxCallsPerDay: 0 }).report.limitReason, 'disabled');
assert.equal(check([], { mediaLlmMaxCallsPerRun: 0 }).report.nextAvailableAt, null);
assert.equal(check([row(0.5, 4)]).report.allowedThisRun, 0, 'midnight cannot reset the pacing window');
assert.equal(check([row(0.5, 4)]).report.limitReason, 'pacing-window');
assert.equal(check([row(0.5, 4)]).report.nextAvailableAt, new Date(+now + 1.5 * HOUR).toISOString());
assert.equal(check([row(2, 4)]).report.allowedThisRun, 4, 'exactly expired windows release capacity');
assert.equal(check([row(3, 47)]).report.allowedThisRun, 1);
assert.equal(check([row(3, 48)]).report.limitReason, 'daily-limit');
assert.equal(check([row(3, 48)]).report.nextAvailableAt, new Date(+now + 21 * HOUR).toISOString());
assert.equal(check([row(3, 44), row(0.5, 4)]).report.nextAvailableAt, new Date(+now + 21 * HOUR).toISOString());
assert.equal(check([row(24, 48), null, {}, row(1, -2), row(1, 1.5)]).report.allowedThisRun, 4);
assert.equal(check([row(-1, 4)]).report.allowedThisRun, 0, 'clock rollback never creates free calls');
assert.equal(check([row(1.5, 3), row(1, 4)]).report.nextAvailableAt, new Date(+now + HOUR).toISOString(), 'release enough calls, not just the first row');

for (const daily of [48, 96, 144]) {
  let usage = [];
  let total = 0;
  for (let hour = 0; hour < 72; hour += 1) {
    const at = new Date(+now + hour * HOUR);
    const budget = assessInstagramMediaBudget(JSON.parse(JSON.stringify(usage)), { ...config, mediaLlmMaxCallsPerDay: daily }, at);
    const calls = budget.report.allowedThisRun;
    usage = [...budget.retainedUsage, ...(calls ? [{ at: at.toISOString(), calls }] : [])];
    total += calls;
    assert(usage.reduce((sum, row) => sum + row.calls, 0) <= daily, 'restarted collectors respect the rolling daily ceiling');
    assert(usage.filter((row) => Date.parse(row.at) > +at - 2 * HOUR).reduce((sum, row) => sum + row.calls, 0) <= Math.ceil(daily / 12));
  }
  assert.equal(total, daily * 3, 'pacing can use the full approved budget across three days');
}
console.log('Instagram AI budget: rolling daily ceiling, two-hour pacing, restart/midnight/boundary/clock-skew and 72-hour capacity tests passed');
