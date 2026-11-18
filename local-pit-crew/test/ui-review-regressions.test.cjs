'use strict';
// Authored in-process regressions. The DOM and fetch are fakes, not a browser/network.
// vm runs only the checked-in authored frontend, never model/user/untrusted source.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createReferenceApp}=require('../ui/bridge.cjs');
const {runAuthoredChecks}=require('./fixtures.cjs');
const origin='http://127.0.0.1:48112',host='127.0.0.1:48112';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function harness(options={}){
 const app=await createReferenceApp({origin,...options});let token,state;
 const request=async(method,pathname,body)=>{
  const r=await app.dispatch({method,pathname,body,headers:{host,origin,'content-type':'application/json','x-pitcrew-token':token}});
  if(r.body.state)state=r.body.state;return r;
 };
 const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
 const start=id=>request('POST','/api/start',{taskId:id??'pagination-zero'});
 const action=name=>request('POST','/api/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action:name});
 return{app,request,start,action,get state(){return state;}};
}
test('UI review: rejected authored check closes pending session and permits explicit restart',async()=>{
 let reject=true;
 const h=await harness({executeChecks:async(id,variant)=>{if(reject)throw Error('authored delegate failure');return runAuthoredChecks(id,variant);}});
 await h.start();const first=h.state.sessionId;
 const result=await h.action('test');
 assert.equal(result.status,503);assert.match(result.body.error,/Reopen/);
 assert.equal(h.state.snapshot.closed,true);assert.equal(h.state.snapshot.pending,null);
 assert.equal(h.state.snapshot.publicChecksCurrent,false);assert.deepEqual(h.state.checks,[]);
 assert.match(h.state.events.at(-1).label,/runner failed/);
 assert.equal((await h.action('finish')).status,409);
 reject=false;await h.start();assert.notEqual(h.state.sessionId,first);
 assert.equal((await h.action('load-authored')).status,200);
 assert.equal((await h.action('apply')).status,200);
 assert.equal((await h.action('test')).status,200);
 assert.equal(h.state.snapshot.publicChecksCurrent,true);
 assert.equal((await h.action('finish')).status,200);
});
test('UI review: malformed trusted check verdict closes without a stuck pending operation',async()=>{
 const h=await harness({executeChecks:async()=>({checks:[{id:'not-the-contract',ok:true}]})});
 await h.start();const result=await h.action('test');
 assert.equal(result.status,503);assert.equal(h.state.snapshot.closed,true);
 assert.equal(h.state.snapshot.pending,null);assert.equal(h.state.snapshot.publicChecksCurrent,false);
 assert.deepEqual(h.state.checks,[]);assert.equal(h.state.aiRunning,false);
});
test('UI review: old rejected check cannot close a newer reference session',async()=>{
 const entered=deferred(),finish=deferred();
 const h=await harness({executeChecks:async()=>{entered.resolve();await finish.promise;}});
 await h.start();const pending=h.action('test');await entered.promise;
 await h.start('config-isolation');const second=h.state.sessionId;
 finish.reject(Error('authored late failure'));assert.equal((await pending).status,409);
 assert.equal(h.state.sessionId,second);assert.equal(h.state.task.id,'config-isolation');
 assert.equal(h.state.snapshot.closed,false);assert.equal(h.state.snapshot.pending,null);
 assert.deepEqual(h.state.checks,[]);
});
class Element{
 constructor(){this.disabled=true;this.value='';this.children=[];this.listeners=new Map();this.textContent='';this.className='';}
 addEventListener(name,fn){this.listeners.set(name,fn);}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 // Deliberately permits synthetic invocation even when disabled, to test the JS guard too.
 emit(name){return this.listeners.get(name)?.();}
}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
async function frontend(options={},planner=null){
 const app=await createReferenceApp({origin,...options}),elements=new Map(),hooks=new Map(),queue=[];
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
  createElement(){return new Element();},addEventListener(name,fn){hooks.set(name,fn);}};
 const window={document,fetch(pathname,options){
  const d=deferred();queue.push({pathname,options,...d});return d.promise;
 }};
 if(planner)window.LocalPitCrewCreateFirebasePlanner=()=>planner;
 const script=fs.readFileSync(path.join(__dirname,'../ui/public/app.js'),'utf8');
 vm.runInNewContext(script,{window},{filename:'authored-ui-app.js',timeout:1000});
 hooks.get('DOMContentLoaded')();
 async function deliver(request){
  const headers={host,origin,...Object.fromEntries(Object.entries(request.options.headers).map(([k,v])=>[k.toLowerCase(),v]))};
  const result=await app.dispatch({method:request.options.method,pathname:request.pathname,headers,
   body:request.options.body===undefined?undefined:JSON.parse(request.options.body)});
  const body=planner&&request.pathname==='/api/bootstrap'
   ?{...result.body,capabilities:{...result.body.capabilities,planner:{available:true,firebaseConfig:{}}}}
   :result.body;
  request.resolve({ok:result.status>=200&&result.status<300,json:async()=>body});
  await settle();return result;
 }
 await deliver(queue.shift());
 return{app,elements,queue,deliver};
}
test('stopping a Nano diagnosis preserves the run and discards late advice during a retry',async()=>{
 const pending=[];let stops=0;
 const planner={state:{calls:0},async prepareFromUserGesture(){return{status:'prepared'};},
  decide(snapshot){this.state.calls++;const result=deferred();pending.push({snapshot,...result});return result.promise;},stop(){stops++;}};
 const f=await frontend({},planner),el=id=>f.elements.get(id);
 el('sample').value='pagination-zero';
 const inspection=el('investigate').emit('click');
 while(f.queue.length)await f.deliver(f.queue.shift());
 await inspection;
 const first=el('diagnose').emit('click');await settle();
 assert.equal(pending.length,1);
 assert.equal(el('stop-diagnosis').hidden,false);
 assert.equal(el('load').disabled,true);
 const passCount=el('pass-count').textContent,stopsBefore=stops;
 await el('stop-diagnosis').emit('click');
 assert.equal(stops,stopsBefore+1);
 assert.equal(el('stop-diagnosis').hidden,true);
 assert.equal(el('load').disabled,false);
 assert.equal(el('pass-count').textContent,passCount);
 assert.equal(el('planner-calls').textContent,'1');
 assert.match(el('advisor-status').textContent,/Stopped/);
 const retry=el('diagnose').emit('click');await settle();
 assert.equal(pending.length,2);
 assert.equal(pending[1].snapshot.revision,pending[0].snapshot.revision);
 pending[0].resolve({status:'decision',inferenceSource:'on_device',decision:{action:'ask_user'}});
 await first;
 assert.equal(stops,stopsBefore+1);
 assert.equal(el('stop-diagnosis').hidden,false);
 assert.equal(el('advisor-result').children.length,0);
 pending[1].resolve({status:'decision',inferenceSource:'on_device',decision:{action:'ask_user',evidenceIds:[]}});
 await retry;
 assert.equal(el('stop-diagnosis').hidden,true);
 assert.equal(el('planner-calls').textContent,'2');
 assert.match(el('advisor-status').textContent,/requested more evidence/);
});
test('UI review: deferred start disables Open and rejects competing starts before dispatch',async()=>{
 const f=await frontend(),el=id=>f.elements.get(id);
 assert.equal(el('open').disabled,false);
 el('sample').value='pagination-zero';const first=el('open').emit('click');
 assert.equal(el('open').disabled,true);assert.equal(el('sample').disabled,true);
 assert.equal(f.queue.length,1);
 el('sample').value='config-isolation';await el('open').emit('click');
 assert.equal(f.queue.length,1,'no second start can arrive in reverse order');
 const response=await f.deliver(f.queue.shift());await first;
 assert.equal(el('task').textContent,response.body.state.task.prompt);
 assert.equal(response.body.state.task.id,'pagination-zero');
 assert.equal(el('open').disabled,false);assert.equal(el('sample').disabled,false);
 const server=await f.app.dispatch({method:'GET',pathname:'/api/state',headers:{host}});
 assert.equal(el('task').textContent,server.body.state.task.prompt);
 assert.equal(server.body.state.sessionId,response.body.state.sessionId);
 // Once settled, a deliberate new start is permitted and agrees with the server.
 const second=el('open').emit('click');assert.equal(f.queue.length,1);
 const changed=await f.deliver(f.queue.shift());await second;
 assert.equal(changed.body.state.task.id,'config-isolation');
 assert.equal(el('task').textContent,changed.body.state.task.prompt);
});
test('UI review: actual authored frontend keeps Close usable during a deferred check',async()=>{
 const entered=deferred(),release=deferred();
 const f=await frontend({executeChecks:async(id,variant)=>{entered.resolve();await release.promise;return runAuthoredChecks(id,variant);}});
 const el=id=>f.elements.get(id);el('sample').value='pagination-zero';
 const start=el('open').emit('click');await f.deliver(f.queue.shift());await start;
 const checking=el('test').emit('click'),pendingDelivery=f.deliver(f.queue.shift());await entered.promise;
 assert.equal(el('open').disabled,true);assert.equal(el('sample').disabled,true);
 assert.equal(el('cancel').disabled,false);
 await el('open').emit('click');assert.equal(f.queue.length,0,'busy check cannot dispatch a new start');
 const close=el('cancel').emit('click');const closed=await f.deliver(f.queue.shift());await close;
 assert.equal(closed.body.state.snapshot.closed,true);
 assert.match(el('status').textContent,/No model result is claimed/);
 release.resolve();assert.equal((await pendingDelivery).status,409);await checking;
 assert.match(el('status').textContent,/No model result is claimed/);
 assert.equal(el('test').disabled,true);assert.equal(el('cancel').disabled,true);
});

