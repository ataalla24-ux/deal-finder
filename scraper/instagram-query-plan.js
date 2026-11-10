export function planInstagramQueries({ general = [], accounts = [], configured = [], limit = 54, bucket = 0 } = {}) {
  const rotate = values => {
    if (!values.length) return [];
    const start = Math.max(0, Math.floor(Number(bucket) || 0)) % values.length;
    return [...values.slice(start), ...values.slice(0, start)];
  };
  // Instagram permalinks are /p/ or /reel/, not /<username>/<post>.
  const merchant = accounts.flatMap(account => {
    const name = String(account.username || '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(name)) return [];
    return [
      `site:instagram.com "${name}" wien angebot`,
      `site:instagram.com "${name}" gratis OR aktion OR "1+1"`,
    ];
  });
  const lanes = [rotate(general), rotate(merchant), rotate(configured)];
  const result = [], seen = new Set();
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  while (result.length < cap && lanes.some(lane => lane.length)) {
    for (const lane of lanes) {
      const query = String(lane.shift() || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (query && !seen.has(query)) { result.push(query); seen.add(query); }
      if (result.length >= cap) break;
    }
  }
  return result;
}
