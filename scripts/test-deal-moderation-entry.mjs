import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-moderation-entry-'));
const docsDir = path.join(tempDir, 'docs');
const moderationPath = path.join(docsDir, 'deal-moderation.json');
const urls = [
  'https://www.instagram.com/reel/ExactOne/',
  'https://www.tiktok.com/@merchant/video/1234567890',
];

try {
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(moderationPath, `${JSON.stringify({
    blockedIds: [],
    blockedUrls: [],
    blockedProviders: [],
    blockedText: [],
    hiddenDeals: [],
  })}\n`);
  fs.writeFileSync(path.join(docsDir, 'deals-pending-test.json'), `${JSON.stringify({
    deals: [{
      id: 'instagram-one',
      url: urls[0],
      ownerUsername: 'exact.merchant',
      originSource: 'Meta Instagram Hashtag API',
    }],
  })}\n`);

  const result = spawnSync(process.execPath, ['scripts/add-deal-moderation-entry.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      DEAL_MODERATION_DOCS_DIR: docsDir,
      DEAL_MODERATION_PATH: moderationPath,
      DEAL_MODERATION_URLS: urls.join('\n'),
      DEAL_MODERATION_REASON: 'exact test removal',
      DEAL_MODERATION_BY: 'test-suite',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const moderation = JSON.parse(fs.readFileSync(moderationPath, 'utf8'));
  assert.deepEqual(moderation.hiddenDeals.map((entry) => entry.url), urls);
  assert.ok(moderation.hiddenDeals.every((entry) => entry.reason === 'exact test removal'));
  assert.equal(moderation.hiddenDeals[0].ownerUsername, 'exact.merchant');
  assert.equal(moderation.hiddenDeals[0].originSource, 'Meta Instagram Hashtag API');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('deal moderation entry ok');
