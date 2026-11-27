import { setTimeout as waitForDelay } from 'node:timers/promises';
import { retryAfterAt } from './source-http-policy.js';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const OPENAI_BACKGROUND_TIMEOUT_MS = 8 * 60_000;
const HTTP_TIMEOUT_MS = 30_000;
const CANCEL_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 8_000;
const MAX_POLLS = 60;
const PENDING = new Set(['queued', 'in_progress']);
const TERMINAL = new Set(['completed', 'incomplete', 'failed', 'cancelled']);
const RESPONSE_ID = /^resp_[A-Za-z0-9]{1,128}$/;

export class OpenAiBackgroundFailure extends Error {}

function validateResponse(payload, model, identity) {
  if (typeof payload?.id !== 'string' || !RESPONSE_ID.test(payload.id)
    || identity && (payload.id !== identity.id || payload.model !== identity.model)) {
    throw new OpenAiBackgroundFailure('background-response-invalid');
  }
  const returnedModel = payload.model;
  const matchesModel = returnedModel === model || typeof returnedModel === 'string'
    && returnedModel.startsWith(model + '-') && /^\d{4}-\d{2}-\d{2}$/.test(returnedModel.slice(model.length + 1));
  if (!matchesModel) throw new OpenAiBackgroundFailure('background-response-invalid');
  if (!PENDING.has(payload.status) && !TERMINAL.has(payload.status)) {
    throw new OpenAiBackgroundFailure('background-response-invalid');
  }
  return { id: payload.id, model: returnedModel };
}

function responseHeaders(headers) {
  const source = new Headers(headers);
  const control = new Headers();
  for (const name of ['authorization', 'openai-organization', 'openai-project']) {
    if (source.has(name)) control.set(name, source.get(name));
  }
  return control;
}

function completeTextOutput(output) {
  if (!Array.isArray(output) || output.some(item => !item || typeof item !== 'object'
    || Object.hasOwn(item, 'status') && item.status !== 'completed')) return false;
  const messages = output.filter(item => item.type === 'message');
  return messages.every(message => (message.role === undefined || message.role === 'assistant')
    && Array.isArray(message.content)
    && message.content.every(part => part?.type === 'output_text' && typeof part.text === 'string'))
    && messages.some(message => message.content.some(part => part.text.trim()));
}

export async function readOpenAiBackgroundResponse(init, {
  model, request, clock, deadline, grantEndsAt, recordProviderWait,
  sleep = (ms, signal) => waitForDelay(ms, undefined, { signal }),
}) {
  const totalSignal = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - clock())));
  const signal = init.signal ? AbortSignal.any([init.signal, totalSignal]) : totalSignal;
  const headers = responseHeaders(init.headers);
  let identity;
  let nextPollAt = 0;
  let providerWaitUntil = 0;
  const outOfTime = () => clock() >= deadline || signal.aborted;
  const send = async (url, options) => {
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(HTTP_TIMEOUT_MS, Math.ceil(deadline - clock()))));
    return request(url, { ...options, redirect: 'error', signal: AbortSignal.any([signal, timeout]) });
  };
  const read = async response => ({ response, payload: await response.json().catch(() => null) });
  const result = (response, payload) => {
    let reason = '';
    if (outOfTime()) reason = 'background-timeout';
    else if (payload.status !== 'completed') reason = 'background-response-unavailable';
    else if (!completeTextOutput(payload.output)) reason = 'background-response-invalid';
    return { response, payload, reason };
  };

  async function cancel(reason) {
    // A provider hold may outlive the run. Do not send even a control request
    // during such a hold or after the grant boundary.
    const cancelTime = Math.min(CANCEL_TIMEOUT_MS, grantEndsAt - clock());
    if (identity && providerWaitUntil <= clock() && cancelTime > 0) {
      try {
        const response = await request(OPENAI_RESPONSES_URL + '/' + identity.id + '/cancel', {
          method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(Math.ceil(cancelTime)),
        });
        const { payload } = await read(response);
        if (response.ok && TERMINAL.has(payload?.status)) {
          validateResponse(payload, model, identity);
          return { response, payload, reason };
        }
      } catch { /* cleanup is best effort and never enables another generation */ }
    }
    throw new OpenAiBackgroundFailure(reason);
  }

  if (outOfTime()) throw new OpenAiBackgroundFailure('background-timeout');
  try {
    // The sole request that can start a generation.
    const initial = await read(await send(OPENAI_RESPONSES_URL, init));
    if (!initial.response.ok) return { ...initial, payload: initial.payload || {}, reason: '' };
    if (!initial.payload && outOfTime()) throw new OpenAiBackgroundFailure('background-timeout');
    identity = validateResponse(initial.payload, model);
    if (TERMINAL.has(initial.payload.status)) return result(initial.response, initial.payload);
    nextPollAt = clock() + POLL_INTERVAL_MS;

    const route = OPENAI_RESPONSES_URL + '/' + identity.id;
    for (let polls = 0; polls < MAX_POLLS; polls += 1) {
      if (outOfTime()) break;
      await sleep(Math.max(0, Math.min(nextPollAt, deadline) - clock()), signal);
      if (outOfTime() || clock() < nextPollAt) break;
      const response = await send(route, { method: 'GET', headers });
      nextPollAt = clock() + POLL_INTERVAL_MS;
      if (response.status === 429) {
        const retryAt = Date.parse(retryAfterAt(response.headers.get('retry-after'), new Date(clock())));
        providerWaitUntil = Number.isFinite(retryAt) ? retryAt : 0;
        nextPollAt = Math.max(nextPollAt, providerWaitUntil);
        await response.body?.cancel().catch(() => {});
        if (providerWaitUntil) await recordProviderWait(providerWaitUntil);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { response, payload: {}, reason: 'background-response-unavailable' };
      }
      const { payload } = await read(response);
      if (!payload && outOfTime()) break;
      validateResponse(payload, model, identity);
      if (TERMINAL.has(payload.status)) return result(response, payload);
    }
  } catch (error) {
    if (!outOfTime()) {
      if (error instanceof OpenAiBackgroundFailure) throw error;
      throw new OpenAiBackgroundFailure('background-response-unavailable');
    }
  }
  return cancel(outOfTime() ? 'background-timeout' : 'background-response-unavailable');
}
