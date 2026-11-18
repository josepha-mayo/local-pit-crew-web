'use strict';
// Bounded authored deadline controls only. No sockets/model/browser or generated-code execution.
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareOllamaWorkbench,parseLaunchConfig,main}=require('../ui/ollama-workbench.cjs');
const {createWorkbenchApp}=require('./workbench-authored-admission.cjs');
const {getTasks,runAuthoredChecks}=require('./fixtures.cjs');
const task=getTasks().find(t=>t.id==='pagination-zero'),origin='http://127.0.0.1:48114',host='127.0.0.1:48114';
const profile={kind:'runtime-reported',profileHash:'a'.repeat(64),modelId:'AUTHORED-TIMEOUT-CONTROL',modelDigest:'b'.repeat(64),engineBuild:'AUTHORED-NOT-ACTUAL-ENGINE'};
const firebaseConfig={firebase:{apiKey:'public-example',projectId:'example-project',appId:'public-app-id'},appCheckSiteKey:'public-site-key',appName:'authored-timeout-control'};
const clone=x=>structuredClone(x);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function config(providerTimeoutMs){return{ollama:{model:'authored-coder:7b',...(providerTimeoutMs===undefined?{}:{providerTimeoutMs})},firebaseConfig:clone(firebaseConfig),contentSecurityPolicy:"default-src 'self'"};}
function metadata(){
 const calls=[],replies={
  '/api/version':{version:'0.20.0'},'/api/status':{cloud:{disabled:true,source:'authored-control'}},
  '/api/tags':{models:[{name:'authored-coder:7b',digest:'b'.repeat(64),size:1,details:{format:'gguf',quantization_level:'Q4_K_M'}}]},
  '/api/show':{details:{format:'gguf',quantization_level:'Q4_K_M'},capabilities:['completion'],template_source:'go_template',template:'authored'}
 };
 return{calls,requestJSON:async r=>{calls.push(r);assert.ok(Object.hasOwn(replies,r.pathname));return clone(replies[r.pathname]);}};
}
function answer(packet){
 const e=packet.evidence.find(e=>e.path===task.writable[0]);
 return{raw:JSON.stringify({edits:[{path:e.path,beforeSha256:e.sha256,find:e.content,replace:e.content+'\n// authored string, not run'}]}),
  receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'AUTHORED-CONTRACT-FAKE',source:'local-engine'}};
}
async function harness({providerTimeoutMs,generate,verifier=null}={}){
 const live={profile:clone(profile),coder:{locality:'local-only',generate:generate??(async packet=>answer(packet))},firebaseConfig:clone(firebaseConfig),contentSecurityPolicy:"default-src 'self'",publicVerifier:verifier,
  ...(providerTimeoutMs===undefined?{}:{providerTimeoutMs})};
 const app=await createWorkbenchApp({origin,live,browserBundleAvailable:true});let token,state,admission;
 async function request(method,pathname,body,extraHeaders={}){
  if(pathname==='/api/workbench/start'&&body&&Object.keys(body).length===1)body={...body,startAdmissionId:admission};
  const r=await app.dispatch({method,pathname,body,headers:{host,origin,'content-type':'application/json','x-pitcrew-token':token,...extraHeaders}});
  if(r.body?.startAdmissionId)admission=r.body.startAdmissionId;
  if(r.body?.state)state=r.body.state;return r;
 }
 const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
 const start=()=>request('POST','/api/workbench/start',{taskId:task.id});
 const action=(action,extra={})=>request('POST','/api/workbench/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra});
 return{live,boot,start,action,request,get state(){return state;}};
}
test('deadline defaults stay15000; configured total deadline is separate from per-HTTP timeout',async()=>{
 const m=metadata(),c=config();c.ollama.requestTimeoutMs=7;
 const p=await prepareOllamaWorkbench({config:c,requestJSON:m.requestJSON});
 assert.equal(p.live.providerTimeoutMs,15000);assert.ok(m.calls.every(r=>r.timeoutMs===7));p.coder.stop();
 const custom=await prepareOllamaWorkbench({config:config(60000),requestJSON:metadata().requestJSON});
 assert.equal(custom.live.providerTimeoutMs,60000);custom.coder.stop();
 const h=await harness();assert.equal(h.boot.body.capabilities.live.providerTimeoutMs,15000);assert.equal(h.boot.body.capabilities.live.available,true);
});
test('invalid explicit deadlines fail before metadata and make host mode unavailable',async()=>{
 for(const bad of [0,-1,120001,1.5,'15000',null]){
  assert.throws(()=>parseLaunchConfig(JSON.stringify(config(bad))),{message:'invalid-total-provider-deadline'});
  const h=await harness({providerTimeoutMs:bad});assert.equal(h.boot.body.capabilities.live.available,false);
  assert.ok(h.boot.body.capabilities.live.missing.includes('bounded total provider deadline'));assert.equal((await h.start()).status,503);
 }
});
test('metadata preparation total deadline rejects an abort-ignoring delegate; late reply cannot start host',async()=>{
 const entered=deferred(),release=deferred();let signal,calls=0,starts=0;
 const pending=main(['--config','explicit-authored.json'],{
  readFile:()=>JSON.stringify(config(10)),
  requestJSON:async r=>{calls++;signal=r.signal;entered.resolve();return release.promise;},
  startServer:async()=>{starts++;return{};},log(){},onFault(){}
 });
 await entered.promise;await assert.rejects(pending,{message:'ollama-workbench-preflight-failed'});
 assert.equal(signal.aborted,true);assert.equal(starts,0);assert.equal(calls,1);
 release.resolve({version:'0.20.0'});await new Promise(r=>setImmediate(r));
 assert.equal(starts,0);assert.equal(calls,1);
});
test('configured short total deadline reaches actual CodingSession, closes pending work and aborts coder',async()=>{
 const entered=deferred();let signal;
 const h=await harness({providerTimeoutMs:10,generate(_packet,options){
  signal=options.signal;entered.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('authored-abort')),{once:true}));
 }});
 await h.start();h.live.providerTimeoutMs=120000; // Owning host copied configuration before caller mutation.
 assert.equal(h.boot.body.capabilities.live.providerTimeoutMs,10);
 const pending=h.action('generate');await entered.promise;let timer;
 try{
  const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('configured deadline did not reach session')),1000);});
  const r=await Promise.race([pending,guard]);assert.equal(r.status,409);assert.equal(h.state.snapshot.closed,true);
  assert.equal(h.state.snapshot.pending,null);assert.equal(signal.aborted,true);assert.equal(h.state.proposal,null);
 }finally{clearTimeout(timer);await h.action('cancel');}
});
test('planner job TTL follows the same configured total deadline; cancellation remains owner-scoped',async()=>{
 // Fake verifier supplies facts only. It never runs ticket.files or establishes isolation.
 const checkIds=(await runAuthoredChecks(task.id,'corrected')).checks.map(c=>c.id);
 const verifier={isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){return{suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:checkIds.map(id=>({id,ok:false}))};}};
 const h=await harness({providerTimeoutMs:60000,verifier});const started=await h.start(),pair=started.body.plannerPair;
 assert.equal((await h.action('generate')).status,200);assert.equal((await h.action('apply')).status,200);assert.equal((await h.action('test')).status,200);
 const before=Date.now(),pending=h.action('generate');let claimed;
 try{
  claimed=await h.request('POST','/api/planner/claim',{sessionId:pair.sessionId,workerId:'AUTHORED-DEADLINE-WORKER'},{'x-pitcrew-token':pair.authToken});
  const after=Date.now();assert.equal(claimed.status,200);assert.ok(claimed.body.job);
  assert.ok(claimed.body.job.expiresAt>=before+60000);assert.ok(claimed.body.job.expiresAt<=after+60000);
 }finally{await h.action('cancel');}
 assert.equal((await pending).status,409);assert.equal(h.state.snapshot.closed,true);
});
test('request bodies cannot change the trusted host deadline',async()=>{
 const h=await harness({providerTimeoutMs:60000});
 assert.equal((await h.request('POST','/api/workbench/start',{taskId:task.id,providerTimeoutMs:120000})).status,400);
 await h.start();assert.equal((await h.action('generate',{providerTimeoutMs:1})).status,409);
 assert.equal(h.state.providerInvocations.coder,0);assert.equal(h.boot.body.capabilities.live.providerTimeoutMs,60000);
 await h.action('cancel');
});
