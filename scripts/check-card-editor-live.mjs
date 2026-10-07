import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createCardEditor } from '../scraper/deal-card-editor.js';

assert.ok(process.env.OPENAI_API_KEY, 'Configure the existing OPENAI_API_KEY secret');
const manifest = JSON.parse(fs.readFileSync('reviews/2026-10-07-card-titles.json', 'utf8'));
const edit = createCardEditor({ maxCalls: 4 });
const results = [];
for (const review of manifest.reviews) {
  // Isolated drafts from verified public evidence, not edits of published data.
  const input = { id: review.dealId, brand: review.expectedBrand, url: review.sourceUrl,
    title: review.expectedFields.title, description: review.expectedFields.description,
    evidence: { textSample: review.sourceQuote } };
  const result = await edit(input);
  results.push({ id: result.id, title: result.title, when: result.expiryDisplayText || '',
    titleApplied: result.cardEditorial?.titleApplied, status: result.cardEditorial?.status,
    warnings: result.cardEditorial?.warnings });
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
assert.ok(results.every(r => r.titleApplied && r.status === 'draft'), 'One of the real model proposals failed validation');
assert.match(results[0].title, /20\s*%/);
assert.match(results[0].title, /saisonal/i);
assert.equal(results[0].when, '', 'Unknown Anker offer window must remain unknown');
assert.match(results[1].title, /2[,.]50/);
assert.doesNotMatch(results[1].title, /08:00|09:00|Montag|Freitag|Mo-Fr/i);
assert.match(results[1].when, /Montag bis Freitag/);
assert.match(results[1].when, /08:00 bis 09:00/);
console.log('Read-only live model check passed. No feed, queue or Slack messages changed.');
