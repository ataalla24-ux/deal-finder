import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import { runBoundedFirecrawlAgent } from '../scraper/firecrawl-agent-utils.js';

const schemas = [
  {
    file: 'consumables', name: 'key3Schema', collection: 'posts', defaultEmpty: true,
    required: ['validity_period', 'location', 'item_or_service', 'original_post_url', 'post_timestamp', 'offer_type'],
    optional: ['food_and_drinks', 'owner_username'],
    uncited: ['item_or_service'],
  },
  {
    file: 'gastro2', name: 'gastroSchema', collection: 'deals', defaultEmpty: false,
    required: ['category', 'brand_or_store', 'item_given_away', 'location', 'validity_date', 'validity_time', 'post_url'],
    optional: ['owner_username', 'post_date'],
  },
  {
    file: 'food3', name: 'schema', collection: 'offers', defaultEmpty: true,
    required: ['provider_name', 'product_type', 'location', 'times', 'participation_conditions', 'offer_type', 'post_url'],
    optional: ['owner_username', 'post_date'],
  },
  {
    file: 'instagram-direct4', name: 'gastroSchema', collection: 'deals', defaultEmpty: false,
    required: ['category', 'brand_or_store', 'item_given_away', 'location', 'validity_date', 'validity_time', 'post_url'],
    optional: ['owner_username', 'post_date'],
  },
  {
    file: 'instagram-gastro5', name: 'offerSchema', collection: 'offers', defaultEmpty: true,
    required: ['restaurant_name', 'post_url', 'post_date', 'offer_description', 'offer_type'],
    optional: ['valid_until', 'location', 'owner_username'],
  },
];

function readSchema(spec) {
  const source = fs.readFileSync(new URL(`../scraper/firecrawl-${spec.file}.js`, import.meta.url), 'utf8');
  // Evaluate only the trusted schema expression, never a scraper's top-level job.
  const expression = source.match(new RegExp(
    `const ${spec.name} = (z\\.object\\([\\s\\S]*?\\n\\}\\)(?:\\.describe\\([^\\n]*\\))?);`,
  ))?.[1];
  assert.ok(expression, `Missing schema in ${spec.file}`);
  return vm.runInNewContext(expression, { z }, { timeout: 1000 });
}

function offlineClient(respond) {
  const calls = [];
  const client = new Firecrawl({ apiKey: 'offline-fixture', apiUrl: 'https://offline.invalid', maxRetries: 1 });
  // The real SDK and Axios serialization run, but transport never reaches a network.
  client.http.instance.defaults.adapter = async (config) => {
    assert.equal(config.baseURL, 'https://offline.invalid');
    const call = { method: config.method, path: config.url, body: config.data ? JSON.parse(config.data) : undefined };
    calls.push(call);
    return { status: 200, statusText: 'OK', headers: {}, config, data: respond(call, calls) };
  };
  return { client, calls };
}

