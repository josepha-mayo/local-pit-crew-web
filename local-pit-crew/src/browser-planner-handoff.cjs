'use strict';
// Backend-owned planner provider + HTTP-compatible dispatch only. This module opens no socket.
const crypto=require('node:crypto');
const {parseDecision}=require('./firebase-local-client.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const clone=x=>structuredClone(x);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(x);
function origin(value,companion=false){
 let u;try{u=new URL(value);}catch{throw Error('invalid-handoff-origin');}
 if(u.origin!==value||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid-handoff-origin');
 if(companion?(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port):
  !(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw Error('invalid-handoff-origin');
 return u;
}
class BrowserPlannerHandoff{
 #session;#token;#companion;#ui;#ttl;#clock;#pending=null;#closed=false;
 constructor({sessionId,authToken,companionOrigin,uiOrigin,ttlMs=15000,clock=Date.now}={}){
  if(!id(sessionId)||typeof authToken!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(authToken)||
   !Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>120000||typeof clock!=='function')throw Error('invalid-handoff-config');
  this.#companion=origin(companionOrigin,true);this.#ui=origin(uiOrigin);
  this.#session=sessionId;this.#token=Buffer.from(authToken);this.#ttl=ttlMs;this.#clock=clock;
 }
 get sessionId(){return this.#session;}
 async decide(snapshot){
  if(this.#closed)throw Error('handoff-closed');
  if(this.#pending)throw Error('handoff-job-pending');
  if(!snapshot||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||snapshot.closed!==false)throw Error('invalid-handoff-snapshot');
  const raw=JSON.stringify(snapshot);
  if(Buffer.byteLength(raw)>18000)throw Error('handoff-snapshot-byte-budget');
  const observed=JSON.parse(raw),now=this.#clock();
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid-handoff-clock');
  const job={sessionId:this.#session,jobId:crypto.randomUUID(),revision:observed.revision,snapshotHash:sha(raw),
   expiresAt:now+this.#ttl,snapshot:observed};
  return new Promise((resolve,reject)=>{
   const pending={job,owner:null,claimId:null,resolve,reject,timer:null};
   this.#pending=pending;
   pending.timer=setTimeout(()=>{if(this.#pending===pending)this.#reject('handoff-expired');},this.#ttl);
  });
 }
 #reject(code){
  const p=this.#pending;if(!p)return;
  this.#pending=null;clearTimeout(p.timer);p.reject(Error(code));
 }
 #resolve(value){
  const p=this.#pending;this.#pending=null;clearTimeout(p.timer);p.resolve(clone(value));
 }
 stop(){this.#closed=true;this.#reject('handoff-stopped');}
 #expire(){if(this.#pending&&this.#clock()>=this.#pending.job.expiresAt)this.#reject('handoff-expired');}
 #matches(body){
  const p=this.#pending;
  return !!p&&body.sessionId===this.#session&&body.workerId===p.owner&&body.jobId===p.job.jobId&&body.claimId===p.claimId&&
   body.revision===p.job.revision&&body.snapshotHash===p.job.snapshotHash;
 }
 #decision(outcome){
  if(!exact(outcome,['status','decision','inferenceSource'])||outcome.status!=='decision'||outcome.inferenceSource!=='on_device')throw Error('invalid-browser-planner-result');
  const s=this.#pending.job.snapshot,d=parseDecision(JSON.stringify(outcome.decision),s.revision);
  const current=(s.evidence??[]).filter(e=>(s.manifest??[]).some(m=>m.path===e.path&&m.sha256===e.sha256));
  const evidenceIds=new Set(current.map(e=>e.id)),known=new Set([...current,...(s.events??[])].map(e=>e.id));
  if(!['code','ask_user'].includes(d.action)||d.reasonEvidenceIds.some(x=>!known.has(x))||
   (d.action==='code'&&(new Set(d.evidenceIds).size!==d.evidenceIds.length||d.evidenceIds.some(x=>!evidenceIds.has(x))||Buffer.byteLength(d.objective)>3000)))throw Error('invalid-browser-planner-action');
  return{status:'decision',decision:d,inferenceSource:'on_device'};
 }
 async dispatch({method,pathname,headers={},body}={}){
  const h=Object.create(null);for(const [k,v]of Object.entries(headers))h[k.toLowerCase()]=v;
  const cors=h.origin===this.#ui.origin?{'Access-Control-Allow-Origin':this.#ui.origin,'Vary':'Origin','Cache-Control':'no-store'}:{'Vary':'Origin','Cache-Control':'no-store'};
  const reply=(status,value)=>({status,headers:cors,body:value});
  const error=(status,code)=>reply(status,{error:code});
  if(h.host!==this.#companion.host||h.origin!==this.#ui.origin)return error(403,'handoff-origin-rejected');
  const routes=['/api/planner/claim','/api/planner/status','/api/planner/result'];
  if(!routes.includes(pathname))return error(404,'unknown-handoff-route');
  if(method==='OPTIONS'){
   const requested=typeof h['access-control-request-headers']==='string'?h['access-control-request-headers'].toLowerCase().split(',').map(x=>x.trim()):[];
   if(h['access-control-request-method']!=='POST'||requested.some(x=>!['content-type','x-pitcrew-token'].includes(x)))return error(403,'handoff-preflight-rejected');
   return{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, X-Pitcrew-Token'},body:null};
  }
  const supplied=typeof h['x-pitcrew-token']==='string'?Buffer.from(h['x-pitcrew-token']):Buffer.alloc(0);
  if(supplied.length!==this.#token.length||!crypto.timingSafeEqual(supplied,this.#token))return error(403,'handoff-authorization-rejected');
  if(method!=='POST'||typeof h['content-type']!=='string'||!/^application\/json(?:;|$)/i.test(h['content-type']))return error(415,'handoff-json-post-required');
  try{if(Buffer.byteLength(JSON.stringify(body))>20000)return error(413,'handoff-body-too-large');}catch{return error(400,'invalid-handoff-body');}
  this.#expire();
  if(pathname==='/api/planner/claim'){
   if(!exact(body,['sessionId','workerId'])||body.sessionId!==this.#session||!id(body.workerId))return error(400,'invalid-handoff-claim');
   if(this.#closed)return reply(410,{closed:true});
   const p=this.#pending;if(!p)return reply(200,{job:null});
   if(p.owner&&p.owner!==body.workerId)return error(409,'handoff-already-claimed');
   if(!p.owner){p.owner=body.workerId;p.claimId=crypto.randomUUID();}
   return reply(200,{job:{...clone(p.job),workerId:p.owner,claimId:p.claimId}});
  }
  const binding=['sessionId','workerId','jobId','claimId','revision','snapshotHash'];
  if(pathname==='/api/planner/status'){
   if(!exact(body,binding))return error(400,'invalid-handoff-binding');
   return reply(200,{active:!this.#closed&&this.#matches(body),closed:this.#closed});
  }
  if(!exact(body,[...binding,'outcome']))return error(400,'invalid-handoff-result');
  if(this.#closed||!this.#matches(body))return error(409,'stale-handoff-result');
  try{
   if(exact(body.outcome,['status','reason'])&&body.outcome.status==='blocked'&&['local-not-ready','planner-failed','cancelled'].includes(body.outcome.reason)){
    this.#resolve({status:'blocked',reason:'browser-planner-blocked'});
   }else this.#resolve(this.#decision(body.outcome));
   return reply(200,{accepted:true});
  }catch{this.#reject('browser-planner-result-rejected');return error(422,'browser-planner-result-rejected');}
 }
}
module.exports={BrowserPlannerHandoff};
