'use strict';
// Authored in-process lifecycle regressions only. Fake DOM/fetch/client/provider; no SDK/model/network/source runner.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const fixtures=require('./fixtures.cjs');
const {createWorkbenchApp}=require('./workbench-authored-admission.cjs');
const origin='http://127.0.0.1:48115',host='127.0.0.1:48115';
const task=fixtures.getTasks().find(t=>t.id==='pagination-zero');
const profile={kind:'runtime-reported',profileHash:'c'.repeat(64),modelId:'AUTHORED-RACE-FAKE',modelDigest:'d'.repeat(64),engineBuild:'AUTHORED-NOT-ACTUAL'};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function response(packet){
 const e=packet.evidence.find(e=>e.path===task.writable[0]);
 return{raw:JSON.stringify({edits:[{path:e.path,beforeSha256:e.sha256,find:e.content,replace:task.correction[e.path]}]}),
  receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'AUTHORED-FAKE',source:'local-engine'}};
}
async function harness({coderOnly=false,firebaseConfigured=true}={}){
 let provider=null;const packets=[];
 const live={profile,coderOnlyPreview:coderOnly,coder:{locality:'local-only',async generate(packet){packets.push(packet);return provider?provider(packet):response(packet);}},
  firebaseConfig:firebaseConfigured?{firebase:{apiKey:'AUTHORED-PUBLIC',projectId:'AUTHORED-PROJECT',appId:'AUTHORED-APP'},appCheckSiteKey:'AUTHORED-PUBLIC',appName:'authored-race'}:null,
  contentSecurityPolicy:"default-src 'self'"};
 const app=await createWorkbenchApp({origin,live,browserBundleAvailable:true});let token,state,admission;
 async function request(method,pathname,body,extra={}){
  if(pathname==='/api/workbench/start'&&body&&Object.keys(body).length===1)body={...body,startAdmissionId:admission};
  const r=await app.dispatch({method,pathname,body,headers:{host,origin,'content-type':'application/json','x-pitcrew-token':token,...extra}});
  if(r.body?.startAdmissionId)admission=r.body.startAdmissionId;
  if(r.body?.state)state=r.body.state;return r;
 }
 const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
 const reference=()=>request('POST','/api/start',{taskId:task.id});
 const local=()=>request('POST','/api/workbench/start',{taskId:task.id});
 const cancelReference=()=>request('POST','/api/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action:'cancel'});
 return{app,request,reference,local,cancelReference,packets,get state(){return state;},set provider(fn){provider=fn;}};
}
class Element{
 constructor(){this.value='';this.disabled=true;this.children=[];this.listeners=new Map();this.attributes=new Map();this.textContent='';}
 setAttribute(name,value){this.attributes.set(name,value);}
 addEventListener(k,f){this.listeners.set(k,f);}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=[...x];}
 emit(k){return this.listeners.get(k)?.();}
}
async function settle(){for(let i=0;i<24;i++)await Promise.resolve();}
async function frontend({openReference=true,cloudReviewer=null,coderOnly=false,firebaseConfigured=true,functionAvailable=false,bootstrapState=null}={}){
 const h=await harness({coderOnly,firebaseConfigured});if(openReference)await h.reference();
 const elements=new Map(),hooks=new Map(),queue=[],timers=new Map(),preparationOptions=[];let timer=0,stops=0,prepares=0,nextPrepare=null,nextPump=null,observe=null;
 const client={state:{prepared:false},async prepareFromUserGesture(options={}){
  prepares++;preparationOptions.push(JSON.parse(JSON.stringify(options)));
  if(nextPrepare){const d=nextPrepare;nextPrepare=null;const result=await d.promise;this.state.prepared=result.status==='prepared';return result;}
  this.state.prepared=true;return{status:'prepared'};
 },stop(){stops++;this.state.prepared=false;},async dispose(){this.stop();}};
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},addEventListener(k,f){hooks.set(k,f);}};
 const window={document,location:{origin},crypto:{randomUUID:crypto.randomUUID},addEventListener(k,f){hooks.set(k,f);},
  setTimeout(fn){const id=++timer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
  LocalPitCrewCreateFirebasePlanner(){return client;},
  LocalPitCrewCreateFirebaseCloudReviewer:cloudReviewer?()=>cloudReviewer:undefined,
  LocalPitCrewBrowserPlanner:{createFetchPlannerTransport(){return{};},createBrowserPlannerPump(options){
   observe=options.onObservation;
   const d=nextPump;nextPump=null;return{runOne(){return d?d.promise:Promise.resolve({status:'idle'});},stop(){client.stop();}};
  }},
  fetch(url,options){const d=deferred();queue.push({url,options,...d});return d.promise;}};
 async function server(item){
  return h.request(item.options.method,item.url,item.options.body?JSON.parse(item.options.body):undefined,
   Object.fromEntries(Object.entries(item.options.headers).map(([k,v])=>[k.toLowerCase(),v])));
 }
 function deliver(item,result){item.resolve({ok:result.status>=200&&result.status<300,json:async()=>result.body});}
 async function reply(item=queue.shift()){assert.ok(item,'expected frontend request');const r=await server(item);
  // UI lifecycle fixture only. This cannot register an executable verifier.
  if(functionAvailable&&item.url==='/api/bootstrap')r.body.capabilities.functionContract={available:true,qualified:false};
  if(bootstrapState&&item.url==='/api/bootstrap')r.body.state=structuredClone(bootstrapState);
  deliver(item,r);await settle();return r;}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/public/app.js'),'utf8'),{window,TextEncoder},{filename:'authored-workbench-race-ui.js',timeout:1000});
 hooks.get('DOMContentLoaded')();await reply();await settle();elements.get('sample').value=task.id;
 async function start(){const p=elements.get('open-live').emit('click');await settle();await reply();await p;return h.state.sessionId;}
 return{h,client,queue,server,deliver,reply,start,hooks,preparationOptions,el:id=>document.getElementById(id),get stops(){return stops;},get prepares(){return prepares;},get observe(){return observe;},
  deferPrepare(){const d=deferred();nextPrepare=d;return d;},deferPump(){const d=deferred();nextPump=d;return d;}};
}

