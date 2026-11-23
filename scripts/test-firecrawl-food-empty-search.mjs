import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] === '--replay') {
  const scenario = process.argv[3];
  // 23 November selects #fooddealsvienna with one slot; 24 November selects #happyhourwien.
  const now = scenario === 'other-hashtag' ? '2026-11-24T12:00:00Z' : '2026-11-23T12:00:00Z';
  mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const server = createServer((request, response) => {
    function reply(data, status = 200) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    }
    console.log('Replay request', request.url);
    switch (request.url) {
      case '/v2/search':
        if (scenario === 'denied') return reply({ success: false, error: 'Unauthorized' }, 401);
        if (scenario === 'credits') return reply({ success: false, error: 'Payment required' }, 402);
        if (scenario === 'missing-results') return reply({ success: true, data: {} });
        if (scenario === 'search-hit') return reply({ success: true, data: { web: [{
          title: 'Gratis Kaffee in Wien', description: 'Gratis Kaffee im Lokal für Gäste.',
          url: 'https://www.instagram.com/p/FixtureCoffee/',
        }] } });
        return reply({ success: true, data: { web: [] } });
      case '/v2/agent':
        return reply({ success: true, id: 'fixture-agent' });
      case '/v2/agent/fixture-agent':
        return reply({ success: true, status: 'completed', data: { offers: [] } });
      default:
        throw new Error(`Unerwartete Anfrage: ${request.url}`);
    }
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  process.env.FIRECRAWL_API_URL = `http://127.0.0.1:${server.address().port}`;
  await import(pathToFileURL(join(process.cwd(), 'scraper/firecrawl-food3.js')).href);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'food-slot-replay-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  cpSync(join(root, 'scraper'), join(dir, 'scraper'), { recursive: true });
  for (const name of ['sentry', 'node_modules', 'package.json']) {
    symlinkSync(join(root, name), join(dir, name));
  }
  mkdirSync(join(dir, 'docs'));
  function replay(scenario, agentCalls) {
    const log = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--replay', scenario], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH, FIRECRAWL_API_KEY2: 'offline-fixture',
        FIRECRAWL2_TARGETS_PER_RUN: '1',
        FIRECRAWL_POST_VERIFY_MAX: '0', SENTRY_DISABLED: '1',
      },
    });
    assert.equal(log.match(/Replay request \/v2\/search\n/g)?.length, 1, log);
    assert.equal(log.match(/Replay request \/v2\/agent\n/g)?.length || 0, agentCalls);
    return JSON.parse(readFileSync(join(dir, 'docs/deal-pipeline-last-run-food3.json'), 'utf8'));
  }
  try {
    // Scheduled run 45156570046 recorded 0 concrete search hits, then an agent timeout.
    const empty = replay('empty', 0);
    assert.equal(empty.diagnostics.sourceStats[0].status, 'completed-search-empty');
    assert.equal(empty.diagnostics.completedSources, 1);
    assert.equal(empty.counts.rawCandidates, 0);
    assert.equal(empty.status, 'completed');
    const hit = replay('search-hit', 0);
    assert.equal(hit.diagnostics.sourceStats[0].status, 'completed-search');
    assert.equal(hit.counts.rawCandidates, 1);
    for (const reason of ['denied', 'credits']) {
      const failed = replay(reason, 0);
      assert.equal(failed.diagnostics.sourceStats[0].status, 'failed');
      assert.equal(failed.status, 'completed-with-errors');
    }
    const malformed = replay('missing-results', 1);
    assert.match(malformed.diagnostics.sourceStats[0].searchError, /Web-Ergebnisliste/);
    assert.equal(malformed.status, 'completed-with-errors');
    const other = replay('other-hashtag', 1);
    assert.match(other.diagnostics.sourceStats[0].url, /happyhourwien/);
    assert.equal(other.diagnostics.sourceStats[0].status, 'completed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('Firecrawl Food #2 empty-search replay passed.');
}
