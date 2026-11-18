'use strict';
// Authored in-process UI/bridge tests only. No socket/browser/model or untrusted source execution.
const test=require('node:test'),assert=require('node:assert/strict');
const {createReferenceApp}=require('../ui/bridge.cjs');
const {createHandler,assetFor}=require('../ui/server.cjs');
const {viewModel}=require('../ui/public/app.js');
const {runAuthoredChecks}=require('./fixtures.cjs');
const origin='http://127.0.0.1:48111',host='127.0.0.1:48111';
async function harness(options={}){
 const app=await createReferenceApp({origin,...options});
 let token,current;
 const request=async(method,pathname,body,extraHeaders={})=>{
  const r=await app.dispatch({method,pathname,body,headers:{host,origin,'content-type':'application/json','x-pitcrew-token':token,...extraHeaders}});
  if(r.body.state)current=r.body.state;
  return r;
 };
 const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
 const start=async(id='pagination-zero')=>request('POST','/api/start',{taskId:id});
 const action=async(name,extra={})=>request('POST','/api/action',{sessionId:current.sessionId,revision:current.snapshot.revision,action:name,...extra});
 return{app,boot,request,start,action,get state(){return current;}};
}
test('reference bootstrap labels no AI and withholds authored corrections',async()=>{
 const h=await harness();assert.equal(h.boot.status,200);
 assert.equal(h.state.mode,'authored-reference');assert.equal(h.state.aiRunning,false);assert.equal(h.state.modelCalls,0);
 for(const task of h.boot.body.tasks)assert.deepEqual(Object.keys(task).sort(),['id','prompt','title']);
 assert.equal(h.state.proposal,null);assert.equal(h.state.snapshot,null);
});
test('bridge uses actual controller read evidence and immutable task',async()=>{
 const h=await harness();await h.start();const task=h.state.task.prompt;
 const r=await h.action('read',{path:'src/list.js'});assert.equal(r.status,200);
 assert.equal(h.state.snapshot.evidence.length,1);
 assert.equal(h.state.snapshot.evidence[0].path,'src/list.js');
 assert.equal(h.state.snapshot.originalTask,task);
 assert.ok(h.state.snapshot.evidence[0].content.includes('if(cursor)'));
});
test('seeded baseline failures are not displayed as success',async()=>{
 const h=await harness();await h.start();
 assert.equal((await h.action('test')).status,200);
 assert.ok(h.state.checks.some(c=>!c.ok));
 assert.equal(h.state.snapshot.publicChecksCurrent,false);
 assert.equal((await h.action('finish')).status,409);
});
test('authored patch traverses actual in-memory apply/public-check/finish workflow',async()=>{
 for(const id of ['pagination-zero','config-isolation','latest-request-wins']){
  const h=await harness();await h.start(id);
  assert.equal((await h.action('load-authored')).status,200);
  assert.match(h.state.proposal.source,/Authored/);
  assert.equal(h.state.snapshot.counts.coder,1);
  assert.equal(h.state.snapshot.counts.patches,0);
  assert.equal((await h.action('apply')).status,200);
  assert.equal(h.state.snapshot.counts.patches,1);
  assert.equal(h.state.snapshot.publicChecksCurrent,false);
  assert.equal((await h.action('test')).status,200);
  assert.equal(h.state.snapshot.publicChecksCurrent,true);
  assert.ok(h.state.checks.every(c=>c.ok));
  assert.equal((await h.action('finish')).status,200);
  assert.equal(h.state.snapshot.closed,true);
  assert.equal(h.state.aiRunning,false);assert.equal(h.state.modelCalls,0);
 }
});
test('unknown reference source/path and caller-supplied artifacts/checks are rejected',async()=>{
 const h=await harness();await h.start();const before=h.state.snapshot.manifest;
 assert.equal((await h.action('read',{path:'../src/controller.cjs'})).status,409);
 assert.deepEqual(h.state.snapshot.manifest,before);
 assert.equal((await h.action('test',{checks:[{id:'forged',ok:true}]})).status,409);
 assert.equal((await h.action('load-authored',{edits:[{path:'invented'}]})).status,409);
 assert.equal((await h.request('POST','/api/complete',{passed:true})).status,404);
});
test('stale revisions cannot mutate the session',async()=>{
 const h=await harness();await h.start();const old=h.state.snapshot.revision;
 await h.action('read',{path:'src/list.js'});const revision=h.state.snapshot.revision;
 const r=await h.request('POST','/api/action',{sessionId:h.state.sessionId,revision:old,action:'load-authored'});
 assert.equal(r.status,409);assert.equal(h.state.snapshot.revision,revision);assert.equal(h.state.proposal,null);
});
test('host/origin/token/JSON checks reject unauthorized reference requests',async()=>{
 const h=await harness();
 assert.equal((await h.request('POST','/api/start',{taskId:'pagination-zero'},{host:'attacker.example'})).status,403);
 assert.equal((await h.request('POST','/api/start',{taskId:'pagination-zero'},{origin:'https://attacker.example'})).status,403);
 assert.equal((await h.request('POST','/api/start',{taskId:'pagination-zero'},{'x-pitcrew-token':'wrong'})).status,403);
 assert.equal((await h.request('POST','/api/start',{taskId:'pagination-zero'},{'content-type':'text/plain'})).status,415);
});
test('close and restart create a clean new reference session',async()=>{
 const h=await harness();await h.start();const first=h.state.sessionId;
 await h.action('load-authored');await h.action('cancel');
 assert.equal(h.state.snapshot.closed,true);
 await h.start();assert.notEqual(h.state.sessionId,first);
 assert.equal(h.state.snapshot.revision,0);assert.equal(h.state.proposal,null);assert.deepEqual(h.state.checks,[]);
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('closing during an authored check discards its late result',async()=>{
 const entered=deferred(),release=deferred();
 const h=await harness({executeChecks:async(id,variant)=>{entered.resolve();await release.promise;return runAuthoredChecks(id,variant);}});
 await h.start();
 const pending=h.action('test');await entered.promise;
 const cancelled=await h.action('cancel');assert.equal(cancelled.status,200);assert.equal(h.state.snapshot.closed,true);
 release.resolve();assert.equal((await pending).status,409);
 assert.equal(h.state.snapshot.closed,true);assert.deepEqual(h.state.checks,[]);
});
test('changing sample during an authored check cannot restore the old session',async()=>{
 const entered=deferred(),release=deferred();
 const h=await harness({executeChecks:async(id,variant)=>{entered.resolve();await release.promise;return runAuthoredChecks(id,variant);}});
 await h.start();const first=h.state.sessionId;
 const pending=h.action('test');await entered.promise;
 await h.start('config-isolation');const second=h.state.sessionId;assert.notEqual(second,first);
 release.resolve();assert.equal((await pending).status,409);
 assert.equal(h.state.sessionId,second);assert.equal(h.state.task.id,'config-isolation');assert.deepEqual(h.state.checks,[]);
});
function responseRecorder(){
 return{headers:{},status:null,body:null,setHeader(name,value){this.headers[name]=value;},
  writeHead(status,headers={}){this.status=status;Object.assign(this.headers,headers);},
  end(body){this.body=body;}};
}
test('HTTP handler serves only fixed authored assets without opening a socket',async()=>{
 const h=await harness();const handler=createHandler({app:h.app,origin:()=>origin});
 const res=responseRecorder();await handler({method:'GET',url:'/',headers:{host}},res);
 assert.equal(res.status,200);assert.match(String(res.body),/Try a failing function/);
 assert.match(res.headers['Content-Security-Policy'],/connect-src 'self'/);
 assert.equal(assetFor('/../src/controller.cjs'),null);
 const rejected=responseRecorder();await handler({method:'GET',url:'/../src/controller.cjs',headers:{host}},rejected);
 assert.equal(rejected.status,404);
});
test('HTTP handler rejects oversized/malformed JSON in process',async()=>{
 const h=await harness();const handler=createHandler({app:h.app,origin:()=>origin});
 const huge={method:'POST',url:'/api/start',headers:{host},async *[Symbol.asyncIterator](){yield Buffer.alloc(8193,65);}};
 const res=responseRecorder();await handler(huge,res);assert.equal(res.status,413);
 const bad={method:'POST',url:'/api/start',headers:{host},async *[Symbol.asyncIterator](){yield Buffer.from('{bad');}};
 const invalid=responseRecorder();await handler(bad,invalid);assert.equal(invalid.status,400);
});

test('development App Check script is opt-in, loopback-bound and contains no persistent credential',async()=>{
 const h=await harness(),normal=createHandler({app:h.app,origin:()=>origin}),dev=createHandler({app:h.app,origin:()=>origin,developmentAppCheck:true});
 const request=async(handler,url,requestHost=host)=>{const res=responseRecorder();await handler({method:'GET',url,headers:{host:requestHost}},res);return res;};
 const normalPage=await request(normal,'/');assert.doesNotMatch(String(normalPage.body),/app-check-development/);
 assert.equal((await request(normal,'/app-check-development.js')).status,404);
 const devPage=await request(dev,'/');assert.match(String(devPage.body),/<head><script src="\/app-check-development.js"><\/script>/);
 const script=await request(dev,'/app-check-development.js');assert.equal(script.status,200);
 assert.match(script.body,/FIREBASE_APPCHECK_DEBUG_TOKEN=true/);assert.match(script.body,/location.hostname!=='127.0.0.1'/);
 assert.doesNotMatch(script.body,/[a-f0-9]{8}-[a-f0-9-]{27}/);assert.equal(script.headers['Cache-Control'],'no-store');
 assert.equal((await request(dev,'/app-check-development.js','evil.example')).status,403);
 assert.throws(()=>createHandler({app:h.app,origin:()=> 'https://example.com',developmentAppCheck:true}),/loopback/);
 assert.throws(()=>createHandler({app:h.app,origin:()=>origin,developmentAppCheck:'true'}));
});
test('pure view model does not call providers and labels reference outcomes',()=>{
 const initial=viewModel(null);assert.equal(initial.opened,false);assert.equal(initial.canFinish,false);
 const state={task:{title:'Authored'},proposal:{},checks:[],snapshot:{closed:false,publicChecksCurrent:true,counts:{patches:1}}};
 const view=viewModel(state);assert.equal(view.canFinish,true);assert.match(view.status,/not a benchmark result/);
 state.snapshot.closed=true;assert.match(viewModel(state).status,/No model result is claimed/);
});
