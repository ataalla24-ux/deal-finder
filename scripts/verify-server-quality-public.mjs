import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const baseFiles=['deals.json','deal-map-locations.json','deal-of-the-day.json','deal-of-the-week.json'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function removalReadback(root, published) {
  const read = (name, field) => {
    const file = path.join(root, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))[field] || [] : [];
  };
  const removed = [
    ...read('reviews/automatic-deal-maintenance-state.json', 'hidden'),
    ...read('reviews/verified-expiry-archive.json', 'entries'),
  ];
  if (!removed.length) return { checked: 0, errors: [] };
  const feed = published.get('deals.json');
  const live = new Map((Array.isArray(feed) ? feed : feed.deals).map(deal => [deal.id, deal]));
  const locations = published.get('deal-map-locations.json').locations;
  const mapped = new Set(locations.flatMap(location => [...(location.dealIds || []), ...(location.automaticDealIds || [])]));
  const edits = read('docs/live-deal-edits.json', 'edits');
  const errors = [];
  for (const row of removed) {
    const current = live.get(row.id);
    if (!current) {
      if (mapped.has(row.id)) errors.push({ id: row.id, reason: 'removed-deal-on-public-map' });
      continue;
    }
    if (edits.some(edit => edit.dealId === row.id && (edit.forceKeep || edit.restoreDeal))) continue;
    const original = row.originalDeal || {};
    const originalEnd = row.validUntil || original.validUntil || original.validOn;
    const currentEnd = current.validUntil || current.validOn;
    const isLaterPeriod = /^20\d{2}-\d{2}-\d{2}$/.test(currentEnd)
      && Date.parse(currentEnd) > Date.parse(originalEnd);
    const approval = Date.parse(current.approvedAt);
    const hasNewApproval = approval > Date.parse(row.hiddenAt || row.removedAt)
      && approval > Date.parse(original.approvedAt)
      && /^\d{10}\.\d{6}$/.test(current.slackTs) && current.slackTs !== original.slackTs;
    if (!isLaterPeriod && !hasNewApproval) errors.push({ id: row.id, reason: 'removed-campaign-in-public-feed' });
  }
  return { checked: removed.length, errors };
}

export async function verifyPublicQuality({root=process.cwd(),request=fetch,attempts=12,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=Date.now,maxDurationMs=240000}={}){
  const policyFile=path.join(root,'reviews/live-deal-integrity-policy.json');
  const integrityRequired=fs.existsSync(policyFile)&&JSON.parse(fs.readFileSync(policyFile,'utf8')).enabled===true;
  const hasIntegrity=fs.existsSync(path.join(root,'docs/deal-integrity-status.json'));
  if(integrityRequired&&!hasIntegrity)throw Error('Enabled integrity audit has no published API status');
  const files=[...baseFiles,...(hasIntegrity?['deal-integrity-status.json']:[])];
  const expected=new Map(files.map(file=>[file,digest(fs.readFileSync(path.join(root,'docs',file)))]));
  const deadline=clock()+Math.max(1,Math.min(240000,maxDurationMs));
  let checks=[];
  for(let attempt=0;attempt<Math.max(1,Math.min(12,attempts));attempt++){
    checks=[];
    const published = new Map();
    for(const file of files){
      if(clock()>=deadline){checks.push({file,exact:false,error:'verification-deadline'});break;}
      try{
        const response=await request(`https://freefinder.at/${file}?quality=${expected.get(file).slice(0,16)}`,{signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-clock()))),headers:{'cache-control':'no-cache'}});
        if(!response.ok)throw Error(`HTTP ${response.status}`);
        const bytes=Buffer.from(await response.arrayBuffer()),actual=digest(bytes);
        if (actual === expected.get(file) && ['deals.json','deal-map-locations.json','deal-integrity-status.json'].includes(file))
          published.set(file, JSON.parse(bytes));
        checks.push({file,status:response.status,expected:expected.get(file),actual,exact:actual===expected.get(file)});
      }catch{checks.push({file,exact:false,error:'public-file-unavailable'});}
    }
    if(checks.length===files.length&&checks.every(row=>row.exact)) {
      const removals = removalReadback(root, published);
      const integrity=published.get('deal-integrity-status.json');
      const integrityErrors=[];
      if(integrity){
        const feed=published.get('deals.json'),deals=Array.isArray(feed)?feed:feed.deals;
        const version=`ff1-${digest(Buffer.from(JSON.stringify(deals))).slice(0,20)}`;
        if(integrity.publishedFeedVersion!==version||integrity.liveCount!==deals.length)
          integrityErrors.push('integrity-status-does-not-match-live-feed');
        if(!Number.isFinite(Date.parse(integrity.checkedAt))||Date.parse(integrity.checkedAt)>clock()+60000
          ||!Number.isFinite(Date.parse(integrity.staleAfter))||Date.parse(integrity.staleAfter)<=clock())
          integrityErrors.push('integrity-audit-stale-or-invalid');
      }
      return { status: removals.errors.length||integrityErrors.length ? 'publication-not-confirmed' : 'publicly-verified',
        checkedAt: new Date().toISOString(), checks, removals,
        ...(integrity?{integrity:{checkedAt:integrity.checkedAt,liveCount:integrity.liveCount,reviewRequired:integrity.reviewRequired,errors:integrityErrors}}:{}) };
    }
    if(clock()>=deadline)break;
    if(attempt+1<Math.min(12,attempts))await wait(Math.min(15000,Math.max(0,deadline-clock())));
  }
  return {status:'publication-not-confirmed',checkedAt:new Date().toISOString(),checks};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyPublicQuality();
  fs.mkdirSync('output',{recursive:true});
  fs.writeFileSync('output/server-quality-public-proof.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Oeffentliche Feed-/Karten-/Tages-/Wochendaten: ${result.status}.\n`);
  if(result.status!=='publicly-verified')process.exitCode=1;
}
