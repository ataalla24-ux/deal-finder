#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { dealBlocks } from './slack-live-deal-review.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MARKER = 'FreeFinder Live-Liste';
const STATE_FILE = 'reviews/slack-live-deal-list-state.json';
const REPORT_FILE = 'reviews/slack-live-deal-list-report.json';
const PUBLIC_FILES = ['deals.json', 'deal-of-the-day.json', 'deal-of-the-week.json'];
const text = (value, max = 800) => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeFallback = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escape = value => escapeFallback(text(value, 450)).replace(/\|/g, '/');
const validTs = value => /^\d{10,}\.\d{6}$/.test(value || '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateSnapshot(documents) {
  const feed = documents['deals.json'];
  assert.ok(Array.isArray(feed?.deals), 'Public feed missing deals');
  assert.equal(feed.totalDeals, feed.deals.length, 'Public feed count mismatch');
  assert.ok(feed.deals.length <= 1000, 'Unexpected feed size; review Slack index capacity');
  const ids = new Set();
  for (const deal of feed.deals) {
    assert.ok(typeof deal.id === 'string' && deal.id.length > 0 && deal.id.length <= 250, 'Invalid deal ID');
    assert.ok(!['__proto__', 'constructor', 'prototype'].includes(deal.id), 'Unsafe deal ID');
    assert.ok(!ids.has(deal.id), 'Duplicate public deal ID');
    assert.ok(text(deal.title), 'Public deal missing title');
    ids.add(deal.id);
  }
  for (const name of PUBLIC_FILES.slice(1)) {
    const pick = documents[name];
    if (!pick?.dealId) continue;
    const deal = feed.deals.find(row => row.id === pick.dealId);
    assert.ok(deal, 'Featured selection missing from public feed');
    for (const field of ['title', 'brand', 'description', 'type', 'url']) {
      assert.deepEqual(pick[field], deal[field], 'Featured copy is not yet synchronized: ' + field);
    }
  }
  return { feed, daily: documents[PUBLIC_FILES[1]], weekly: documents[PUBLIC_FILES[2]], digest: hash(documents) };
}

export async function publishedSnapshot({ root = ROOT, fetcher = fetch, wait = sleep, attempts = 7 } = {}) {
  const expected = Object.fromEntries(PUBLIC_FILES.map(name => [name, JSON.parse(fs.readFileSync(path.join(root, 'docs', name), 'utf8'))]));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const documents = {};
    for (const name of PUBLIC_FILES) {
      const response = await fetcher('https://freefinder.at/' + name, {
        redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('Public ' + name + ' HTTP ' + response.status);
      documents[name] = await response.json();
    }
    // A queued Pages deployment is not an online change, and mixed generations
    // must never make the catalogue falsely archive or feature a deal.
    if (PUBLIC_FILES.every(name => isDeepStrictEqual(documents[name], expected[name]))) return validateSnapshot(documents);
    if (attempt + 1 < attempts) await wait(10000);
  }
  return null;
}

export function loadListState(file) {
  if (!fs.existsSync(file)) return { version: 1, entries: {} };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.version, 1, 'Unsupported Slack list state');
  assert.ok(state.entries && typeof state.entries === 'object' && !Array.isArray(state.entries), 'Invalid Slack list entries');
  assert.ok(validTs(state.rootTs) || (!state.rootTs && Object.keys(state.entries).length === 0), 'Existing list has invalid root timestamp; do not create a duplicate');
  for (const entry of Object.values(state.entries)) assert.ok(validTs(entry.ts), 'Invalid existing card timestamp');
  return state;
}

function messageLink(state, ts) {
  const url = new URL('/archives/' + state.channel + '/p' + ts.replace('.', ''), state.workspaceUrl);
  if (ts !== state.rootTs) {
    url.searchParams.set('thread_ts', state.rootTs);
    url.searchParams.set('cid', state.channel);
  }
  return url.href;
}

export function liveCard(deal, snapshot, now = new Date()) {
  const badges = ['Online'];
  if (snapshot.daily?.dealId === deal.id) badges.push('Tagesdeal-Auswahl');
  if (snapshot.weekly?.dealId === deal.id) badges.push('Wochendeal-Auswahl');
  const expiry = Date.parse(deal.expires || deal.validUntil || '');
  if (Number.isFinite(expiry) && expiry < now.getTime()) badges.push('G\u00fcltigkeit pr\u00fcfen');
  const period = text(deal.expiryDisplayText || deal.validUntil || deal.expires || 'Nicht eindeutig angegeben', 240);
  const formattedPeriod = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(period) && Number.isFinite(Date.parse(period))
    ? 'bis ' + new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'medium' }).format(new Date(period)) : period;
  const details = [MARKER, 'Anbieter: ' + text(deal.brand, 180), 'Angebot: ' + text(deal.title, 500),
    'Status: ' + badges.join(' | '),
    'Ort: ' + text(deal.address || deal.distance || deal.location || 'Nicht angegeben', 300),
    'Zeitraum: ' + formattedPeriod,
    deal.description ? 'Details: ' + text(deal.description, 850) : '', 'Deal-ID: ' + deal.id].filter(Boolean).join('\n');
  const actions = dealBlocks(deal, 0).find(block => block.type === 'actions');
  assert.ok(actions, 'Existing live-deal actions unavailable');
  const elements = actions.elements.map(element => element.action_id === 'freefinder_remove_deal'
    ? { ...element, text: { type: 'plain_text', text: 'Ausblenden' } } : element);
  return { text: escapeFallback(details), blocks: [
    { type: 'section', text: { type: 'plain_text', text: details } },
    { type: 'actions', elements },
  ] };
}

