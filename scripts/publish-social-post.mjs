import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_WORKER_BASE = 'https://freefinder-referrals.freefinder-stefan.workers.dev';
const KEYCHAIN_SERVICE = 'freefinder-tiktok-publish-token';
const KEYCHAIN_ACCOUNT = 'freefinder';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    if (['consent', 'dry-run', 'no-wait', 'not-aigc'].includes(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function resolvePublishToken() {
  const fromEnvironment = String(process.env.SOCIAL_PUBLISH_TOKEN || '').trim();
  if (fromEnvironment) return fromEnvironment;
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('/usr/bin/security', [
      'find-generic-password',
      '-a', KEYCHAIN_ACCOUNT,
      '-s', KEYCHAIN_SERVICE,
      '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function selectedPlatforms(value) {
  const normalized = String(value || 'both').trim().toLowerCase();
  if (normalized === 'both') return ['tiktok', 'instagram'];
  const platforms = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!platforms.length || platforms.some((entry) => !['tiktok', 'instagram'].includes(entry))) {
    throw new Error('--platform must be tiktok, instagram, or both');
  }
  return [...new Set(platforms)];
}

function mimeTypeForVideo(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.webm') return 'video/webm';
  return '';
}

function inspectVideo(filePath) {
  let output;
  try {
    output = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,size,format_name:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('ffprobe could not validate the video');
  }
  const metadata = JSON.parse(output);
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(metadata?.format?.duration || 0);
  if (!videoStream || !Number.isFinite(duration) || duration <= 0) throw new Error('The file is not a valid video');
  const [rateNumerator, rateDenominator = '1'] = String(videoStream.r_frame_rate || '').split('/');
  const frameRate = Number(rateNumerator) / Number(rateDenominator);
  return {
    duration,
    videoCodec: String(videoStream.codec_name || '').toLowerCase(),
    audioCodec: String(audioStream?.codec_name || '').toLowerCase(),
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    frameRate,
  };
}

function validateTikTokVideo(metadata, mimeType, size) {
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType)) {
    throw new Error('TikTok requires an MP4, MOV, or WebM file');
  }
  if (!['h264', 'hevc', 'vp8', 'vp9'].includes(metadata.videoCodec)) {
    throw new Error(`TikTok requires H.264, H.265, VP8, or VP9 video, found ${metadata.videoCodec || 'unknown'}`);
  }
  if (metadata.duration > 600) throw new Error('TikTok videos may be at most 10 minutes long');
  if (metadata.width < 360 || metadata.height < 360 || metadata.width > 4096 || metadata.height > 4096) {
    throw new Error('TikTok video dimensions must be between 360 and 4096 pixels');
  }
  if (!Number.isFinite(metadata.frameRate) || metadata.frameRate < 23 || metadata.frameRate > 60) {
    throw new Error('TikTok videos must use a frame rate between 23 and 60 FPS');
  }
  if (size > 4 * 1024 * 1024 * 1024) throw new Error('TikTok videos may be at most 4 GB');
}

function validateInstagramVideo(metadata, mimeType, size) {
  if (!['video/mp4', 'video/quicktime'].includes(mimeType)) {
    throw new Error('Instagram Reels require an MP4 or MOV file');
  }
  if (!['h264', 'hevc'].includes(metadata.videoCodec)) {
    throw new Error(`Instagram Reels require H.264 or HEVC video, found ${metadata.videoCodec || 'unknown'}`);
  }
  if (metadata.audioCodec && metadata.audioCodec !== 'aac') {
    throw new Error(`Instagram Reels require AAC audio, found ${metadata.audioCodec}`);
  }
  if (metadata.duration < 3 || metadata.duration > 900) {
    throw new Error('Instagram Reels must be between 3 seconds and 15 minutes');
  }
  if (metadata.width > 1920) throw new Error('Instagram Reels may be at most 1920 pixels wide');
  if (size > 24 * 1024 * 1024) {
    throw new Error('The Reel exceeds the 24 MB temporary upload limit; compress it before publishing');
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeIdempotencyBase(input, caption) {
  const explicit = String(input || '').trim();
  if (explicit) {
    if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(explicit)) throw new Error('Invalid --idempotency value');
    return explicit;
  }
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const digest = createHash('sha256').update(`${day}\n${caption}`).digest('hex').slice(0, 16);
  return `daily:${day}:${digest}`;
}

async function responseJson(response, label) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const error = new Error(`${label}: ${payload?.error || payload?.message || `HTTP ${response.status}`}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function apiClient(workerBase, publishToken) {
  const base = String(workerBase || DEFAULT_WORKER_BASE).replace(/\/+$/, '');
  const authorization = `Bearer ${publishToken}`;
  return {
    async json(endpoint, init = {}) {
      const headers = { authorization, ...(init.headers || {}) };
      const response = await fetch(`${base}${endpoint}`, { ...init, headers });
      return responseJson(response, endpoint);
    },
    async uploadMedia(filePath, mimeType) {
      const data = await readFile(filePath);
      const response = await fetch(`${base}/api/social/media`, {
        method: 'POST',
        headers: { authorization, 'content-type': mimeType, 'content-length': String(data.byteLength) },
        body: data,
      });
      return responseJson(response, 'temporary media upload');
    },
  };
}

function tiktokStatusName(payload) {
  return String(payload?.status?.status || payload?.status?.status_code || '').trim().toUpperCase();
}

async function uploadTikTokChunks(uploadUrlValue, filePath, mimeType, fileSize, chunkSize, totalChunkCount) {
  const uploadUrl = new URL(uploadUrlValue);
  if (uploadUrl.protocol !== 'https:' || !uploadUrl.hostname.toLowerCase().endsWith('.tiktokapis.com')) {
    throw new Error('TikTok returned an untrusted upload URL');
  }
  const chunks = Math.max(1, Number(totalChunkCount || 1));
  const standardChunkSize = Math.max(1, Number(chunkSize || fileSize));
  const file = await open(filePath, 'r');
  try {
    let start = 0;
    for (let index = 0; index < chunks; index += 1) {
      const endExclusive = index === chunks - 1 ? fileSize : Math.min(fileSize, start + standardChunkSize);
      const length = endExclusive - start;
      if (length <= 0) throw new Error('TikTok returned an invalid chunk plan');
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, start);
      if (bytesRead !== length) throw new Error('Could not read the complete video chunk');

      let uploaded = false;
      let lastError = '';
      for (let attempt = 1; attempt <= 3 && !uploaded; attempt += 1) {
        try {
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'content-type': mimeType,
              'content-length': String(length),
              'content-range': `bytes ${start}-${endExclusive - 1}/${fileSize}`,
            },
            body: buffer,
          });
          if (response.ok) {
            uploaded = true;
          } else {
            lastError = `HTTP ${response.status}`;
            if (response.status < 500 && response.status !== 429) break;
          }
        } catch (error) {
          lastError = error?.message || String(error);
        }
        if (!uploaded && attempt < 3) await sleep(attempt * 1500);
      }
      if (!uploaded) throw new Error(`TikTok chunk upload failed: ${lastError || 'unknown error'}`);
      start = endExclusive;
    }
    if (start !== fileSize) throw new Error('TikTok upload did not cover the complete file');
  } finally {
    await file.close();
  }
}

async function pollTikTok(client, environment, publishId, timeoutMs = 12 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await client.json('/api/social/tiktok/publish/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment, publishId }),
    });
    const status = tiktokStatusName(payload);
    if (['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'].includes(status)) return payload;
    if (['FAILED', 'PUBLISH_FAILED'].includes(status)) {
      throw new Error(`TikTok publishing failed: ${payload?.status?.fail_reason || status}`);
    }
    await sleep(10_000);
  }
  throw new Error('TikTok publishing did not finish within 12 minutes');
}

async function publishTikTok({ client, filePath, fileSize, mimeType, caption, idempotencyKey, environment, wait, isAigc }) {
  const connection = await client.json(`/api/social/tiktok/status?environment=${encodeURIComponent(environment)}`);
  if (!connection.configured || !connection.connected) throw new Error(`TikTok ${environment} is not connected`);

  const initialized = await client.json('/api/social/tiktok/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'FILE_UPLOAD',
      videoSize: fileSize,
      mediaType: mimeType,
      caption,
      idempotencyKey,
      environment,
      privacyLevel: environment === 'sandbox' ? 'SELF_ONLY' : 'PUBLIC_TO_EVERYONE',
      isAigc,
      consent: true,
    }),
  });

  let shouldUpload = true;
  if (initialized.replayed) {
    try {
      const current = await client.json('/api/social/tiktok/publish/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ environment, publishId: initialized.publishId }),
      });
      shouldUpload = ['PROCESSING_UPLOAD', ''].includes(tiktokStatusName(current));
      if (!shouldUpload && !wait) return { publishId: initialized.publishId, status: tiktokStatusName(current) };
    } catch {
      shouldUpload = true;
    }
  }
  if (shouldUpload) {
    await uploadTikTokChunks(
      initialized.uploadUrl,
      filePath,
      mimeType,
      fileSize,
      initialized.chunkSize,
      initialized.totalChunkCount,
    );
  }
  if (!wait) return { publishId: initialized.publishId, status: 'UPLOADED' };
  const completed = await pollTikTok(client, environment, initialized.publishId);
  return { publishId: initialized.publishId, status: tiktokStatusName(completed), privacyLevel: initialized.privacyLevel };
}

async function pollInstagram(client, idempotencyKey, timeoutMs = 10 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await client.json(`/api/social/instagram/publish/status?idempotencyKey=${encodeURIComponent(idempotencyKey)}`);
    const status = String(payload?.status?.status_code || '').trim().toUpperCase();
    if (status === 'FINISHED') return payload;
    if (['ERROR', 'EXPIRED'].includes(status)) {
      throw new Error(`Instagram Reel processing failed: ${payload?.status?.status || status}`);
    }
    await sleep(5_000);
  }
  throw new Error('Instagram Reel processing did not finish within 10 minutes');
}

async function publishInstagram({ client, filePath, mimeType, caption, idempotencyKey, wait }) {
  const connection = await client.json('/api/social/instagram/status');
  if (!connection.configured || !connection.connected) throw new Error('Instagram is not connected');

  try {
    const existing = await client.json(`/api/social/instagram/publish/status?idempotencyKey=${encodeURIComponent(idempotencyKey)}`);
    const existingStatus = String(existing?.status?.status_code || '').trim().toUpperCase();
    if (existing.mediaId || existingStatus === 'PUBLISHED') {
      return { containerId: existing.containerId, mediaId: existing.mediaId, status: 'PUBLISHED', replayed: true };
    }
    if (['ERROR', 'EXPIRED'].includes(existingStatus)) {
      throw new Error(`Instagram Reel processing failed: ${existing?.status?.status || existingStatus}`);
    }
    if (!wait) return { containerId: existing.containerId, status: 'IN_PROGRESS', replayed: true };
    await pollInstagram(client, idempotencyKey);
    const completed = await client.json('/api/social/instagram/publish/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey, consent: true }),
    });
    return {
      containerId: completed.containerId,
      mediaId: completed.mediaId,
      status: 'PUBLISHED',
      replayed: true,
    };
  } catch (error) {
    if (error?.status !== 404) throw error;
  }

  const media = await client.uploadMedia(filePath, mimeType);
  const initialized = await client.json('/api/social/instagram/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      videoUrl: media.mediaUrl,
      caption,
      idempotencyKey,
      shareToFeed: true,
      consent: true,
    }),
  });
  if (!wait) return { containerId: initialized.containerId, status: 'IN_PROGRESS' };
  await pollInstagram(client, idempotencyKey);
  const completed = await client.json('/api/social/instagram/publish/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, consent: true }),
  });
  return { containerId: completed.containerId, mediaId: completed.mediaId, status: 'PUBLISHED' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const platforms = selectedPlatforms(args.platform);
  const publishToken = resolvePublishToken();
  if (!publishToken) throw new Error(`SOCIAL_PUBLISH_TOKEN is missing and Keychain service ${KEYCHAIN_SERVICE} was not found`);
  const workerBase = args.worker || process.env.SOCIAL_API_BASE || DEFAULT_WORKER_BASE;
  const client = apiClient(workerBase, publishToken);
  const environment = String(args.environment || 'production').trim().toLowerCase();
  if (!['production', 'sandbox'].includes(environment)) throw new Error('--environment must be production or sandbox');
  if (platforms.includes('tiktok') && environment === 'production' && !args['dry-run']) {
    throw new Error('TikTok production Direct Post is disabled until a compliant per-post review UX is approved; use sandbox or prepare the file for TikTok Studio');
  }

  if (args['dry-run']) {
    const checks = {};
    if (platforms.includes('tiktok')) checks.tiktok = await client.json(`/api/social/tiktok/status?environment=${environment}`);
    if (platforms.includes('instagram')) checks.instagram = await client.json('/api/social/instagram/status');
    console.log(JSON.stringify({ ok: true, dryRun: true, checks }, null, 2));
    return;
  }

  if (!args.consent) throw new Error('Pass --consent to confirm this individual post was reviewed and expressly approved');
  const filePath = path.resolve(String(args.video || ''));
  const sharedCaption = String(args.caption || '').trim();
  const captions = {
    tiktok: String(args['tiktok-caption'] || sharedCaption).trim(),
    instagram: String(args['instagram-caption'] || sharedCaption).trim(),
  };
  for (const platform of platforms) {
    if (!captions[platform] || captions[platform].length > 2200) {
      throw new Error(`--${platform}-caption or --caption is required and must be at most 2200 characters`);
    }
  }
  const mimeType = mimeTypeForVideo(filePath);
  if (!mimeType) throw new Error('--video must be an MP4, MOV, or WebM file');
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size < 1) throw new Error('--video must point to a non-empty file');
  const metadata = inspectVideo(filePath);
  if (platforms.includes('tiktok')) validateTikTokVideo(metadata, mimeType, fileStat.size);
  if (platforms.includes('instagram')) validateInstagramVideo(metadata, mimeType, fileStat.size);

  const captionFingerprint = platforms.map((platform) => `${platform}:${captions[platform]}`).join('\n');
  const idempotencyBase = makeIdempotencyBase(args.idempotency, captionFingerprint);
  const wait = !args['no-wait'];
  const results = {};
  const failures = {};
  for (const platform of platforms) {
    try {
      if (platform === 'tiktok') {
        results.tiktok = await publishTikTok({
          client,
          filePath,
          fileSize: fileStat.size,
          mimeType,
          caption: captions.tiktok,
          idempotencyKey: `tiktok:${idempotencyBase}`,
          environment,
          wait,
          isAigc: !args['not-aigc'],
        });
      } else {
        results.instagram = await publishInstagram({
          client,
          filePath,
          mimeType,
          caption: captions.instagram,
          idempotencyKey: `instagram:${idempotencyBase}`,
          wait,
        });
      }
    } catch (error) {
      failures[platform] = error?.message || String(error);
    }
  }

  const output = { ok: Object.keys(failures).length === 0, results, failures };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
