import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {blogCandidates,validateBlogDraft,prepareServerBlog} from './server-blog-draft.mjs';

const now=new Date('2026-11-06T11:00:00Z');
const url='https://www.drei.at/de/dreiplus/ersparnisse/cleverfit/';
const deal={id:'example',title:'10 % fuer neue Mitglieder',brand:'clever fit',url,category:'freizeit'};
const text='Neue Mitglieder erhalten 10 Prozent Rabatt. Nur teilnehmende Studios. Code per SMS anfordern.';
const digest=value=>createHash('sha256').update(value).digest('hex');
const source={officialText:text,verifiedAt:now.toISOString(),contentHash:digest(text)};
const coverage={entries:[{id:deal.id,status:'covered',slug:'clever-fit-wien'}]};

test('blog accepts same-day verified existing guide, rejects stale, held and short-lived offers',()=>{
  assert.equal(blogCandidates([deal],coverage,new Map([[deal.id,source]]),now).length,1);
  assert.equal(blogCandidates([{...deal,validUntil:'2026-11-08'}],coverage,new Map([[deal.id,source]]),now).length,0);
  assert.equal(blogCandidates([deal],{entries:[{...coverage.entries[0],status:'held'}]},new Map([[deal.id,source]]),now).length,0);
  assert.equal(blogCandidates([deal],coverage,new Map([[deal.id,{...source,verifiedAt:'2026-11-05T23:01:00Z'}]]),now).length,1);
  assert.equal(blogCandidates([deal],coverage,new Map([[deal.id,{...source,verifiedAt:'2026-11-05T20:00:00Z'}]]),now).length,0);
});

test('blog draft rejects thin text, markup and invented evidence quotes',()=>{
  const draft={useful:true,title:'Der Mitgliedervorteil im Detail',sections:Array.from({length:3},()=>({heading:'Bedingungen beachten',text:Array(100).fill('Beispiel').join(' '),quote:text}))};
  assert.equal(validateBlogDraft(draft,{source}),true);
  assert.equal(validateBlogDraft({...draft,sections:[draft.sections[0]]},{source}),false);
  for(const patch of [{quote:'Jeder bekommt alles gratis.'},{text:'<script>test</script>'}])assert.equal(validateBlogDraft({...draft,sections:draft.sections.map(row=>({...row,...patch}))},{source}),false);
});

test('server blog records at most one daily attempt, writes only review artifacts, preserves published guide',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ff-blog-'));
  const before=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-not-a-real-key';
  try{
    fs.mkdirSync(path.join(root,'docs/blog'),{recursive:true});fs.mkdirSync(path.join(root,'reviews'));
    const write=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
    write('docs/deals.json',{deals:[deal]});write('reviews/blog-coverage-2026-10-30.json',coverage);
    write('reviews/maintenance-source-evidence.json',{entries:{[url]:{url,brand:deal.brand,status:'verified',text,hash:digest(text),checkedAt:now.toISOString()}}});
    const original='<article>Existing verified guide</article>';fs.writeFileSync(path.join(root,'docs/blog/clever-fit-wien.html'),original);
    let calls=0;
    const request=async()=>{calls++;return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({useful:false,title:'',sections:[]})}}]})};};
    const report=await prepareServerBlog({root,now,allowAi:true,request});
    assert.equal(report.status,'no-safe-substantive-draft');assert.equal(calls,1);
    const second=await prepareServerBlog({root,now,allowAi:true,request});assert.equal(second.status,'daily-attempt-already-recorded');assert.equal(calls,1);
    write('reviews/2026-11-06-daily-blog.json',{result:'exists'});
    assert.equal((await prepareServerBlog({root,now,allowAi:true,request})).status,'existing-editorial-result-needs-no-second-draft');
    assert.equal(fs.readFileSync(path.join(root,'docs/blog/clever-fit-wien.html'),'utf8'),original);
    assert.equal(report.automaticPublicationEnabled,false);
  }finally{if(before===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=before;fs.rmSync(root,{recursive:true,force:true});}
});