test('function intake: cloud rendering preserves user-function identity and never calls its patches authored corrections',async()=>{
 const {createFunctionTask,TASK_SCHEMA}=require('../runner/function-contract.cjs');
 const {createFunctionWorkflow}=require('../src/function-workflow.cjs');
 const own=createFunctionTask({schema:TASK_SCHEMA,title:'My function',instructions:'Return the argument.',exportName:'fn',source:'module.exports={fn:x=>x};',cases:[{label:'zero',args:[0],expected:0}]});
 const flow=createFunctionWorkflow({task:own,verifier:{capabilityFor:()=>({available:false,qualified:false,admissionKind:'unavailable'})}});
 const f=await frontend({bootstrapState:flow.state()});
 assert.match(f.el('mode-chip').textContent,/Your function/);assert.equal(f.el('scope-title').textContent,'A repair has to earn every check.');
 assert.doesNotMatch(f.el('scope-copy').textContent,/authored|reference/i);assert.match(f.el('proposal-source').textContent,/Paste your proposed full function source/);
 assert.doesNotMatch(f.el('proposal-source').textContent,/authored correction/);f.hooks.get('pagehide')();
});

test('function intake: a late rejected open cannot cancel a replacement returned in its error state',async()=>{
 const f=await frontend({functionAvailable:true});f.el('fill-function-example').emit('click');
 const pending=f.el('open-function').emit('click'),old=f.queue.shift();assert.equal(old.url,'/api/function/open');
 const close=f.el('cancel').emit('click');await f.reply();await close;
 const replacement={...f.h.state,mode:'function-contract',sessionId:'replacement-function',snapshot:{...f.h.state.snapshot,closed:false}};
 f.deliver(old,{status:409,body:{error:'Start admission expired.',state:replacement}});await pending;await settle();
 assert.equal(f.queue.length,0,'an error-state owner is never a successful start receipt');
 f.hooks.get('pagehide')();
});

