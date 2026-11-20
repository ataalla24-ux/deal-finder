import assert from 'node:assert/strict';
import test from 'node:test';
import { sourcePublicationYield, formatSourcePublicationYield } from './source-publication-yield.mjs';
import { probeLiveFeed } from './check-launch-readiness.mjs';

const now = new Date('2026-11-20T12:00:00Z');
const ago = days => new Date(+now - days * 86400000);
function message(dealId, days, extra = {}) {
  return { dealId, slackTs: (+ago(days) / 1000).toFixed(6), slackSentAt: ago(days).toISOString(),
    decision: 'approved', decisionSource: 'reaction-scan', decidedAt: now.toISOString(),
    category: 'essen & trinken', originSource: 'Testseite', ...extra };
}
const feed = rows => ({status:'ok', receipts:rows.map(r => ({id:r.dealId, slackTs:r.slackTs}))});

test('real receipts, approval and public observation belong to the same delivery cohort', () => {
  const food = message('food', 2), old=message('old', 10,{category:'mode',originSource:'Shop'}),
    approvedPending=message('pending', 3,{publicationStatus:'published'}),
    undecided=message('other', 1, { category:'technik', decision:'',source:'Shop',originSource:'' });
  const rows=[food, old, approvedPending, undecided, message('no-receipt', 4, { slackSentAt:'' }),
    message('recovered-digest', 5,{slackThreadTs: (+ago(5)/1000).toFixed(6)})];
  const first=sourcePublicationYield({events:rows},feed([food,old,undecided]),null,now);
  assert.deepEqual(first.windows[0].totals.all,{delivered:3,approved:2,public:1});
  assert.deepEqual(first.windows[1].totals.food,{delivered:2,approved:2,public:1});
  assert.deepEqual(first.windows[1].totals.other,{delivered:2,approved:1,public:1});
  assert.deepEqual(first.windows[0].sources.map(s=>s.source),['Testseite','Shop']);
  const later=sourcePublicationYield({events:rows},{status:'error'},first,new Date(+now+1000));
  assert.deepEqual(later.windows,first.windows);
  assert.equal(later.lastPublicCheck,now.toISOString());
  assert.equal(formatSourcePublicationYield(later).includes('30 Tage'),true);
});

test('reposts count once, first-source attribution survives, mismatched and colliding receipts cannot prove publication', () => {
  const first=message('a',8,{decision:''}), retry=message('a',1,{originSource:'Copy'}),
    other=message('b',2), collision=message('c',2), late=message('future',-1),
    futureApproval=message('unknown',4,{decidedAt:ago(-1).toISOString()});
  const rows=[retry, first, other, collision, late, futureApproval];
  const report=sourcePublicationYield({events:rows},feed([first,other,late,futureApproval]),null,now);
  assert.deepEqual(report.windows[0].totals.all,{delivered:1,approved:0,public:0});
  assert.deepEqual(report.windows[1].totals.all,{delivered:2,approved:1,public:0});
  const next=sourcePublicationYield({events:rows},feed([retry]),report,now);
  assert.deepEqual(next.windows[1].sources.map(s=>s.source),['Testseite']);
  assert.equal(next.windows[1].totals.all.public,1);
  assert.equal(sourcePublicationYield(null,{status:'error'},next,now).windows.length,0);
  assert.equal(JSON.stringify(next).includes(retry.slackTs),false);
});

test('public probe only yields matching fields from a validated app feed', async()=>{
  const row={id:'x',title:'Angebot',slackTs:'1795172400.123456',other:'private'};
  const request=async()=>Response.json({deals:[row],totalDeals:1});
  assert.deepEqual((await probeLiveFeed(request,{includeReceipts:true})).receipts,[{id:row.id,slackTs:row.slackTs}]);
  assert.equal((await probeLiveFeed(request)).receipts,undefined);
  assert.equal((await probeLiveFeed(async()=>Response.json({deals:[row],totalDeals:2}),{includeReceipts:true})).receipts,undefined);
});
