const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(error, now) {
  const message = String(error?.message || '');
  const status = Number(error?.statusCode || error?.status || error?.response?.status);
  if ([401, 402, 403].includes(status) || /insufficient credits|credit balance|out of credits|payment required/i.test(message)) return null;
  if (status !== 429 && !/rate limit|too many requests/i.test(message)) return null;

  const headers = error?.response?.headers || error?.headers;
  const retryAfter = headers?.get?.('retry-after') ?? headers?.['retry-after'];
  if (retryAfter !== undefined && retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000 + 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now) + 1000;
  }
  const seconds = message.match(/retry after\s+(\d+(?:\.\d+)?)\s*s/i)?.[1];
  return seconds ? Number(seconds) * 1000 + 1000 : 61000;
}

// One queue per API client keeps searches below the observed 10 requests/minute
// limit. A single bounded retry handles limits shared with another running job.
export function createFirecrawlSearch(client, {
  intervalMs = 6500,
  maxRetryWaitMs = 65000,
  now = Date.now,
  sleep = delay,
  onRetry = (ms) => console.log(`Firecrawl Search: rate limited, retrying once in ${Math.ceil(ms / 1000)}s`),
} = {}) {
  let nextRequestAt = 0;
  let tail = Promise.resolve();
  return (query, params) => {
    const run = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const wait = Math.max(0, nextRequestAt - now());
        if (wait) await sleep(wait);
        nextRequestAt = now() + intervalMs;
        try {
          const response = await client.search(query, params);
          if (response?.success === false || response?.error) {
            throw Object.assign(new Error(String(response.error || 'Firecrawl Search fehlgeschlagen')), {
              statusCode: response.statusCode || response.status,
            });
          }
          return response;
        } catch (error) {
          const waitMs = retryDelay(error, now());
          if (attempt > 0 || waitMs === null || waitMs > maxRetryWaitMs) throw error;
          nextRequestAt = Math.max(nextRequestAt, now() + waitMs);
          onRetry(waitMs);
        }
      }
    };
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };
}