test('function intake: a late successful open is canceled by its exact returned owner only',async()=>{
 const f=await frontend({functionAvailable:true});f.el('fill-function-example').emit('click');
 const pending=f.el('open-function').emit('click'),old=f.queue.shift();
 const close=f.el('cancel').emit('click');await f.reply();await close;
 const accepted={...f.h.state,mode:'function-contract',sessionId:'accepted-old-function'};
 f.deliver(old,{status:200,body:{state:accepted,openedFunctionSessionId:accepted.sessionId}});await pending;await settle();
 const compensation=f.queue.shift();assert.equal(compensation.url,'/api/function/action');
 assert.deepEqual(JSON.parse(compensation.options.body),{sessionId:accepted.sessionId,revision:accepted.snapshot.revision,action:'cancel'});
 f.deliver(compensation,{status:409,body:{error:'Old owner is no longer current.'}});await settle();
 assert.equal(f.queue.length,0);f.hooks.get('pagehide')();
});

test('workbench review: each new provider proposal needs review after an earlier patch was applied',async()=>{
 const f=await frontend();await f.start();
 assert.deepEqual(f.preparationOptions,[{repairAdviceOnly:true,repairAdviceFormat:'source-line'}],'the full workbench prepares source-line repair advice, not the general action protocol');
 for(const action of ['load','apply','load']){const pending=f.el(action).emit('click');await f.reply();await pending;}
 assert.equal(f.h.state.snapshot.counts.patches,1);assert.equal(f.h.state.proposal.applied,false);
 assert.equal(f.el('apply').disabled,false);assert.equal(f.el('patch-state').textContent,'REVIEW REQUIRED');
 f.hooks.get('pagehide')();
});

test('workbench review: planner diagnosis survives own closure and cannot cross into a replacement owner',async()=>{
 const f=await frontend();await f.start();const observe=f.observe,sessionId=f.h.state.sessionId,revision=f.h.state.snapshot.revision;
 observe({sessionId,revision,status:'blocked',inferenceSource:null,diagnostic:'output-grounding'});
 assert.match(f.el('advisor-status').textContent,/repair citation.*current source/);
 const close=f.el('cancel').emit('click');await f.reply();await close;
 assert.match(f.el('advisor-status').textContent,/repair citation.*current source/);
 await f.start();observe({sessionId,revision,status:'blocked',inferenceSource:null,diagnostic:'output-grounding'});
 assert.match(f.el('advisor-status').textContent,/automatically after an applied patch fails/);
 f.hooks.get('pagehide')();
});

test('workbench review: coder-only mode describes the available actions without suggesting disabled advisors',async()=>{
 const f=await frontend({coderOnly:true});await f.start();
 assert.equal(f.prepares,0);assert.deepEqual(f.preparationOptions,[]);assert.equal(f.el('diagnose').disabled,true);
 assert.match(f.el('advisor-status').textContent,/This run uses the local coder/);
 assert.match(f.el('cloud-status').textContent,/available in reference runs/);
 f.hooks.get('pagehide')();
});

