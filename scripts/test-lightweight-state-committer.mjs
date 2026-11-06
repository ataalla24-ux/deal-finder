import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('lightweight Slack state committer loads without installed npm dependencies',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'state-committer-no-deps-'));
  try {
    const listing=spawnSync('git',['ls-files','scripts','scraper'],{cwd:root,encoding:'utf8'});
    assert.equal(listing.status,0,listing.stderr);
    for(const file of listing.stdout.split('\n').filter(file=>/\.(?:mjs|js)$/.test(file))){
      const target=path.join(temp,file);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(root,file),target);
    }
    fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
    // Argument validation happens after imports, before any Git/network action.
    const result=spawnSync(process.execPath,['scripts/commit-generated.mjs'],{cwd:temp,encoding:'utf8',timeout:15000});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Generated commit failed: Missing --message/);
    assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|Cannot find package/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
