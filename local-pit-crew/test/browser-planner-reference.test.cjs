'use strict';
// In-process dispatch/Node Response/fake fetch and authored planner only, never Chrome/network/models.
const test=require('node:test'),assert=require('node:assert/strict');
const {hash}=require('../src/controller.cjs');
const {BrowserPlannerHandoff}=require('../src/browser-planner-handoff.cjs');
const {createFetchPlannerTransport,createBrowserPlannerPump}=require('../ui/browser-planner-pump.js');
const companion='http://127.0.0.1:48113',ui='https://authored-ui.example',host='127.0.0.1:48113';
const sessionId='authored-session-1',workerId='authored-worker-1',authToken='authored_token_for_tests_only_1234567890';
function snapshot(){
 const content='function x(v){return v || 1;}';
 return{revision:4,closed:false,originalTask:'Preserve zero.',manifest:[{path:'x.js',sha256:hash(content),bytes:content.length}],
  evidence:[{id:'e1',path:'x.js',sha256:hash(content),content}],events:[{id:'public-1',kind:'public-check',label:'zero failed.'}]};
}
function decision(s){return{status:'decision',inferenceSource:'on_device',decision:{revision:s.revision,action:'code',path:'',artifactId:'',evidenceIds:['e1'],objective:'Repair zero handling.',reasonEvidenceIds:['public-1']}};}
function handoff(options={}){return new BrowserPlannerHandoff({sessionId,authToken,companionOrigin:companion,uiOrigin:ui,ttlMs:2000,...options});}
function request(h,path,body,headers={},method='POST'){
 return h.dispatch({method,pathname:path,body,headers:{host,origin:ui,'content-type':'application/json','x-pitcrew-token':authToken,...headers}});
}
function bind(job){return Object.fromEntries(['sessionId','workerId','jobId','claimId','revision','snapshotHash'].map(k=>[k,job[k]]));}
async function claim(h,worker=workerId){return request(h,'/api/planner/claim',{sessionId,workerId:worker});}
function transport(h,requests=[]){
 return createFetchPlannerTransport({companion,sessionId,workerId,authToken,fetchImpl:async(url,options)=>{
  requests.push({url,options});const u=new URL(url);
  const result=await request(h,u.pathname,JSON.parse(options.body),Object.fromEntries(Object.entries(options.headers).map(([k,v])=>[k.toLowerCase(),v])));
  return new Response(JSON.stringify(result.body),{status:result.status,headers:{...result.headers,'Content-Type':'application/json'}});
 }});
}
function client(overrides={}){
 const state={prepared:true};let calls=0,stops=0;
 return{state,async decide(s){calls++;return decision(s);},stop(){stops++;state.prepared=false;},...overrides,
  get calls(){return calls;},get stops(){return stops;}};
}
const sha=s=>hash(JSON.stringify(s));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('handoff binds claimed job/session/revision/hash and independently accepts constrained decision',async()=>{
 const h=handoff(),s=snapshot(),pending=h.decide(s),claimed=await claim(h),job=claimed.body.job;
 assert.equal(job.snapshotHash,sha(s));assert.equal(job.revision,s.revision);assert.equal(job.sessionId,sessionId);
 job.snapshot.originalTask='caller mutation';
 const again=(await claim(h)).body.job;assert.equal(again.snapshot.originalTask,s.originalTask);assert.equal(again.claimId,job.claimId);
 const result=await request(h,'/api/planner/result',{...bind(job),outcome:decision(s)});
 assert.equal(result.status,200);assert.equal(result.body.accepted,true);
 assert.deepEqual(await pending,decision(s));
 assert.equal((await claim(h)).body.job,null);h.stop();
});
test('handoff rejects host/origin/token and exposes no verification-completion route',async()=>{
 const h=handoff(),body={sessionId,workerId};
 for(const headers of [{host:'attacker.example'},{origin:'https://attacker.example'},{'x-pitcrew-token':'wrong'}]){
  const result=await request(h,'/api/planner/claim',body,headers);assert.equal(result.status,403);
  assert.equal(JSON.stringify(result.body).includes('originalTask'),false);
 }
 assert.equal((await request(h,'/api/complete',{passed:true})).status,404);
 assert.equal((await request(h,'/api/planner/result',{acceptPublicVerdict:true})).status,400);
 const cors=await request(h,'/api/planner/claim',null,{'access-control-request-method':'POST','access-control-request-headers':'content-type, x-pitcrew-token'},'OPTIONS');
 assert.equal(cors.status,204);assert.equal(cors.headers['Access-Control-Allow-Origin'],ui);
 assert.notEqual(cors.headers['Access-Control-Allow-Origin'],'*');
 h.stop();
});
test('handoff single owner and stale binding cannot hijack a pending decision',async()=>{
 const h=handoff(),s=snapshot(),pending=h.decide(s),job=(await claim(h)).body.job;
 assert.equal((await claim(h,'authored-worker-2')).status,409);
 for(const changed of [{sessionId:'other-session'},{workerId:'other-worker'},{jobId:'other-job'},{claimId:'other-claim'},{revision:99},{snapshotHash:'0'.repeat(64)}]){
  const bad=await request(h,'/api/planner/result',{...bind(job),...changed,outcome:decision(s)});
  assert.equal(bad.status,409);
 }
 assert.equal((await request(h,'/api/planner/status',bind(job))).body.active,true);
 assert.equal((await request(h,'/api/planner/result',{...bind(job),outcome:decision(s)})).status,200);
 await pending;h.stop();
});
test('handoff rejects invalid source/actions/evidence at backend instead of trusting browser label',async()=>{
 for(const change of [
  d=>({...d,inferenceSource:'in_cloud'}),
  d=>({...d,decision:{...d.decision,action:'finish',evidenceIds:[],objective:''}}),
  d=>({...d,decision:{...d.decision,evidenceIds:['invented']}}),
  d=>({...d,decision:{...d.decision,reasonEvidenceIds:['invented']}})
 ]){
  const h=handoff(),s=snapshot(),pending=h.decide(s),rejected=pending.then(()=>false,()=>true),job=(await claim(h)).body.job;
  assert.equal((await request(h,'/api/planner/result',{...bind(job),outcome:change(decision(s))})).status,422);
  assert.equal(await rejected,true);assert.equal((await claim(h)).body.job,null);h.stop();
 }
});
test('handoff expiry and stop invalidate late results without a model or browser',async()=>{
 let now=1000;const h=handoff({clock:()=>now}),pending=h.decide(snapshot()),rejected=pending.then(()=>false,()=>true),job=(await claim(h)).body.job;
 now=job.expiresAt;
 assert.equal((await request(h,'/api/planner/status',bind(job))).body.active,false);assert.equal(await rejected,true);
 assert.equal((await request(h,'/api/planner/result',{...bind(job),outcome:decision(snapshot())})).status,409);
 h.stop();assert.equal((await claim(h)).status,410);
 await assert.rejects(h.decide(snapshot()),/handoff-closed/);
});
test('pump connects actual queue and fetch codec with authored client; no actual fetch/network',async()=>{
 const h=handoff(),s=snapshot(),pending=h.decide(s),requests=[],observations=[],c=client();
 const pump=createBrowserPlannerPump({client:c,transport:transport(h,requests),hashSnapshot:sha,pollMs:50,onObservation:x=>observations.push(x)});
 assert.equal((await pump.runOne()).status,'submitted');assert.deepEqual(await pending,decision(s));
 assert.deepEqual(observations,[{sessionId,revision:s.revision,status:'decision',inferenceSource:'on_device',diagnostic:null}]);
 assert.equal(c.calls,1);assert.equal(pump.state.runtimeVerified,false);
 for(const r of requests){
  assert.equal(new URL(r.url).origin,companion);assert.equal(r.options.credentials,'omit');assert.equal(r.options.redirect,'error');
  assert.equal(r.url.includes(authToken),false);assert.equal(r.options.body.includes(authToken),false);
  assert.equal(r.options.headers['X-Pitcrew-Token'],authToken);
 }
 assert.equal((await pump.runOne()).status,'idle');pump.stop();h.stop();
});