test('workbench review: a minimal coder-only launch does not send users to unconfigured reference advisors',async()=>{
 const f=await frontend({coderOnly:true,firebaseConfigured:false});await f.start();
 assert.equal(f.prepares,0);assert.equal(f.el('diagnose').disabled,true);assert.equal(f.el('review-cloud').disabled,true);
 assert.match(f.el('advisor-status').textContent,/Configure Firebase/);
 assert.match(f.el('cloud-status').textContent,/Configure Firebase/);
 assert.doesNotMatch(f.el('advisor-status').textContent,/Open a reference run/);
 assert.doesNotMatch(f.el('cloud-status').textContent,/available in reference runs/);
 const close=f.el('cancel').emit('click');await f.reply();await close;
 const reference=f.el('open').emit('click');await f.reply();await reference;
 assert.equal(f.el('diagnose').disabled,true);assert.equal(f.el('review-cloud').disabled,true);assert.equal(f.prepares,0);
 assert.match(f.el('advisor-status').textContent,/Launch with your Firebase configuration/);
 f.hooks.get('pagehide')();
});
test('workbench review: Close during deferred local prepare never sends Start after reference cancellation',async()=>{
 const f=await frontend(),gate=f.deferPrepare(),starting=f.el('open-live').emit('click');
 assert.equal(f.el('cancel').disabled,false);
 const closing=f.el('cancel').emit('click');await f.reply();await closing;
 assert.equal(f.h.state.snapshot.closed,true);const before=f.queue.length;
 gate.resolve({status:'prepared'});await starting;await settle();
 assert.equal(f.queue.length,before);assert.equal(f.queue.some(x=>x.url==='/api/workbench/start'),false);
 assert.ok(f.stops>0);assert.equal(f.h.packets.length,0);f.hooks.get('pagehide')();
});
test('workbench review: preparation can be canceled even before any sample session exists',async()=>{
 const f=await frontend({openReference:false}),gate=f.deferPrepare(),starting=f.el('open-live').emit('click');
 assert.equal(f.el('cancel').disabled,false);
 const closing=f.el('cancel').emit('click');await f.reply();await closing;
 gate.resolve({status:'prepared'});await starting;await settle();
 assert.equal(f.queue.length,0);assert.match(f.el('status').textContent,/canceled/);assert.equal(f.h.packets.length,0);f.hooks.get('pagehide')();
});
test('workbench review: admitted Start cannot commit after valid reference-parent Close or newer reference navigation',async t=>{
 for(const operation of ['close','new-reference'])await t.test(operation,async()=>{
  const h=await harness();await h.reference();
  const original=fixtures.runAuthoredChecks,entered=deferred(),release=deferred();
  // Temporary in-memory wrapper of an AUTHORED fixture API, restored below; no file/code changes.
  fixtures.runAuthoredChecks=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
  try{
   const pending=h.local();await entered.promise;
   if(operation==='close')await h.cancelReference();else await h.reference();
   release.resolve();const result=await pending;
   assert.equal(result.status,409);assert.match(result.body.error,/older admitted start/);
   const boot=await h.request('GET','/api/bootstrap');assert.equal(boot.body.activeConfiguredSession,false);
   assert.equal(h.packets.length,0);
  }finally{release.resolve();fixtures.runAuthoredChecks=original;}
 });
});
test('workbench review: stale Generate response and rejected old pump cannot stop replacement preparation/client',async()=>{
 const f=await frontend(),oldPump=f.deferPump();await f.start();
 const entered=deferred(),release=deferred();
 f.h.provider=async packet=>{entered.resolve();await release.promise;return response(packet);};
 const generating=f.el('load').emit('click'),oldRequest=f.queue.shift(),oldServer=f.server(oldRequest);await entered.promise;
 const closing=f.el('cancel').emit('click');await f.reply();await closing;
 const oldResult=await oldServer,gate=f.deferPrepare(),replacing=f.el('open-live').emit('click'),before=f.stops;
 f.deliver(oldRequest,oldResult);await generating;
 oldPump.reject(Error('AUTHORED old pump rejection'));await settle();
 assert.equal(f.stops,before,'stale action/pump cleanup must not stop new preparation');
 f.h.provider=null;gate.resolve({status:'prepared'});await settle();await f.reply();await replacing;
 assert.equal(f.client.state.prepared,true);assert.equal(f.el('load').disabled,false);
 const read=f.el('load').emit('click');await f.reply();await read;assert.equal(f.h.packets.length,2);
 release.resolve();const cancel=f.el('cancel').emit('click');await f.reply();await cancel;f.hooks.get('pagehide')();
});
test('workbench review: Close revokes a delayed Start before admission without response compensation',async()=>{
 const f=await frontend(),starting=f.el('open-live').emit('click');await settle();
 const oldStart=f.queue.shift();assert.equal(oldStart.url,'/api/workbench/start');
 // The admission binds the offer before Start is sent, including transport delay.
 const closing=f.el('cancel').emit('click');await f.reply();await closing;
 const late=await f.server(oldStart);assert.equal(late.status,409);
 f.deliver(oldStart,late);await starting;await settle();
 assert.equal(f.queue.length,0,'no late session exists to compensate');
 assert.match(f.el('scope-title').textContent,/Authored reference/);
 assert.equal(f.h.packets.length,0);f.hooks.get('pagehide')();
});

