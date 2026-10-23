#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyLiveDealEditsToBundle, loadLiveDealEditStore, readJson,
  saveLiveDealEditStore, upsertLiveDealEdit, writeJson,
} from './live-deal-edits-lib.mjs';

const copyFields = new Set(['title', 'brand', 'description', 'url', 'hidden', 'type']);

export function applyReviewedDealCopy(bundle, store, review, now = new Date().toISOString()) {
  assert.ok(Array.isArray(bundle?.deals), 'Missing live deals');
  const changes = review.changes || [];
  const reviewedIds = [...changes, ...(review.kept || [])].map(row => row.id);
  assert.equal(new Set(reviewedIds).size, reviewedIds.length, 'Duplicate reviewed ID');
  assert.equal(reviewedIds.length, review.reviewedCount, 'Incomplete review');
  assert.deepEqual([...reviewedIds].sort(), bundle.deals.map(deal => deal.id).sort(), 'Live inventory changed; review the new records first');
  const byId = new Map(bundle.deals.map(deal => [deal.id, deal]));
  let nextStore = store;
  for (const change of changes) {
    const deal = byId.get(change.id);
    assert.equal(deal.title, change.before, `Title changed since review: ${change.id}`);
    assert.ok(change.reason, `Missing review reason: ${change.id}`);
    assert.ok(Object.keys(change.fields).every(key => copyFields.has(key)), 'Only reviewed copy or explicit hides may change');
    assert.ok(typeof change.fields.title === 'string' && change.fields.title.trim().length >= 8
      && change.fields.title.length <= 65, 'Title must remain readable and complete');
    if (change.fields.url) assert.equal(new URL(change.fields.url).protocol, 'https:');
    if (change.fields.type) {
      assert.equal(change.fields.type, 'bogo', 'Only an explicit 1+1 offer classification may be corrected');
      assert.match(change.fields.title, /1\+1/);
    }
    if (Object.hasOwn(change.fields, 'hidden')) assert.equal(change.fields.hidden, true, 'Review cannot restore hidden records');
    const existing = nextStore.edits.find(edit => edit.dealId === change.id) || {};
    nextStore = upsertLiveDealEdit(nextStore, {
      ...existing, ...change.fields, dealId: change.id,
      ...(change.fields.brand ? { logo: deal.logo || '', logoUrl: deal.logoUrl || '' } : {}),
      editedBy: `owner-request-copy-review-${review.reviewedAt}`,
      updatedAt: now,
      ...(change.fields.hidden ? { manualRemovalApproved: true, restoreDeal: deal } : {}),
    }, now);
  }
  const result = applyLiveDealEditsToBundle(bundle, nextStore, {
    checkedAt: now, allowRemovals: false, allowManualRemovals: true,
  });
  const hiddenIds = new Set(changes.filter(row => row.fields.hidden).map(row => row.id));
  assert.deepEqual(result.bundle.deals.map(deal => deal.id), bundle.deals.filter(deal => !hiddenIds.has(deal.id)).map(deal => deal.id),
    'Only the explicitly reviewed hides may affect inventory or order');
  const changedById = new Map(changes.map(row => [row.id, row]));
  const editMetadata = new Set(['liveEditedAt', 'liveEditedBy', 'liveEditedFields']);
  for (const deal of result.bundle.deals) {
    const before = byId.get(deal.id);
    const change = changedById.get(deal.id);
    const allowed = new Set([...Object.keys(change?.fields || {}), ...editMetadata,
      ...(change?.fields.brand ? ['logo', 'logoUrl'] : [])]);
    for (const field of new Set([...Object.keys(before), ...Object.keys(deal)])) {
      if (!allowed.has(field)) assert.deepEqual(deal[field], before[field], `Unexpected change: ${deal.id}.${field}`);
    }
    if (change) assert.equal(deal.title, change.fields.title);
  }
  return {
    bundle: result.bundle, store: nextStore,
    report: {
      reviewedAt: review.reviewedAt, beforeCount: bundle.deals.length, afterCount: result.bundle.deals.length,
      changedTitles: changes.filter(row => !row.fields.hidden).length,
      keptTitles: (review.kept || []).length,
      hidden: changes.filter(row => row.fields.hidden).map(row => ({
        id: row.id, reason: row.reason, originalDeal: byId.get(row.id),
      })),
      reviewed: reviewedIds.map(id => ({ id, decision: changedById.has(id)
        ? hiddenIds.has(id) ? 'hidden' : 'copy-corrected' : 'kept',
      before: byId.get(id).title, after: changedById.get(id)?.fields.title || byId.get(id).title })),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reviewPath = path.resolve(process.argv[2] || 'reviews/deal-title-review-2026-10-23.json');
  const result = applyReviewedDealCopy(readJson('docs/deals.json'), loadLiveDealEditStore('docs/live-deal-edits.json'), readJson(reviewPath));
  if (process.argv.includes('--apply')) {
    saveLiveDealEditStore('docs/live-deal-edits.json', result.store);
    writeJson('docs/deals.json', result.bundle);
    writeJson(reviewPath.replace(/\.json$/, '-result.json'), result.report);
  }
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'applied' : 'dry-run',
    before: result.report.beforeCount, after: result.report.afterCount,
    changedTitles: result.report.changedTitles, keptTitles: result.report.keptTitles,
    hidden: result.report.hidden.map(row => row.id) }, null, 2));
}
