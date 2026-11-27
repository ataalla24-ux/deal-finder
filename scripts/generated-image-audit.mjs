import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {photoDigest} from './deal-photo-contract.mjs';
import {DEAL_IMAGE_GENERATION_MODEL,freeCreditOpenAiFetch} from '../scraper/ai-credit-budget.js';
import {createDealImagePreviewCheck} from '../scraper/deal-image-pilot.js';
import {GENERATED_IMAGE_CACHE,generatedDealImageKey,prepareGeneratedDealImagePreview} from '../scraper/generated-deal-images.js';

const sourcePattern = /^docs\/deals-pending(?:-[a-z0-9]+)*\.json$/;
const defaultProof = 'output/generated-deal-image-audit.json';

function readCandidate(root,sourceFile,dealId) {
  if (!sourcePattern.test(sourceFile) || typeof dealId !== 'string' || !dealId.trim() || dealId.length > 200) {
    throw Error('audit-input-invalid');
  }
  const source = path.join(root,sourceFile);
  if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== path.join(fs.realpathSync(root),sourceFile)) {
    throw Error('audit-source-path-invalid');
  }
  const bytes = fs.readFileSync(source);
  if (bytes.length > 20_000_000) throw Error('audit-source-size-invalid');
  const document = JSON.parse(bytes);
  const rows = Array.isArray(document) ? document : document?.deals;
  if (!Array.isArray(rows)) throw Error('audit-source-invalid');
  const matches = rows.filter(deal => deal?.id === dealId);
  if (matches.length !== 1) throw Error('audit-candidate-not-unique');
  const deal = matches[0];
  if (deal.approvedDealImage?.status === 'locked' || deal.pipelineLifecycle?.stage === 'published'
    || deal.pipelineLifecycle?.publishedAt || deal.publishedAt) throw Error('audit-candidate-already-published');
  const feed = JSON.parse(fs.readFileSync(path.join(root,'docs/deals.json'),'utf8'));
  const live = Array.isArray(feed) ? feed : feed?.deals;
  if (!Array.isArray(live)) throw Error('audit-feed-invalid');
  if (live.some(row => row?.id === dealId)) throw Error('audit-candidate-already-live');
  const draft = structuredClone(deal);
  for (const field of ['slackTs','slackThreadTs','pendingDealImage','approvedDealImage','generatedDealImage',
    'approvedAt','approvalBlock','imageApprovalContextHash','photoUrl','photoSubjectHash','pipelineLifecycle','imagePreparationState']) delete draft[field];
  return {draft,sourceSha256:photoDigest(bytes)};
}

function cacheEntry(root,key) {
  const file = path.join(root,GENERATED_IMAGE_CACHE);
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 8_000_000) throw Error('audit-cache-invalid');
  const cache = JSON.parse(fs.readFileSync(file,'utf8'));
  if (cache.version !== 1 || !cache.entries || typeof cache.entries !== 'object' || Array.isArray(cache.entries)) {
    throw Error('audit-cache-invalid');
  }
  return cache.entries[key] || null;
}

export async function auditImageModelAccess({request=fetch,apiKey=process.env.OPENAI_API_KEY,now=new Date()}={}) {
  const proof = {version:1,mode:'model-access',status:'model-access-unavailable',checkedAt:now.toISOString(),
    requests:0,providerGenerationRequests:0,availableImageModels:[],httpStatus:0};
  if (typeof apiKey !== 'string' || !apiKey.trim()) return {...proof,error:'model-access-credentials-unavailable'};
  try {
    proof.requests = 1;
    const response = await request('https://api.openai.com/v1/models',{method:'GET',redirect:'error',credentials:'omit',
      headers:{authorization:`Bearer ${apiKey}`,accept:'application/json'},signal:AbortSignal.timeout(15000)});
    proof.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      return {...proof,error:[401,403].includes(response.status)?'model-access-denied':'model-access-unavailable'};
    }
    if (!response.body) return {...proof,error:'model-list-invalid'};
    const reader = response.body.getReader(),chunks=[];
    let size=0;
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) {
        await reader.cancel();
        return {...proof,error:'model-list-invalid'};
      }
      chunks.push(value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(payload.data) || payload.data.length > 5000) return {...proof,error:'model-list-invalid'};
    const imageId = /^(?:gpt-image-|dall-e-)[a-zA-Z0-9._-]{1,72}$/;
    const ids = payload.data.map(row=>row?.id).filter(id=>typeof id==='string'&&imageId.test(id));
    return {...proof,status:'model-access-verified',availableImageModels:[...new Set(ids)].sort()};
  } catch {return {...proof,error:'model-access-unavailable'};}
}

