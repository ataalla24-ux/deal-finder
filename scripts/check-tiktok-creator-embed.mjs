import fs from 'node:fs';
import { chromium } from 'playwright';
import { githubRunProvenance } from '../scraper/pipeline-run-report-utils.js';
import { discoverPublicTikTokCreatorLinks, visibleTikTokAccessStop, watchPublicTikTokRefusals } from '../scraper/tiktok-creator-embed.js';
import { readPublicTikTokOriginal } from '../scraper/tiktok-signed-in-browser.js';

const previous = JSON.parse(fs.readFileSync('docs/tiktok-scanner-report.json', 'utf8'));
const api = previous.apiDiscovery;
const failure = api?.lastFailure;
const searchOnlyFailure = failure?.code === 'provider-error' && failure?.status === 200
  && failure?.providerSignal === 'unclassified' && failure?.retryAfterProvided === false;
const pauses = [previous.searchDiscovery?.postVisitStop?.retryAt, api?.postVisitStop?.retryAt];
if (!searchOnlyFailure || api?.lastSearchResponse?.retryAfterProvided === true) pauses.push(api?.nextRetryAt);
const retryMs = Math.max(0, ...pauses.map(time => Date.parse(time) || 0));
const nextRetryAt = retryMs > Date.now() ? new Date(retryMs).toISOString() : '';
const report = { checkedAt: new Date().toISOString(), provenance: githubRunProvenance(), profiles: [], originals: [], stop: null };

async function inspectOriginal(context, url) {
  const page = await context.newPage();
  const monitor = watchPublicTikTokRefusals(page);
  const evidence = { url, status: null, exactPage: false, caption: null, captionLength: 0, createTime: null, stop: null };
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    evidence.status = response?.status() ?? null;
    evidence.stop = monitor.current();
    if (!response?.ok() || evidence.stop) return evidence;
    const deadline = Date.now() + 6000;
    do {
      evidence.stop = monitor.current() || await visibleTikTokAccessStop(page);
      if (evidence.stop) return evidence;
      const actual = new URL(page.url());
      evidence.exactPage = !actual.username && !actual.password && actual.origin + actual.pathname.replace(/\/$/, '') === url;
      if (!evidence.exactPage) return evidence;
      const original = await readPublicTikTokOriginal(page, url);
      if (original && !monitor.current()) return { ...evidence, caption: original.caption.slice(0, 140),
        captionLength: original.caption.length, createTime: original.createTime };
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return evidence;
  } catch { return { ...evidence, stop: monitor.current() || { reason: 'original-read-unavailable' } }; }
  finally { monitor.close(); await page.close(); }
}

if (nextRetryAt) report.stop = { reason: 'cooldown', nextRetryAt };
else {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'de-AT', timezoneId: 'Europe/Vienna' });
    // Two independent creator profiles, three original documents across the entire comparison.
    for (const handle of ['eatinvienna', 'dahabdoener']) {
      const page = await context.newPage();
      let profile;
      try { profile = await discoverPublicTikTokCreatorLinks(page, handle); }
      finally { await page.close(); }
      report.profiles.push(profile);
      report.stop = profile.stop;
      if (report.stop || !profile.links.length) break;
      const limit = handle === 'eatinvienna' ? 2 : 1;
      for (const url of profile.links.slice(0, limit)) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const evidence = await inspectOriginal(context, url);
        report.originals.push(evidence);
        if (evidence.stop) { report.stop = evidence.stop; break; }
      }
      if (report.stop) break;
    }
  } finally { await browser.close(); }
}
report.counts = {
  profiles: report.profiles.length, visibleLinks: report.profiles.reduce((n, p) => n + p.links.length, 0),
  visitedOriginals: report.originals.length, originalCaptions: report.originals.filter(p => p.caption).length,
  originalDates: report.originals.filter(p => p.createTime).length,
};
fs.mkdirSync('output/social-discovery', { recursive: true });
fs.writeFileSync('output/social-discovery/creator-embed.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ counts: report.counts, stop: report.stop }));
