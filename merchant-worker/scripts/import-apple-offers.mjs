import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { privateInput } from './referral-support.mjs';

const host = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev';
const prefix = 'com.stefanataalla.freefinderwien.premium.';
const definitions = {
  'referral-active-monthly-2026': ['monthly', 'existing', '3f5a4d1e-eb81-40e1-9acf-b8efde5ebdcc', '6810249175'],
  'referral-active-yearly-2026': ['yearly', 'existing', '268707cb-8a4b-4fd5-9968-8429d18c9faf', '6810354972'],
  'referral-earned-month-2026': ['monthly', 'new_or_expired', '3d07649b-ad1e-4eb9-842c-c52518f098d7', '6810249175'],
};

export function readPrivateCodes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 1024 * 1024) {
      throw Error('Code file must be an owner-private regular file, at most 1MiB.');
    }
    const bytes = readFileSync(fd);
    if (bytes.length > 1024 * 1024) throw Error('Code file exceeds limit.');
    return bytes;
  } finally { closeSync(fd); }
}

export function prepareOffers(bytes, manifest, now = Date.now()) {
  const definition = definitions[manifest?.offerId];
  const fields = ['environment', 'batchId', 'count', 'sha256', 'offerId', 'expiresAt', 'sourceURL',
    'freeMonths', 'autoRenew', 'combineIntroductoryOffer', 'countries'];
  if (!definition || Object.keys(manifest).some(key => !fields.includes(key)) ||
      manifest.environment !== 'Production' || !/^\d{1,20}$/.test(manifest.batchId || '') ||
      !Number.isSafeInteger(manifest.count) || manifest.count < 1 || manifest.count > 10000 ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256 || '') ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.sha256 ||
      manifest.freeMonths !== 1 || manifest.autoRenew !== true || manifest.combineIntroductoryOffer !== false ||
      JSON.stringify(manifest.countries) !== '["AT","DE"]') throw Error('Production manifest or file fingerprint does not match.');
  const [period, customerType, offerUUID, productNumber] = definition;
  const sourceURL = `https://appstoreconnect.apple.com/apps/6758958213/distribution/subscriptions/${productNumber}/pricing/offer-codes/${offerUUID}`;
  const expiresAt = Date.parse(manifest.expiresAt);
  if (manifest.sourceURL !== sourceURL || !Number.isFinite(expiresAt) || expiresAt <= now + 2 * 86400000 ||
      expiresAt > now + 183 * 86400000 || new Date(expiresAt).toISOString() !== manifest.expiresAt) {
    throw Error('Offer source or expiry is invalid.');
  }
  // Apple currently exports a headerless, unquoted CODE,URL format. Reject other CSV dialects, do not guess.
  const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const seen = new Set();
  const offers = lines.map(line => {
    const match = /^([A-Z0-9]{6,64}),([^\s,"\r\n]+)$/.exec(line);
    if (!match || seen.has(match[1])) throw Error('Code file has invalid or duplicate rows.');
    const code = match[1];
    let url;
    try { url = new URL(match[2]); } catch { throw Error('Code file has an invalid redemption URL.'); }
    if (url.origin !== 'https://apps.apple.com' || url.pathname !== '/redeem' || url.username || url.password || url.hash ||
        [...url.searchParams].length !== 3 || url.searchParams.get('ctx') !== 'offercodes' ||
        url.searchParams.get('id') !== '6758958213' || url.searchParams.get('code') !== code) {
      throw Error('Code file does not match FreeFinder redemption.');
    }
    seen.add(code);
    return { productId: prefix + period, offerId: manifest.offerId, code, environment: 'Production',
      freeMonths: 1, customerType, expiresAt, autoRenew: true, combineIntroductoryOffer: false };
  });
  if (offers.length !== manifest.count) throw Error('Code count differs from the inspected Store batch.');
  return offers;
}

export async function importOffers(offers, secret, transport = fetch) {
  if (!Array.isArray(offers) || !offers.length || offers.length > 10000 || !secret?.trim() || /[\r\n]/.test(secret)) {
    throw Error('Missing offers or existing referral administrator credential.');
  }
  const batches = []; let batch = [];
  for (const offer of offers) {
    const candidate = [...batch, offer];
    if (candidate.length > 100 || Buffer.byteLength(JSON.stringify({ offers: candidate })) > 16000) {
      if (!batch.length) throw Error('One inventory row exceeds the endpoint limit.');
      batches.push(batch); batch = [];
    }
    batch.push(offer);
    if (Buffer.byteLength(JSON.stringify({ offers: batch })) > 16000) throw Error('One inventory row exceeds the endpoint limit.');
  }
  if (batch.length) batches.push(batch);
  let confirmed = 0;
  for (const rows of batches) {
    try {
      const response = await transport(`${host}/api/referral-months/import-apple-offers`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
        headers: { 'content-type': 'application/json', 'x-freefinder-merchant-secret': secret },
        body: JSON.stringify({ offers: rows }),
      });
      if (!response.ok) throw Error();
      const reader = response.body?.getReader();
      if (!reader) throw Error();
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1024) { await reader.cancel(); throw Error(); }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result?.ok !== true) throw Error();
      confirmed += rows.length;
    } catch {
      throw Error(`Import stopped after ${confirmed} confirmed rows; next batch outcome may be unknown. No automatic retry. Reimport only the identical file and manifest.`);
    }
  }
  return { ok: true, confirmed };
}

async function main() {
  const [mode, manifestPath, codePath] = process.argv.slice(2);
  if (process.argv.length !== 5 || !['--check', '--import'].includes(mode)) {
    throw Error('Usage: node scripts/import-apple-offers.mjs --check|--import PRIVATE_MANIFEST.json PRIVATE_CODES.csv');
  }
  const manifest = privateInput(manifestPath);
  const offers = prepareOffers(readPrivateCodes(codePath), manifest);
  if (mode === '--check') {
    console.log(JSON.stringify({ valid: true, batchId: manifest.batchId, count: offers.length, offerId: manifest.offerId,
      note: 'Local validation only. Production batch classification must be checked in App Store Connect.' }));
    return;
  }
  let secret;
  try { secret = execFileSync('security', ['find-generic-password', '-s', 'freefinder-referral-admin', '-a', 'freefinder', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw Error('Existing referral administrator credential unavailable.'); }
  const result = await importOffers(offers, secret);
  secret = undefined;
  console.log(JSON.stringify({ ...result, batchId: manifest.batchId, offerId: manifest.offerId,
    note: 'Inventory only; no customer reservation, subscription or activation change.' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Apple inventory operation failed. No codes or credentials logged. For an uncertain import, reuse only the identical input.'); process.exitCode = 1; });
}
