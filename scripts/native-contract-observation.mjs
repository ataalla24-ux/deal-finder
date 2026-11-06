import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const artworkInputHash=deals=>hash(JSON.stringify(deals.map(d=>[d.id,d.title,d.category||'',d.brand||'',d.photoUrl||'',d.imageUrl||'']).sort((a,b)=>a[0].localeCompare(b[0]))));
const required=['test-artwork-native-parity','test-artwork-library-assets','test-deal-photo-sharing'];

export function nativeContractStatus(deals,snapshot){
  if(!snapshot)return {status:'missing-native-observation',semanticImageReview:false,recipientUiTest:false};
  const valid=required.every(name=>snapshot.tests?.some(t=>t.name===name&&t.status==='passed'));
  return {status:!valid?'native-tests-incomplete':snapshot.artworkInputHash!==artworkInputHash(deals)?'feed-changed-recheck-required':'observed-contracts-pass',
    checkedAt:snapshot.checkedAt,sourceHashes:snapshot.sourceHashes||{},semanticImageReview:false,recipientUiTest:false,
    caveat:'Current local native source was tested, not every installed Store version. Native source or library changes require a new observation.'};
}

export function observeNativeContracts({root=process.cwd(),nativeRoot,now=new Date()}={}){
  if(!nativeRoot)throw Error('Explicit native source checkout required');
  const feed=path.join(root,'docs/deals.json'),deals=JSON.parse(fs.readFileSync(feed,'utf8')).deals;
  const sourceFiles=['FreeFinderWien/DealsHomeArtwork.swift','FreeFinderWien/DealsHomeStyle.swift',
    'FreeFinderWien-Android/app/src/main/java/com/stefanataalla/freefinderwien/DealsHomeArtwork.kt',
    'FreeFinderWien-Android/app/src/main/java/com/stefanataalla/freefinderwien/MainActivity.kt',
    'FreeFinderWien-Android/app/src/main/java/com/stefanataalla/freefinderwien/FreeFinderShareSheet.kt',
    ...required.map(name=>'scripts/'+name+'.mjs')];
  const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,hash(fs.readFileSync(path.join(nativeRoot,file)))]));
  const tests=[];
  for(const name of required){
    const result=spawnSync(process.execPath,[path.join(nativeRoot,'scripts',name+'.mjs'),...(name==='test-artwork-native-parity'?[feed]:[])],
      {cwd:nativeRoot,encoding:'utf8',timeout:240000,env:{...process.env,SENTRY_DISABLED:'1'}});
    tests.push({name,status:result.status===0?'passed':'failed',stdout:result.stdout?.slice(-6000)||'',stderr:result.stderr?.slice(-3000)||''});
    if(result.status!==0)break;
  }
  const report={version:1,checkedAt:now.toISOString(),artworkInputHash:artworkInputHash(deals),sourceHashes,tests,
    semanticImageReview:false,recipientUiTest:false,noNativeAppOrStoreChange:true};
  fs.writeFileSync(path.join(root,'reviews/native-contract-observation.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv.indexOf('--native-root');
  const result=observeNativeContracts({nativeRoot:arg>=0?process.argv[arg+1]:null});
  console.log(JSON.stringify(result.tests));if(result.tests.length!==required.length||result.tests.some(t=>t.status!=='passed'))process.exitCode=1;
}