export async function auditGeneratedDealImage({root=process.cwd(),mode,dealId,sourceFile,now=new Date(),
  prepare=prepareGeneratedDealImagePreview,request=freeCreditOpenAiFetch,publicRequest=fetch,apiKey=process.env.OPENAI_API_KEY}={}) {
  if (mode === 'model-access') return auditImageModelAccess({request:publicRequest,apiKey,now});
  if (!['generate','verify-public'].includes(mode)) throw Error('audit-mode-invalid');
  const {draft,sourceSha256} = readCandidate(root,sourceFile,dealId);
  const generationKey = generatedDealImageKey(draft);
  let prepared;
  if (mode === 'generate') {
    prepared = await prepare(draft,{root,now,request,apiKey,batch:{used:0,paused:false},
      checkPreview:createDealImagePreviewCheck({request:publicRequest})});
  } else {
    // Verification reads the committed result. It cannot enter a provider call.
    const row = cacheEntry(root,generationKey);
    if (row?.status === 'ready') {
      prepared = await prepare(draft,{root,now,apiKey:'',batch:{used:0,paused:true},
        request:async()=>{throw Error('audit-provider-call-forbidden');},
        checkPreview:createDealImagePreviewCheck({request:publicRequest})});
    }
  }
  const row = cacheEntry(root,generationKey);
  const publiclyVerified = prepared?.pendingDealImage?.version === 3
    && prepared.pendingDealImage.generationKey === generationKey;
  const status = mode === 'verify-public'
    ? publiclyVerified ? 'publicly-verified' : 'public-verification-pending'
    : row?.status === 'ready' ? 'prepared' : 'preparation-deferred';
  return {version:1,mode,status,checkedAt:now.toISOString(),sourceFile,sourceSha256,
    candidate:{id:dealId,title:String(draft.title || '').slice(0,300)},generationKey,
    model:DEAL_IMAGE_GENERATION_MODEL,cacheStatus:row?.status || 'missing',
    imagePreparationState:prepared?.imagePreparationState || 'waiting-generation',
    imageUrl:typeof row?.photoUrl === 'string' && /^https:\/\/freefinder\.at\/assets\/approved-deal-photos\/[a-f0-9]{16}-[a-f0-9]{64}\.jpg$/.test(row.photoUrl) ? row.photoUrl : null,
    imageSha256:typeof row?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256) ? row.sha256 : null,
    publiclyVerified,sourceUnchanged:photoDigest(fs.readFileSync(path.join(root,sourceFile))) === sourceSha256};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.env.GENERATED_IMAGE_AUDIT_MODE;
  const proofPath = path.resolve(defaultProof);
  let proof;
  try {
    proof = await auditGeneratedDealImage({mode,dealId:process.env.GENERATED_IMAGE_AUDIT_DEAL_ID,
      sourceFile:process.env.GENERATED_IMAGE_AUDIT_SOURCE_FILE});
    const succeeded = mode === 'model-access' ? proof.status === 'model-access-verified'
      : proof.sourceUnchanged && (mode === 'generate' ? proof.status === 'prepared' : proof.publiclyVerified);
    if (!succeeded) process.exitCode = 1;
  } catch {
    proof = {version:1,mode:['generate','verify-public','model-access'].includes(mode)?mode:'invalid',status:'audit-failed',
      checkedAt:new Date().toISOString(),error:'image-audit-unavailable'};
    process.exitCode = 1;
  }
  fs.mkdirSync(path.dirname(proofPath),{recursive:true});
  fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
}
