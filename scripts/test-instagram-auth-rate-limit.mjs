import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateInstagramAuth, writeGithubOutputs } from './check-instagram-auth.mjs';

const cookies = [
  { name: 'sessionid', value: 'test-session' },
  { name: 'csrftoken', value: 'test-csrf' },
];

let fetches = 0;
const rateLimited = await validateInstagramAuth(cookies, {
  env: { INSTAGRAM_AUTH_ATTEMPTS: '3', INSTAGRAM_AUTH_BACKOFF_MS: '1' },
  fetchImpl: async () => {
    fetches += 1;
    return new Response('{"message":"Please wait"}', {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  },
  sleepImpl: async () => assert.fail('429 must not be retried by the health probe'),
});

assert.equal(fetches, 1);
assert.equal(rateLimited.status, 'rate-limited');
assert.equal(rateLimited.ok, false);
assert.equal(rateLimited.rateLimited, true);
assert.equal(rateLimited.shouldRefreshCookies, false);
assert.equal(rateLimited.canProceed, true);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-instagram-auth-'));
const outputPath = path.join(tempDir, 'github-output.txt');
const previousOutputPath = process.env.GITHUB_OUTPUT;
process.env.GITHUB_OUTPUT = outputPath;
try {
  writeGithubOutputs(rateLimited);
  const githubOutput = fs.readFileSync(outputPath, 'utf8');
  assert.match(githubOutput, /^ok=true$/m, 'legacy workflow gates must proceed on a probe-only 429');
  assert.match(githubOutput, /^auth_valid=false$/m, '429 must not be reported as confirmed valid auth');
  assert.match(githubOutput, /^proceed=true$/m);
} finally {
  if (previousOutputPath === undefined) delete process.env.GITHUB_OUTPUT;
  else process.env.GITHUB_OUTPUT = previousOutputPath;
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const loginWall = await validateInstagramAuth(cookies, {
  env: { INSTAGRAM_AUTH_ATTEMPTS: '1' },
  fetchImpl: async () => new Response('<html>Log in to Instagram</html>', {
    status: 401,
    headers: { 'content-type': 'text/html' },
  }),
});

assert.equal(loginWall.status, 'login-wall');
assert.equal(loginWall.shouldRefreshCookies, true);
assert.equal(loginWall.canProceed, false);

const success = await validateInstagramAuth(cookies, {
  env: { INSTAGRAM_AUTH_ATTEMPTS: '1' },
  fetchImpl: async () => new Response('{"data":{"user":{"username":"ciosgrill"}}}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
});

assert.equal(success.ok, true);
assert.equal(success.canProceed, true);
assert.equal(success.shouldRefreshCookies, false);

console.log('instagram auth rate-limit tests passed');