test('pump preserves bounded local failure diagnostics before submit, with no raw errors or protocol expansion',async t=>{
 for(const diagnostic of ['output-grounding','operation-timeout','DO-NOT-EXPORT-RAW-ERROR'])await t.test(diagnostic==='DO-NOT-EXPORT-RAW-ERROR'?'unknown category':diagnostic,async()=>{
  const h=handoff(),s=snapshot(),pending=h.decide(s),requests=[],observations=[];
  const c=client({async decide(){return{status:'blocked',reason:'DO-NOT-EXPORT-RAW-ERROR',diagnostic,source:'DO-NOT-EXPORT-SOURCE'};}});
  const t=transport(h,requests),submit=t.submit;
  t.submit=async(...args)=>{assert.equal(observations.length,1,'observation precedes backend closure');return submit(...args);};
  const pump=createBrowserPlannerPump({client:c,transport:t,hashSnapshot:sha,pollMs:50,onObservation:x=>{observations.push(x);throw Error('authored observer failure');}});
  assert.equal((await pump.runOne()).status,'submitted');assert.equal((await pending).status,'blocked');
  assert.deepEqual(observations,[{sessionId,revision:s.revision,status:'blocked',inferenceSource:null,diagnostic:diagnostic==='DO-NOT-EXPORT-RAW-ERROR'?null:diagnostic}]);
  assert.equal(JSON.stringify(observations).includes('DO-NOT-EXPORT'),false);
  const sent=JSON.parse(requests.find(r=>new URL(r.url).pathname==='/api/planner/result').options.body);
  assert.deepEqual(sent.outcome,{status:'blocked',reason:'planner-failed'});pump.stop();h.stop();
 });
});
test('pump refuses unprepared client without claiming, downloading or initializing anything',async()=>{
 let calls=0;
 const c=client();c.state.prepared=false;
 const pump=createBrowserPlannerPump({client:c,transport:{sessionId,workerId,claim(){calls++;},status(){calls++;},submit(){calls++;}},hashSnapshot:sha});
 assert.equal((await pump.runOne()).reason,'local-client-not-prepared');assert.equal(calls,0);assert.equal(c.calls,0);pump.stop();
});
test('pump hash mismatch reports bounded blocked outcome without sending snapshot to client',async()=>{
 const h=handoff(),pending=h.decide(snapshot()),c=client(),t=transport(h),original=t.claim;
 t.claim=async options=>{const result=await original(options);result.job.snapshot.originalTask='tampered';return result;};
 const pump=createBrowserPlannerPump({client:c,transport:t,hashSnapshot:sha,pollMs:50});
 assert.equal((await pump.runOne()).status,'blocked');assert.equal(c.calls,0);
 assert.equal((await pending).status,'blocked');assert.equal(c.stops,1);pump.stop();h.stop();
});
test('backend cancellation is observed during deferred authored planner and late result is not submitted',async()=>{
 const h=handoff(),pending=h.decide(snapshot()),rejected=pending.then(()=>false,()=>true),entered=deferred(),release=deferred(),requests=[],observations=[];
 let calls=0,stops=0;
 const c={state:{prepared:true},async decide(s){calls++;entered.resolve();await release.promise;return decision(s);},stop(){stops++;}};
 const pump=createBrowserPlannerPump({client:c,transport:transport(h,requests),hashSnapshot:sha,pollMs:50,onObservation:x=>observations.push(x)});
 const running=pump.runOne();await entered.promise;
 assert.equal((await pump.runOne()).reason,'pump-busy');assert.equal(calls,1);
 h.stop();assert.equal(await rejected,true);
 const result=await running;assert.equal(result.status,'discarded');assert.ok(stops>=1);
 release.resolve();await Promise.resolve();
 assert.equal(requests.some(r=>new URL(r.url).pathname==='/api/planner/result'),false);
 assert.deepEqual(observations,[]);
 pump.stop();
});
test('coordinated pump and backend stop discard the active job and request client cancellation',async()=>{
 const h=handoff(),pending=h.decide(snapshot()),rejected=pending.then(()=>false,()=>true),entered=deferred(),release=deferred();
 let stopped=0;
 const c={state:{prepared:true},async decide(s){entered.resolve();await release.promise;return decision(s);},stop(){stopped++;}};
 const pump=createBrowserPlannerPump({client:c,transport:transport(h),hashSnapshot:sha,pollMs:50});
 const running=pump.runOne();await entered.promise;pump.stop();h.stop();
 assert.equal((await running).status,'discarded');assert.equal(await rejected,true);assert.ok(stopped>=1);
 release.resolve();assert.equal((await pump.runOne()).reason,'pump-closed');
});
test('fetch transport rejects non-loopback origins and bounds streamed response data',async()=>{
 const args={sessionId,workerId,authToken,fetchImpl:async()=>{throw Error('never used');}};
 for(const companion of ['https://remote.example','http://localhost:48113','http://127.0.0.1:48113/path','http://user:pass@127.0.0.1:48113']){
  assert.throws(()=>createFetchPlannerTransport({...args,companion}));
 }
 const t=createFetchPlannerTransport({...args,companion,fetchImpl:async()=>new Response('x'.repeat(24001),{status:200,headers:{'Content-Type':'application/json'}})});
 await assert.rejects(t.claim(),/handoff-response-size/);
});
