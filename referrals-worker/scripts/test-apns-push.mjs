import process from 'node:process';

const workerBase = String(process.env.PUSH_API_BASE || process.env.REFERRAL_API_BASE || '').trim();
const adminToken = String(process.env.ADMIN_API_TOKEN || '').trim();
const token = String(process.env.APNS_DEVICE_TOKEN || '').trim();

if (!workerBase) {
  console.error('Missing PUSH_API_BASE or REFERRAL_API_BASE');
  process.exit(1);
}

if (!adminToken) {
  console.error('Missing ADMIN_API_TOKEN');
  process.exit(1);
}

if (!token) {
  console.error('Missing APNS_DEVICE_TOKEN');
  process.exit(1);
}

const payload = {
  token,
  title: process.env.PUSH_TITLE || 'FreeFinder Test',
  body: process.env.PUSH_BODY || 'Push-Test erfolgreich',
  dealId: process.env.PUSH_DEAL_ID || 'test-deal',
  url: process.env.PUSH_URL || 'https://ataalla24-ux.github.io/deal-finder/?deal=test-deal',
};

const response = await fetch(`${workerBase.replace(/\/$/, '')}/api/push/apns/send`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${adminToken}`,
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
console.log(text);

if (!response.ok) process.exit(1);
