import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');
const ENV_PATH = path.join(ROOT, '.env');
const DEFAULT_REPORT_PATH = path.join(DOCS_DIR, 'meta-instagram-auth-health.json');
const DEFAULT_BUSINESS_DISCOVERY_TEST_ACCOUNT = 'ciosgrill';

function cleanText(value, max = 2000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function loadEnvFile(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function booleanEnv(env, name, fallback = false) {
  const value = cleanText(env[name], 20).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function numberEnv(env, name, fallback, min, max) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function redact(value, secrets) {
  let out = cleanText(value, 3000);
  for (const secret of secrets.filter(Boolean)) {
    out = out.split(secret).join('[redacted]');
    try {
      out = out.split(encodeURIComponent(secret)).join('[redacted]');
    } catch {
      // Raw replacement above still protects non-URL messages.
    }
  }
  return out.replace(/([?&](?:access_token|token|client_secret)=)[^&\s"']+/gi, '$1[redacted]');
}

function safeUrl(value, secrets) {
  try {
    const url = new URL(value);
    for (const key of ['access_token', 'token', 'client_secret']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    }
    return redact(url.toString(), secrets);
  } catch {
    return redact(value, secrets);
  }
}

function classifyMetaError(error) {
  const status = Number(error?.status || 0);
  const code = cleanText(error?.code, 40);
  const message = cleanText(error?.message, 1200);
  if (code === '190' || /bad signature|invalid oauth|expired token|malformed access token/i.test(message)) {
    return 'invalid-token';
  }
  if (status === 401 || /not authorized|unauthorized/i.test(message)) return 'unauthorized-token';
  if (/permission|requires.+permission|access to this data/i.test(message)) return 'missing-permission';
  if (/instagram_business_account|no linked instagram|does not exist|unsupported get request/i.test(message)) {
    return 'wrong-token-type-or-missing-page-link';
  }
  return status >= 500 || status === 429 ? 'temporary-meta-error' : 'meta-api-error';
}

function graphUrl(config, pathname, params = {}, token = config.instagramAccessToken) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${pathname.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  if (token) url.searchParams.set('access_token', token);
  return url.toString();
}

async function fetchMetaJson(url, config, tokenName = 'instagram', fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: cleanText(text, 500) };
  }

  if (response.ok) {
    return {
      ok: true,
      payload,
      usage: {
        app: cleanText(response.headers.get('x-app-usage'), 500),
        business: cleanText(response.headers.get('x-business-use-case-usage'), 500),
      },
    };
  }

  const err = new Error(payload?.error?.message || payload?.raw || `Meta API ${response.status}`);
  err.status = response.status;
  err.code = payload?.error?.code;
  err.type = payload?.error?.type;
  err.tokenName = tokenName;
  throw err;
}

function addCheck(report, check) {
  report.checks.push({
    name: cleanText(check.name, 100),
    status: cleanText(check.status, 40),
    detail: cleanText(check.detail, 500),
    ...(check.url ? { url: check.url } : {}),
    ...(check.code ? { code: cleanText(check.code, 80) } : {}),
    ...(check.httpStatus ? { httpStatus: Number(check.httpStatus) } : {}),
  });
}

async function runCheck(options = {}) {
  const env = { ...loadEnvFile(), ...process.env, ...(options.env || {}) };
  const fetchImpl = options.fetchImpl || fetch;
  const config = {
    graphVersion: cleanText(env.META_GRAPH_VERSION || env.INSTAGRAM_GRAPH_VERSION || 'v26.0', 20),
    instagramAccessToken: cleanText(env.INSTAGRAM_ACCESS_TOKEN || env.META_INSTAGRAM_ACCESS_TOKEN || '', 2000),
    instagramUserId: cleanText(env.INSTAGRAM_USER_ID || env.IG_USER_ID || '', 100),
    adLibraryToken: cleanText(env.META_AD_LIBRARY_ACCESS_TOKEN || '', 2000),
    reportPath: cleanText(env.META_INSTAGRAM_AUTH_REPORT_PATH, 500) || DEFAULT_REPORT_PATH,
    requestTimeoutMs: numberEnv(env, 'META_INSTAGRAM_REQUEST_TIMEOUT_MS', 15000, 1000, 60000),
    requireConfiguredSource: booleanEnv(env, 'META_INSTAGRAM_REQUIRE_SOURCE', false),
    businessDiscoveryTestAccount: cleanText(env.META_INSTAGRAM_HEALTHCHECK_ACCOUNT || DEFAULT_BUSINESS_DISCOVERY_TEST_ACCOUNT, 100)
      .replace(/^@/, '')
      .toLowerCase(),
    hashtagTest: cleanText(env.META_INSTAGRAM_HEALTHCHECK_HASHTAG || '', 100).replace(/^#/, '').toLowerCase(),
  };
  const secrets = [config.instagramAccessToken, config.adLibraryToken];
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'meta-instagram-auth-health',
    graphVersion: config.graphVersion,
    status: 'running',
    configured: {
      instagramGraph: Boolean(config.instagramAccessToken),
      instagramUserId: Boolean(config.instagramUserId),
      adLibrary: Boolean(config.adLibraryToken),
    },
    checks: [],
    nextAction: '',
  };

  if (!config.instagramAccessToken) {
    report.status = config.requireConfiguredSource && !config.adLibraryToken ? 'missing-credentials' : 'skipped';
    report.nextAction = config.adLibraryToken
      ? 'Instagram Graph is not configured; Ad Library can still run.'
      : 'Set INSTAGRAM_ACCESS_TOKEN, and preferably INSTAGRAM_USER_ID, in GitHub Secrets.';
    addCheck(report, {
      name: 'instagram-access-token',
      status: report.status,
      detail: report.nextAction,
    });
    if (options.write !== false) writeJsonAtomic(config.reportPath, report);
    return { report, ok: report.status === 'skipped' };
  }

  let graphToken = config.instagramAccessToken;
  let igUserId = config.instagramUserId;
  let username = '';

  try {
    const meFields = igUserId
      ? 'id,name'
      : 'id,name,instagram_business_account{id,username}';
    const me = await fetchMetaJson(graphUrl(config, '/me', { fields: meFields }, graphToken), config, 'instagram', fetchImpl);
    const linkedIg = me.payload?.instagram_business_account || null;
    if (!igUserId && linkedIg?.id) {
      igUserId = cleanText(linkedIg.id, 100);
      username = cleanText(linkedIg.username, 100);
    }
    addCheck(report, {
      name: 'token-basic',
      status: 'ok',
      detail: `Token resolved /me${username ? ` for @${username}` : ''}.`,
    });
  } catch (error) {
    report.status = classifyMetaError(error);
    report.nextAction = report.status === 'invalid-token'
      ? 'Replace the GitHub secret INSTAGRAM_ACCESS_TOKEN with a fresh Meta Graph access token.'
      : 'Check the token type and Meta app permissions.';
    addCheck(report, {
      name: 'token-basic',
      status: report.status,
      detail: redact(error?.message || error, secrets),
      code: error?.code,
      httpStatus: error?.status,
    });
    if (options.write !== false) writeJsonAtomic(config.reportPath, report);
    return { report, ok: false };
  }

  if (!igUserId) {
    try {
      const accountsUrl = graphUrl(config, '/me/accounts', {
        fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
      }, graphToken);
      const accounts = await fetchMetaJson(accountsUrl, config, 'instagram', fetchImpl);
      const pages = Array.isArray(accounts.payload?.data) ? accounts.payload.data : [];
      const page = pages.find((entry) => cleanText(entry?.instagram_business_account?.id, 100));
      if (page) {
        igUserId = cleanText(page.instagram_business_account.id, 100);
        username = cleanText(page.instagram_business_account.username, 100);
        graphToken = cleanText(page.access_token, 2000) || graphToken;
        addCheck(report, {
          name: 'linked-page',
          status: 'ok',
          detail: `Found linked Instagram professional account${username ? ` @${username}` : ''}.`,
        });
      } else {
        addCheck(report, {
          name: 'linked-page',
          status: 'not-found',
          detail: 'No managed Facebook Page returned an instagram_business_account.',
        });
      }
    } catch (error) {
      addCheck(report, {
        name: 'linked-page',
        status: classifyMetaError(error),
        detail: redact(error?.message || error, secrets),
        code: error?.code,
        httpStatus: error?.status,
      });
    }
  } else {
    addCheck(report, {
      name: 'instagram-user-id',
      status: 'configured',
      detail: `Using INSTAGRAM_USER_ID=${igUserId}.`,
    });
  }

  if (!igUserId) {
    report.status = 'no-linked-instagram-account';
    report.nextAction = 'Use a Business/Creator Instagram account linked to a Facebook Page, or set INSTAGRAM_USER_ID with a matching Page token.';
    if (options.write !== false) writeJsonAtomic(config.reportPath, report);
    return { report, ok: false };
  }

  try {
    const media = await fetchMetaJson(graphUrl(config, `/${igUserId}/media`, {
      fields: 'id,caption,media_type,permalink,timestamp',
      limit: '3',
    }, graphToken), config, 'instagram', fetchImpl);
    const rows = Array.isArray(media.payload?.data) ? media.payload.data : [];
    addCheck(report, {
      name: 'own-media',
      status: 'ok',
      detail: `Read ${rows.length} recent media row(s); timestamp/permalink fields are available.`,
    });
  } catch (error) {
    addCheck(report, {
      name: 'own-media',
      status: classifyMetaError(error),
      detail: redact(error?.message || error, secrets),
      code: error?.code,
      httpStatus: error?.status,
    });
  }

  if (config.businessDiscoveryTestAccount) {
    try {
      const fields = `business_discovery.username(${config.businessDiscoveryTestAccount}){username,name,media.limit(1){id,caption,media_type,permalink,timestamp}}`;
      const discovery = await fetchMetaJson(graphUrl(config, `/${igUserId}`, { fields }, graphToken), config, 'instagram', fetchImpl);
      const mediaRows = discovery.payload?.business_discovery?.media?.data || [];
      addCheck(report, {
        name: 'business-discovery',
        status: 'ok',
        detail: `Business Discovery works for @${config.businessDiscoveryTestAccount}; ${mediaRows.length} media row(s) returned.`,
      });
    } catch (error) {
      addCheck(report, {
        name: 'business-discovery',
        status: classifyMetaError(error),
        detail: redact(error?.message || error, secrets),
        code: error?.code,
        httpStatus: error?.status,
      });
    }
  }

  if (config.hashtagTest) {
    try {
      const search = await fetchMetaJson(graphUrl(config, '/ig_hashtag_search', {
        user_id: igUserId,
        q: config.hashtagTest,
      }, graphToken), config, 'instagram', fetchImpl);
      const hashtagId = cleanText(search.payload?.data?.[0]?.id, 100);
      if (!hashtagId) {
        addCheck(report, {
          name: 'hashtag-search',
          status: 'not-found',
          detail: `No hashtag id returned for #${config.hashtagTest}.`,
        });
      } else {
        const media = await fetchMetaJson(graphUrl(config, `/${hashtagId}/recent_media`, {
          user_id: igUserId,
          fields: 'id,caption,media_type,permalink,timestamp',
          limit: '3',
        }, graphToken), config, 'instagram', fetchImpl);
        addCheck(report, {
          name: 'hashtag-search',
          status: 'ok',
          detail: `Hashtag #${config.hashtagTest} works; ${(media.payload?.data || []).length} recent media row(s) returned.`,
        });
      }
    } catch (error) {
      addCheck(report, {
        name: 'hashtag-search',
        status: classifyMetaError(error),
        detail: redact(error?.message || error, secrets),
        code: error?.code,
        httpStatus: error?.status,
      });
    }
  } else {
    addCheck(report, {
      name: 'hashtag-search',
      status: 'skipped',
      detail: 'Set META_INSTAGRAM_HEALTHCHECK_HASHTAG to test hashtag access; this counts toward Meta hashtag limits.',
    });
  }

  const hardFailures = new Set([
    'invalid-token',
    'unauthorized-token',
    'missing-permission',
    'wrong-token-type-or-missing-page-link',
    'no-linked-instagram-account',
    'meta-api-error',
  ]);
  const failedChecks = report.checks.filter((check) => hardFailures.has(check.status));
  const requiredChecks = new Set(['own-media', 'business-discovery']);
  const requiredFailures = failedChecks.filter((check) => requiredChecks.has(check.name));
  if (requiredFailures.length) {
    report.status = requiredFailures[0].status;
    report.nextAction = 'Fix the Meta Graph token permissions before enabling scheduled discovery.';
  } else {
    report.status = 'ok';
    report.nextAction = 'Meta Instagram Graph is ready for the deal collector.';
  }

  if (options.write !== false) writeJsonAtomic(config.reportPath, report);
  return { report, ok: report.status === 'ok' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCheck().then(({ report, ok }) => {
    console.log(`Meta Instagram Graph health: ${report.status}`);
    for (const check of report.checks) {
      const detail = check.detail ? ` - ${check.detail}` : '';
      console.log(`  ${check.name}: ${check.status}${detail}`);
      if (check.url) console.log(`    ${safeUrl(check.url, [])}`);
    }
    console.log(`  next: ${report.nextAction}`);
    if (!ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(`Meta Instagram Graph health failed: ${cleanText(error?.stack || error?.message || error, 2000)}`);
    process.exitCode = 1;
  });
}

export { runCheck };
