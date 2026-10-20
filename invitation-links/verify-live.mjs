import assert from 'node:assert/strict';

const base = 'https://www.freefinder.at';
const code = 'RM-0123456789ABCDEF01234567';
const token = 'ASNFZ4mrze8BI0Vn';
const results = [];
const get = async url => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });

const health = await get(base + '/_link-health');
assert.equal(health.status, 200);
assert.equal(await health.text(), 'FreeFinder invitation links v1');
results.push({ path: '/_link-health', status: health.status });

for (const path of ['/', '/privacy.html', '/support.html', '/invite.html?invite=' + code]) {
  const response = await get(base + path);
  assert.equal(response.status, 301, path);
  assert.equal(response.headers.get('location'), 'https://freefinder.at' + path);
  results.push({ path, status: response.status, location: response.headers.get('location') });
}

for (const suffix of ['', '?deal=pizza-1']) {
  const path = '/i/' + token + suffix;
  const response = await get(base + path);
  const target = 'https://freefinder.at/invite.html?invite=' + code + (suffix ? '&deal=pizza-1' : '');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), target);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  // Read the static landing page only; never accept an invitation or create a reward.
  const landing = await get(target);
  assert.equal(landing.status, 200);
  const html = await landing.text();
  assert.match(html, /property="og:image"/);
  assert.match(html, /invitation-20261020\.jpg/);
  results.push({ path, status: response.status, location: target, landing: landing.status, imageMetadata: true });
}

for (const path of ['/i/not-a-valid-code', '/i/' + token + '?next=https://example.com']) {
  const response = await get(base + path);
  assert.equal(response.status, 404);
  results.push({ path, status: response.status });
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  tlsVerified: true,
  results,
  handsetHandoffTested: false,
  whatsAppPreviewTested: false,
  purchasesOrAcceptances: 0,
}, null, 2));
