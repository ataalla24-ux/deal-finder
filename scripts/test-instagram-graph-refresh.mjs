import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectInstagramGraphVerificationCandidates,
  refreshInstagramGraphEvidence,
} from '../scraper/refresh-instagram-graph-evidence.js';

const now = new Date('2026-08-22T10:00:00.000Z');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-graph-refresh-'));
const candidateUrl = 'https://www.instagram.com/reel/DNcFresh123/';

fs.writeFileSync(path.join(tempDir, 'deals-pending-firecrawl4.json'), JSON.stringify({
  deals: [
    {
      id: 'fresh-candidate',
      url: candidateUrl,
      ownerUsername: 'vienna.cafe',
      sourcePublishedAt: '2026-08-21T08:00:00.000Z',
      sourcePublishedAtSource: 'url.instagramShortcode',
    },
    {
      id: 'old-candidate',
      url: 'https://www.instagram.com/reel/DOldCandidate/',
      ownerUsername: 'old.cafe',
      sourcePublishedAt: '2025-08-21T08:00:00.000Z',
      sourcePublishedAtSource: 'url.instagramShortcode',
    },
  ],
}));

const inventory = collectInstagramGraphVerificationCandidates({
  now,
  docsDir: tempDir,
  files: ['deals-pending-firecrawl4.json'],
});
assert.equal(inventory.candidates.length, 1);
assert.equal(inventory.candidates[0].ownerUsername, 'vienna.cafe');

for (const file of [
  'deals-pending-all.json',
  'deals-pending-firecrawl.json',
  'deals-pending-instagram-verified.json',
  'deals-pending-merged.json',
]) {
  fs.writeFileSync(path.join(tempDir, file), JSON.stringify({
    deals: [{
      id: `excluded-${file}`,
      url: `https://www.instagram.com/reel/DExcluded${file.length}/`,
      ownerUsername: 'excluded.account',
      sourcePublishedAt: '2026-08-21T08:00:00.000Z',
      sourcePublishedAtSource: 'instagram-rendered-time-datetime',
    }],
  }));
}
const automaticInventory = collectInstagramGraphVerificationCandidates({ now, docsDir: tempDir });
assert.deepEqual(automaticInventory.files, ['deals-pending-firecrawl4.json']);
assert.equal(automaticInventory.candidates.length, 1);

const refreshed = await refreshInstagramGraphEvidence({
  now,
  docsDir: tempDir,
  files: ['deals-pending-firecrawl4.json'],
  evidencePath: path.join(tempDir, 'evidence.json'),
  reportPath: path.join(tempDir, 'report.json'),
  env: {
    INSTAGRAM_ACCESS_TOKEN: 'test-token',
    INSTAGRAM_USER_ID: '123456',
    META_GRAPH_VERSION: 'v26.0',
  },
  write: false,
  fetchAccount: async (_config, account) => ({
    username: account.username,
    entries: [{
      item: {
        id: 'graph-media-1',
        username: 'vienna.cafe',
        caption: 'Bis 31. August 2026: 50% Rabatt in 1070 Wien.',
        permalink: candidateUrl,
        timestamp: '2026-08-21T08:00:00.000Z',
        media_type: 'VIDEO',
      },
      context: {
        sourceType: 'account',
        sourceName: '@vienna.cafe',
        account: { username: 'vienna.cafe', verifiedVienna: true },
      },
    }],
  }),
});

assert.equal(refreshed.report.status, 'ok');
assert.equal(refreshed.report.exactMatches, 1);
assert.equal(refreshed.evidence.totalPosts, 1);
assert.equal(refreshed.evidence.posts[0].sourcePublishedAt, '2026-08-21T08:00:00.000Z');
assert.equal(refreshed.evidence.posts[0].graphAccepted, true);

const notConfigured = await refreshInstagramGraphEvidence({
  now,
  docsDir: tempDir,
  files: ['deals-pending-firecrawl4.json'],
  evidencePath: path.join(tempDir, 'missing-evidence.json'),
  reportPath: path.join(tempDir, 'missing-report.json'),
  env: {},
  write: false,
});
assert.equal(notConfigured.report.status, 'not-configured');
assert.equal(notConfigured.shouldFail, false);

fs.writeFileSync(path.join(tempDir, 'deals-pending-auth-test.json'), JSON.stringify({
  deals: [
    {
      id: 'auth-candidate-one',
      url: 'https://www.instagram.com/reel/DNcAuthOne/',
      ownerUsername: 'auth.one',
      sourcePublishedAt: '2026-08-21T09:00:00.000Z',
      sourcePublishedAtSource: 'instagram-rendered-time-datetime',
    },
    {
      id: 'auth-candidate-two',
      url: 'https://www.instagram.com/reel/DNcAuthTwo/',
      ownerUsername: 'auth.two',
      sourcePublishedAt: '2026-08-21T09:30:00.000Z',
      sourcePublishedAtSource: 'instagram-rendered-time-datetime',
    },
  ],
}));
let authRequests = 0;
const authFailure = await refreshInstagramGraphEvidence({
  now,
  docsDir: tempDir,
  files: ['deals-pending-auth-test.json'],
  evidencePath: path.join(tempDir, 'auth-evidence.json'),
  reportPath: path.join(tempDir, 'auth-report.json'),
  maxAccounts: 2,
  env: {
    INSTAGRAM_ACCESS_TOKEN: 'expired-test-token',
    INSTAGRAM_USER_ID: '123456',
    META_GRAPH_VERSION: 'v26.0',
  },
  write: false,
  fetchAccount: async () => {
    authRequests += 1;
    throw Object.assign(new Error('Invalid OAuth access token.'), { status: 401, code: 190 });
  },
});
assert.equal(authRequests, 1, 'a global token failure must stop the account loop immediately');
assert.equal(authFailure.report.status, 'failed-preserved');
assert.equal(authFailure.report.globalError.code, '190');
assert.deepEqual(authFailure.report.accountFailures, {}, 'global failures must not put individual accounts on cooldown');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('instagram graph refresh tests passed');
