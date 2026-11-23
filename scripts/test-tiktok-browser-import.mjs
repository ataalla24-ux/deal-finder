import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importTikTokBrowserPosts, parseTikTokBrowserBatch } from './import-tiktok-browser-posts.mjs';
import { buildTikTokDeliveryAudit } from '../scraper/instagram-delivery-audit.js';
import { getNonOfferContentReason } from '../scraper/promotion-quality-utils.js';

const now = new Date('2026-11-23T12:00:00.000Z');
const seconds = Math.floor((+now - 60 * 60 * 1000) / 1000);
function post({ time = seconds, suffix = 1, caption = 'Zweiter Kaffee gratis bei Cafe Milano. Kaiserstraße 105, 1070 Wien. Gültig bis 30.11.2026.' } = {}) {
  const video = (BigInt(time) << 32n) | BigInt(suffix);
  return { url: `https://www.tiktok.com/@cafemilano/video/${video}`, caption, createTime: time };
}
const batch = posts => JSON.stringify({ version: 1, posts });

test('require the bounded input schema without disclosing its contents', () => {
  assert.deepEqual(parseTikTokBrowserBatch(batch([])), []);
  assert.throws(() => parseTikTokBrowserBatch(batch(Array(21).fill(post()))), /at most 20/);
  assert.throws(() => parseTikTokBrowserBatch('a'.repeat(55_001)), /55,000 bytes/);
  assert.throws(() => parseTikTokBrowserBatch('☕'.repeat(19_000)), /55,000 bytes/);
  assert.throws(() => parseTikTokBrowserBatch('not-json-secret'), error =>
    /valid JSON/.test(error.message) && !error.message.includes('not-json-secret'));
  assert.throws(() => parseTikTokBrowserBatch('{"version":1,"posts":[],"cookie":"extra"}'), /must contain/);
});

test('build local public posts with their declared source timestamp and ordinary delivery classification', () => {
  const input = post();
  input.createTime = String(seconds - 14408);
  const result = importTikTokBrowserPosts([input], { now });
  assert.equal(result.counts.accepted, 1);
  const candidate = result.added[0];
  assert.equal(candidate.url, input.url);
  assert.equal(candidate.brand, 'Cafe Milano');
  assert.equal(candidate.pubDate, new Date(Number(input.createTime) * 1000).toISOString());
  assert.equal(candidate.pubDateSource, 'tiktok-timestamp');
  assert.equal(candidate.originSource, 'tiktok-deals-scanner');
  assert.equal(candidate.source, 'TikTok');
  assert.equal(candidate.collectionMode, 'authenticated-browser');
  assert.equal(candidate.slackTs, undefined);
  assert.equal(candidate.approvedAt, undefined);
  const delivery = buildTikTokDeliveryAudit({ candidates: [candidate], stages: [], validation: { results: [] }, selected: [] });
  assert.equal(delivery.extractedCandidates, 1);
  assert.equal(delivery.rows[0].status, 'not-in-standard-lane');
});

test('fail closed on malformed public posts, invalid timestamps and generic scouts', () => {
  const good = post();
  const result = importTikTokBrowserPosts([
    { ...good, createTime: seconds + 0.5 },
    { ...good, createTime: { toString: 'not a function' } },
    { ...good, url: good.url.replace('www.tiktok.com', 'example.invalid') },
    { ...good, url: good.url + '?sessionid=fixture' },
    { ...good, url: good.url + '/other' },
    { ...good, cookie: 'fixture' },
    { ...good, caption: '\uD83D' },
    post({ time: seconds - 8 * 86400 }),
    post({ time: seconds + 7200 }),
    post({ caption: 'Kaffee gratis in Wien, 1070 Wien.' }),
  ], { now });
  assert.equal(result.added.length, 0);
  assert.equal(result.counts.invalid, 9);
  assert.equal(result.counts.rejected, 1);
});

test('hold an opening repost when the inferred merchant is the street address', () => {
  const caption = '🎉 VAMOS GRAND OPENING! 🎉 Es ist so weit! Am 27.11.2026 von 15:00 bis 19:00 Uhr feiern wir unsere große Eröffnung und ihr seid herzlich eingeladen! 🔥 🥙 HÜHNER-DÖNER GRATIS 🥩 STEAK-DÖNER GRATIS 🥤 BEY GAZOZ GRATIS ❤️ Gemeinsam Gutes tun! Wer möchte, kann freiwillig spenden. Der gesamte gesammelte Betrag geht an das St. Anna Kinderspital. Kommt vorbei, bringt eure Freunde und Familie mit und feiert mit uns einen unvergesslichen Eröffnungstag! 🎉 📍 Franz-Josefs-Kai 27, 1010 Wien Wir freuen uns auf euch! 🤍 #VAMOS #GrandOpening #Schwedenplatz #Wien #Döner';
  const input = { url: 'https://www.tiktok.com/@vamoskebap/video/7710635479883992342', caption, createTime: 1795272227 };
  const knownDeals = ['1781195302937297', '1841363440215913'].map(id => ({
    id: `meta-ad-${id}`,
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    title: '🥙 HÜHNER-DÖNER GRATIS 🥩 STEAK-DÖNER GRATIS 🥤 BEY GAZOZ GRATIS ❤️ Gemeinsam Gutes tun!',
    brand: 'Vamos Kebap Schwedenplatz',
    description: `${caption} GemeinsamGutesTun instagram.com`,
    expires: '2026-11-27',
  }));
  for (const existing of [[], knownDeals]) {
    const result = importTikTokBrowserPosts([input], { now, knownDeals: existing });
    assert.equal(result.counts.rejected, 1);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.deals, []);
  }
});