function offlineCard(id, entry) {
  const body = [MARKER, 'Nicht mehr online', text(entry.brand, 180), text(entry.title, 500),
    'Dieses Angebot ist nicht mehr im ver\u00f6ffentlichten Feed. Keine neue Freigabe oder Wiederherstellung durch diese Liste.', 'Deal-ID: ' + id].join('\n');
  return { text: escapeFallback(body), blocks: [{ type: 'section', text: { type: 'plain_text', text: body } }] };
}

export function listHeader(state, snapshot, now) {
  const deals = [...snapshot.feed.deals].sort((a, b) => text(a.brand).localeCompare(text(b.brand), 'de') || text(a.title).localeCompare(text(b.title), 'de') || a.id.localeCompare(b.id));
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: MARKER } },
    { type: 'section', text: { type: 'plain_text', text: [MARKER,
      deals.length + ' Angebote im ver\u00f6ffentlichten Feed. Hier einen Eintrag \u00f6ffnen und direkt bearbeiten.',
      'Letzte Listenaktualisierung: ' + new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'medium', timeStyle: 'short' }).format(now),
      'Neue Einsendungen und deren Freigaben bleiben getrennt. Entfernte Angebote sind nicht mehr in dieser \u00dcbersicht verlinkt.'].join('\n') } },
  ];
  let group = '';
  for (const deal of deals) {
    const entry = state.entries[deal.id];
    assert.ok(entry?.ts, 'No Slack card for live deal');
    const line = '<' + messageLink(state, entry.ts) + '|' + escape(deal.brand) + ' | ' + escape(deal.title) + '>\n';
    if (group.length + line.length > 2800) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: group.trim() } });
      group = '';
    }
    group += line;
  }
  if (group) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: group.trim() } });
  assert.ok(blocks.length <= 50, 'Slack index exceeds block limit; no partial index published');
  return { text: MARKER + ': ' + deals.length + ' aktuelle Angebote', blocks };
}

