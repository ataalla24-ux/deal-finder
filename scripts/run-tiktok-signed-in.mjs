import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { buildDealFromPost, buildTikTokApiKeywords } from '../scraper/tiktok-deals-scanner.js';
import { collectTikTokBrowserEvidence } from '../scraper/tiktok-signed-in-browser.js';

const workDir = path.join(os.homedir(), 'Library', 'Application Support', 'FreeFinder TikTok');
const profileDir = path.join(workDir, 'Browser');
const stateFile = path.join(workDir, 'run-state.json');
const pendingFile = path.join(workDir, 'pending-posts.json');
const githubRepository = 'ataalla24-ux/deal-finder';
const workflow = 'tiktok-deals.yml';
const apiPrefix = `repos/${githubRepository}/actions`;
const maxPayloadBytes = 55_000;
const maxCaptionChars = 1_800;
const postPattern = /^https:\/\/www\.tiktok\.com\/@([\w.-]{1,40})\/video\/\d{16,22}$/;
const ghCommand = process.env.FREEFINDER_GH_CLI || 'gh';

function checkDirectory(directory, create = false) {
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw new Error('local-profile-permissions');
  }
}

function readJson(file, missing) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return missing;
    throw error;
  }
}

function writeLocalJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function githubApi(endpoint, input) {
  const args = ['api', '--hostname', 'github.com', '-H', 'X-GitHub-Api-Version: 2026-03-10', endpoint];
  if (input) args.push('--method', 'POST', '--input', '-');
  const result = spawnSync(ghCommand, args, {
    input: input ? JSON.stringify(input) : undefined,
    encoding: 'utf8', timeout: 30_000, maxBuffer: 256_000, stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (result.status !== 0) throw new Error('github-request-failed');
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('github-receipt-unavailable');
  }
}

function publicOfferPosts(posts, now) {
  const offers = [];
  const seen = new Set();
  for (const post of posts) {
    const account = postPattern.exec(post.url)?.[1];
    const date = new Date(post.createTime);
    if (!account || !post.createTime || Number.isNaN(date.valueOf()) || seen.has(post.url)
        || typeof post.caption !== 'string' || !post.caption.trim() || post.caption.length > maxCaptionChars) continue;
    const { deal } = buildDealFromPost(post.url, {
      accountHandle: account, description: post.caption, timeDateTime: date.toISOString(),
    }, { now });
    if (!deal) continue;
    const candidate = { url: post.url, caption: post.caption, createTime: Math.floor(date.valueOf() / 1000) };
    if (Buffer.byteLength(JSON.stringify({ version: 1, posts: [...offers, candidate] })) > maxPayloadBytes) continue;
    offers.push(candidate);
    seen.add(post.url);
  }
  return offers;
}

function selectedKeywords(now, mode, cursor) {
  const month = new Intl.DateTimeFormat('de-AT', {
    month: 'long', year: 'numeric', timeZone: 'Europe/Vienna',
  }).format(now).toLowerCase();
  const openingQuery = `wien neueröffnung gratis ${month}`;
  if (mode === 'probe') return [openingQuery];
  const rotating = buildTikTokApiKeywords(now).filter(word => word !== openingQuery);
  const offset = (Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0) % rotating.length;
  const terms = [...rotating.slice(offset), ...rotating.slice(0, offset)].slice(0, 4);
  return [openingQuery, ...terms];
}

function deliveryStatus() {
  const pending = readJson(pendingFile, null);
  if (!pending) return null;
  if (pending.runId) {
    const run = githubApi(`${apiPrefix}/runs/${pending.runId}`);
    if (run.status !== 'completed') return { status: 'github-pending', runId: pending.runId };
    if (run.conclusion === 'success') {
      fs.unlinkSync(pendingFile);
      return null;
    }
  }
  const encoded = JSON.stringify(pending.batch);
  if (Buffer.byteLength(encoded) > maxPayloadBytes) throw new Error('public-batch-too-large');
  const response = githubApi(`${apiPrefix}/workflows/${workflow}/dispatches`, {
    ref: 'main', inputs: { browsed_posts: encoded },
  });
  const runId = response.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('github-receipt-unavailable');
  writeLocalJson(pendingFile, { batch: pending.batch, runId });
  return { status: 'github-queued', runId };
}

async function openProfile() {
  return chromium.launchPersistentContext(profileDir, {
    headless: false, locale: 'de-AT', timezoneId: 'Europe/Vienna',
    serviceWorkers: 'block', acceptDownloads: false,
  });
}

async function run() {
  const mode = process.argv[2];
  if (!['login', 'preflight', 'probe', 'run'].includes(mode) || process.argv.length !== 3) {
    throw new Error('use-login-preflight-probe-or-run');
  }
  process.umask(0o077);
  checkDirectory(workDir, mode === 'login');
  checkDirectory(profileDir, mode === 'login');

  if (mode === 'preflight') {
    const browserInstalled = fs.existsSync(chromium.executablePath());
    const active = githubApi(`${apiPrefix}/workflows/${workflow}`).state === 'active';
    const githubWriteAuthenticated = githubApi(`repos/${githubRepository}`).permissions?.push === true;
    if (!browserInstalled || !active || !githubWriteAuthenticated) throw new Error('local-runner-preflight-failed');
    console.log(JSON.stringify({ status: 'preflight-ok', browserInstalled, active, githubWriteAuthenticated }));
    return;
  }
  if (mode === 'login') {
    const context = await openProfile();
    try {
      const closed = new Promise(resolve => context.once('close', resolve));
      const page = context.pages()[0] || await context.newPage();
      await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      console.log('TikTok-Anmeldung im lokalen FreeFinder-Profil geöffnet.');
      await closed;
    } finally {
      await context.close().catch(() => {});
    }
    return;
  }

  if (mode === 'run') {
    const delivery = deliveryStatus();
    if (delivery) {
      console.log(JSON.stringify(delivery));
      return;
    }
  }
  const state = readJson(stateFile, {});
  const now = new Date();
  if (Date.parse(state.nextRetryAt) > +now) {
    console.log(JSON.stringify({ status: 'browser-cooldown', nextRetryAt: state.nextRetryAt }));
    return;
  }
  const keywords = selectedKeywords(now, mode, state.cursor);
  const context = await openProfile();
  let result;
  try {
    const page = context.pages()[0] || await context.newPage();
    result = await collectTikTokBrowserEvidence(page, {
      keywords, maxQueries: keywords.length, maxPosts: mode === 'probe' ? 3 : 16, nextRetryAt: state.nextRetryAt,
    });
  } finally {
    await context.close();
  }

  const offers = publicOfferPosts(result.posts, now);
  const summary = {
    status: result.stop?.reason || 'completed',
    checkedAt: now.toISOString(), queryCount: result.queryCount, videoCount: result.videoCount,
    publicPosts: result.posts.length, offerPosts: offers.length,
    nextRetryAt: result.stop?.nextRetryAt || '',
  };
  if (mode === 'run' && offers.length) {
    writeLocalJson(pendingFile, { batch: { version: 1, posts: offers } });
  }
  writeLocalJson(stateFile, {
    ...summary,
    cursor: mode === 'run' && result.queryCount > 0 ? (state.cursor || 0) + keywords.length - 1 : state.cursor || 0,
  });
  console.log(JSON.stringify(summary));
  if (mode !== 'run' || !offers.length) return;

  console.log(JSON.stringify(deliveryStatus()));
}

run().catch(error => {
  // Browser or CLI errors can contain full URLs, credentials or local paths.
  const reason = /^[a-z]+(?:-[a-z]+)+$/.test(error?.message) ? error.message : 'local-runner-failed';
  console.error(JSON.stringify({ status: 'error', reason }));
  process.exitCode = 1;
});
