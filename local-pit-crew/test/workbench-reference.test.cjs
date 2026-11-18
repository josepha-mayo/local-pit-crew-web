'use strict';
// Composed app/actual UI with authored adapters and fake HTTP/DOM only. No real provider/SDK/network/source runner.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const verifierContract=require('../src/public-verifier-contract.cjs');
const ordinaryAdmissionFactory=verifierContract.createVerifierAdmission;
const bridgeModuleId=require.resolve('../ui/workbench-bridge.cjs'),bridgeCacheBeforeAuthored=require.cache[bridgeModuleId];
const {createWorkbenchApp}=require('./workbench-authored-admission.cjs');
const bridgeCacheAfterAuthored=require.cache[bridgeModuleId];
const {createWorkbenchApp:createOrdinaryWorkbenchApp}=require('../ui/workbench-bridge.cjs');
const {createHandler}=require('../ui/server.cjs');
const {getTasks,runAuthoredChecks}=require('./fixtures.cjs');
const origin='http://127.0.0.1:48114',host='127.0.0.1:48114';
const task=getTasks().find(t=>t.id==='pagination-zero');
const profile={kind:'runtime-reported',profileHash:'a'.repeat(64),modelId:'AUTHORED-TEST-ONLY',modelDigest:'b'.repeat(64),engineBuild:'AUTHORED-NOT-ACTUAL-ENGINE'};
const firebaseConfig={firebase:{apiKey:'AUTHORED-PUBLIC-KEY',projectId:'AUTHORED-PROJECT',appId:'AUTHORED-APP'},appCheckSiteKey:'AUTHORED-SITE-KEY',appName:'authored-composed-ui'};
function provider(){
 const packets=[];let generate=null;
 const coder={locality:'local-only',async generate(packet,options){
  packets.push(structuredClone(packet));if(generate)return generate(packet,options);
  return answer(packet,packets.length);
 }};
 return{coder,packets,set generate(fn){generate=fn;}};
}
function answer(packet,n=1){
 const path=task.writable[0],e=packet.evidence.find(e=>e.path===path);
 return{raw:JSON.stringify({edits:[{path,beforeSha256:e.sha256,find:e.content,replace:task.correction[path]+'\n// AUTHORED candidate '+n}]}),
  receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'AUTHORED-CONTRACT-FAKE',source:'local-engine'}};
}
async function harness({configured=true,verifier=null,source,factory=createWorkbenchApp}={}){
 const p=source??provider(),live=configured?{profile:structuredClone(profile),coder:p.coder,firebaseConfig:structuredClone(firebaseConfig),
  contentSecurityPolicy:"default-src 'self'; frame-ancestors 'none'",publicVerifier:verifier}:null;
 const app=await factory({origin,live,browserBundleAvailable:configured});let token,state,admission;
 async function request(method,pathname,body,extra={}){
  if(pathname==='/api/workbench/start'&&body&&Object.keys(body).length===1)body={...body,startAdmissionId:admission};
  const r=await app.dispatch({method,pathname,body,headers:{host,origin,'content-type':'application/json','x-pitcrew-token':token,...extra}});
  if(r.body?.startAdmissionId)admission=r.body.startAdmissionId;
  if(r.body?.state)state=r.body.state;return r;
 }
 const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
 const start=()=>request('POST','/api/workbench/start',{taskId:task.id});
 const action=(action,extra={})=>request('POST','/api/workbench/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra});
 return{app,boot,p,live,request,start,action,get state(){return state;}};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('composed host defaults to authored reference and configured local mode is visibly unavailable',async()=>{
 const h=await harness({configured:false});assert.equal(h.boot.body.capabilities.live.available,false);
 assert.equal(h.state.mode,'authored-reference');assert.ok(h.boot.body.capabilities.live.missing.includes('approved local coder adapter'));
 assert.equal((await h.start()).status,503);assert.equal(h.p.packets.length,0);
 assert.equal((await h.request('POST','/api/start',{taskId:task.id})).status,200);
 assert.equal(h.state.mode,'authored-reference');
});
test('configured path uses actual controller reads/provider string proposal/explicit apply, not authored correction action',async()=>{
 const h=await harness(),start=await h.start();assert.equal(start.status,200);
 assert.equal(h.state.mode,'configured-local-unverified');assert.equal(h.state.runtimeVerified,false);
 assert.equal((await h.action('read',{path:task.writable[0]})).status,200);assert.equal(h.state.snapshot.evidence.length,1);
 assert.equal((await h.action('load-authored')).status,409);
 assert.equal((await h.action('generate')).status,200);assert.equal(h.p.packets.length,1);
 assert.match(h.state.proposal.edits[0].replace,/AUTHORED candidate/);assert.match(h.state.proposal.source,/Provider-reported/);
 assert.equal(h.state.snapshot.counts.patches,0);assert.equal((await h.action('apply')).status,200);
 assert.equal(h.state.snapshot.counts.patches,1);assert.equal(h.state.snapshot.originalTask,task.prompt);
 const unverified=await h.action('test');assert.equal(unverified.status,409);assert.match(unverified.body.error,/not executed or verified/);
 assert.equal(h.state.snapshot.pending,null);assert.equal(h.state.snapshot.publicChecksCurrent,false);
 assert.equal((await h.action('finish')).status,409);
 await h.action('cancel');assert.equal(h.state.snapshot.closed,true);
});
test('composed host cannot inject providers/verdicts and unauthorized requests disclose no source state',async()=>{
 const h=await harness();await h.start();
 const rejected=await h.request('POST','/api/workbench/action',{sessionId:h.state.sessionId,revision:h.state.snapshot.revision,action:'generate'},{'x-pitcrew-token':'wrong'});
 assert.equal(rejected.status,403);assert.equal(Object.hasOwn(rejected.body,'state'),false);
 assert.equal((await h.action('generate',{coder:'injected'})).status,409);assert.equal(h.p.packets.length,0);
 assert.equal((await h.request('POST','/api/complete',{passed:true})).status,404);
 assert.equal((await h.request('POST','/api/workbench/complete',{passed:true})).status,409);
 assert.equal((await h.action('test',{checks:[{id:'forged',ok:true}]})).status,409);
 await h.action('cancel');
});
test('actual composed CodingSession to handoff repair promise is resolved through authenticated constrained result, using authored delegates only',async()=>{
 let verdicts=0;
 const ids=(await runAuthoredChecks(task.id,'corrected')).checks.map(c=>c.id);
 const verifier={isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){
  verdicts++;return{suiteId:task.id,workspaceHash:ticket.workspaceHash,checks:ids.map(id=>({id,ok:verdicts>1}))};
 }};
 // This fake registered verifier supplies facts; it never executes ticket.files or proves isolation.
 const h=await harness({verifier}),started=await h.start(),pair=started.body.plannerPair;
 await h.action('generate');await h.action('apply');await h.action('test');
 assert.equal(h.state.snapshot.publicChecksCurrent,false);assert.equal(h.p.packets.length,1);
 const pending=h.action('generate'),workerId='AUTHORED-UI-WORKER';
 const claimed=await h.request('POST','/api/planner/claim',{sessionId:pair.sessionId,workerId},{'x-pitcrew-token':pair.authToken});
 assert.equal(claimed.status,200);const job=claimed.body.job;assert.ok(job);
 const evidenceIds=job.snapshot.evidence.filter(e=>job.snapshot.manifest.some(m=>m.path===e.path&&m.sha256===e.sha256)).map(e=>e.id);
 const decision={revision:job.revision,action:'code',path:'',artifactId:'',evidenceIds,objective:'AUTHORED repair hint; keep original task.',reasonEvidenceIds:[]};
 const binding=Object.fromEntries(['sessionId','workerId','jobId','claimId','revision','snapshotHash'].map(k=>[k,job[k]]));
 const submitted=await h.request('POST','/api/planner/result',{...binding,outcome:{status:'decision',decision,inferenceSource:'on_device'}},{'x-pitcrew-token':pair.authToken});
 assert.equal(submitted.status,200);assert.equal((await pending).status,200);
 assert.equal(h.p.packets.length,2);assert.equal(h.p.packets[1].originalTask,task.prompt);
 assert.match(h.p.packets[1].nextStepHint,/AUTHORED repair hint/);
 await h.action('apply');await h.action('test');assert.equal(h.state.snapshot.publicChecksCurrent,true);
 const finished=await h.action('finish');assert.equal(finished.body.result.heldOutCorrectness,false);assert.equal(h.state.snapshot.closed,true);
});
test('composed Close discards a late authored coder result and switching to reference invalidates planner ownership',async()=>{
 const p=provider(),entered=deferred(),release=deferred();
 p.generate=async packet=>{entered.resolve();await release.promise;return answer(packet);};
 const h=await harness({source:p}),started=await h.start(),pending=h.action('generate');await entered.promise;
 assert.equal((await h.action('cancel')).status,200);assert.equal(h.state.snapshot.closed,true);
 release.resolve();assert.equal((await pending).status,409);assert.equal(h.state.snapshot.closed,true);assert.equal(h.state.proposal,null);
 await h.request('POST','/api/start',{taskId:task.id});assert.equal(h.state.mode,'authored-reference');
 const old=await h.request('POST','/api/planner/claim',{sessionId:started.body.plannerPair.sessionId,workerId:'AUTHORED-OLD-WORKER'},{'x-pitcrew-token':started.body.plannerPair.authToken});
 assert.equal(old.status,409);
});
test('composed HTTP handler serves fixed copied bundle/pump assets without executing or opening sockets',async()=>{
 const h=await harness({configured:false}),handler=createHandler({app:h.app,origin:()=>origin});
 const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers={}){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}});
 const bundle=res();await handler({method:'GET',url:'/firebase-planner.mjs',headers:{host}},bundle);
 assert.equal(bundle.status,200);assert.equal(crypto.createHash('sha256').update(bundle.body).digest('hex'),JSON.parse(fs.readFileSync(path.join(__dirname,'../ui/public/firebase-bundle.json'),'utf8')).sha256);
 const pump=res();await handler({method:'GET',url:'/browser-planner-pump.js',headers:{host}},pump);
 assert.equal(pump.status,200);assert.match(String(pump.body),/createBrowserPlannerPump/);
 assert.match(bundle.headers['Content-Security-Policy'],/connect-src 'self'/);
});
class Element{
 constructor(){this.value='';this.disabled=true;this.children=[];this.listeners=new Map();this.textContent='';}
 addEventListener(name,fn){this.listeners.set(name,fn);}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=[...x];}
 emit(name){return this.listeners.get(name)?.();}
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}
test('existing actual frontend starts configured mode and drives Generate/Apply/Close through composed backend with fake prepared client',async()=>{
 const h=await harness(),elements=new Map(),hooks=new Map(),requests=[],timers=new Map();let timerSeq=0,prepares=0,stops=0,disposes=0;
 const localClient={state:{prepared:false},async prepareFromUserGesture(){prepares++;this.state.prepared=true;return{status:'prepared'};},stop(){stops++;this.state.prepared=false;},async dispose(){disposes++;}};
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
  createElement(){return new Element();},addEventListener(name,fn){hooks.set(name,fn);}};
 const window={document,location:{origin},crypto:{randomUUID:crypto.randomUUID},addEventListener(name,fn){hooks.set(name,fn);},
  setTimeout(fn){const id=++timerSeq;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
  LocalPitCrewCreateFirebasePlanner(){return localClient;},
  LocalPitCrewBrowserPlanner:{createFetchPlannerTransport(){return{};},createBrowserPlannerPump(){return{async runOne(){return{status:'idle'};},stop(){localClient.stop();}};}},
  fetch(url,options){const d=deferred();requests.push({url,options,...d});return d.promise;}};
 async function deliver(){
  const item=requests.shift();assert.ok(item,'expected frontend request');
  const result=await h.request(item.options.method,item.url,item.options.body?JSON.parse(item.options.body):undefined,
   Object.fromEntries(Object.entries(item.options.headers).map(([k,v])=>[k.toLowerCase(),v])));
  item.resolve({ok:result.status>=200&&result.status<300,json:async()=>result.body});await settle();return result;
 }
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/public/app.js'),'utf8'),{window},{filename:'authored-composed-ui.js',timeout:1000});
 hooks.get('DOMContentLoaded')();await deliver();await settle();
 const el=id=>elements.get(id);el('sample').value=task.id;assert.equal(el('open-live').disabled,false);
 const starting=el('open-live').emit('click');await settle();await deliver();await starting;
 assert.equal(prepares,1);assert.match(el('scope-title').textContent,/Outputs are not verified/);assert.equal(el('load').textContent,'Generate local patch');
 const generating=el('load').emit('click');await deliver();await generating;
 assert.equal(h.p.packets.length,1);assert.equal(el('apply').disabled,false);assert.equal(el('test').disabled,true);
 const applying=el('apply').emit('click');await deliver();await applying;assert.equal(h.state.snapshot.counts.patches,1);
 const closing=el('cancel').emit('click');await deliver();await closing;assert.equal(h.state.snapshot.closed,true);assert.ok(stops>=1);
 // A new gesture can reprepare; stopping the old pump must not stop this replacement lifetime afterward.
 const restarted=el('open-live').emit('click');await settle();await deliver();await restarted;
 assert.equal(prepares,2);assert.equal(localClient.state.prepared,true);
 hooks.get('pagehide')();await settle();assert.equal(disposes,1);await h.action('cancel');
});


