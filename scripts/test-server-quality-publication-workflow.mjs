import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const workflow = name => fs.readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');

test('public verification waits for successful trusted main Pages deployment, with read-only permissions', () => {
  const w = workflow('server-quality-publication');
  assert.match(w, /workflow_run:\s+workflows: \['pages-build-deployment'\]\s+branches: \[main\]\s+types: \[completed\]/);
  assert.match(w, /permissions:\s+contents: read\s+concurrency:/);
  assert.match(w, /conclusion == 'success'/);
  assert.match(w, /head_repository.full_name == github.repository/);
  assert.match(w, /head_branch == 'main'/);
  assert.match(w, /actions\/checkout@v4\s+with:\s+ref: main/);
  assert.deepEqual([...w.matchAll(/^\s+run: (.+)$/gm)].map(m => m[1]), ['node scripts/verify-server-quality-public.mjs']);
  assert.match(w, /timeout-minutes: 5\s+run: node scripts\/verify-server-quality-public.mjs/);
  assert.match(w, /if: always\(\)\s+uses: actions\/upload-artifact@v4/);
  assert.match(w, /path: output\/server-quality-public-proof.json\s+if-no-files-found: error/);
  assert.ok(!w.includes('secrets.'));
});

test('writer never claims publication success and no longer waits for its own pending deployment', () => {
  const w = workflow('server-deal-quality');
  assert.ok(!w.includes('run: node scripts/verify-server-quality-public.mjs'));
  assert.ok(w.includes('kein Veroeffentlichungsnachweis'));
  assert.ok(w.includes('node scripts/commit-generated.mjs'));
});
