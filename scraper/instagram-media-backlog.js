const DAY_MS = 86400000;

function mediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password
      || !/(^|\.)(fbcdn\.net|cdninstagram\.com|instagram\.com)$/.test(url.hostname)
      || [...url.searchParams.keys()].some((key) => /access.?token|appsecret|authorization/i.test(key))) return '';
    return url.href;
  } catch { return ''; }
}

function storedItem(item, child = false) {
  const result = {};
  for (const key of ['id', 'username', 'caption', 'timestamp', 'media_type']) {
    if (typeof item?.[key] === 'string') result[key] = item[key];
  }
  for (const key of ['permalink', 'media_url', 'thumbnail_url']) {
    const url = mediaUrl(item?.[key]);
    if (url) result[key] = url;
  }
  if (!child && Array.isArray(item?.children?.data)) {
    result.children = { data: item.children.data.map((entry) => storedItem(entry, true)) };
  }
  return result;
}

function storedContext(context) {
  const result = {};
  for (const key of ['sourceType', 'sourceName']) {
    if (typeof context?.[key] === 'string') result[key] = context[key];
  }
  if (context?.account) {
    result.account = {};
    for (const key of ['username', 'name', 'displayName', 'category', 'accountType', 'verifiedVienna', 'foodFocused']) {
      const value = context.account[key];
      if (typeof value === 'string' || typeof value === 'boolean') result.account[key] = value;
    }
  }
  return result;
}

export function mergeMediaBacklog(entries, previous, now, maxAgeDays = 7) {
  const merged = [...entries];
  const live = new Map(entries.map((entry) => [String(entry.item?.id || ''), entry]));
  let resumed = 0, expired = 0;
  for (const entry of Array.isArray(previous) ? previous : []) {
    const published = Date.parse(entry?.item?.timestamp || '');
    if (!entry?.item?.id || !Number.isFinite(published) || published > +now
      || +now - published > maxAgeDays * DAY_MS) { expired += 1; continue; }
    const current = live.get(String(entry.item.id));
    if (current) {
      for (const match of entries.filter((row) => String(row.item?.id) === String(entry.item.id))) {
        match.mediaQueuedAt = entry.mediaQueuedAt;
        match.mediaLastAttemptAt = entry.mediaLastAttemptAt;
      }
    } else {
      const restored = { item: storedItem(entry.item), context: storedContext(entry.context),
        mediaQueuedAt: entry.mediaQueuedAt, mediaLastAttemptAt: entry.mediaLastAttemptAt };
      live.set(String(entry.item.id), restored);
      merged.push(restored);
      resumed += 1;
    }
  }
  return { entries: merged, resumed, expired };
}

export function saveMediaBacklog(entries, cache, now, config, shouldAnalyzeEntry) {
  const pending = entries.filter((entry) => {
    const item = entry?.item;
    const published = Date.parse(item?.timestamp || '');
    if (!item?.id || !Number.isFinite(published) || published > +now
      || +now - published > config.maxOrganicAgeWithExpiryDays * DAY_MS
      || shouldAnalyzeEntry?.(entry) === false) return false;
    const evidence = item._mediaEvidence || cache[item.id];
    return !evidence || evidence.aiPending || evidence.aiError || evidence.retryableFailure
      || evidence.warnings?.some((warning) => /tesseract timeout/i.test(warning));
  }).map((entry) => ({
    item: storedItem(entry.item), context: storedContext(entry.context),
    mediaQueuedAt: entry.mediaQueuedAt || now.toISOString(),
    mediaLastAttemptAt: entry.mediaLastAttemptAt || '',
  })).filter((entry) => entry.item.media_url || entry.item.thumbnail_url || entry.item.children?.data?.length);
  const byId = new Map();
  for (const entry of pending) {
    const previous = byId.get(entry.item.id);
    if (!previous || (!previous.context.account?.verifiedVienna && entry.context.account?.verifiedVienna)) {
      byId.set(entry.item.id, entry);
    }
  }
  return [...byId.values()];
}
