import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../scraper/meta-instagram-deals.js';
import { classifySocialMediaEvidenceWithOpenAI } from '../scraper/instagram-media-evidence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkInstagramAiAccess(options = {}) {
  const env = options.env || process.env;
  if (!env.OPENAI_API_KEY) throw new Error('OpenAI access check: API key is missing');
  const config = buildConfig({ ...env, META_INSTAGRAM_MEDIA_LLM_ENABLED: '1' });
  const classify = options.classify || classifySocialMediaEvidenceWithOpenAI;
  const image = await fs.readFile(path.join(root, 'docs/assets/brand-logos/starbucks-starbucks-at.png'));
  let result;
  try {
    result = await classify({
      platform: 'instagram',
      caption: 'Gratis Kaffee fuer alle in Wien, am 21. September 2026. Ohne Kaufpflicht.',
      ocrText: '',
      visionImages: [`data:image/png;base64,${image.toString('base64')}`],
    }, { ...config, mediaVisionDetail: 'low', mediaVisionMaxImagesPerPost: 1 });
  } catch (error) {
    // Only diagnostics from our sanitized classifier may reach public CI logs.
    const status = Number.isInteger(error?.status) ? error.status : 'unknown';
    const allowed = ['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active', 'usage_limit_reached', 'organization_usage_limit_exceeded', 'rate_limit_exceeded', 'rate_limit_error', 'slow_down', 'invalid_api_key', 'model_not_found'];
    const code = allowed.includes(error?.code) ? error.code : 'request-failed';
    throw new Error(`OpenAI access check failed: HTTP ${status} (${code})`);
  }
  if (!result?.isDeal || result.exclusion !== 'none' || !/kaffee/i.test(result.offerText) || !/wien/i.test(result.locationText)) {
    throw new Error('OpenAI access check failed: unexpected synthetic classification');
  }
  let recoveredEntries = 0;
  if (options.recover === true) {
    const statePath = options.statePath || path.join(root, 'docs/meta-instagram-state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    for (const [id, entry] of Object.entries(state.mediaEvidence || {})) {
      // Never invalidate successful evidence or touch the separate Meta Ads cooldown.
      if (!entry?.ai && (entry?.aiError || entry?.aiPending || entry?.aiFailure?.haltBatch)) {
        delete state.mediaEvidence[id];
        recoveredEntries += 1;
      }
    }
    if (recoveredEntries) {
      state.updatedAt = new Date().toISOString();
      const tempPath = `${statePath}.ai-check.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
      await fs.rename(tempPath, statePath);
    }
  }
  return { status: 'ok', imageRequestVerified: true, recoveredEntries, usage: result.usage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkInstagramAiAccess({ recover: process.argv.includes('--recover') }).then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    // Do not echo arbitrary filesystem or provider errors containing private paths/data.
    console.error(error.message.startsWith('OpenAI access check') ? error.message : 'OpenAI access check failed: local state unavailable');
    process.exitCode = 1;
  });
}