test('guided inspection reproduces each authored failure and reads its source without loading a patch',async()=>{
 for(const taskId of ['pagination-zero','config-isolation','latest-request-wins']){
  const f=await frontend(),el=id=>f.elements.get(id);el('sample').value=taskId;
  const inspection=el('investigate').emit('click');assert.equal(el('investigate').disabled,true);
  await el('open').emit('click');await el('investigate').emit('click');assert.equal(f.queue.length,1);
  const opened=await f.deliver(f.queue.shift());assert.equal(opened.body.state.task.id,taskId);
  assert.equal(f.queue.length,1);assert.equal(JSON.parse(f.queue[0].options.body).action,'test');
  const checked=await f.deliver(f.queue.shift());assert.ok(checked.body.state.checks.some(c=>!c.ok));
  const paths=opened.body.state.snapshot.manifest.map(file=>file.path);let revision=checked.body.state.snapshot.revision;
  for(const path of paths){
   assert.equal(f.queue.length,1);assert.deepEqual(JSON.parse(f.queue[0].options.body),{
    sessionId:opened.body.state.sessionId,revision,action:'read',path});
   revision=(await f.deliver(f.queue.shift())).body.state.snapshot.revision;
  }
  await inspection;assert.equal(f.queue.length,0);assert.equal(el('source-evidence').open,true);
  const result=await f.app.dispatch({method:'GET',pathname:'/api/state',headers:{host}}),state=result.body.state;
  assert.equal(state.task.id,taskId);assert.equal(state.proposal,null);assert.equal(state.modelCalls,0);
  assert.equal(state.snapshot.counts.coder,0);assert.equal(state.snapshot.counts.patches,0);
  assert.deepEqual(state.snapshot.evidence.map(e=>e.path),paths);assert.match(el('status').textContent,/public checks failed.*source is ready/);
  assert.equal(el('investigate').disabled,false);assert.equal(el('load').disabled,false);
 }
});

