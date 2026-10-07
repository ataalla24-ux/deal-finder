import { load } from 'cheerio';

// OSM relation 109166 is Vienna, verified through ISO3166-2=AT-9.
export const VIENNA_FOOD_QUERY = '[out:json][timeout:90];(nwr[amenity~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|food_court)$"](area:3600109166);nwr[shop~"^(bakery|confectionery|deli)$"](area:3600109166););out tags;';
const excludedHosts = /(^|\.)(instagram\.com|facebook\.com|thefork\.[a-z.]+|neotaste\.[a-z.]+|lieferando\.at|wolt\.com|google\.[a-z.]+|tripadvisor\.[a-z.]+)$/i;

export function merchantWebsite(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || excludedHosts.test(url.hostname)) return '';
    if (!url.hostname.includes('.') || /[\[\]:]/.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return '';
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function instagramHandle(value) {
  let text = String(value || '').trim();
  if (/instagram\.com/i.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase())) return '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';
      text = parts[0];
    } catch { return ''; }
  }
  text = text.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(text) && !/^(thefork|neotaste)([._]|$)/.test(text) && !['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'instagram'].includes(text) ? text : '';
}

export function buildMerchantDirectory(payload, now = new Date()) {
  if (payload.remark || !Array.isArray(payload.elements) || !payload.elements.length) throw new Error('Incomplete or empty Overpass response; preserve previous directory');
  const records = new Map();
  for (const element of payload.elements) {
    const t = element.tags || {};
    if (!t.name || t.disused === 'yes' || t.abandoned === 'yes' || t.closed === 'yes') continue;
    if (!/^(restaurant|cafe|fast_food|bar|pub|ice_cream|food_court)$/.test(t.amenity || '') && !/^(bakery|confectionery|deli)$/.test(t.shop || '')) continue;
    const id = `${element.type}/${element.id}`;
    records.set(id, {
      id, name: t.name, kind: t.amenity || t.shop, cuisine: t.cuisine || '',
      address: [t['addr:street'], t['addr:housenumber'], t['addr:postcode'], t['addr:city']].filter(Boolean).join(' '),
      postcode: t['addr:postcode'] || '',
      website: merchantWebsite(t['contact:website'] || t.website || ''),
      instagram: instagramHandle(t['contact:instagram'] || t.instagram),
      sourceUrl: `https://www.openstreetmap.org/${id}`,
      observedAt: now.toISOString(),
    });
  }
  if (!records.size) throw new Error('No usable merchants; preserve previous directory');
  return { generatedAt: now.toISOString(), attribution: '© OpenStreetMap contributors, ODbL 1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', merchants: [...records.values()].sort((a,b) => a.id.localeCompare(b.id)) };
}

export function extractMerchantLinks(html, pageUrl) {
  const $ = load(html);
  const handles = new Set();
  const offers = new Set();
  $('a[href]').each((i, element) => {
    try {
      const url = new URL($(element).attr('href'), pageUrl);
      const handle = ['www.instagram.com', 'instagram.com'].includes(url.hostname) ? instagramHandle(url.href) : '';
      if (handle) handles.add(handle);
      if (url.origin === new URL(pageUrl).origin && /aktion|angebot|happy.hour|coupon|special/i.test(url.pathname) && merchantWebsite(url.href)) offers.add(url.href);
    } catch {}
  });
  return { handles: [...handles], offerUrls: [...offers].slice(0, 10) };
}

export function discoveryAccounts(directory, websiteState, now = new Date()) {
  const accounts = new Map();
  const cutoff = now.getTime() - 45 * 86400000;
  for (const merchant of directory.merchants || []) {
    if (!(Date.parse(merchant.observedAt) >= cutoff)) continue;
    const site = websiteState[merchant.website];
    const checked = site?.status === 'ok' && Date.parse(site.checkedAt) >= cutoff;
    for (const username of new Set([merchant.instagram, ...(checked ? site.handles || [] : [])].filter(Boolean))) {
      const prior = accounts.get(username);
      const evidence = { merchant: merchant.name, sourceUrl: merchant.sourceUrl, website: merchant.website, observedAt: merchant.observedAt,
        postcode: merchant.postcode, address: merchant.address, cuisine: merchant.cuisine, kind: merchant.kind };
      if (prior) { if (prior.merchants.length < 10) prior.merchants.push(evidence); continue; }
      accounts.set(username, { username, category: 'food', accountType: 'merchant', priority: 25,
        verifiedVienna: false, evidenceKind: checked && site.handles?.includes(username) ? 'directory-and-website-link' : 'directory-tag',
        merchants: [evidence], observedAt: merchant.observedAt });
    }
  }
  return [...accounts.values()].sort((a,b) => a.username.localeCompare(b.username));
}

// A bounded rotating pool supplements established accounts, never overwrites them.
export function selectDiscoveryAccounts(payload, now = new Date(), limit = 200) {
  if (!(Date.parse(payload.generatedAt) >= now.getTime() - 45 * 86400000)) return [];
  const all = (Array.isArray(payload.accounts) ? payload.accounts : []).filter(a => a && instagramHandle(a.username) === a.username);
  if (!all.length) return [];
  const count = Math.max(0, Math.min(5000, limit, all.length));
  const offset = (Math.floor(now.getTime() / 86400000) * 200) % all.length;
  return Array.from({ length: count }, (_, i) => ({
    username: all[(offset + i) % all.length].username,
    category: 'food', accountType: 'merchant', priority: 25,
    evidenceKind: all[(offset + i) % all.length].evidenceKind,
    merchants: all[(offset + i) % all.length].merchants || [],
  }));
}
