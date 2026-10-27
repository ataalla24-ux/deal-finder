const DAY = 86400000;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function featuredSelectionHistory(previous = {}, next = {}, today) {
  if (!validDay(today)) throw new Error('Invalid featured history date');
  // Keep seven complete calendar days: an early-morning selection precedes the 09:00 push.
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
  const rows = [...(Array.isArray(previous?.selectionHistory) ? previous.selectionHistory : []), previous, next];
  const unique = new Map();
  for (const row of rows) {
    if (!validDay(row?.date) || row.date < oldest || row.date > today
      || typeof row.dealId !== 'string' || !/^[\w:.-]{1,200}$/.test(row.dealId)) continue;
    unique.set(`${row.date}:${row.dealId}`, { date: row.date, dealId: row.dealId });
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.dealId.localeCompare(b.dealId)).slice(-128);
}

export function recentFeaturedDealIds(previous, today) {
  return new Set(featuredSelectionHistory(previous, {}, today).map(row => row.dealId));
}
