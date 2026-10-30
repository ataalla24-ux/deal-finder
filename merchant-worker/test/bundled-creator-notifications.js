import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { workerBundleOptions } from './bundled-apple-claims.js';

export async function bundledCreatorNotifications(path = 'src/creator-store-notifications.js') {
  const result = await build({ ...workerBundleOptions,
    entryPoints: [fileURLToPath(new URL('../src/creator-store-notifications.js', import.meta.url))] });
  return { type: 'ESModule', path, contents: result.outputFiles[0].text };
}
