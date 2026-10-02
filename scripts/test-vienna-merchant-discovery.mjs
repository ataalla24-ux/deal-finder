import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMerchantDirectory, discoveryAccounts, extractMerchantLinks, instagramHandle, merchantWebsite, selectDiscoveryAccounts } from '../scraper/vienna-merchant-discovery.js';
import { publicIPv4, robotsAllowsDiscovery } from './discover-vienna-merchants.mjs';
import { buildConfig, loadAccountCatalog } from '../scraper/meta-instagram-deals.js';

const now = new Date();
for (const value of ['http://127.0.0.1/', 'https://user:pass@cafe.at', 'https://thefork.at/', 'https://localhost/', 'https://[::1]/', 'https://cafe.at:8443/']) assert.equal(merchantWebsite(value), '', value);
assert.equal(merchantWebsite('www.cafe.at/'), 'https://www.cafe.at/');
for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.16.0.1', '100.64.0.1', '224.1.1.1', '0.0.0.0', '::1']) assert.equal(publicIPv4(ip), false);
assert.equal(publicIPv4('93.184.216.34'), true);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow: /'), false);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow:'), true);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow: /wp-admin/'), true);
assert.equal(robotsAllowsDiscovery('User-agent: *\nDisallow: /private/', 'https://example.com/private/menu'), false);
assert.equal(instagramHandle('https://instagram.com/p/test/'), '');
assert.equal(instagramHandle('https://instagram.com.evil.test/cafe'), '');
assert.equal(instagramHandle('@Cafe.Wien'), 'cafe.wien');
assert.throws(() => buildMerchantDirectory({ elements: [], remark: 'timeout' }), /Incomplete/);
const directory = buildMerchantDirectory({ elements: [
  { type: 'node', id: 1, tags: { name: 'Cafe', amenity: 'cafe', website: 'https://cafe.at/', 'contact:instagram': '@cafe.wien' } },
  { type: 'node', id: 2, tags: { name: 'Closed', amenity: 'cafe', disused: 'yes' } },
  { type: 'node', id: 3, tags: { name: 'Other', amenity: 'bank' } },
] }, now);
assert.equal(directory.merchants.length, 1);
assert.equal(directory.merchants[0].address, '', 'no invented address');
const links = extractMerchantLinks('<a href="https://instagram.com/cafe.wien/">IG</a><a href="https://instagram.com/cafe.wien/">again</a><a href="/angebote">Offers</a><a href="https://evil.test/angebote">bad</a>', 'https://cafe.at/');
assert.deepEqual(links, { handles: ['cafe.wien'], offerUrls: ['https://cafe.at/angebote'] });
const accounts = discoveryAccounts(directory, {}, now);
assert.equal(accounts.length, 1);
assert.equal(accounts[0].verifiedVienna, false);
const bulk = { generatedAt: now.toISOString(), accounts: Array.from({ length: 1000 }, (_, i) => ({ username: `cafe${i}`, verifiedVienna: true, priority: 999 })) };
const first = selectDiscoveryAccounts(bulk, now);
assert.equal(first.length, 200);
assert.ok(first.every(a => !a.verifiedVienna && a.priority === 25));
assert.notDeepEqual(first, selectDiscoveryAccounts(bulk, new Date(+now + 86400000)));
assert.equal(selectDiscoveryAccounts({ ...bulk, generatedAt: '2000-01-01' }, now).length, 0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-discovery-test-'));
try {
  const write = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(data)); return p; };
  const config = buildConfig({}, now);
  const catalog = loadAccountCatalog(config, {
    watchlistPath: write('watch.json', { accounts: [{ username: 'cafe.wien', category: 'discovery', priority: 100 }] }),
    registryPath: write('registry.json', { accounts: [{ username: 'blocked.cafe', blockedByModeration: true }] }),
    discoveryPath: write('discovery.json', { generatedAt: now.toISOString(), accounts: [...accounts, { username: 'blocked.cafe' }, { username: 'new.cafe' }] }),
    candidatePaths: [],
  });
  assert.equal(catalog.find(a => a.username === 'cafe.wien').priority, 100);
  assert.notEqual(catalog.find(a => a.username === 'cafe.wien').accountType, 'merchant');
  assert.ok(!catalog.some(a => a.username === 'blocked.cafe'));
  assert.equal(catalog.find(a => a.username === 'new.cafe').verifiedVienna, false);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('Vienna merchant discovery: safety, deduplication, rotation and catalog isolation passed');
