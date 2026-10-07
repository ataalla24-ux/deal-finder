import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig, collectAdLibrary } from '../scraper/meta-instagram-deals.js';
import { sharedInstagramFetch } from '../scraper/instagram-shared-quota.js';

export async function runAdLibraryAccessCheck(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const config = {
    ...buildConfig(env, now),
    adSearchTerms: ['Wien gratis Kaffee'],
    maxAdTermsPerRun: 1,
    maxAdPagesPerTerm: 1,
    adCoverageMode: false,
    adPageSize: 100,
    maxRetries: 0,
  };
  const report = {
    generatedAt: now.toISOString(),
    source: 'meta-ad-library-access-check',
    status: 'not-configured',
    configured: Boolean(config.adLibraryToken),
    fetched: 0,
    errors: [],
    nextAction: 'Configure a Meta user access token authorized for the Ad Library API.',
    scope: 'One read-only Austrian Instagram ad search; no AI, Slack, or collector output/state writes.',
  };
  if (config.adLibraryToken) {
    const fetchImpl = sharedInstagramFetch(options.fetchImpl || fetch, env);
    const result = await collectAdLibrary(config, now, fetchImpl);
    const error = result.errors[0];
    report.fetched = result.raw.length;
    report.selectedTerms = result.selectedTerms;
    report.errors = result.errors;
    report.sharedQuota = fetchImpl.quotaStats || null;
    report.status = !error ? 'ok' : result.budgetDeferred || [4, 17, 32, 613, 80002].includes(Number(error.code)) || error.status === 429
      ? 'quota-deferred' : [10, 200].includes(Number(error.code)) || error.status === 403
        ? 'missing-permission' : Number(error.code) === 190 || error.status === 401
          ? 'invalid-token' : 'api-error';
    report.nextAction = report.status === 'ok' ? 'Ad Library API access works; the existing production collector can search active Austrian Instagram ads.'
      : report.status === 'quota-deferred' ? 'Retry when shared Meta quota is available; no permission failure is implied.'
        : report.status === 'missing-permission' ? 'Finish Ad Library API authorization for the verified Facebook user and the existing Meta app.'
          : report.status === 'invalid-token' ? 'Refresh the authorized Meta user token without changing Instagram permissions.'
            : 'Review the redacted API error; do not treat an API or network error as successful access.';
  }
  if (options.write !== false) {
    const reportPath = env.META_AD_LIBRARY_ACCESS_REPORT_PATH || 'artifacts/meta-ad-library-access.json';
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return { report, ok: report.status === 'ok' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runAdLibraryAccessCheck().then(({ report, ok }) => {
    console.log(`Meta Ad Library API access: ${report.status}; ${report.fetched} ad row(s).`);
    console.log(report.nextAction);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Ad Library API access\n\n- Status: **${report.status}**\n- Ads returned: ${report.fetched}\n- ${report.scope}\n- ${report.nextAction}\n`);
    if (!ok) process.exitCode = 1;
  }).catch(() => {
    console.error('Ad Library API access check could not finish; no access success has been verified.');
    process.exitCode = 1;
  });
}
