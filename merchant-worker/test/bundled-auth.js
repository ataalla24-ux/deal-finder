import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Match Wrangler's dependency bundling inside the isolated Workers test runtime.
export async function bundledAuth(path = 'src/account-auth.js') {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/account-auth.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  return { type: 'ESModule', path, contents: result.outputFiles[0].text };
}
