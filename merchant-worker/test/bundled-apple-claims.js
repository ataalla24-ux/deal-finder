import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Match Wrangler's nodejs_compat dependency packaging, not a mocked cryptographic verifier.
export const workerBundleOptions = { bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
  external: ['node:*', 'crypto', 'stream', 'buffer'],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire("/worker.js");' } };
export async function bundledAppleClaims(path = 'src/apple-reward-claim.js') {
  const result = await build({ ...workerBundleOptions,
    entryPoints: [fileURLToPath(new URL('../src/apple-reward-claim.js', import.meta.url))] });
  return { type: 'ESModule', path, contents: result.outputFiles[0].text };
}