test('workbench review: cancel by admission closes an accepted Start even when its response was lost',async()=>{
 const h=await harness(),boot=await h.request('GET','/api/bootstrap'),admission=boot.body.startAdmissionId;
 const started=await h.local();assert.equal(started.status,200);
 const closed=await h.request('POST','/api/workbench/cancel-start',{startAdmissionId:admission});
 assert.equal(closed.status,200);assert.equal(closed.body.state.snapshot.closed,true);
 assert.equal((await h.request('POST','/api/workbench/start',{taskId:task.id,startAdmissionId:admission})).status,409);
});

test('workbench review: old admission cancellation and replay cannot close a replacement',async()=>{
 const h=await harness(),boot=await h.request('GET','/api/bootstrap'),admission=boot.body.startAdmissionId;
 await h.local();const replacement=await h.local(),id=replacement.body.state.sessionId;
 const closed=await h.request('POST','/api/workbench/cancel-start',{startAdmissionId:admission});
 assert.equal(closed.body.state.sessionId,id);assert.equal(closed.body.state.snapshot.closed,false);
 assert.equal((await h.request('POST','/api/workbench/start',{taskId:task.id,startAdmissionId:admission})).status,409);
 assert.equal((await h.request('POST','/api/workbench/cancel-start',{startAdmissionId:admission,extra:true})).status,400);
});

test('workbench review: bootstrap recovers an active configured owner after a lost response or reload',async()=>{
 const h=await harness(),started=await h.local(),id=started.body.state.sessionId;
 const boot=await h.request('GET','/api/bootstrap');
 assert.equal(boot.body.activeConfiguredSession,true);assert.equal(boot.body.state.sessionId,id);
 assert.equal(boot.body.state.mode,'configured-local-unverified');assert.equal(boot.body.state.providerProfile.modelId,profile.modelId);
 const closed=await h.request('POST','/api/workbench/action',{sessionId:id,revision:boot.body.state.snapshot.revision,action:'cancel'});
 assert.equal(closed.status,200);assert.equal(closed.body.state.snapshot.closed,true);
});
test('workbench review: configured placeholders and transport errors do not assert provider disconnection',async()=>{
 const f=await frontend();await f.start();
 assert.match(f.el('proposal-source').textContent,/host provider is configured/);
 const pending=f.el('load').emit('click');f.queue.shift().reject(Error('AUTHORED transport failure'));await pending;
 assert.match(f.el('status').textContent,/unconfirmed/);assert.doesNotMatch(f.el('status').textContent,/No AI|No provider|not connected/);
 assert.equal(f.h.packets.length,0);
 const cancel=f.el('cancel').emit('click');await f.reply();await cancel;f.hooks.get('pagehide')();
});

test('repair bench: a failed reference check can receive Nano advice without generating or applying code',async()=>{
 const f=await frontend();
 const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 let input=null;f.client.state.calls=0;f.client.decide=async snapshot=>{
  input=snapshot;f.client.state.calls++;
  return{status:'decision',inferenceSource:'on_device',decision:{action:'code',objective:'Inspect the null/undefined guard.',evidenceIds:snapshot.evidence.map(e=>e.id)}};
 };
 assert.equal(f.el('diagnose').disabled,false);await f.el('diagnose').emit('click');
 assert.equal(input.semanticBranch,'repair-after-public-check-failure');assert.equal(f.h.packets.length,0);
 assert.equal(f.h.state.snapshot.counts.patches,0);assert.equal(f.el('advisor-result').children[0].textContent,'Inspect the null/undefined guard.');
 f.hooks.get('pagehide')();
});

