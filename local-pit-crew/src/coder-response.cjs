'use strict';
// Protocol validation only. Patch strings remain data; this module never executes source.
const {hash}=require('./controller.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const bytes=x=>Buffer.byteLength(x,'utf8');
const text=(x,max)=>typeof x==='string'&&x.length>0&&bytes(x)<=max;
const canonicalHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const digest=x=>typeof x==='string'&&/^(sha256:)?[a-f0-9]{64}$/.test(x);
const fail=code=>{throw Error(code);};
const PATCH_SCHEMA={
 type:'object',properties:{edits:{type:'array',minItems:1,maxItems:16,items:{
  type:'object',properties:{path:{type:'string'},beforeSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},find:{type:'string'},replace:{type:'string'}},
  required:['path','beforeSha256','find','replace'],additionalProperties:false
 }}},required:['edits'],additionalProperties:false
};
const FILE_CONTENTS_SCHEMA={
 type:'object',properties:{files:{type:'array',minItems:1,maxItems:16,items:{
  type:'object',properties:{path:{type:'string'},content:{type:'string',description:'The complete corrected file contents, not a fragment.'}},
  required:['path','content'],additionalProperties:false
 }}},required:['files'],additionalProperties:false
};
function validateProfile(profile){
 const keys=['kind','profileHash','modelId','modelDigest','engineBuild'];
 if(!exact(profile,keys)||!['authored-delegate','runtime-reported'].includes(profile.kind)||!canonicalHash(profile.profileHash)||!text(profile.modelId,256))fail('invalid-profile');
 if(profile.kind==='authored-delegate'){
  if(profile.modelDigest!=='none'||profile.engineBuild!=='none')fail('invalid-authored-profile');
 }else if(!digest(profile.modelDigest)||!text(profile.engineBuild,256))fail('invalid-runtime-profile-pins');
 return structuredClone(profile);
}
function validateCoderReceipt(receipt,{profile,requestId,workspaceHash}){
 const keys=['kind','requestId','profileHash','workspaceHash','provider','modelId','modelDigest','engineBuild','source'];
 const p=validateProfile(profile);
 if(!exact(receipt,keys)||!text(requestId,200)||!canonicalHash(workspaceHash)||!text(receipt.provider,80))fail('invalid-coder-receipt');
 if(receipt.requestId!==requestId||receipt.workspaceHash!==workspaceHash||!Object.keys(p).every(k=>receipt[k]===p[k]))fail('coder-receipt-pin-mismatch');
 if(p.kind==='authored-delegate'){
  if(receipt.provider!=='authored'||receipt.source!=='authored')fail('invalid-authored-receipt');
 }else if(receipt.source!=='local-engine')fail('unexpected-coder-source');
 // A post-call declared receipt cannot prove locality or undo a transmission.
 return structuredClone(receipt);
}
function validatePublicFeedback(feedback,workspaceHash){
 if(feedback===null)return null;
 if(!exact(feedback,['suiteId','workspaceHash','checks'])||!text(feedback.suiteId,120)||
  !canonicalHash(feedback.workspaceHash)||feedback.workspaceHash!==workspaceHash||
  !Array.isArray(feedback.checks)||!feedback.checks.length||feedback.checks.length>64||
  !feedback.checks.every(c=>exact(c,['id','ok'])&&text(c.id,120)&&typeof c.ok==='boolean')||
  new Set(feedback.checks.map(c=>c.id)).size!==feedback.checks.length)fail('invalid-public-feedback');
 return structuredClone(feedback);
}
function parseCoderResponse(raw,{evidence,writable,maxBytes=48000}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>48000||typeof raw!=='string'||bytes(raw)>maxBytes)fail('invalid-coder-response-size');
 if(!Array.isArray(writable)||!writable.length||writable.length>64||new Set(writable).size!==writable.length||!writable.every(x=>text(x,300)))fail('invalid-patch-scope');
 if(!Array.isArray(evidence)||!evidence.length)fail('missing-patch-evidence');
 const sources=new Map();
 for(const e of evidence){
  if(!e||!text(e.path,300)||typeof e.content!=='string'||!canonicalHash(e.sha256)||hash(e.content)!==e.sha256||sources.has(e.path))fail('invalid-patch-evidence');
  sources.set(e.path,e);
 }
 let artifact;try{artifact=JSON.parse(raw);}catch{fail('invalid-coder-json');}
 if(!exact(artifact,['edits'])||!Array.isArray(artifact.edits)||!artifact.edits.length||artifact.edits.length>Math.min(16,writable.length))fail('invalid-patch-envelope');
 const touched=new Set();
 for(const edit of artifact.edits){
  if(!exact(edit,['path','beforeSha256','find','replace'])||!writable.includes(edit.path)||touched.has(edit.path))fail('invalid-patch-path');
  touched.add(edit.path);
  const source=sources.get(edit.path);
  if(!source||edit.beforeSha256!==source.sha256)fail('patch-preimage-mismatch');
  if(!text(edit.find,20000)||typeof edit.replace!=='string'||bytes(edit.replace)>20000)fail('invalid-patch-edit-size');
  const at=source.content.indexOf(edit.find);
  if(at<0||source.content.indexOf(edit.find,at+1)!==-1)fail('ambiguous-patch-match');
 }
 return structuredClone(artifact);
}
function parseFileContentsResponse(raw,{evidence,writable,maxBytes=48000}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>48000||typeof raw!=='string'||bytes(raw)>maxBytes)fail('invalid-coder-response-size');
 let response;try{response=JSON.parse(raw);}catch{fail('invalid-coder-json');}
 if(!exact(response,['files'])||!Array.isArray(response.files)||!response.files.length||response.files.length>16||
  !Array.isArray(evidence)||!Array.isArray(writable))fail('invalid-file-contents-envelope');
 const edits=response.files.map(file=>{
  if(!exact(file,['path','content'])||!text(file.path,300)||!writable.includes(file.path)||
   typeof file.content!=='string'||bytes(file.content)>20000)fail('invalid-file-contents-entry');
  const source=evidence.find(e=>e?.path===file.path);
  if(!source||typeof source.content!=='string'||!source.content.length)fail('missing-file-contents-preimage');
  // All bindings come from the captured caller snapshot. Model contents stay verbatim.
  return{path:file.path,beforeSha256:source.sha256,find:source.content,replace:file.content};
 });
 return parseCoderResponse(JSON.stringify({edits}),{evidence,writable,maxBytes});
}
module.exports={PATCH_SCHEMA,FILE_CONTENTS_SCHEMA,validateProfile,validateCoderReceipt,validatePublicFeedback,parseCoderResponse,parseFileContentsResponse};