// Default-closed admission/typed-result controls. Authored fact composition is never qualification.
test('settings verdicts require their own exact checks and stay unadmitted without issuer identity',()=>{
 const {CONFIG_CHECK_IDS}=require('../runner/policy.cjs'),binding={ticketId:'settings-ticket',suiteId:'config-isolation',workspaceHash:'b'.repeat(64)};
 const value={status:'candidate-verdict',...binding,checks:CONFIG_CHECK_IDS.map(id=>({id,ok:false}))};
 assert.deepEqual(verifierContract.parsePublicCheckOutcome(value,binding),value);
 for(const checks of [value.checks.slice(1),[...value.checks,{id:'extra',ok:true}],verifierContract.PILOT_CHECK_IDS.map(id=>({id,ok:true})),
  value.checks.map((c,i)=>i?c:{...c,observed:'unchecked'}),value.checks.map((c,i)=>i?c:{...c,id:CONFIG_CHECK_IDS[1]})])
  assert.throws(()=>verifierContract.parsePublicCheckOutcome({...value,checks},binding));
 assert.equal(verifierContract.createVerifierAdmission({qualified:true}).capabilityFor(binding.suiteId).available,false);
 assert.equal(verifierContract.createVerifierAdmission({qualified:true}).capabilityFor(binding.suiteId).reason,'not-qualified');
});
test('verifier contract binds exact complete pagination facts, not qualification or held-out correctness',async()=>{
 const c=verifierContract,binding={ticketId:'owned-ticket',suiteId:c.PILOT_SUITE,workspaceHash:'c'.repeat(64)};
 assert.deepEqual((await runAuthoredChecks(task.id,'corrected')).checks.map(x=>x.id),c.PILOT_CHECK_IDS);
 const value={status:'candidate-verdict',...binding,checks:c.PILOT_CHECK_IDS.map(id=>({id,ok:false}))};
 assert.deepEqual(c.parsePublicCheckOutcome(value,binding),value);
 for(const changed of [
  {...value,ticketId:'other'}, {...value,workspaceHash:'d'.repeat(64)}, {...value,suiteId:'config-isolation'},
  {...value,qualified:true}, {...value,checks:value.checks.slice(1)},
  {...value,checks:value.checks.map((x,i)=>i?x:value.checks[1])},
  {...value,checks:value.checks.map((x,i)=>i?x:{...x,ok:'false'})},
  {...value,checks:value.checks.map((x,i)=>i?x:{...x,privateGrading:true})}
 ])assert.throws(()=>c.parsePublicCheckOutcome(changed,binding),{message:'public-check-contract-rejected'});
 for(const malformed of [{...binding,workspaceHash:undefined},{...binding,workspaceHash:''},{...binding,ticketId:null}])assert.throws(()=>c.parsePublicCheckOutcome(value,malformed));
 let getters=0;const withGetter={...value};Object.defineProperty(withGetter,'status',{get(){getters++;return'candidate-verdict';},enumerable:true});
 assert.throws(()=>c.parsePublicCheckOutcome(withGetter,binding));assert.equal(getters,0);
});
test('unavailable protocol never carries check booleans or an invented candidate-error shortcut',()=>{
 const c=verifierContract,b={ticketId:'ticket',suiteId:c.PILOT_SUITE,workspaceHash:'c'.repeat(64)};
 for(const reason of c.UNAVAILABLE_REASONS){
  const value={status:'unavailable',...b,reason};assert.deepEqual(c.parsePublicCheckOutcome(value,b),value);
  assert.throws(()=>c.parsePublicCheckOutcome({...value,checks:[]},b));
 }
 for(const value of [{status:'candidate-error',...b,reason:'syntax'},{status:'unavailable',...b,reason:'guest says interrupted'},true,null])assert.throws(()=>c.parsePublicCheckOutcome(value,b));
});
test('ordinary admission ignores callback/hash/boolean/status/test-token claims and creates no test ticket',async()=>{
 let calls=0,getters=0;
 const claimed={isolationEvidenceHash:'f'.repeat(64),qualified:true,status:'qualified-runtime',testToken:'authored-test-facts',
  get runPublicChecks(){getters++;return()=>{calls++;};}};
 for(const claim of [claimed,true,'{"qualified":true,"testToken":"authored-test-facts"}',{NODE_ENV:'test'}]){
  const admission=verifierContract.createVerifierAdmission(claim),cap=admission.capabilityFor('pagination-zero');
  assert.equal(cap.available,false);assert.equal(cap.qualified,false);assert.equal(cap.benchmarkEligible,false);assert.equal(cap.admissionKind,'unavailable');
 }
 const h=await harness({verifier:claimed,factory:createOrdinaryWorkbenchApp});await h.start();
 const count=h.state.snapshot.counts.tests;assert.equal(h.state.canVerify,false);assert.equal(h.state.verification.admissionKind,'unavailable');
 assert.equal((await h.action('test')).status,409);assert.equal(h.state.snapshot.counts.tests,count);assert.equal(h.state.snapshot.pending,null);
 assert.equal(h.state.snapshot.publicChecksCurrent,false);assert.equal(h.state.providerInvocations.planner,0);assert.equal(h.state.providerInvocations.coder,0);
 assert.equal(calls,0);assert.equal(getters,0);await h.action('cancel');
});
test('test composition never changes real resolver/cache or later ordinary app admission after success/failure/mutation',async()=>{
 assert.equal(verifierContract.createVerifierAdmission,ordinaryAdmissionFactory);assert.equal(bridgeCacheAfterAuthored,bridgeCacheBeforeAuthored);
 const success={isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){return{suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:verifierContract.PILOT_CHECK_IDS.map(id=>({id,ok:true}))};}};
 const h=await harness({verifier:success});await h.start();
 assert.equal(h.state.verification.admissionKind,'authored-test-facts');assert.equal(h.state.verification.qualified,false);assert.equal(h.state.verification.benchmarkEligible,false);
 assert.equal((await h.action('test')).status,200);assert.equal(h.state.snapshot.publicChecksCurrent,true);await h.action('cancel');
 const bad=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(){throw Error('authored failure');}}});await bad.start();assert.equal((await bad.action('test')).status,503);
 success.runPublicChecks=()=>{throw Error('caller mutation');};success.qualified=true;
 const ordinary=await harness({verifier:success,factory:createOrdinaryWorkbenchApp});await ordinary.start();
 assert.equal(ordinary.state.canVerify,false);assert.equal((await ordinary.action('test')).status,409);assert.equal(ordinary.state.snapshot.pending,null);
 assert.equal(verifierContract.createVerifierAdmission,ordinaryAdmissionFactory);await ordinary.action('cancel');
});
test('unsupported configured suite stays unadmitted before facts callback or ticket creation',async()=>{
 let calls=0;const h=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(){calls++;throw Error('must not call');}}});
 const started=await h.request('POST','/api/workbench/start',{taskId:'config-isolation'});assert.equal(started.status,200);
 assert.equal(h.state.canVerify,false);assert.equal(h.state.verification.reason,'unsupported-suite');
 const count=h.state.snapshot.counts.tests;assert.equal((await h.action('test')).status,409);
 assert.equal(h.state.snapshot.counts.tests,count);assert.equal(h.state.snapshot.pending,null);assert.equal(calls,0);await h.action('cancel');
});
test('infrastructure and malformed fact outcomes close only owning work without fabricated failed checks or planner calls',async t=>{
 for(const reason of ['runtime-unavailable','protocol-invalid','cleanup-uncertain','aborted','expired'])await t.test(reason,async()=>{
  const h=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){
   return{status:'unavailable',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,reason};
  }}});
  await h.start();assert.equal((await h.action('test')).status,503);
  assert.equal(h.state.snapshot.closed,true);assert.equal(h.state.snapshot.pending,null);assert.equal(h.state.snapshot.publicChecksCurrent,false);
  assert.deepEqual(h.state.checks,[]);assert.equal(h.state.events.some(e=>e.kind==='public-check'),false);assert.equal(h.state.providerInvocations.planner,0);
 });
 const malformed=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){
  return{status:'unavailable',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,reason:'runtime-unavailable',checks:verifierContract.PILOT_CHECK_IDS.map(id=>({id,ok:false}))};
 }}});
 await malformed.start();assert.equal((await malformed.action('test')).status,503);assert.deepEqual(malformed.state.checks,[]);
 assert.equal(malformed.state.events.some(e=>e.kind==='public-check'),false);assert.equal(malformed.state.providerInvocations.planner,0);
});
test('late unavailable or malformed outcome cannot close or grade a replacement owner',async()=>{
 const entered=deferred(),release=deferred();
 const h=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){entered.resolve();await release.promise;return{status:'unavailable',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,reason:'cleanup-uncertain'};}}});
 await h.start();const old=h.state.sessionId,pending=h.action('test');await entered.promise;
 await h.action('cancel');await h.start();const newer=h.state.sessionId;assert.notEqual(newer,old);
 release.resolve();assert.equal((await pending).status,409);assert.equal(h.state.sessionId,newer);assert.equal(h.state.snapshot.closed,false);
 assert.equal(h.state.snapshot.pending,null);assert.deepEqual(h.state.checks,[]);await h.action('cancel');
});
test('cancel or unavailable retest invalidates an older current-pass badge without rewriting historical checks',async()=>{
 let runs=0;const h=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){
  runs++;return runs===1?{suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:verifierContract.PILOT_CHECK_IDS.map(id=>({id,ok:true}))}:
   {status:'unavailable',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,reason:'runtime-unavailable'};
 }}});
 await h.start();assert.equal((await h.action('test')).status,200);assert.equal(h.state.snapshot.publicChecksCurrent,true);
 const events=h.state.events.filter(e=>e.kind==='public-check').length;
 assert.equal((await h.action('test')).status,503);assert.equal(h.state.snapshot.closed,true);assert.equal(h.state.snapshot.publicChecksCurrent,false);
 assert.equal(h.state.events.filter(e=>e.kind==='public-check').length,events);assert.equal(h.state.checks.every(c=>c.ok),true);
 const other=await harness({verifier:{isolationEvidenceHash:'f'.repeat(64),async runPublicChecks(ticket){return{suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:verifierContract.PILOT_CHECK_IDS.map(id=>({id,ok:true}))};}}});
 await other.start();await other.action('test');assert.equal(other.state.snapshot.publicChecksCurrent,true);
 await other.action('cancel');assert.equal(other.state.snapshot.publicChecksCurrent,false);
});
test('production entrypoints do not import the authored admission loader or expose a test enablement option',()=>{
 for(const name of ['server.cjs','ollama-workbench.cjs']){
  const source=fs.readFileSync(path.join(__dirname,'..','ui',name),'utf8');
  assert.equal(source.includes('workbench-authored-admission'),false);assert.equal(source.includes('authoredAdmission'),false);
 }
 const gate=fs.readFileSync(path.join(__dirname,'..','src','public-verifier-contract.cjs'),'utf8');
 assert.equal(gate.includes('process.env'),false);
});
