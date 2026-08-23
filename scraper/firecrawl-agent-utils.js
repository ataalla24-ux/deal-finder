const TERMINAL_AGENT_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const activeAgentJobs = new Set();
let signalHandlersInstalled = false;

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

export function selectRotatingFirecrawlTargets(targets = [], count = targets.length, date = new Date()) {
  if (!Array.isArray(targets) || targets.length === 0) return [];
  const selectedCount = Math.min(targets.length, positiveInteger(count, targets.length));
  const timestamp = date instanceof Date ? date.getTime() : Date.parse(date);
  const dayNumber = Math.floor((Number.isFinite(timestamp) ? timestamp : Date.now()) / (24 * 60 * 60 * 1000));
  const start = (dayNumber * selectedCount) % targets.length;
  return Array.from({ length: selectedCount }, (_, index) => targets[(start + index) % targets.length]);
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

function installSignalHandlers() {
  if (signalHandlersInstalled || typeof process === 'undefined' || typeof process.once !== 'function') return;
  signalHandlersInstalled = true;
  for (const [signal, exitCode] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    process.once(signal, async () => {
      const forceExit = setTimeout(() => process.exit(exitCode), 5000);
      try {
        await Promise.allSettled([...activeAgentJobs].map(({ client, jobId }) => (
          typeof client?.cancelAgent === 'function' ? client.cancelAgent(jobId) : Promise.resolve(false)
        )));
      } finally {
        clearTimeout(forceExit);
        process.exit(exitCode);
      }
    });
  }
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

  installSignalHandlers();
  const activeJob = { client, jobId };
  activeAgentJobs.add(activeJob);
  const deadline = now() + timeoutSeconds * 1000;
  try {
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
  } finally {
    activeAgentJobs.delete(activeJob);
  }
}