test('Close and a replacement run stop a guided inspection before any source read after its deferred baseline',async()=>{
 const entered=deferred(),release=deferred();
 const f=await frontend({executeChecks:async(id,variant)=>{entered.resolve();await release.promise;return runAuthoredChecks(id,variant);}}),el=id=>f.elements.get(id);
 el('sample').value='pagination-zero';const inspection=el('investigate').emit('click');await f.deliver(f.queue.shift());
 const pendingCheck=f.deliver(f.queue.shift());await entered.promise;
 assert.equal(el('cancel').disabled,false);assert.equal(el('investigate').disabled,true);assert.equal(el('load').disabled,true);
 const close=el('cancel').emit('click');await f.deliver(f.queue.shift());await close;
 el('sample').value='config-isolation';const replacement=el('open').emit('click');await f.deliver(f.queue.shift());await replacement;
 const message=el('task').textContent;release.resolve();assert.equal((await pendingCheck).status,409);await inspection;
 assert.equal(f.queue.length,0);assert.equal(el('task').textContent,message);assert.equal(el('investigate').disabled,false);
 const result=await f.app.dispatch({method:'GET',pathname:'/api/state',headers:{host}});
 assert.equal(result.body.state.task.id,'config-isolation');assert.deepEqual(result.body.state.snapshot.evidence,[]);assert.equal(result.body.state.proposal,null);
});

test('an unavailable baseline ends guided inspection without reading source or hiding its error',async()=>{
 const f=await frontend({executeChecks:async()=>{throw Error('authored-baseline-unavailable');}}),el=id=>f.elements.get(id);
 el('sample').value='pagination-zero';const inspection=el('investigate').emit('click');await f.deliver(f.queue.shift());
  assert.equal((await f.deliver(f.queue.shift())).status,503);await inspection;
 assert.equal(f.queue.length,0);assert.equal(el('investigate').disabled,false);assert.equal(el('status').className,'status error');
 const result=await f.app.dispatch({method:'GET',pathname:'/api/state',headers:{host}});
 assert.deepEqual(result.body.state.snapshot.evidence,[]);assert.equal(result.body.state.proposal,null);
});
