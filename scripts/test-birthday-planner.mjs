import assert from 'node:assert/strict';
import { birthdayWindows } from '../docs/blog/birthday-planner.js';

const byName = (value, name) => birthdayWindows(value).find(row => row.name === name);
for (const value of ['', '2026-2-03', '2026-02-29', '2026-04-31', 'bad', '2026-10-28T12:00:00Z', '9999-12-31', '0000-01-01', '1899-12-31', '2100-01-01']) assert.equal(birthdayWindows(value), null);
assert.deepEqual(byName('2026-10-27', 'Watertuin'), { name: 'Watertuin', start: '2026-10-28', end: '2026-10-29' });
assert.deepEqual(byName('2026-10-28', 'Watertuin'), { name: 'Watertuin', start: '2026-10-28', end: '2026-10-28' });
assert.deepEqual(byName('2027-01-01', 'Donauturm'), { name: 'Donauturm', start: '2026-12-30', end: '2027-01-03' });
assert.deepEqual(byName('2026-03-29', 'Balls&Clubs'), { name: 'Balls&Clubs', start: '2026-03-22', end: '2026-04-05' });
assert.deepEqual(byName('2026-10-25', 'Cineplexx Kindergeburtstag'), { name: 'Cineplexx Kindergeburtstag', start: '2026-10-11', end: '2026-11-08' });
for (const name of ['Madame Tussauds', '3D PicArt Museum']) {
  assert.deepEqual(byName('2028-02-29', name), { name, start: '2028-02-29', end: '2028-02-29' });
}
assert.equal(birthdayWindows('2026-10-28').length, 6);
for (const edge of ['1900-01-01', '2099-12-31']) for (const row of birthdayWindows(edge)) {
  assert.match(row.start, /^\d{4}-\d{2}-\d{2}$/); assert.match(row.end, /^\d{4}-\d{2}-\d{2}$/);
}
assert.ok(!birthdayWindows('2026-10-28').some(row => /NoWayOut|Starbucks|XXXLutz/.test(row.name)));
console.log('Birthday planner: invalid dates, leap day, year boundary, Vienna DST boundaries, Tuesday exception and exclusions PASS');