for (const spec of schemas) {
  test(`${spec.file}: real SDK retains extraction fields, citations and bounded request`, async () => {
    const schema = readSchema(spec);
    const result = { [spec.collection]: [] };
    const { client, calls } = offlineClient(({ method }) => method === 'post'
      ? { success: true, id: 'fixture-job' }
      : { success: true, status: 'completed', creditsUsed: 2, data: result });
    const response = await runBoundedFirecrawlAgent(client, {
      prompt: 'Offline compatibility fixture', schema,
      urls: ['https://restaurant.example/offer'], strictConstrainToURLs: true,
    }, { maxCredits: 5, timeoutSeconds: 10 });

    assert.deepEqual(response.data, result);
    assert.equal(response.creditsUsed, 2);
    assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
      ['post', '/v2/agent'], ['get', '/v2/agent/fixture-job'],
    ]);
    const request = calls[0].body;
    assert.equal(request.maxCredits, 5);
    assert.equal(request.strictConstrainToURLs, true);
    assert.equal(request.prompt, 'Offline compatibility fixture');
    assert.deepEqual(request.urls, ['https://restaurant.example/offer']);
    const wire = request.schema;
    assert.equal(wire.type, 'object');
    assert.equal(wire.additionalProperties, false);
    assert.deepEqual(Object.keys(wire.properties), [spec.collection]);
    assert.deepEqual(wire.required, [spec.collection]);
    const collection = wire.properties[spec.collection];
    assert.equal(collection.type, 'array');
    if (spec.defaultEmpty) assert.deepEqual(collection.default, []);
    const item = collection.items;
    assert.equal(item.type, 'object');
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(item.required, spec.required);
    const fields = [...spec.required, ...spec.optional];
    const expectedFields = fields.flatMap((field) => spec.uncited?.includes(field)
      ? [field] : [field, `${field}_citation`]).sort();
    assert.deepEqual(Object.keys(item.properties).sort(), expectedFields);
    for (const field of expectedFields) {
      if (field === 'valid_until') assert.deepEqual(item.properties[field], {});
      else assert.equal(item.properties[field].type, 'string', field);
    }

    // Zod 4's output schema requires defaulted arrays; its input still accepts omissions.
    assert.equal(schema.safeParse({}).success, spec.defaultEmpty);
    if (spec.defaultEmpty) assert.deepEqual(JSON.parse(JSON.stringify(schema.parse({}))), result);
    const example = Object.fromEntries(fields.map((field) => [field, 'fixture']));
    assert.equal(schema.safeParse({ [spec.collection]: [example] }).success, true);
    for (const field of spec.required) {
      const missing = { ...example };
      delete missing[field];
      assert.equal(schema.safeParse({ [spec.collection]: [missing] }).success, false, field);
    }
    const optionalOnly = Object.fromEntries(spec.required.map((field) => [field, 'fixture']));
    assert.equal(schema.safeParse({ [spec.collection]: [optionalOnly] }).success, true);
  });
}

test('real SDK timeout cancels exactly one job without restarting it', async () => {
  let clock = 0;
  const { client, calls } = offlineClient(({ method }) => {
    if (method === 'post') return { success: true, id: 'fixture-timeout' };
    if (method === 'delete') return { success: true };
    return { success: true, status: 'processing', creditsUsed: 3 };
  });
  await assert.rejects(runBoundedFirecrawlAgent(client, { prompt: 'offline timeout' }, {
    maxCredits: 5, timeoutSeconds: 2, pollIntervalSeconds: 1,
    now: () => clock, sleep: async (ms) => { clock += ms; },
  }), (error) => error.code === 'firecrawl-agent-timeout' && error.cancelled === true && error.creditsUsed === 3);
  assert.deepEqual(calls.map(({ method }) => method), ['post', 'get', 'get', 'get', 'delete']);
  assert.equal(calls[0].body.maxCredits, 5);
  assert.equal(calls.at(-1).path, '/v2/agent/fixture-timeout');
});

test('real SDK credit refusal does not poll or start a second job', async () => {
  const { client, calls } = offlineClient(() => ({ success: false, error: 'Insufficient credits' }));
  await assert.rejects(runBoundedFirecrawlAgent(client, { prompt: 'offline refusal' }, { maxCredits: 5 }),
    (error) => error.code === 'firecrawl-agent-start-failed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'post');
});

test('real SDK terminal failures preserve credit usage and are not retried', async () => {
  const { client, calls } = offlineClient(({ method }) => method === 'post'
    ? { success: true, id: 'fixture-failed' }
    : { success: false, status: 'failed', creditsUsed: 4, error: 'Source unavailable' });
  await assert.rejects(runBoundedFirecrawlAgent(client, { prompt: 'offline failure' }, { maxCredits: 5 }),
    (error) => error.code === 'firecrawl-agent-failed' && error.creditsUsed === 4);
  assert.deepEqual(calls.map(({ method }) => method), ['post', 'get']);
});
