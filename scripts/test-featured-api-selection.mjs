import assert from 'node:assert/strict';
import test from 'node:test';
import { selectFeaturedDealWithOpenAI } from '../scraper/featured-api-selection.js';

const now = new Date('2026-11-24T08:00:00Z');
const daily = { kind: 'daily', now };
const weekly = { kind: 'weekly', now };
const recorded = { status: 'completed', model: 'gpt-6.2-sol', usage: { total_tokens: 330 } };
const reply = (dealId, metadata = {}) => Response.json({ ...recorded,
    output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ dealId }) }] }],
    ...metadata });
const ranked = (id, fields = {}) => ({ deal: { id, title: '2 Pizzen für 10 €', brand: 'Pizzeria',
    description: 'Nur bei Abholung und mit App-Gutschein.', validUntil: '2026-11-29', ...fields },
    value: 50, days: ['2026-11-24', '2026-11-25'] });

test('one native Responses call can select a weekly ID from a bounded public shortlist', async t => {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousProfile = process.env.FREEFINDER_ASTRA_ENRICHMENT;
    t.after(() => {
        if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
        if (previousProfile === undefined) delete process.env.FREEFINDER_ASTRA_ENRICHMENT;
        else process.env.FREEFINDER_ASTRA_ENRICHMENT = previousProfile;
    });
    process.env.OPENAI_API_KEY = 'offline-featured-key';
    process.env.FREEFINDER_ASTRA_ENRICHMENT = '0';
    const log = t.mock.method(console, 'log', () => {});
    const candidates = [ranked('first', { lat: 48, privateText: 'private fixture', slackTs: 'do not send', expires: '2026-11-29T19:00:00Z' }),
        ranked('long', { description: 'a'.repeat(701) }), ranked('second'), ...Array.from({ length: 6 }, (_, n) => ranked(`extra-${n}`))];
    let calls = 0;
    const selection = await selectFeaturedDealWithOpenAI(candidates, { ...weekly, request: async (url, init) => {
        calls++;
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.authorization, 'Bearer offline-featured-key');
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'gpt-6.2-sol');
        assert.equal(body.store, false);
        assert.equal(body.service_tier, 'default');
        assert.equal(body.text.format.strict, true);
        assert.match(body.input[0].content, /untrusted data/);
        const input = JSON.parse(body.input[1].content);
        assert.deepEqual(body.text.format.schema.properties.dealId.enum, input.candidates.map(row => row.id));
        assert.deepEqual(input.candidates[0], { id: 'first', title: '2 Pizzen für 10 €', brand: 'Pizzeria',
            terms: 'Nur bei Abholung und mit App-Gutschein.', validUntil: '2026-11-29',
            expires: '2026-11-29T19:00:00Z', value: 50, redeemableDays: ['2026-11-24', '2026-11-25'] });
        assert.equal(input.kind, 'weekly');
        assert.equal(input.timeZone, 'Europe/Vienna');
        assert.ok(!input.candidates.some(row => ['long', 'extra-5'].includes(row.id)));
        return reply('second');
    } });
    assert.equal(calls, 1);
    assert.equal(selection, 'second');
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[0]), { event: 'featured-openai-selection',
        kind: 'weekly', dealId: 'second', model: 'gpt-6.2-sol', tokens: 330 });

    for (const response of [
        () => reply('not-live'),
        () => reply('first', { model: 'gpt-6.2-astra' }),
        () => reply('first', { status: 'incomplete' }),
        () => reply('first', { usage: {} }),
        () => reply('first', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private fixture' }] }] }),
        () => new Response('provider error with private fixture', { status: 429 }),
        () => { throw Error('private fixture'); },
    ]) {
        let requests = 0;
        const warn = t.mock.method(console, 'warn', () => {});
        assert.equal(await selectFeaturedDealWithOpenAI(candidates, { ...daily, request: async () => {
            requests++;
            return response();
        } }), '');
        assert.equal(requests, 1);
        assert.ok(!JSON.stringify(warn.mock.calls.map(entry => entry.arguments)).includes('private fixture'));
        warn.mock.restore();
    }
    let unexpectedRequests = 0;
    const noRequest = () => { unexpectedRequests++; };
    assert.equal(await selectFeaturedDealWithOpenAI([null, ranked('empty', { description: '' })], { ...daily, request: noRequest }), '');
    assert.equal(await selectFeaturedDealWithOpenAI([{ ...ranked('no-days'), days: [] }], { ...weekly, request: noRequest }), '');
    delete process.env.OPENAI_API_KEY;
    assert.equal(await selectFeaturedDealWithOpenAI(candidates, { ...daily, request: noRequest }), '');
    assert.equal(unexpectedRequests, 0, 'missing key or eligible candidates end selection before the API');
});
