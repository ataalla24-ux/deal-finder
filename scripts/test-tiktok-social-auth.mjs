import assert from 'node:assert/strict';
import worker from '../referrals-worker/src/index.js';

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key) ?? null;
    return type === 'json' && value ? JSON.parse(value) : value;
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
  TIKTOK_CLIENT_KEY: 'test-client-key',
  TIKTOK_CLIENT_SECRET: 'test-client-secret',
  TIKTOK_SANDBOX_CLIENT_KEY: 'test-sandbox-client-key',
  TIKTOK_SANDBOX_CLIENT_SECRET: 'test-sandbox-client-secret',
  SOCIAL_TOKEN_ENCRYPTION_KEY: 'test-encryption-key-that-is-longer-than-thirty-two-characters',
  SOCIAL_CONNECT_TOKEN: 'connect-token',
  SOCIAL_PUBLISH_TOKEN: 'publish-token',
  TIKTOK_EXPECTED_USERNAME: 'freefinder.at',
};

const connectResponse = await worker.fetch(new Request(
  'https://worker.example/api/social/tiktok/connect-session',
  { method: 'POST', headers: { authorization: 'Bearer connect-token' } },
), env);
assert.equal(connectResponse.status, 200);
const connect = await connectResponse.json();
const authorizeUrl = new URL(connect.authorizeUrl);
assert.equal(authorizeUrl.origin, 'https://www.tiktok.com');
assert.equal(authorizeUrl.searchParams.get('scope'), 'user.info.basic,video.publish');
assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/tiktok/callback');

const state = authorizeUrl.searchParams.get('state');
assert.ok(state);

const invalidEnvironmentResponse = await worker.fetch(new Request(
  'https://worker.example/api/social/tiktok/connect-session?environment=sandobx',
  { method: 'POST', headers: { authorization: 'Bearer connect-token' } },
), env);
assert.equal(invalidEnvironmentResponse.status, 400);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.endsWith('/v2/oauth/token/')) {
    return Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      open_id: 'freefinder-open-id',
      scope: 'user.info.basic,video.publish',
      expires_in: 86400,
      refresh_expires_in: 31536000,
      token_type: 'Bearer',
    });
  }
  if (href.includes('/v2/user/info/')) {
    return Response.json({
      data: { user: { display_name: 'FreeFinder', avatar_url: 'https://example.com/avatar.png' } },
      error: { code: 'ok', message: '' },
    });
  }
  if (href.endsWith('/v2/post/publish/creator_info/query/')) {
    return Response.json({
      data: {
        creator_username: 'freefinder.at',
        creator_nickname: 'FreeFinder',
        privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      },
      error: { code: 'ok', message: '' },
    });
  }
  if (href.endsWith('/v2/post/publish/video/init/')) {
    const body = JSON.parse(init.body);
    assert.equal(body.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
    if (body.source_info.source === 'FILE_UPLOAD') {
      if (body.source_info.video_size === 100 * 1024 * 1024) {
        assert.equal(body.source_info.chunk_size, 32 * 1024 * 1024);
        assert.equal(body.source_info.total_chunk_count, 3);
        return Response.json({
          data: {
            publish_id: 'v_pub_file_chunked_789',
            upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=chunked&upload_token=secret',
          },
          error: { code: 'ok', message: '' },
        });
      }
      assert.equal(body.source_info.video_size, 12_345_678);
      assert.equal(body.source_info.chunk_size, 12_345_678);
      assert.equal(body.source_info.total_chunk_count, 1);
      return Response.json({
        data: {
          publish_id: 'v_pub_file_test_456',
          upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=test&upload_token=secret',
        },
        error: { code: 'ok', message: '' },
      });
    }
    assert.equal(body.source_info.video_url, 'https://freefinder.at/social/test.mp4');
    return Response.json({ data: { publish_id: 'v_pub_test_123' }, error: { code: 'ok', message: '' } });
  }
  throw new Error(`Unexpected fetch: ${href}`);
};

