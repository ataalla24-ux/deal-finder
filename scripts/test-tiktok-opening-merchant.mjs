import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDealFromPost } from '../scraper/tiktok-deals-scanner.js';
import { importTikTokBrowserPosts } from './import-tiktok-browser-posts.mjs';

const now = new Date('2026-11-23T12:00:00Z');
const createTime = 1795272227;
const video = '7710635479883992342';
const caption = '🎉 VAMOS GRAND OPENING! Am 27.11.2026 von 15:00 bis 19:00 Uhr feiern wir unsere große Eröffnung! 🥙 HÜHNER-DÖNER GRATIS 🥩 STEAK-DÖNER GRATIS 🥤 BEY GAZOZ GRATIS ❤️ Wer möchte, kann freiwillig spenden. 📍 Franz-Josefs-Kai 27, 1010 Wien.';
const post = (owner, text = caption) => ({ url: 'https://www.tiktok.com/@' + owner + '/video/' + video, caption: text, createTime });

test('the real opening owner and headline identify VAMOS, leaving its address in the copy', () => {
  const result = importTikTokBrowserPosts([post('vamoskebap1')], { now });
  assert.equal(result.counts.accepted, 1);
  const [deal] = result.added;
  assert.equal(deal.brand, 'VAMOS');
  assert.equal(deal.merchantName, deal.brand);
  assert.equal(deal.title, 'Hühner-Döner, Steak-Döner und Bey Gazoz gratis bei VAMOS');
  assert.match(deal.description, /freiwillig spenden/);
  assert.match(deal.description, /Franz-Josefs-Kai 27/);
  assert.equal(importTikTokBrowserPosts([post('vamoskebap1')], { now, previous: [deal] }).counts.duplicate, 1);
  assert.equal(importTikTokBrowserPosts([post('vamoskebap1')], { now: new Date('2026-12-04T18:00:00Z') }).counts.invalid, 1);
});

test('reporting accounts, near-match names, and conflicting URL authors cannot establish a merchant', () => {
  for (const owner of ['vamoskebap', 'vamoskebap12', 'opening.guide']) {
    assert.equal(importTikTokBrowserPosts([post(owner)], { now }).counts.rejected, 1);
  }
  const { deal } = buildDealFromPost(post('opening.guide').url, {
    accountHandle: 'vamoskebap1', description: caption, timeDateTime: new Date(createTime * 1000).toISOString(),
  }, { now });
  assert.notEqual(deal?.brand, 'VAMOS');
});

test('an exact account can identify its own business; conditional benefits retain their conditions in the source', () => {
  const other = caption.replace('VAMOS', 'SENNA');
  const result = importTikTokBrowserPosts([post('senna', other)], { now });
  assert.equal(result.added[0].brand, 'SENNA');
  const conditional = importTikTokBrowserPosts([post('senna', other + ' Nur bei Bestellung über 15 €.')], { now });
  assert.notEqual(conditional.added[0]?.title, result.added[0].title);
});
