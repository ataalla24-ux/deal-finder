import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'freefinder-social-publisher-'));
const videoPath = path.join(temporaryDirectory, 'test-reel.mp4');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let instagramContainerCreated = false;
let instagramPublished = false;

await execFileAsync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=0xf2a33a:s=360x640:d=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  videoPath,
]);

const requests = [];
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  requests.push({ method: request.method, url: request.url, headers: request.headers, body });

  response.setHeader('content-type', 'application/json');
  if (request.url === '/api/social/instagram/status') {
    response.end(JSON.stringify({ ok: true, configured: true, connected: true, account: { username: 'freefinder.at' } }));
    return;
  }
  if (request.url === '/api/social/media') {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer publisher-test-token');
    assert.equal(request.headers['content-type'], 'video/mp4');
    assert.ok(body.byteLength > 0);
    response.statusCode = 201;
    response.end(JSON.stringify({ ok: true, mediaUrl: 'https://worker.example/api/social/media/test.mp4' }));
    return;
  }
  if (request.url === '/api/social/instagram/publish') {
    const payload = JSON.parse(body.toString('utf8'));
    assert.equal(payload.caption, 'FreeFinder Publisher Test');
    assert.equal(payload.idempotencyKey, 'instagram:test:publisher:2026-08-21');
    assert.equal(payload.consent, true);
    instagramContainerCreated = true;
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true, containerId: 'container-test' }));
    return;
  }
  if (request.url === '/api/social/instagram/publish/status?idempotencyKey=instagram%3Atest%3Apublisher%3A2026-08-21') {
    if (!instagramContainerCreated) {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: 'Instagram publish session not found' }));
      return;
    }
    response.end(JSON.stringify(instagramPublished
      ? { ok: true, containerId: 'container-test', mediaId: 'media-test', status: { status_code: 'PUBLISHED' } }
      : { ok: true, containerId: 'container-test', status: { status_code: 'FINISHED' } }));
    return;
  }
  if (request.url === '/api/social/instagram/publish/complete') {
    const payload = JSON.parse(body.toString('utf8'));
    assert.equal(payload.idempotencyKey, 'instagram:test:publisher:2026-08-21');
    assert.equal(payload.consent, true);
    instagramPublished = true;
    response.statusCode = 201;
    response.end(JSON.stringify({ ok: true, containerId: 'container-test', mediaId: 'media-test' }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    'scripts/publish-social-post.mjs',
    '--platform', 'instagram',
    '--video', videoPath,
    '--caption', 'FreeFinder Publisher Test',
    '--idempotency', 'test:publisher:2026-08-21',
    '--worker', `http://127.0.0.1:${address.port}`,
    '--consent',
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, SOCIAL_PUBLISH_TOKEN: 'publisher-test-token' },
  });
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.results.instagram.status, 'PUBLISHED');
  assert.equal(result.results.instagram.mediaId, 'media-test');
  assert.deepEqual(requests.map((entry) => `${entry.method} ${entry.url}`), [
    'GET /api/social/instagram/status',
    'GET /api/social/instagram/publish/status?idempotencyKey=instagram%3Atest%3Apublisher%3A2026-08-21',
    'POST /api/social/media',
    'POST /api/social/instagram/publish',
    'GET /api/social/instagram/publish/status?idempotencyKey=instagram%3Atest%3Apublisher%3A2026-08-21',
    'POST /api/social/instagram/publish/complete',
  ]);

  const requestCountAfterFirstPublish = requests.length;
  const replay = await execFileAsync(process.execPath, [
    'scripts/publish-social-post.mjs',
    '--platform', 'instagram',
    '--video', videoPath,
    '--caption', 'FreeFinder Publisher Test',
    '--idempotency', 'test:publisher:2026-08-21',
    '--worker', `http://127.0.0.1:${address.port}`,
    '--consent',
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, SOCIAL_PUBLISH_TOKEN: 'publisher-test-token' },
  });
  assert.equal(replay.stderr, '');
  const replayResult = JSON.parse(replay.stdout);
  assert.equal(replayResult.results.instagram.replayed, true);
  assert.equal(requests.length, requestCountAfterFirstPublish + 2);
  assert.equal(requests.at(-1).url, '/api/social/instagram/publish/status?idempotencyKey=instagram%3Atest%3Apublisher%3A2026-08-21');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('Local social publisher validation and Instagram Reel flow passed.');
