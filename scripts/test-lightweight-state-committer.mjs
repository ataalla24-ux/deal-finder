import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function copySource(root, temp) {
  const listing=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','scripts','scraper'],{cwd:root,encoding:'utf8'});
  assert.equal(listing.status,0,listing.stderr);
  for(const file of listing.stdout.split('\n').filter(file=>/\.(?:mjs|js)$/.test(file))){
    const target=path.join(temp,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,file),target);
  }
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
}

test('lightweight Slack state committer loads without installed npm dependencies',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'state-committer-no-deps-'));
  try {
    copySource(root, temp);
    // Argument validation happens after imports, before any Git/network action.
    const result=spawnSync(process.execPath,['scripts/commit-generated.mjs'],{cwd:temp,encoding:'utf8',timeout:15000});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Generated commit failed: Missing --message/);
    assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|Cannot find package/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('Slack catalogue and approval-isolation tests run without npm dependencies',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'slack-catalogue-no-deps-'));
  try {
    copySource(root,temp);
    fs.cpSync(path.join(root,'.github'),path.join(temp,'.github'),{recursive:true});
    const result=spawnSync(process.execPath,['scripts/test-slack-live-deal-list.mjs'],{
      cwd:temp,encoding:'utf8',timeout:15000,env:{...process.env,SENTRY_DISABLED:'1'},
    });
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    assert.match(result.stdout,/offline checks passed/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('Churches wildcard and Slack identities persist to a local remote without npm dependencies',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'church-committer-no-deps-'));
  const repo=path.join(temp,'repo');
  const remote=path.join(temp,'remote.git');
  const env={...process.env,GIT_AUTHOR_NAME:'Offline test',GIT_AUTHOR_EMAIL:'test@example.invalid',
    GIT_COMMITTER_NAME:'Offline test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
  const run=(command,args,cwd=repo)=>{
    const result=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    return result.stdout.trim();
  };
  try {
    fs.mkdirSync(repo);
    copySource(path.resolve(import.meta.dirname,'..'),repo);
    fs.mkdirSync(path.join(repo,'docs'));
    fs.mkdirSync(path.join(repo,'reviews'));
    fs.writeFileSync(path.join(repo,'docs/deals.json'),'{"deals":[]}\n');
    run('git',['init','--initial-branch=main']);
    run('git',['add','.']);
    run('git',['commit','-m','fixture']);
    run('git',['init','--bare',remote]);
    run('git',['remote','add','origin',remote]);
    run('git',['push','-u','origin','main']);
    const church='docs/deals-pending-church-test.json';
    const slack='reviews/slack-live-deal-list-state.json';
    fs.writeFileSync(path.join(repo,church),'{"deals":[{"id":"church-test","title":"Visitor listing"}]}\n');
    fs.writeFileSync(path.join(repo,slack),'{"version":1,"entries":{}}\n');
    // Dirty live data must neither trigger maintenance nor be included in this source commit.
    fs.writeFileSync(path.join(repo,'docs/deals.json'),'{"deals":[{"id":"unrelated"}]}\n');
    run(process.execPath,['scripts/commit-generated.mjs','--message','Churches offline fixture',
      '--files','docs/deals-pending-church-*.json',slack]);
    for(const file of [church,slack]) assert.equal(run('git',['--git-dir',remote,'show',`main:${file}`]),fs.readFileSync(path.join(repo,file),'utf8').trim());
    assert.equal(run('git',['--git-dir',remote,'show','main:docs/deals.json']),'{"deals":[]}');
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
