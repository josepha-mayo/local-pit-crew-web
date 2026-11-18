'use strict';
// Authored in-memory workflow contract. No filesystem, process, network or code execution.
const crypto=require('node:crypto');
const clone=x=>structuredClone(x);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const bytes=x=>new TextEncoder().encode(x).byteLength;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const text=(x,max)=>typeof x==='string'&&x.length>0&&bytes(x)<=max;
const workspaceHash=files=>hash(JSON.stringify(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0)));
class ReferenceController {
 #s;#pending=null;#evidence=new Map();#artifacts=new Map();#seq=0;#session=crypto.randomUUID();
 constructor({files,writable,taskText,suiteId,checkIds,limits={}}){
  if(!record(files)||!Object.keys(files).length||!Object.values(files).every(v=>typeof v==='string'))throw Error('invalid file manifest');
  if(!Array.isArray(writable)||!writable.length||new Set(writable).size!==writable.length||!writable.every(p=>Object.hasOwn(files,p)))throw Error('invalid writable manifest');
  if(!text(taskText,6000)||!text(suiteId,120))throw Error('invalid task contract');
  if(!Array.isArray(checkIds)||!checkIds.length||new Set(checkIds).size!==checkIds.length||!checkIds.every(id=>text(id,120)))throw Error('invalid public-check contract');
  const caps={decisions:20,coder:3,patches:2,tests:3,contextBytes:24000,...limits};
  if(!Object.values(caps).every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('invalid limits');
  this.#s={revision:0,closed:false,files:clone(files),writable:[...writable],taskText,suiteId,checkIds:[...checkIds],caps,
   counts:{decisions:0,coder:0,patches:0,tests:0},publicCheckHash:null};
 }
 snapshot(){
  const s=this.#s;
  return{mode:'reference-memory-only',revision:s.revision,closed:s.closed,originalTask:s.taskText,
   manifest:Object.entries(s.files).map(([path,content])=>({path,sha256:hash(content),bytes:bytes(content)})),
   evidence:[...this.#evidence].map(([id,e])=>({id,...clone(e)})),artifacts:[...this.#artifacts.keys()],
   pending:this.#pending?{id:this.#pending.id,type:this.#pending.type}:null,
   counts:clone(s.counts),publicChecksCurrent:s.publicCheckHash===workspaceHash(s.files)};
 }
 filesForReferenceTest(){return clone(this.#s.files);}
 decide(a){
  const s=this.#s;
  if(s.closed)throw Error('closed');
  if(this.#pending)throw Error('pending operation');
  if(!record(a)||a.revision!==s.revision)throw Error('stale revision');
  if(s.counts.decisions>=s.caps.decisions)throw Error('decision budget');
  s.counts.decisions++; // Malformed current-revision proposals consume budget too.
  const begin=(type,request)=>{
   s.revision++;
   this.#pending={id:this.#session+':'+(++this.#seq),type,request:clone(request)};
   return clone(this.#pending);
  };
  if(a.type==='read'){
   if(!exact(a,['revision','type','path'])||!Object.hasOwn(s.files,a.path))throw Error('read outside manifest');
   return begin('read',{path:a.path,sha256:hash(s.files[a.path])});
  }
  if(a.type==='code'){
   if(!exact(a,['revision','type','evidenceIds','objective'])||!text(a.objective,3000)||!Array.isArray(a.evidenceIds)||!a.evidenceIds.length||new Set(a.evidenceIds).size!==a.evidenceIds.length)throw Error('invalid coding request');
   if(s.counts.coder>=s.caps.coder)throw Error('coder budget');
   const evidence=a.evidenceIds.map(id=>{
    const e=this.#evidence.get(id);
    if(!e||!Object.hasOwn(s.files,e.path)||hash(s.files[e.path])!==e.sha256)throw Error('missing or stale evidence');
    return clone(e);
   });
   if(evidence.reduce((n,e)=>n+bytes(e.content),0)>s.caps.contextBytes)throw Error('context byte budget');
   s.counts.coder++;
   return begin('code',{originalTask:s.taskText,nextStepHint:a.objective,evidence,writable:[...s.writable],workspaceHash:workspaceHash(s.files)});
  }
  if(a.type==='apply'){
   if(!exact(a,['revision','type','artifactId']))throw Error('invalid apply');
   if(s.counts.patches>=s.caps.patches)throw Error('patch budget');
   const artifact=this.#artifacts.get(a.artifactId);
   if(!artifact)throw Error('unknown artifact');
   const next=clone(s.files),touched=new Set();
   for(const e of artifact.edits){
    if(!exact(e,['path','beforeSha256','find','replace'])||!s.writable.includes(e.path)||touched.has(e.path))throw Error('edit outside scope or duplicate path');
    touched.add(e.path);
    const before=s.files[e.path];
    if(e.beforeSha256!==hash(before))throw Error('stale source hash');
    if(!text(e.find,20000)||typeof e.replace!=='string'||bytes(e.replace)>20000)throw Error('invalid edit bytes');
    const at=before.indexOf(e.find);
    if(at<0||before.indexOf(e.find,at+1)!==-1)throw Error('ambiguous exact replacement');
    next[e.path]=before.slice(0,at)+e.replace+before.slice(at+e.find.length);
   }
   if(!touched.size)throw Error('empty patch');
   s.files=next;s.publicCheckHash=null;s.counts.patches++;s.revision++;
   return{type:'applied-in-memory',paths:[...touched],workspaceHash:workspaceHash(s.files)};
  }
  if(a.type==='test'){
   if(!exact(a,['revision','type']))throw Error('invalid public test request');
   if(s.counts.tests>=s.caps.tests)throw Error('test budget');
   s.counts.tests++;
   return begin('test',{suiteId:s.suiteId,workspaceHash:workspaceHash(s.files)});
  }
  if(a.type==='finish'){
   if(!exact(a,['revision','type']))throw Error('invalid finish');
   if(s.publicCheckHash!==workspaceHash(s.files))throw Error('no current public-check verification');
   s.closed=true;s.revision++;
   return{type:'public-checks-complete',workspaceHash:s.publicCheckHash};
  }
  throw Error('unknown action');
 }
 // Trusted backend providers only. Never expose this as a model action/public request.
 complete(id,result){
  const s=this.#s,op=this.#pending;
  if(s.closed||!op||op.id!==id)return{accepted:false,reason:'late or unknown operation'};
  try{
   if(op.type==='read'){
    if(!exact(result,['content'])||typeof result.content!=='string'||hash(result.content)!==op.request.sha256)throw Error('read hash mismatch');
    this.#evidence.set('e:'+id,{path:op.request.path,sha256:op.request.sha256,content:result.content});
   }else if(op.type==='code'){
    if(!exact(result,['edits'])||!Array.isArray(result.edits)||!result.edits.length||result.edits.length>s.writable.length)throw Error('invalid code artifact');
    this.#artifacts.set('a:'+id,clone(result));
   }else if(op.type==='test'){
    if(!exact(result,['suiteId','workspaceHash','checks'])||result.suiteId!==s.suiteId||result.workspaceHash!==op.request.workspaceHash||result.workspaceHash!==workspaceHash(s.files)||
     !Array.isArray(result.checks)||result.checks.length!==s.checkIds.length||new Set(result.checks.map(c=>c.id)).size!==s.checkIds.length||
     !result.checks.every(c=>exact(c,['id','ok'])&&s.checkIds.includes(c.id)&&typeof c.ok==='boolean'))throw Error('invalid independent public verdict');
    s.publicCheckHash=result.checks.every(c=>c.ok)?result.workspaceHash:null;
   }
   s.revision++;
   return{accepted:true};
  }finally{this.#pending=null;}
 }
 // Trusted workflow only, after a verifier confirms candidate code was never sent.
 releaseUnstartedTest(id){
  if(this.#s.closed||this.#pending?.id!==id||this.#pending.type!=='test')return false;
  this.#pending=null;
  this.#s.publicCheckHash=null;
  this.#s.counts.tests--;
  this.#s.revision++;
  return true;
 }
 cancel(){this.#s.closed=true;this.#s.publicCheckHash=null;this.#s.revision++;this.#pending=null;}
}
module.exports={ReferenceController,workspaceHash,hash};