try {
  const callbackResponse = await worker.fetch(new Request(
    `https://worker.example/api/social/tiktok/callback?code=code-123&state=${encodeURIComponent(state)}`,
  ), env);
  const callbackHtml = await callbackResponse.text();
  assert.equal(callbackResponse.status, 200, callbackHtml);
  assert.match(callbackHtml, /TikTok ist verbunden/);

  const stored = JSON.parse(await env.REFERRAL_KV.get('social:tiktok:tokens'));
  assert.equal(stored.version, 1);
  assert.equal(JSON.stringify(stored).includes('access-token'), false);
  assert.equal(JSON.stringify(stored).includes('refresh-token'), false);

  const statusResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/status',
    { headers: { authorization: 'Bearer connect-token' } },
  ), env);
  const status = await statusResponse.json();
  assert.equal(status.connected, true);
  assert.equal(status.account.username, 'freefinder.at');

  const publishResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        videoUrl: 'https://freefinder.at/social/test.mp4',
        caption: 'Gratis Deal in Wien #freefinder',
        idempotencyKey: 'daily:2026-08-17',
        consent: true,
      }),
    },
  ), env);
  assert.equal(publishResponse.status, 202);
  const publish = await publishResponse.json();
  assert.equal(publish.publishId, 'v_pub_test_123');

  const replayResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        videoUrl: 'https://freefinder.at/social/test.mp4',
        caption: 'Gratis Deal in Wien #freefinder',
        idempotencyKey: 'daily:2026-08-17',
        consent: true,
      }),
    },
  ), env);
  const replay = await replayResponse.json();
  assert.equal(replay.replayed, true);

  const filePublishResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'FILE_UPLOAD',
        videoSize: 12_345_678,
        mediaType: 'video/mp4',
        caption: 'Lokaler Video-Upload #freefinder',
        idempotencyKey: 'daily:2026-08-18:file',
        consent: true,
      }),
    },
  ), env);
  assert.equal(filePublishResponse.status, 202);
  const filePublish = await filePublishResponse.json();
  assert.equal(filePublish.publishId, 'v_pub_file_test_456');
  assert.match(filePublish.uploadUrl, /^https:\/\/open-upload\.tiktokapis\.com\//);
  assert.equal(Number.isFinite(filePublish.uploadExpiresAt), true);
  assert.equal(Object.hasOwn(filePublish, 'expiresAt'), false);
  const storedFilePublish = JSON.parse(await env.REFERRAL_KV.get('social:tiktok:publish:daily:2026-08-18:file'));
  assert.equal(Object.hasOwn(storedFilePublish, 'uploadUrl'), false);

  const fileReplayResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadMode: 'file',
        videoSize: 12_345_678,
        mediaType: 'video/mp4',
        caption: 'Lokaler Video-Upload #freefinder',
        idempotencyKey: 'daily:2026-08-18:file',
        consent: true,
      }),
    },
  ), env);
  const fileReplay = await fileReplayResponse.json();
  assert.equal(fileReplay.replayed, true);
  assert.match(fileReplay.uploadUrl, /^https:\/\/open-upload\.tiktokapis\.com\//);
  assert.equal(Number.isFinite(fileReplay.uploadExpiresAt), true);
  assert.equal(Object.hasOwn(fileReplay, 'expiresAt'), false);

  const chunkedPublishResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/publish',
    {
      method: 'POST',
      headers: { authorization: 'Bearer publish-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'FILE_UPLOAD',
        videoSize: 100 * 1024 * 1024,
        mediaType: 'video/mp4',
        caption: 'Groesserer lokaler Video-Upload #freefinder',
        idempotencyKey: 'daily:2026-08-19:chunked',
        consent: true,
      }),
    },
  ), env);
  assert.equal(chunkedPublishResponse.status, 202);
  const chunkedPublish = await chunkedPublishResponse.json();
  assert.equal(chunkedPublish.chunkSize, 32 * 1024 * 1024);
  assert.equal(chunkedPublish.totalChunkCount, 3);

  const sandboxConnectResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/connect-session?environment=sandbox',
    { method: 'POST', headers: { authorization: 'Bearer connect-token' } },
  ), env);
  const sandboxConnect = await sandboxConnectResponse.json();
  assert.equal(sandboxConnect.environment, 'sandbox');
  const sandboxAuthorizeUrl = new URL(sandboxConnect.authorizeUrl);
  assert.equal(sandboxAuthorizeUrl.searchParams.get('client_key'), 'test-sandbox-client-key');

  const sandboxCallbackResponse = await worker.fetch(new Request(
    `https://worker.example/api/social/tiktok/callback?code=sandbox-code&state=${encodeURIComponent(sandboxAuthorizeUrl.searchParams.get('state'))}`,
  ), env);
  assert.equal(sandboxCallbackResponse.status, 200, await sandboxCallbackResponse.text());
  assert.equal(await env.REFERRAL_KV.get('social:tiktok:sandbox:tokens') !== null, true);

  const sandboxStatusResponse = await worker.fetch(new Request(
    'https://worker.example/api/social/tiktok/status?environment=sandbox',
    { headers: { authorization: 'Bearer connect-token' } },
  ), env);
  const sandboxStatus = await sandboxStatusResponse.json();
  assert.equal(sandboxStatus.environment, 'sandbox');
  assert.equal(sandboxStatus.connected, true);
  assert.equal(sandboxStatus.account.username, 'freefinder.at');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('TikTok OAuth, encrypted token storage, account validation, and idempotent publishing passed.');