test('repair bench: a request for evidence is displayed as manual review with no patch',async()=>{
 const f=await frontend();const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 f.client.state.calls=0;f.client.decide=async()=>{f.client.state.calls++;return{status:'decision',inferenceSource:'on_device',decision:{action:'ask_user',evidenceIds:[]}};};
 await f.el('diagnose').emit('click');assert.match(f.el('advisor-status').textContent,/requested more evidence/);
 assert.equal(f.h.packets.length,0);assert.equal(f.h.state.snapshot.counts.patches,0);f.hooks.get('pagehide')();
});

test('repair bench: Close discards late Nano advice and preserves the closed reference session',async()=>{
 const f=await frontend();
 const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 const entered=deferred(),release=deferred();f.client.decide=async snapshot=>{entered.resolve();return release.promise;};
 const advice=f.el('diagnose').emit('click');await entered.promise;
 const closing=f.el('cancel').emit('click');await f.reply();await closing;
 release.resolve({status:'decision',inferenceSource:'on_device',decision:{action:'ask_user',evidenceIds:[]}});await advice;
 assert.equal(f.el('advisor-result').children.length,0);assert.equal(f.h.state.snapshot.closed,true);assert.equal(f.h.packets.length,0);
 f.hooks.get('pagehide')();
});

test('repair bench: rejected model output explains its bounded failure and never appears as advice',async()=>{
 for(const [result,message]of [
  [{status:'blocked',diagnostic:'output-fields'},/unexpected response shape/],
  [{status:'blocked',diagnostic:'output-grounding'},/quoted code that does not match/],
  [{status:'blocked',diagnostic:'operation-timeout'},/90-second wait.*owned session was canceled/],
  [{status:'blocked',reason:'unexpected-inference-source-investigate-egress'},/investigate possible cloud traffic/],
  [{status:'decision',inferenceSource:'on_device',decision:{action:'test'}},/workflow action instead of a repair hint/]
 ]){
  const f=await frontend();const checking=f.el('test').emit('click');await f.reply();await checking;
  const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
  f.client.state.calls=0;f.client.decide=async()=>{f.client.state.calls++;return result;};
  await f.el('diagnose').emit('click');assert.match(f.el('advisor-status').textContent,message);
  assert.equal(f.el('advisor-result').children.length,0);assert.equal(f.h.state.snapshot.counts.patches,0);f.hooks.get('pagehide')();
 }
});

test('repair bench: Native setup timeout explains recovery in advisor and configured-start flows',async()=>{
 const f=await frontend();const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 f.client.state.calls=0;const gate=f.deferPrepare(),diagnosis=f.el('diagnose').emit('click');
 gate.resolve({status:'blocked',reason:'native-operation-timeout',diagnostic:'operation-timeout'});await diagnosis;
 assert.match(f.el('advisor-status').textContent,/setup exceeded its 90-second wait/);assert.equal(f.el('advisor-result').children.length,0);
 assert.equal(f.h.state.snapshot.counts.patches,0);assert.equal(f.h.packets.length,0);assert.equal(f.el('planner-calls').textContent,'0');f.hooks.get('pagehide')();
 const g=await frontend(),startGate=g.deferPrepare(),starting=g.el('open-live').emit('click');
 startGate.resolve({status:'blocked',reason:'native-operation-timeout',diagnostic:'operation-timeout'});await starting;
 assert.match(g.el('status').textContent,/setup exceeded its 90-second wait/);assert.equal(g.queue.length,0);assert.equal(g.h.packets.length,0);assert.equal(g.el('open-live').disabled,false);g.hooks.get('pagehide')();
});

