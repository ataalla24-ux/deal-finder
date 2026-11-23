import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {POWER_FOOD_SOURCES} from '../scraper/power-food-sources.js';
import {discoverFoodLinks} from '../scraper/power-food-extraction.js';
import {crawlFoodSource} from '../scraper/power-food-crawler.js';

const source = POWER_FOOD_SOURCES.find(row => row.name === 'Cuadro');
const detail = 'https://www.cuadro.at/angebote-aktuelles/';
const home = fs.readFileSync(new URL('./fixtures/power-cuadro-home.html', import.meta.url), 'utf8');
const offers = fs.readFileSync(new URL('./fixtures/power-cuadro-offers.html', import.meta.url), 'utf8');
const now = new Date('2026-11-23T12:32:00Z');

test('actual Cuadro navigation discovers its same-merchant canonical offers page', () => {
  assert.deepEqual(discoverFoodLinks(home, source), [detail]);
  const unrelated = home + '<a href="https://www.cuadro.at.evil.test/angebote-aktuelles/">Foreign</a>' +
    '<a href="https://other.test/angebote-aktuelles/">Other</a>' +
    '<a href="http://www.cuadro.at/angebote-aktuelles/">Insecure</a>' +
    '<a href="https://www.cuadro.at/essen-trinken/speisen/">Ordinary menu</a>';
  assert.deepEqual(discoverFoodLinks(unrelated, source), [detail]);
});

test('existing crawler visits the real current offers page without inventing a deal', async () => {
  const requests = [];
  const result = await crawlFoodSource(source, {now, maxPages: 5, fetchPage: async url => {
    requests.push(url);
    assert.ok([source.url, detail].includes(url));
    return {html: url === source.url ? home : offers, finalUrl: url, status: 200};
  }});
  assert.deepEqual(requests, [source.url, detail]);
  assert.equal(result.operationalStatus, 'no-offers');
  assert.deepEqual(result.rows, [], 'food in jars without a concrete benefit is not a promotion');
});

test('the caller page cap still prevents the extra detail navigation', async () => {
  const requests = [];
  await crawlFoodSource(source, {now, maxPages: 1, fetchPage: async url => {
    requests.push(url); return {html: home, finalUrl: url, status: 200};
  }});
  assert.deepEqual(requests, [source.url]);
});