test('hold address-only merchant guesses while retaining named merchants with a number', () => {
  const result = importTikTokBrowserPosts([
    post({ suffix: 2, caption: 'Zweiter Kaffee gratis bei Kaiserstraße 105, 1070 Wien. Gültig bis 30.11.2026.' }),
    post({ suffix: 3, caption: 'Zweiter Kaffee gratis bei Studio 27. Kaiserstraße 105, 1070 Wien. Gültig bis 30.11.2026.' }),
  ], { now });
  assert.equal(result.counts.rejected, 1);
  assert.deepEqual(result.added.map(deal => deal.brand), ['Studio 27']);
});

test('retain an explicit zero entry price in the title of a named venue', () => {
  const capture = post({ caption: 'Ein 360°-Freiluftmuseum, das keinen Cent kostet. Das ist immersive Lichtkunst vom Museum of Change. Museum of Change, Postgasse 10, 1010 Wien. Täglich 18–22 Uhr. Eintritt: 0€.' });
  capture.url = capture.url.replace('@cafemilano', '@goodnight.at_wien');
  const result = importTikTokBrowserPosts([capture], { now });
  assert.equal(result.counts.accepted, 1);
  assert.equal(result.added[0].title, 'Gratis Eintritt: Museum of Change');
  assert.equal(result.added[0].type, 'gratis');
});

test('hold tourist recommendations that only describe free access to a Christmas market', () => {
  const capture = post({ caption: 'Mercatino di Natale di Vienna al Rathausplatz. Ingresso gratis: si paga solo quello che compri ai banchi. 🎥 Foto e clip: Jakob Mueller. #vienna' });
  capture.url = capture.url.replace('@cafemilano', '@navigoviaggi');
  assert.match(getNonOfferContentReason(capture.caption), /Christkindlmarkt/);
  assert.equal(getNonOfferContentReason(`${capture.caption} Un buono per un caffè.`), '');
  const result = importTikTokBrowserPosts([capture], { now });
  assert.equal(result.counts.rejected, 1);
  assert.deepEqual(result.added, []);
});

test('use canonical receipts, read-only current offers, and the existing outbox to suppress duplicates', () => {
  const input = post();
  const videoId = input.url.split('/').at(-1);
  const base = importTikTokBrowserPosts([input], { now }).added[0];
  const prior = [base];
  const current = [{ ...base, id: 'official-coffee-offer', url: 'https://cafemilano.example/aktionen/kaffee' }];
  assert.equal(importTikTokBrowserPosts([input], { now, seenPostKeys: [`tiktok:video:${videoId}`] }).counts.duplicate, 1);
  assert.equal(importTikTokBrowserPosts([input], { now, previous: prior }).counts.duplicate, 1);
  assert.equal(importTikTokBrowserPosts([input], { now, knownDeals: current }).counts.duplicate, 1);
  const another = post({ suffix: 2 });
  const sameBatch = importTikTokBrowserPosts([input, another], { now });
  assert.equal(sameBatch.counts.accepted, 1);
  assert.equal(sameBatch.counts.duplicate, 1);
  assert.equal(prior.length, 1);
  assert.equal(current[0].id, 'official-coffee-offer');
});

test('workflow input is read from its event file and only fresh candidates trigger a traced outbox write', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-browser-import-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture, 'docs'));
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.symlinkSync(new URL('../scraper/', import.meta.url), path.join(fixture, 'scraper'), 'dir');
  fs.copyFileSync(new URL('./import-tiktok-browser-posts.mjs', import.meta.url), path.join(fixture, 'scripts/import.mjs'));
  const event = path.join(fixture, 'event.json');
  const output = path.join(fixture, 'outputs');
  const outbox = path.join(fixture, 'docs/deals-pending-tiktok-browser.json');
  const env = {
    ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output, SENTRY_DISABLED: '1',
  };
  const run = posts => {
    fs.writeFileSync(event, JSON.stringify({ inputs: { browsed_posts: batch(posts) } }));
    const guard = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("No external requests")};';
    return spawnSync(process.execPath, ['--import', guard, 'scripts/import.mjs'], { cwd: fixture, env, encoding: 'utf8' });
  };
  assert.equal(run([]).status, 0);
  assert.equal(fs.existsSync(outbox), false);
  assert.equal(fs.existsSync(output), false);

  for (const [name, value] of Object.entries({
    'deals.json': { deals: [] }, 'deals-pending-all.json': { deals: [] },
    'deals-pending-tiktok.json': { deals: [] }, 'deal-candidates-index.json': { candidates: [] },
    'slack-seen-posts.json': { seenPostKeys: [] }, 'deal-moderation.json': {},
  })) fs.writeFileSync(path.join(fixture, 'docs', name), JSON.stringify(value));
  const recent = post({ time: Math.floor(Date.now() / 1000) - 3600,
    caption: 'Zweiter Kaffee gratis bei Cafe Milano. Kaiserstraße 105, 1070 Wien. Solange der Vorrat reicht.' });
  const first = run([recent]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).accepted, 1);
  assert(!first.stdout.includes(recent.url));
  assert(!first.stdout.includes(recent.caption));
  assert.equal(fs.readFileSync(output, 'utf8'), 'changed=true\n');
  const previous = fs.readFileSync(outbox, 'utf8');
  assert.equal(JSON.parse(previous).deals.length, 1);
  const duplicate = run([recent]);
  assert.equal(duplicate.status, 0, duplicate.stderr);
  assert.equal(JSON.parse(duplicate.stdout).duplicate, 1);
  assert.equal(fs.readFileSync(outbox, 'utf8'), previous);
  assert.equal(fs.readFileSync(output, 'utf8'), 'changed=true\n');
});