test('repair bench: visible record excludes private advice and source, then clears when the run changes',async()=>{
 const f=await frontend();const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 f.client.state.calls=0;f.client.decide=async s=>{f.client.state.calls++;return{status:'decision',inferenceSource:'on_device',
  decision:{action:'code',objective:'PRIVATE_ADVISORY_TEXT',evidenceIds:s.evidence.map(e=>e.id)}};};
 await f.el('diagnose').emit('click');assert.equal(f.el('view-record').disabled,false);
 f.el('view-record').emit('click');const text=f.el('record-json').textContent,record=JSON.parse(text);
 assert.equal(f.el('record-preview').hidden,false);assert.equal(f.el('record-preview').open,true);
 assert.equal(record.counts.advisorCalls,1);assert.equal(record.advisor.inferenceSource,'on_device');
 assert.equal(text.includes('PRIVATE_ADVISORY_TEXT'),false);
 for(const evidence of f.h.state.snapshot.evidence)assert.equal(text.includes(evidence.content),false);
 const reread=f.el('files').children[0].children[1].emit('click');await f.reply();await reread;
 assert.equal(f.el('record-preview').hidden,true);assert.equal(f.el('record-json').textContent,'');f.hooks.get('pagehide')();
});

test('repair bench: preview sends nothing and explicit cloud Send uses exactly the displayed payload',async()=>{
 let approved=null;const cloud={state:{calls:0},preview:s=>Object.freeze({revision:s.revision,model:'AUTHORED-FAKE',prompt:'AUTHORED EXACT PROMPT'}),
  async send(review){approved=review;this.state.calls++;return{status:'review',revision:review.revision,model:review.model,inferenceSource:'in_cloud',
   answer:{assessment:'uncertain',explanation:'Authored fake opinion',nextCheck:'Authored next check',evidenceIds:['test-evidence']}};},stop(){},async dispose(){}};
 const f=await frontend({cloudReviewer:cloud});
 const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 assert.equal(f.el('review-cloud').disabled,false);f.el('review-cloud').emit('click');
 assert.equal(cloud.state.calls,0);assert.equal(approved,null);assert.equal(f.el('cloud-preview').hidden,false);
 const shown=f.el('cloud-payload').textContent;assert.equal(shown,'AUTHORED EXACT PROMPT');
 await f.el('send-cloud').emit('click');assert.equal(approved.prompt,shown);assert.equal(cloud.state.calls,1);
 assert.equal(f.el('cloud-preview').hidden,true);assert.equal(f.el('cloud-result').children.length,1);assert.equal(f.el('cloud-calls').textContent,'1');
 const notes=f.el('cloud-result').children[0].children;
 assert.equal(notes[0].children[0].textContent,'Independent cloud review');
 assert.equal(notes[0].children[1].textContent,'Authored fake opinion');
 assert.equal(notes[1].textContent,'Next check to try');assert.equal(notes[2].textContent,'Authored next check');
 f.el('view-record').emit('click');assert.equal(JSON.parse(f.el('record-json').textContent).cloudReview.assessment,'uncertain');
 assert.equal(f.el('mode-chip').textContent,'Cloud review attempted');assert.match(f.el('scope-title').textContent,/separate model opinions/);
 assert.doesNotMatch(f.el('scope-title').textContent,/No AI is running/);
 assert.equal(f.h.packets.length,0);assert.equal(f.h.state.snapshot.counts.patches,0);f.hooks.get('pagehide')();
});

test('repair bench: edits invalidate cloud approval and Close discards a late cloud opinion',async()=>{
 const gate=deferred();let sent=0;const cloud={state:{calls:0},preview:s=>Object.freeze({revision:s.revision,prompt:'AUTHORED PREVIEW'}),
  async send(){sent++;this.state.calls++;return gate.promise;},stop(){},async dispose(){}};
 const f=await frontend({cloudReviewer:cloud});
 const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 f.el('review-cloud').emit('click');
 const loading=f.el('load').emit('click');await f.reply();await loading;
 const applying=f.el('apply').emit('click');await f.reply();await applying;
 assert.equal(f.el('cloud-preview').hidden,true);assert.equal(f.el('send-cloud').disabled,true);
 await f.el('send-cloud').emit('click');assert.equal(sent,0);
 // A fresh reference baseline supplies a new, current failure.
 const opening=f.el('open').emit('click');await f.reply();await opening;
 const recheck=f.el('test').emit('click');await f.reply();await recheck;
 const reread=f.el('files').children[0].children[1].emit('click');await f.reply();await reread;
 f.el('review-cloud').emit('click');const sending=f.el('send-cloud').emit('click');assert.equal(sent,1);
 const closing=f.el('cancel').emit('click');await f.reply();await closing;
 gate.resolve({status:'review',answer:{explanation:'LATE OUTPUT MUST NOT RENDER'}});await sending;
 assert.equal(f.el('cloud-result').children.length,0);assert.equal(f.h.state.snapshot.closed,true);f.hooks.get('pagehide')();
});

