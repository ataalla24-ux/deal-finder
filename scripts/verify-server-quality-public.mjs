import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const files=['deals.json','deal-map-locations.json','deal-of-the-day.json','deal-of-the-week.json'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function verifyPublicQuality({root=process.cwd(),request=fetch,attempts=12,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=Date.now,maxDurationMs=240000}={}){
  const expected=new Map(files.map(file=>[file,digest(fs.readFileSync(path.join(root,'docs',file)))]));
  const deadline=clock()+Math.max(1,Math.min(240000,maxDurationMs));
  let checks=[];
  for(let attempt=0;attempt<Math.max(1,Math.min(12,attempts));attempt++){
    checks=[];
    for(const file of files){
      if(clock()>=deadline){checks.push({file,exact:false,error:'verification-deadline'});break;}
      try{
        const response=await request(`https://freefinder.at/${file}?quality=${expected.get(file).slice(0,16)}`,{signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-clock()))),headers:{'cache-control':'no-cache'}});
        if(!response.ok)throw Error(`HTTP ${response.status}`);
        const bytes=Buffer.from(await response.arrayBuffer()),actual=digest(bytes);
        checks.push({file,status:response.status,expected:expected.get(file),actual,exact:actual===expected.get(file)});
      }catch{checks.push({file,exact:false,error:'public-file-unavailable'});}
    }
    if(checks.length===files.length&&checks.every(row=>row.exact))return {status:'publicly-verified',checkedAt:new Date().toISOString(),checks};
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
