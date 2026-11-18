'use strict';
// Actual loopback HTTP, immutable authored fixtures only. No model or external service.
const test=require('node:test'),assert=require('node:assert/strict');
const {start}=require('../ui/server.cjs');
const {createFetchPlannerTransport,createBrowserPlannerPump}=require('../ui/browser-planner-pump.js');
const expectedChecks={
 'pagination-zero':['zero-preserved','empty-preserved','undefined-absent','null-absent','string-preserved','limit-preserved'],
 'config-isolation':['custom-default-isolation','returned-mutation-isolation','different-retry-reference','zero-retries','explicit-timeout'],
 'latest-request-wins':['old-success-not-overwrite','old-completion-not-stop-loading','old-error-not-poison-latest','latest-error-visible']
};
const checkIds=(state,id)=>assert.deepEqual(state.checks.map(c=>c.id).sort(),[...expectedChecks[id]].sort());
test('real HTTP reference journeys and request boundaries',async()=>{
 const server=await start(),origin='http://127.0.0.1:'+server.address().port;
 let token,state;
 async function request(path,{method='GET',body,headers={}}={}){
  const r=await fetch(origin+path,{method,signal:AbortSignal.timeout(5000),redirect:'error',headers:{origin,'content-type':'application/json',...(token?{'x-pitcrew-token':token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{}
  if(data?.state)state=data.state;
  return{r,text,data};
 }
 const action=(action,extra={})=>request('/api/action',{method:'POST',body:{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra}});
 try{
  const page=await request('/');assert.equal(page.r.status,200);assert.match(page.text,/Try a failing function/);
  assert.match(page.r.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.equal(page.r.headers.get('x-content-type-options'),'nosniff');
  assert.equal(page.r.headers.get('referrer-policy'),'no-referrer');
  for(const path of ['/app.js','/style.css','/browser-planner-pump.js','/firebase-planner.mjs'])assert.equal((await request(path)).r.status,200);
  const boot=await request('/api/bootstrap');assert.equal(boot.r.status,200);token=boot.data.sessionToken;
  assert.equal(boot.data.capabilities.live.available,false);assert.equal(boot.data.capabilities.live.canVerify,false);
  assert.deepEqual(boot.data.tasks.map(t=>t.id).sort(),Object.keys(expectedChecks).sort());
  for(const task of boot.data.tasks){
   assert.equal((await request('/api/start',{method:'POST',body:{taskId:task.id}})).r.status,200);
   assert.equal((await action('test')).r.status,200);checkIds(state,task.id);assert.ok(state.checks.some(c=>!c.ok));
   assert.equal((await action('finish')).r.status,409);
   assert.equal((await action('load-authored')).r.status,200);
   assert.equal((await action('apply')).r.status,200);
   assert.equal((await action('test')).r.status,200);checkIds(state,task.id);assert.ok(state.checks.every(c=>c.ok));
   assert.equal((await action('finish')).r.status,200);assert.equal(state.snapshot.closed,true);assert.equal(state.modelCalls,0);
  }
  const oldId=state.sessionId;
  await request('/api/start',{method:'POST',body:{taskId:'pagination-zero'}});
  assert.equal((await request('/api/action',{method:'POST',body:{sessionId:oldId,revision:0,action:'cancel'}})).r.status,409);
  assert.equal(state.snapshot.closed,false);
  assert.equal((await request('/api/start',{method:'POST',body:{taskId:'pagination-zero'},headers:{origin:'https://example.invalid'}})).r.status,403);
  assert.equal((await request('/api/start',{method:'POST',body:{taskId:'pagination-zero'},headers:{'x-pitcrew-token':'invalid'}})).r.status,403);
  assert.equal((await request('/api/start',{method:'POST',body:{padding:'x'.repeat(9000)}})).r.status,413);
  const malformed=await fetch(origin+'/api/start',{method:'POST',signal:AbortSignal.timeout(5000),redirect:'error',headers:{origin,'content-type':'application/json','x-pitcrew-token':token},body:'{bad'});assert.equal(malformed.status,400);await malformed.text();
  assert.equal((await request('/api/workbench/start',{method:'POST',body:{taskId:'pagination-zero'}})).r.status,503);
  assert.equal((await action('cancel')).r.status,200);assert.equal(state.snapshot.closed,true);
 }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('real HTTP planner stays prepared while the configured session has no repair job',async()=>{
 const profile={kind:'runtime-reported',profileHash:'a'.repeat(64),modelId:'AUTHORED-IDLE-TRANSPORT',modelDigest:'b'.repeat(64),engineBuild:'AUTHORED-NO-INFERENCE'};
 const firebaseConfig={firebase:{apiKey:'example-public-key',projectId:'example-project',appId:'example-app'},appCheckSiteKey:'example-site',appName:'idle-transport'};
 const server=await start({live:{profile,firebaseConfig,contentSecurityPolicy:"default-src 'self'",providerTimeoutMs:15000,
  coder:{locality:'local-only',async generate(){throw Error('must not infer');}}}});
 const origin='http://127.0.0.1:'+server.address().port;let pump;
 try{
  const page=await fetch(origin,{signal:AbortSignal.timeout(5000)});await page.text();
  assert.equal(page.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  const boot=await (await fetch(origin+'/api/bootstrap',{signal:AbortSignal.timeout(5000)})).json();
  const response=await fetch(origin+'/api/workbench/start',{method:'POST',signal:AbortSignal.timeout(5000),
   headers:{origin,'content-type':'application/json','x-pitcrew-token':boot.sessionToken},
   body:JSON.stringify({taskId:'pagination-zero',startAdmissionId:boot.startAdmissionId})});
  assert.equal(response.status,200);const started=await response.json();assert.ok(started.startAdmissionId);
  let calls=0,stops=0;
  const client={state:{prepared:true},async decide(){calls++;throw Error('no job exists');},stop(){stops++;}};
  const transport=createFetchPlannerTransport({companion:origin,...started.plannerPair,workerId:'authored-idle-worker',
   fetchImpl:(url,options)=>fetch(url,{...options,headers:{...options.headers,origin}})});
  pump=createBrowserPlannerPump({client,transport});
  assert.equal((await pump.runOne()).status,'idle');assert.equal((await pump.runOne()).status,'idle');
  assert.equal(calls,0);assert.equal(stops,0);assert.equal(pump.state.closed,false);
 }finally{pump?.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