test('repair bench: sharing Nano advice in cloud review is opt-in and limited to the current session',async()=>{
 let receivedHint='not-called';const cloud={state:{calls:0},preview(s,hint){receivedHint=hint;return{revision:s.revision,prompt:hint?.objective??'TASK AND EVIDENCE ONLY'};},stop(){},async dispose(){}};
 const f=await frontend({cloudReviewer:cloud});
 const checking=f.el('test').emit('click');await f.reply();await checking;
 const reading=f.el('files').children[0].children[1].emit('click');await f.reply();await reading;
 f.client.state.calls=0;f.client.decide=async s=>{f.client.state.calls++;return{status:'decision',inferenceSource:'on_device',
  decision:{action:'code',objective:'OLD SESSION HINT',evidenceIds:s.evidence.map(e=>e.id)}};};
 await f.el('diagnose').emit('click');assert.equal(f.el('advisor-result').children.length,1);
 assert.equal(f.el('review-cloud-with-nano').hidden,false);
 await f.el('review-cloud').emit('click');assert.equal(receivedHint,null);
 assert.equal(f.el('cloud-payload').textContent,'TASK AND EVIDENCE ONLY');
 await f.el('review-cloud-with-nano').emit('click');assert.equal(receivedHint.objective,'OLD SESSION HINT');
 assert.equal(f.el('cloud-payload').textContent,'OLD SESSION HINT');
 await f.el('review-cloud').emit('click');assert.equal(receivedHint,null);
 assert.equal(f.el('cloud-payload').textContent,'TASK AND EVIDENCE ONLY');
 const opening=f.el('open').emit('click');await f.reply();await opening;
 const recheck=f.el('test').emit('click');await f.reply();await recheck;
 const reread=f.el('files').children[0].children[1].emit('click');await f.reply();await reread;
 f.el('review-cloud').emit('click');assert.equal(receivedHint,null);
 assert.equal(f.el('review-cloud-with-nano').hidden,true);
 assert.equal(f.el('advisor-result').children.length,0);assert.equal(f.el('planner-calls').textContent,'0');f.hooks.get('pagehide')();
});

test('workbench review: closed configured owner is inactive when binding the reference parent of a new admitted Start',async()=>{
 const h=await harness();await h.reference();const referenceId=h.state.sessionId;
 await h.local();const closedOwner=h.state.sessionId;
 await h.request('POST','/api/workbench/action',{sessionId:closedOwner,revision:h.state.snapshot.revision,action:'cancel'});
 const boot=await h.request('GET','/api/bootstrap');
 assert.equal(boot.body.state.sessionId,referenceId);assert.equal(boot.body.state.snapshot.closed,false);
 const original=fixtures.runAuthoredChecks,entered=deferred(),release=deferred();
 fixtures.runAuthoredChecks=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
 try{
  const pending=h.local();await entered.promise;await h.cancelReference();release.resolve();
  const result=await pending;assert.equal(result.status,409);assert.match(result.body.error,/older admitted start/);
  assert.equal(result.body.state.sessionId,closedOwner);assert.equal(result.body.state.snapshot.closed,true);
  assert.equal(Object.hasOwn(result.body,'plannerPair'),false);assert.equal(h.packets.length,0);
 }finally{release.resolve();fixtures.runAuthoredChecks=original;}
});
