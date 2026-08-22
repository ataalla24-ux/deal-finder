const TERMINAL_AGENT_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function cleanText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function positiveInteger(value, fallback) {
  return Math.floor(positiveNumber(value, fallback));
}

export function isFirecrawlRateOrCreditError(message) {
  const signal = cleanText(message).toLowerCase();
  return signal.includes('insufficient credit')
    || signal.includes('not enough credit')
    || signal.includes('credit limit')
    || signal.includes('quota exceeded')
    || signal.includes('rate limit');
}

function createAgentError(message, details = {}) {
  const error = new Error(cleanText(message) || 'Firecrawl Agent fehlgeschlagen');
  Object.assign(error, details);
  return error;
}

export async function runBoundedFirecrawlAgent(client, payload, options = {}) {
  if (!client?.startAgent || !client?.getAgentStatus) {
    throw new TypeError('Firecrawl client must support startAgent() and getAgentStatus()');
  }

  const timeoutSeconds = positiveNumber(options.timeoutSeconds, 300);
  const pollIntervalSeconds = positiveNumber(options.pollIntervalSeconds, 2);
  const maxCredits = positiveInteger(options.maxCredits ?? payload?.maxCredits, 0);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const request = {
    ...payload,
    ...(maxCredits > 0 ? { maxCredits } : {}),
  };

  const started = await client.startAgent(request);
  const jobId = cleanText(started?.id, 200);
  if (started?.success === false || !jobId) {
    throw createAgentError(started?.error || 'Firecrawl Agent konnte nicht gestartet werden', {
      code: 'firecrawl-agent-start-failed',
      status: 'failed',
    });
  }

  const deadline = now() + timeoutSeconds * 1000;
  while (true) {
    const status = await client.getAgentStatus(jobId);
    const statusName = cleanText(status?.status, 40).toLowerCase();

    if (statusName === 'completed' && status?.success !== false) {
      return { ...status, id: jobId };
    }

    if (TERMINAL_AGENT_STATUSES.has(statusName) || status?.success === false) {
      throw createAgentError(status?.error || `Firecrawl Agent status: ${statusName || 'failed'}`, {
        code: 'firecrawl-agent-failed',
        jobId,
        status: statusName || 'failed',
        creditsUsed: Number(status?.creditsUsed || status?.credits_used || 0),
      });
    }

    if (now() >= deadline) {
      let cancelled = false;
      if (typeof client.cancelAgent === 'function') {
        try {
          cancelled = await client.cancelAgent(jobId) === true;
        } catch {
          cancelled = false;
        }
      }
      throw createAgentError(`Firecrawl Agent nach ${timeoutSeconds}s abgebrochen`, {
        code: 'firecrawl-agent-timeout',
        jobId,
        status: statusName || 'processing',
        cancelled,
        creditsUsed: Number(status?.creditsUsed || status?.credits_used || 0),
      });
    }

    await sleep(pollIntervalSeconds * 1000);
  }
}
