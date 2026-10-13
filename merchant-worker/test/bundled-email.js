import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function bundledEmail(path = 'src/account-email.js') {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/account-email.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  return { type: 'ESModule', path, contents: result.outputFiles[0].text };
}
