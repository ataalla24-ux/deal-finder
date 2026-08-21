import assert from 'node:assert/strict';
import worker from '../referrals-worker/src/index.js';

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key) ?? null;
    if (type === 'json' && typeof value === 'string') return JSON.parse(value);
    return value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }

  async list({ prefix = '' } = {}) {
    return {
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    };
  }
}

const env = {
  REFERRAL_KV: new MemoryKv(),
  INSTAGRAM_APP_ID: 'instagram-app-id',
  INSTAGRAM_APP_SECRET: 'instagram-app-secret',
  INSTAGRAM_EXPECTED_USERNAME: 'freefinder.at',
  SOCIAL_TOKEN_ENCRYPTION_KEY: 'test-encryption-key-that-is-longer-than-thirty-two-characters',
  SOCIAL_CONNECT_TOKEN: 'connect-token',
  SOCIAL_PUBLISH_TOKEN: 'publish-token',
};

const connectResponse = await worker.fetch(new Request(
  'https://worker.example/api/social/instagram/connect-session',
  { method: 'POST', headers: { authorization: 'Bearer connect-token' } },
), env);
assert.equal(connectResponse.status, 200);
const connect = await connectResponse.json();
const authorizeUrl = new URL(connect.authorizeUrl);
assert.equal(authorizeUrl.origin, 'https://www.instagram.com');
assert.equal(authorizeUrl.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish');
assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/instagram/callback');
const state = authorizeUrl.searchParams.get('state');
assert.ok(state);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href === 'https://api.instagram.com/oauth/access_token') {
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('client_id'), 'instagram-app-id');
    assert.equal(body.get('code'), 'instagram-code');
    return Response.json({ access_token: 'short-lived-token', user_id: 'ig-user-123' });
  }
  if (href.startsWith('https://graph.instagram.com/access_token?')) {
    return Response.json({ access_token: 'long-lived-token', token_type: 'bearer', expires_in: 5_184_000 });
  }
  if (href.startsWith('https://graph.instagram.com/v26.0/me?')) {
    assert.equal(init.headers.authorization, 'Bearer long-lived-token');
    return Response.json({
      id: 'ig-user-123',
      user_id: 'ig-user-123',
      username: 'freefinder.at',
      name: 'FreeFinder',
      account_type: 'BUSINESS',
      profile_picture_url: 'https://example.com/freefinder.jpg',
    });
  }
  if (href === 'https://graph.instagram.com/v26.0/ig-user-123/media') {
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('media_type'), 'REELS');
    assert.match(body.get('video_url'), /^https:\/\/worker\.example\/api\/social\/media\//);
    assert.equal(body.get('share_to_feed'), 'true');
    assert.equal(body.get('access_token'), 'long-lived-token');
    return Response.json({ id: 'container-123' });
  }
  if (href.startsWith('https://graph.instagram.com/v26.0/container-123?')) {
    assert.equal(init.headers.authorization, 'Bearer long-lived-token');
    return Response.json({ id: 'container-123', status_code: 'FINISHED', status: 'Finished' });
  }
  if (href === 'https://graph.instagram.com/v26.0/ig-user-123/media_publish') {
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('creation_id'), 'container-123');
    assert.equal(body.get('access_token'), 'long-lived-token');
    return Response.json({ id: 'media-456' });
  }
  throw new Error(`Unexpected fetch: ${href}`);
};

try {
  const callbackResponse = await worker.fetch(new Request(
    `https://worker.example/api/social/instagram/callback?code=instagram-code&state=${encodeURIComponent(state)}`,
  ), env);
  const callbackHtml = await callbackResponse.text();
  assert.equal(callbackResponse.status, 200, callbackHtml);
  assert.match(callbackHtml, /Instagram ist verbunden/);

  const storedToken = JSON.parse(await env.REFERRAL_KV.get('social:instagram:tokens'));
  assert.equal(storedToken.version, 1);
  assert.equal(JSON.stringify(storedToken).includes('long-lived-token'), false);

  const statusResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/status',
    { headers: { authorization: 'Bearer connect-token' } },
  ), env);
  const status = await statusResponse.json();
  assert.equal(status.connected, true);
  assert.equal(status.account.username, 'freefinder.at');

  const unknownPublishStatusResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish/status?idempotencyKey=instagram:unknown:2026-08-21',
    { headers: { authorization: 'Bearer publish-token' } },
  ), env);
  assert.equal(unknownPublishStatusResponse.status, 404);

  const mediaBytes = new TextEncoder().encode('fake-mp4-content');
  const uploadResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/media',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'video/mp4' },
      body: mediaBytes,
    },
  ), env);
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  assert.match(upload.mediaUrl, /^https:\/\/worker\.example\/api\/social\/media\/.+\.mp4$/);

  const publicMediaResponse = await worker.fetch(new Request(upload.mediaUrl), env);
  assert.equal(publicMediaResponse.status, 200);
  assert.equal(publicMediaResponse.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await publicMediaResponse.arrayBuffer()), mediaBytes);

  const rejectedPublishResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        videoUrl: 'https://attacker.example/video.mp4',
        caption: 'Nicht erlaubt',
        idempotencyKey: 'instagram:blocked:2026-08-21',
        consent: true,
      }),
    },
  ), env);
  assert.equal(rejectedPublishResponse.status, 400);

  const publishResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        videoUrl: upload.mediaUrl,
        caption: 'Gratis Deal in Wien #freefinder',
        idempotencyKey: 'instagram:daily:2026-08-21',
        consent: true,
      }),
    },
  ), env);
  assert.equal(publishResponse.status, 202);
  const publish = await publishResponse.json();
  assert.equal(publish.containerId, 'container-123');

  const publishReplayResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        videoUrl: upload.mediaUrl,
        caption: 'Gratis Deal in Wien #freefinder',
        idempotencyKey: 'instagram:daily:2026-08-21',
        consent: true,
      }),
    },
  ), env);
  assert.equal((await publishReplayResponse.json()).replayed, true);

  const containerStatusResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish/status?idempotencyKey=instagram:daily:2026-08-21',
    { headers: { authorization: 'Bearer publish-token' } },
  ), env);
  const containerStatus = await containerStatusResponse.json();
  assert.equal(containerStatus.status.status_code, 'FINISHED');

  const completeResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish/complete',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'instagram:daily:2026-08-21', consent: true }),
    },
  ), env);
  assert.equal(completeResponse.status, 201);
  const completed = await completeResponse.json();
  assert.equal(completed.mediaId, 'media-456');

  const completeReplayResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish/complete',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'instagram:daily:2026-08-21', consent: true }),
    },
  ), env);
  assert.equal((await completeReplayResponse.json()).replayed, true);

  const completedStatusResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/instagram/publish/status?idempotencyKey=instagram:daily:2026-08-21',
    { headers: { authorization: 'Bearer publish-token' } },
  ), env);
  const completedStatus = await completedStatusResponse.json();
  assert.equal(completedStatus.mediaId, 'media-456');
  assert.equal(completedStatus.status.status_code, 'PUBLISHED');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Instagram OAuth, encrypted tokens, temporary media, and idempotent Reel publishing passed.');