export async function syncLiveList({ snapshot, state, channel, api, save = () => {}, now = new Date() }) {
  assert.ok(/^[CG][A-Z0-9]+$/.test(channel), 'Invalid configured Slack channel');
  assert.ok(!state.channel || state.channel === channel, 'List belongs to another channel; refusing duplicate');
  assert.ok(!state.pendingPost, 'A previous Slack post has an ambiguous result; reconcile its client message ID before retrying');
  const identity = await api('auth.test', {});
  assert.ok(identity.team_id && identity.user_id, 'Slack identity unavailable');
  assert.ok(!state.botUser || state.botUser === identity.user_id, 'Only the original bot may update this list');
  assert.ok(!state.team || state.team === identity.team_id, 'Slack workspace changed');
  const workspace = new URL(identity.url);
  assert.ok(workspace.protocol === 'https:' && /^[a-z0-9-]+\.slack\.com$/.test(workspace.hostname), 'Unexpected Slack workspace URL');
  state.channel = channel;
  state.team = identity.team_id;
  state.botUser = identity.user_id;
  state.workspaceUrl = workspace.origin;
  const previewState = { ...state, rootTs: state.rootTs || '1000000000.000001', entries: Object.fromEntries(
    snapshot.feed.deals.map(deal => [deal.id, { ts: state.entries[deal.id]?.ts || '1000000000.000002' }])) };
  listHeader(previewState, snapshot, now);
  const counts = { created: 0, updated: 0, archived: 0, unchanged: 0 };
  const post = async (key, payload, accept) => {
    const digest = createHash('sha256').update(channel + ':' + key).digest('hex');
    const clientId = [digest.slice(0, 8), digest.slice(8, 12), '4' + digest.slice(13, 16), 'a' + digest.slice(17, 20), digest.slice(20, 32)].join('-');
    state.pendingPost = { key, clientMsgId: clientId, startedAt: now.toISOString() };
    save(state);
    let response;
    try {
      response = await api('chat.postMessage', { channel, ...payload, client_msg_id: clientId, unfurl_links: false, unfurl_media: false, parse: 'none' });
    } catch (error) {
      if (error.definitelyRejected) { delete state.pendingPost; save(state); }
      throw error;
    }
    assert.ok(validTs(response.ts), 'Slack accepted a post without a valid timestamp; reconcile before retry');
    accept(response.ts);
    delete state.pendingPost;
    save(state);
  };
  if (!state.rootTs) {
    await post('root-v1', { text: MARKER + ': wird eingerichtet', blocks: [{ type: 'section', text: {
      type: 'plain_text', text: MARKER + '\nDie erstmalige Synchronisierung l\u00e4uft. Die vollst\u00e4ndige \u00dcbersicht erscheint nach erfolgreichem Abgleich.' } }] }, ts => { state.rootTs = ts; });
  }
  const liveIds = new Set(snapshot.feed.deals.map(deal => deal.id));
  for (const deal of snapshot.feed.deals) {
    const card = liveCard(deal, snapshot, now);
    const cardHash = hash(card);
    const previous = state.entries[deal.id];
    if (previous?.hash === cardHash && previous.status === 'live') { counts.unchanged++; continue; }
    let ts = previous?.ts;
    if (ts) {
      await api('chat.update', { channel, ts, ...card, parse: 'none' });
      counts.updated++;
    } else {
      await post('deal:' + state.rootTs + ':' + deal.id, { ...card, thread_ts: state.rootTs }, result => {
        ts = result;
        state.entries[deal.id] = { ts, hash: cardHash, status: 'live', brand: text(deal.brand, 180), title: text(deal.title, 500) };
      });
      counts.created++;
    }
    state.entries[deal.id] = { ts, hash: cardHash, status: 'live', brand: text(deal.brand, 180), title: text(deal.title, 500) };
    save(state);
  }
  for (const [id, entry] of Object.entries(state.entries)) {
    if (liveIds.has(id) || entry.status === 'offline') continue;
    const card = offlineCard(id, entry);
    await api('chat.update', { channel, ts: entry.ts, ...card, parse: 'none' });
    state.entries[id] = { ...entry, status: 'offline', hash: hash(card) };
    counts.archived++;
    save(state);
  }
  const changed = counts.created + counts.updated + counts.archived > 0 || state.snapshotHash !== snapshot.digest;
  if (changed) {
    const header = listHeader(state, snapshot, now);
    await api('chat.update', { channel, ts: state.rootTs, ...header, parse: 'none' });
    state.snapshotHash = snapshot.digest;
    state.publicFeedVersion = snapshot.feed.feedVersion;
    state.lastSyncedAt = now.toISOString();
    save(state);
  }
  if (!state.pin) {
    try {
      await api('pins.add', { channel, timestamp: state.rootTs });
      state.pin = { status: 'pinned' };
    } catch (error) {
      if (error.code === 'already_pinned') state.pin = { status: 'pinned' };
      else if (['missing_scope', 'not_allowed_token_type', 'restricted_action'].includes(error.code)) state.pin = { status: 'manual-pin-needed', reason: error.code };
      else throw error;
    }
    save(state);
  }
  return { status: 'synchronized', ...counts, liveCount: liveIds.size, rootTs: state.rootTs,
    channel, url: messageLink(state, state.rootTs), pin: state.pin, publicFeedVersion: snapshot.feed.feedVersion,
    publicSnapshotHash: snapshot.digest, lastSyncedAt: state.lastSyncedAt };
}

export function slackClient({ token, fetcher = fetch, wait = sleep, spacingMs = 1100 } = {}) {
  assert.ok(token, 'SLACK_BOT_TOKEN missing');
  let lastRequest = 0;
  return async (method, body) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = spacingMs - (Date.now() - lastRequest);
      if (delay > 0) await wait(delay);
      lastRequest = Date.now();
      const response = await fetcher('https://slack.com/api/' + method, { method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(25000) });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        if (attempt < 2 && Number.isFinite(seconds) && seconds > 0 && seconds <= 120) { await wait(seconds * 1000); continue; }
        const error = new Error('Slack rate limit; bounded retry exhausted');
        Object.assign(error, { code: 'ratelimited', definitelyRejected: true });
        throw error;
      }
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        const error = new Error('Slack ' + method + ': ' + text(result.error || 'HTTP ' + response.status, 100));
        Object.assign(error, { code: result.error, definitelyRejected: response.status < 500 });
        throw error;
      }
      return result;
    }
  };
}

async function main() {
  const stateFile = path.join(ROOT, STATE_FILE);
  const reportFile = path.join(ROOT, REPORT_FILE);
  const save = state => {
    const serialized = JSON.stringify(state, null, 2) + '\n';
    if (fs.existsSync(stateFile) && fs.readFileSync(stateFile, 'utf8') === serialized) return;
    fs.writeFileSync(stateFile, serialized);
  };
  try {
    const snapshot = await publishedSnapshot();
    if (!snapshot) { console.log('Slack live list unchanged: waiting for matching public feed and featured selections.'); return; }
    const state = loadListState(stateFile);
    const result = await syncLiveList({ snapshot, state, channel: process.env.SLACK_CHANNEL_ID,
      api: slackClient({ token: process.env.SLACK_BOT_TOKEN }), save });
    const report = { ...result, checkedAt: new Date().toISOString(), source: 'https://freefinder.at/deals.json' };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Slack Live-Deal-Liste\n[Liste oeffnen](${result.url})\n\n${result.liveCount} live; ${result.created} neu, ${result.updated} aktualisiert, ${result.archived} offline, ${result.unchanged} unveraendert.\nPin: ${result.pin.status}\n`);
  } catch (error) {
    // The state checkpoints are retained even after partial failures. Never
    // silently recreate a possibly accepted post or a missing existing card.
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
