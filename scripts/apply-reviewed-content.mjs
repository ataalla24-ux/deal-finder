#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_DEAL_EDIT_FIELDS, applyLiveDealEditsToBundle, loadLiveDealEditStore,
  normalizeLiveDealEdit, readJson, saveLiveDealEditStore, upsertLiveDealEdit, writeJson,
} from './live-deal-edits-lib.mjs';

export function applyReviewedContent(bundle, store, manifest) {
  assert.ok(Array.isArray(bundle?.deals), 'Missing feed');
  assert.ok(Array.isArray(manifest?.reviews) && manifest.reviews.length, 'Missing reviewed corrections');
  assert.ok(Number.isFinite(Date.parse(manifest.checkedAt)), 'Missing review timestamp');
  const seen = new Set();
  const edits = manifest.reviews.map((review) => {
    assert.ok(!seen.has(review.dealId), `Duplicate review: ${review.dealId}`);
    seen.add(review.dealId);
    const deal = bundle.deals.find((item) => item.id === review.dealId);
    assert.ok(deal, `Missing live deal: ${review.dealId}`);
    assert.equal(deal.url, review.sourceUrl, `Source changed: ${review.dealId}`);
    assert.ok(review.evidence && review.status && review.expectedBrand, 'Missing source review');
    assert.ok([review.expectedBrand, review.patch?.brand].includes(deal.brand), `Merchant changed since review: ${review.dealId}`);
    assert.ok(review.patch && Object.keys(review.patch).length, 'Empty correction');
    for (const field of Object.keys(review.patch)) {
      assert.ok(LIVE_DEAL_EDIT_FIELDS.includes(field) && !['pubDate', 'pinnedRank'].includes(field), `Unsupported content correction: ${field}`);
      assert.equal(typeof review.patch[field], 'string', `Invalid value: ${field}`);
    }
    return normalizeLiveDealEdit({
      ...review.patch, dealId: deal.id, url: deal.url,
      editedBy: `source-review-${manifest.checkedAt.slice(0, 10)}`, updatedAt: manifest.checkedAt,
    }, { nowIso: manifest.checkedAt });
  });
  const result = applyLiveDealEditsToBundle(bundle, { edits }, { checkedAt: manifest.checkedAt });
  assert.deepEqual(result.bundle.deals.map((deal) => deal.id), bundle.deals.map((deal) => deal.id), 'Content review cannot add, remove or reorder deals');
  result.bundle.deals.forEach((deal, index) => {
    if (!seen.has(deal.id)) assert.deepEqual(deal, bundle.deals[index], `Unrelated deal changed: ${deal.id}`);
  });
  const nextStore = edits.reduce((current, edit) => upsertLiveDealEdit(current, edit, manifest.checkedAt), store);
  return { ...result, store: nextStore };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  assert.ok(manifestPath, 'Usage: node scripts/apply-reviewed-content.mjs reviews/FILE.json [--apply]');
  const manifest = readJson(manifestPath);
  const result = applyReviewedContent(readJson('docs/deals.json'), loadLiveDealEditStore('docs/live-deal-edits.json'), manifest);
  console.log(JSON.stringify(result.report, null, 2));
  if (process.argv.includes('--apply')) {
    writeJson('docs/deals.json', result.bundle);
    saveLiveDealEditStore('docs/live-deal-edits.json', result.store, manifest.checkedAt);
  } else {
    console.log('Dry run only; add --apply to write the reviewed content.');
  }
}
