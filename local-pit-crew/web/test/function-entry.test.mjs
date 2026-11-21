// DOM fixture with the real memory composition and actual Node WASM checks.
// This is not a Chrome execution or model-quality claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import workflowModule from '../../src/reference-workflow.cjs';
import probeModule from '../../runner/probe.cjs';
import {createBrowserFunctionWorkbench} from '../function-workbench.mjs';
import {createReferenceTransport} from '../reference-transport.mjs';
import {createFirebaseFunctionDrafterCore} from '../firebase-function-draft-core.mjs';
import {createFirebaseCloudReviewerCore} from '../firebase-cloud-review-core.mjs';
import replayModule from '../../../scripts/replay-function.cjs';
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
async function setup({holdCheck=null,admissionKind='test-wasm-only',holdReplay=null,hash='',digest=null,tamperCheckedSource=false,tamperReplayContract=false,cloud=null,fetchFirebaseConfig=null,nativeStatus=null,clipboard=null}={}){
 const reference=await workflowModule.createReferenceWorkflow({definitions:[],executeChecks(){throw Error('Not a drill test');}});
 const calls=[],downloads=[],objectUrls=new Map(),lifecycle=new Map();let urlIndex=0,reloads=0,activeElement=null;
 const verifier={capabilityFor:()=>({available:true,qualified:false,admissionKind}),close(){},async runPublicChecks(ticket,{signal}){
  if(holdCheck&&(await holdCheck())==='browser-setup-unavailable'){
   return{status:'unavailable',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,reason:'browser-setup-unavailable'};
  }
  const result=await probeModule.runCandidateProbe({suiteId:ticket.suiteId,files:ticket.files},{signal});
  if(result.status!=='observed')throw Error('No candidate verdict');
  return{status:'candidate-verdict',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,observations:result.observations,checks:result.checks};
 }};
 const workflow=createBrowserFunctionWorkbench({reference,verifier});
 const request=createReferenceTransport({workflow,functionWorkbench:true,firebaseConfig:fetchFirebaseConfig?null:cloud?.config??null,firebaseConfigured:!!cloud});
 class Element{
  constructor(){this.value='';this.children=[];this.listeners=new Map();this.attributes=new Map();this.disabled=true;}
  get options(){return this.children;}
  setAttribute(name,value){this.attributes.set(name,value);}focus(){activeElement=this;}
  removeAttribute(name){this.attributes.delete(name);}
  showModal(){this.open=true;}
  addEventListener(name,fn){this.listeners.set(name,fn);}append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}click(){if(this.download){downloads.push({fileName:this.download,blob:objectUrls.get(this.href)});return;}return this.listeners.get('click')?.();}
 }
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={readyState:'complete',getElementById:el,createElement:()=>new Element(),get activeElement(){return activeElement;}};
 const window={document,location:{hash,reload(){reloads++;}},setTimeout,clearTimeout,Blob,crypto:{subtle:{digest:digest??webcrypto.subtle.digest.bind(webcrypto.subtle)}},
  URL:{createObjectURL(blob){const url='blob:authored-'+(++urlIndex);objectUrls.set(url,blob);return url;},revokeObjectURL(url){objectUrls.delete(url);}},
  addEventListener(event,callback){lifecycle.set(event,callback);},fetch:fetchFirebaseConfig??(()=>{throw Error('Unexpected network');}),
  async LocalPitCrewReferenceRequest(path,options){calls.push({path,body:options.body?JSON.parse(options.body):null});if(path==='/api/function/replay'&&holdReplay)await holdReplay();const response=await request(path,options);
   if(!tamperCheckedSource&&!tamperReplayContract)return response;
   // Deliberately corrupt only the returned source bytes, preserving its claimed hash.
   const data=await response.json();if(tamperCheckedSource&&data.state?.checkedFunction)data.state.checkedFunction.content+='\n/* tampered transport */';
   if(tamperReplayContract)for(const packet of [data.state?.checkedReplay,data.state?.failedReplay])if(packet)packet.files[1].content+=' ';
   return{...response,json:async()=>structuredClone(data)};
  }};
 if(cloud){
  const createPlanner=()=>cloud.planner??{state:{prepared:false,calls:0},stop(){},async dispose(){},prepareFromUserGesture(){cloud.calls.native++;throw Error('Unexpected native inference');}};
  Object.defineProperty(window,'LocalPitCrewCreateFirebasePlanner',{get(){cloud.calls.adapterReads=(cloud.calls.adapterReads??0)+1;return createPlanner;}});
  window.LocalPitCrewCreateFirebaseFunctionDrafter=()=>{cloud.calls.factory++;return cloud.client;};
  window.LocalPitCrewCreateFirebaseCloudReviewer=()=>cloud.reviewer;
 }
 if(nativeStatus){
  window.isSecureContext=true;
  window.LanguageModel={availability:nativeStatus,create(){throw Error('Readiness must not create a session');}};
 }
 if(clipboard)window.navigator={clipboard};
 const source=await readFile(new URL('../../ui/public/app.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{window,TextEncoder,TextDecoder,Uint8Array,AbortSignal,setTimeout,clearTimeout},{timeout:1000});await settle();
 return{el,calls,downloads,lifecycle,get reloads(){return reloads;},get activeElement(){return activeElement;},async close(){workflow.close();await cloud?.client.dispose();await cloud?.reviewer.dispose();}};
}
test('a cached return reloads the hosted workbench after teardown, while an ordinary show does not',async()=>{
 const f=await setup();
 try{
  f.lifecycle.get('pageshow')({persisted:false});
  assert.equal(f.reloads,0);
  await f.el('try-function-example').click();
  f.lifecycle.get('pagehide')();
  f.lifecycle.get('pageshow')({persisted:false});
  assert.equal(f.reloads,0);
  f.lifecycle.get('pageshow')({persisted:true});
  assert.equal(f.reloads,1);
 }finally{await f.close();}
});
test('a guided baseline setup failure focuses Retry and restores the evidence after the next check',async()=>{
 let attempts=0;
 const f=await setup({admissionKind:'browser-worker-quickjs',holdCheck:()=>++attempts===1?'browser-setup-unavailable':undefined});
 try{
  await f.el('try-shipping-example').click();
  assert.equal(f.el('next-action').textContent,'Retry verification');
  assert.equal(f.activeElement,f.el('next-action'));
  assert.equal(f.el('pass-count').textContent,'—');
  await f.el('next-action').click();
  assert.equal(f.el('pass-count').textContent,'3/4');
  assert.equal(f.el('source-evidence').open,true);
  assert.equal(f.activeElement,f.el('active-run'));
  const runs=f.calls.filter(call=>call.body?.action==='test');
  assert.equal(runs.length,2);
  assert.equal(runs[0].body.sessionId,runs[1].body.sessionId);
  assert.deepEqual(f.calls.filter(call=>call.body?.action==='read').map(call=>call.body.path),['src/function.js','contract.json']);
 }finally{await f.close();}
});
test('the guided next step retains focus and ignores activation during verification',async()=>{
 let begin,release,attempts=0;
 const started=new Promise(resolve=>{begin=resolve;});
 const pending=new Promise(resolve=>{release=resolve;});
 const f=await setup({holdCheck:async()=>{if(++attempts===2){begin();await pending;}}});
 try{
  await f.el('try-shipping-example').click();
  await f.el('load-function-example-patch').click();
  f.el('load').focus();
  await f.el('load').click();
  const next=f.el('next-action');
  assert.equal(f.activeElement,next);
  await next.click();
  assert.equal(f.activeElement,f.el('apply'));
  await f.el('apply').click();
  assert.equal(f.activeElement,next);
  const verification=next.click();
  await started;
  assert.equal(f.activeElement,next);
  assert.equal(next.disabled,false);
  assert.equal(next.attributes.get('aria-disabled'),'true');
  await next.click();
  assert.equal(f.calls.filter(call=>call.body?.action==='test').length,2);
  release();
  await verification;
  assert.equal(f.el('pass-count').textContent,'4/4');
  assert.equal(f.activeElement,next);
  assert.equal(next.textContent,'Try a new counterexample');
  assert.equal(next.attributes.get('aria-disabled'),'false');
 }finally{release();await f.close();}
});
test('one-click function entry runs real failing checks, reads evidence, preserves draft intake and makes no model call',async()=>{
 const f=await setup();try{
  assert.equal(f.el('active-run').hidden,true);assert.equal(f.el('mode-chip').textContent,'Ready for a repair');
  assert.equal(f.el('try-function-example').disabled,false);
  f.el('function-title').value='UNSAVED_TITLE';f.el('function-source').value='UNSAVED_SOURCE';f.el('function-cases').value='UNSAVED_CASES';
  await f.el('try-function-example').click();await settle();
  assert.equal(f.el('pass-count').textContent,'3/5');assert.equal(f.el('active-run').hidden,false);assert.equal(f.el('source-evidence').open,true);
  assert.equal(f.el('failure-preview').hidden,false);
  assert.equal(f.el('failure-preview-count').textContent,'3/5 passing');
  assert.equal(f.el('failure-preview-name').textContent,'Keep special names');
  assert.equal(f.el('failure-preview-reason').textContent,'The return value differs');
  assert.deepEqual(f.calls.filter(c=>c.path==='/api/function/action').map(c=>c.body.action),['test','read','read']);
  assert.equal(f.el('function-title').value,'UNSAVED_TITLE');assert.equal(f.el('function-source').value,'UNSAVED_SOURCE');assert.equal(f.el('function-cases').value,'UNSAVED_CASES');
  await f.el('view-record').click();const record=JSON.parse(f.el('record-json').textContent);
  assert.equal(record.sample,'json-function-v1');assert.equal(record.counts.tests,1);assert.equal(record.counts.patches,0);
  assert.equal(record.counts.advisorCalls+record.counts.cloudCalls+record.counts.coderCalls,0);
  await f.el('bring-function').click();assert.equal(f.el('function-intake').open,true);
 }finally{f.close();}
});
test('explicit browser readiness disables unavailable diagnosis and re-enables it after a successful check',async()=>{
 const cloud=cloudFixture();
 let nativeStatus='unavailable',configFetches=0;
 const f=await setup({cloud,nativeStatus:async()=>nativeStatus,async fetchFirebaseConfig(path){
  assert.equal(path,'/firebase-config.json');configFetches++;
  return{ok:true,json:async()=>({firebaseConfig:cloud.config})};
 }});
 try{
  await f.el('try-function-example').click();
  assert.match(f.el('advisor-status').textContent,/needs a ready browser model/);
  await f.el('open-browser-setup').click();assert.equal(f.el('runtime-setup').open,true);
  await f.el('check-browser').click();assert.equal(f.el('diagnose').disabled,true);
  assert.match(f.el('advisor-status').textContent,/reports the on-device model is unavailable/);
  await f.el('diagnose').click();assert.equal(cloud.calls.factory,0);
  assert.equal(configFetches,0);
  assert.equal(f.el('review-cloud').disabled,false);
  nativeStatus='available';
  await f.el('check-browser').click();assert.equal(f.el('diagnose').disabled,false);
  assert.match(f.el('browser-status').textContent,/Firebase is loaded.*offline diagnosis/);
  assert.match(f.el('advisor-status').textContent,/Firebase is loaded for this tab/);
  assert.equal(configFetches,1);
  await f.el('check-browser').click();
  assert.equal(configFetches,1);
  assert.equal(f.el('pass-count').textContent,'3/5');assert.equal(cloud.calls.native,0);
 }finally{await f.close();}
});
test('guided tag repair passes, fails an added whitespace example, then passes the extended contract',async()=>{
 const f=await setup();
 try{
  await f.el('try-function-example').click();
  assert.equal(f.el('load-function-example-patch').hidden,false);
  await f.el('load-function-example-patch').click();
  assert.equal(f.calls.some(c=>c.body?.action==='propose'),false);
  await f.el('load').click();
  await f.el('apply').click();
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'5/5');
  assert.equal(f.el('fill-tab-padding-challenge').hidden,false);
  await f.el('fill-tab-padding-challenge').click();
  assert.deepEqual(JSON.parse(f.el('challenge-args').value),[[' Ops ','\tops','API','api']]);
  assert.deepEqual(JSON.parse(f.el('challenge-expected').value),[' Ops ','API']);
  assert.equal(f.calls.some(c=>c.path==='/api/function/extend'),false);
  await f.el('extend-function').click();
  assert.equal(f.el('finish').disabled,true);
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'5/6');
  assert.equal(f.el('finish').disabled,true);
  assert.equal(f.el('inspect-failed-example').hidden,false);
  const firstResult=f.el('checks').children[0];
  assert.equal(firstResult.children[0].textContent,'FAIL');
  assert.equal(firstResult.children[1].textContent,'Tab-pad an omitted duplicate');
  assert.equal(firstResult.children[1].children[0].textContent,'Added counterexample');
  await f.el('load-function-example-patch').click();
  await f.el('load').click();
  await f.el('apply').click();
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'6/6');
  assert.equal(f.el('inspect-failed-example').hidden,true);
  assert.equal(f.el('failure-preview').hidden,true);
  await f.el('finish').click();
  await f.el('view-record').click();
  assert.equal(JSON.parse(f.el('record-json').textContent).counts.modelCallsTotal,0);
 }finally{await f.close();}
});
test('checkout walkthrough replays a draft and independently exposes the unsafe-integer bug',async()=>{
 const f=await setup();
 try{
  await f.el('try-shipping-example').click();
  assert.equal(f.el('pass-count').textContent,'3/4');
  const [, , inputChange,inputValues,fullArguments]=f.el('checks').children[0].children[2].children;
  assert.equal(inputChange.textContent,'First observed input change: Argument 1[0]["id"]');
  assert.deepEqual(inputValues.children.map(cell=>JSON.parse(cell.children[1].textContent)),['paid','free']);
  assert.equal(fullArguments.children[0].textContent,'View full arguments');
  const inputPair=fullArguments.children[1];
  assert.equal(inputPair.className,'counterexample-pair counterexample-inputs changed');
  assert.equal(JSON.parse(inputPair.children[0].children[1].textContent)[0][0].id,'paid');
  assert.equal(JSON.parse(inputPair.children[1].children[1].textContent)[0][0].id,'free');
  assert.equal(f.el('shipping-example-note').hidden,false);
  assert.equal(f.el('load-function-example-patch').textContent,'Fill recorded Gemini patch');
  await f.el('load-function-example-patch').click();await f.el('load').click();await f.el('apply').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'4/4');
  assert.equal(f.el('next-action').textContent,'Try a new counterexample');
  assert.match(f.el('status').textContent,/All current examples passed/);
  await f.el('next-action').click();
  assert.equal(f.el('challenge-function').open,true);
  assert.equal(f.el('challenge-args').value,'');
  assert.equal(f.calls.some(c=>c.path==='/api/function/extend'),false);
  assert.equal(f.el('numeric-boundary').hidden,false);
  assert.equal(f.el('numeric-boundary-field').children[0].children[1].textContent,'Argument 1[1]["priceCents"] · 0');
  f.el('numeric-boundary-field').value='1';
  f.el('challenge-expected').value='"stale draft"';
  await f.el('fill-numeric-boundary').click();
  assert.equal(f.el('challenge-expected').value,'');
  assert.deepEqual(JSON.parse(f.el('challenge-args').value),[[
   {available:true,currency:'USD',id:'paid',priceCents:799},
   {available:true,currency:'USD',id:'free',priceCents:9007199254740992}
  ],'USD']);
  assert.equal(f.el('pass-count').textContent,'4/4');
  assert.equal(f.calls.some(c=>c.path==='/api/function/extend'),false);
  assert.equal(f.el('fill-shipping-challenge').hidden,false);
  await f.el('fill-shipping-challenge').click();
  assert.equal(JSON.parse(f.el('challenge-args').value)[0][0].priceCents,9007199254740992);
  await f.el('extend-function').click();
  assert.equal(f.activeElement,f.el('next-action'));
  assert.equal(f.el('next-action').textContent,'Run baseline checks');
  await f.el('next-action').click();
  assert.equal(f.el('pass-count').textContent,'4/5');
  const packagedDraft=JSON.parse(await readFile(new URL('../../../examples/checkout/gemini-draft.replay.json',import.meta.url),'utf8'));
  assert.deepEqual(JSON.parse(f.el('failure-replay-json').textContent),packagedDraft);
  const contractBytes=await readFile(new URL('../../../examples/checkout/function.contract.json',import.meta.url),'utf8');
  assert.equal(f.el('failure-replay-download-contract').disabled,false);
  await f.el('failure-replay-download-contract').click();
  assert.equal(f.downloads[0].fileName,'function.contract.json');
  assert.equal(await f.downloads[0].blob.text(),contractBytes);
  const failedCheck=f.el('checks').children[0];
  assert.equal(failedCheck.children[1].textContent,'Reject unsafe integer');
  const [summary,returns,inputLabel,input]=failedCheck.children[2].children;
  assert.equal(summary.textContent,'The return value differs');
  assert.equal(returns.className,'counterexample-pair counterexample-returns changed');
  const [expected,observed]=returns.children;
  assert.equal(expected.children[0].textContent,'Expected return');
  assert.equal(expected.children[1].textContent,'null');
  assert.equal(observed.children[0].textContent,'Observed return');
  assert.notEqual(JSON.parse(observed.children[1].textContent),null);
  assert.equal(inputLabel.textContent,'Input arguments');
  assert.equal(JSON.parse(input.textContent)[0][0].priceCents,9007199254740992);
  assert.equal(f.el('load-function-example-patch').textContent,'Fill reviewed safe-integer fix');
  await f.el('load-function-example-patch').click();await f.el('load').click();
  const [, , before, , after]=f.el('patches').children[0].children;
  const [unchangedStart,change,unchangedEnd]=after.children;
  assert.equal(change.className,'source-change');
  assert.equal(change.textContent,'Safe');
  assert.equal(unchangedStart.textContent+unchangedEnd.textContent,before.textContent);
  await f.el('apply').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'5/5');
  const packagedFix=await readFile(new URL('../../../examples/checkout/shipping-quote.js',import.meta.url),'utf8');
  const checked=JSON.parse(f.el('replay-json').textContent);
  assert.equal(checked.files[0].content,packagedFix);
  assert.deepEqual(checked.files[1],packagedDraft.files[1]);
  await f.el('replay-download-contract').click();
  assert.equal(f.downloads[1].fileName,'function.contract.json');
  assert.equal(await f.downloads[1].blob.text(),contractBytes);
  await f.el('replay-workflow').click();
  assert.equal(f.el('workflow-dialog').open,true);
  const workflowSource=f.el('workflow-source');
  assert.equal(workflowSource.value,'examples/checkout/shipping-quote.js');
  const submit=()=>f.el('workflow-form').listeners.get('submit')({preventDefault(){}});
  workflowSource.value='../outside.js';
  submit();
  assert.equal(workflowSource.attributes.get('aria-invalid'),'true');
  assert.equal(f.downloads.length,2);
  workflowSource.value='src/my function.cjs';
  workflowSource.listeners.get('input')();
  submit();
  assert.equal(f.downloads[2].fileName,'check-reviewed-examples.yml');
  const workflow=await f.downloads[2].blob.text();
  assert.match(workflow,/on: \[pull_request, push\]/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/local-pit-crew-web@[a-f0-9]{40}/);
  assert.match(workflow,/contract: function\.contract\.json\n\s+source: "src\/my function\.cjs"/);
  assert.equal(f.el('workflow-pin').checked,true);
  assert.ok(workflow.includes('contract-sha256: '+createHash('sha256').update(contractBytes).digest('hex')));
  assert(!workflow.includes(packagedFix));
  f.el('workflow-pin').checked=false;
  submit();
  assert.doesNotMatch(await f.downloads[3].blob.text(),/contract-sha256/);
  assert.equal(f.el('next-action').textContent,'Finish checked repair');
  await f.el('view-record').click();assert.equal(JSON.parse(f.el('record-json').textContent).counts.modelCallsTotal,0);
  await f.el('try-function-example').click();
  assert.equal(f.el('shipping-example-note').hidden,true);
  assert.equal(f.el('load-function-example-patch').textContent,'Fill authored first patch');
 }finally{await f.close();}
});
test('the checkout demo link opens and checks a fresh authored baseline without Firebase setup',async()=>{
 const f=await setup({hash:'#checkout-repair'});
 try{
  const deadline=Date.now()+3000;
  while(!f.el('source-evidence').open&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.el('source-evidence').open,true);
  assert.equal(f.el('pass-count').textContent,'3/4');
  assert.equal(f.el('shipping-example-note').hidden,false);
  assert.equal(f.el('load-function-example-patch').textContent,'Fill recorded Gemini patch');
  assert.deepEqual(f.calls.filter(c=>c.path==='/api/function/action').map(c=>c.body.action),['test','read','read']);
  await f.el('view-record').click();
  assert.equal(JSON.parse(f.el('record-json').textContent).counts.modelCallsTotal,0);
 }finally{await f.close();}
});
test('a pre-mount intake link opens the form after startup without opening a run or calling a model',async()=>{
 const f=await setup({hash:'#function-intake'});try{
  assert.equal(f.el('function-intake').open,true);assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.calls.some(c=>c.path==='/api/function/open'||c.path==='/api/function/action'),false);
 }finally{await f.close();}
});
test('the hybrid review link opens the video example at the model panel with a browser-observed failure',async()=>{
 const cloud=cloudFixture();
 const f=await setup({hash:'#hybrid-review',cloud});
 try{
  const deadline=Date.now()+1500;
  while(f.activeElement!==f.el('advisor-panel')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.activeElement,f.el('advisor-panel'));
  assert.equal(f.el('pass-count').textContent,'3/5');
  const evidence=f.el('model-review-evidence');
  assert.equal(evidence.hidden,false);
  assert.equal(evidence.children[1].textContent,'3/5 passing · Keep special names');
  assert.match(evidence.children[2].children[0].children[1].textContent,/constructor/);
  assert.equal(evidence.children[2].children[1].children[1].textContent,'[]');
  assert.equal(f.el('diagnose').disabled,false);
  assert.equal(f.el('review-cloud').disabled,false);
  assert.equal(cloud.calls.adapterReads,undefined);
  assert.equal(cloud.calls.prompts.length,0);
  await f.el('try-shipping-example').click();
  assert.equal(evidence.hidden,true);
  assert.equal(f.activeElement,f.el('active-run'));
 }finally{await f.close();}
});
test('the missed-test link runs the recorded draft and one action reveals the unsafe-price failure',async()=>{
 const f=await setup({hash:'#missed-test'});
 try{
  const deadline=Date.now()+3000;
  while(f.el('next-action').textContent!=='Run the unsafe-price check'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.el('pass-count').textContent,'4/4');
  assert.equal(f.el('next-action').textContent,'Run the unsafe-price check');
  assert.equal(f.el('load-function-example-patch').hidden,true);
  const recorded=f.calls.find(call=>call.path==='/api/function/open').body.spec;
  assert.match(recorded.source,/Number\.isInteger/);
  assert.equal(recorded.cases.length,4);
  await f.el('next-action').click();
  assert.equal(f.el('pass-count').textContent,'4/5');
  assert.equal(f.el('failure-preview-name').textContent,'Reject unsafe integer');
  assert.equal(f.el('finish').disabled,true);
  const failed=JSON.parse(f.el('failure-replay-json').textContent);
  assert.equal(failed.files[0].content,recorded.source);
  assert.equal(f.el('load-function-example-patch').textContent,'Fill reviewed safe-integer fix');
  await f.el('load-function-example-patch').click();
  await f.el('load').click();await f.el('apply').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'5/5');
  await f.el('view-record').click();
  assert.equal(JSON.parse(f.el('record-json').textContent).counts.modelCallsTotal,0);
 }finally{await f.close();}
});
test('the same-score link runs the two example workers without opening a repair session',async()=>{
 const f=await setup({hash:'#same-score'});
 try{
  const deadline=Date.now()+3000;
  while(!f.el('compare-replay-changes').children.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(f.el('compare-replay-status').textContent,/Same score, different failures\. 3\/4 baseline → 3\/4 candidate/);
  assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.el('compare-replay-panel').open,true);
  assert.equal(f.calls.filter(c=>c.path==='/api/function/compare-replays').length,1);
  assert.equal(f.calls.some(c=>c.path==='/api/function/open'),false);
 }finally{await f.close();}
});
test('the recorded Firebase run opens with zero inference and rechecks the exact saved sources',async()=>{
 const f=await setup({hash:'#recorded-hybrid'});
 try{
  assert.equal(f.el('recorded-hybrid').open,true);
  assert.equal(f.el('recheck-recorded-hybrid').disabled,false);
  assert.deepEqual(f.calls.map(c=>c.path),['/api/bootstrap']);
  await f.el('recheck-recorded-hybrid').click();
  assert.match(f.el('compare-replay-status').textContent,/3\/5 baseline → 5\/5 candidate/);
  assert.deepEqual(f.calls.filter(c=>c.path!=='/api/bootstrap'),[
   {path:'/api/function/compare-replays',body:{example:'recorded-tags'}}
  ]);
  await f.el('download-comparison-summary').click();
  const summary=JSON.parse(await f.downloads[0].blob.text());
  assert.equal(summary.beforeWorkspaceHash,'dd23638ca26006f87da1572482172543a26ac36ce9f5e3ca81e7dc97aabd5b5c');
  assert.equal(summary.afterWorkspaceHash,'8a93ba7699709e77ce14a463c1e46c8848623d5b468662f246ac2533981ebd5c');
  assert.deepEqual(summary.repaired,['case-01','case-03']);
  assert.deepEqual(summary.regressed,[]);
  assert.equal(summary.modelCalls,0);
 }finally{await f.close();}
});
test('the checkout audit reproduces the archived result from both exact versions',async()=>{
 const f=await setup();
 try{
  assert.equal(f.el('try-checkout-audit').disabled,false);
  await f.el('try-checkout-audit').click();
  assert.equal(f.el('checkout-audit-context').hidden,false);
  assert.equal(f.activeElement,f.el('compare-replay-status'));
  assert.match(f.el('compare-replay-status').textContent,/7\/8 Gemini draft → 8\/8 reviewed fix/);
  const [repaired]=f.el('comparison-evidence').children;
  assert.equal(repaired.open,true);
  assert.deepEqual(repaired.children.map(element=>element.textContent),[
   'Repaired · Reject unsafe integer','Input arguments','[[{"available":true,"currency":"USD","id":"too-high","priceCents":9007199254740992}],"USD"]',
   'Expected return','null','Baseline · Input preserved','"too-high"','Candidate · Input preserved','null'
  ]);
  assert.deepEqual(f.calls.filter(call=>call.body),[
   {path:'/api/function/compare-replays',body:{example:'checkout-audit'}}
  ]);
  await f.el('download-comparison-summary').click();
  const summary=JSON.parse(await f.downloads[0].blob.text());
  assert.deepEqual(summary.repaired,['case-06']);
  assert.deepEqual(summary.regressed,[]);
  assert.equal(summary.modelCalls,0);
  await f.el('compare-replay-example').click();
  assert.equal(f.el('checkout-audit-context').hidden,true);
 }finally{await f.close();}
});
test('probing checkout from the original examples discovers an unsafe price inside the quote list',async()=>{
 const f=await setup({hash:'#checkout-boundaries'});
 try{
  const deadline=Date.now()+3000;
  while(f.el('boundary-probe').hidden&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.el('checkout-probe-context').hidden,false);
  const before=f.el('compare-replay-status').textContent;
  assert.match(before,/4\/4 Gemini draft → 4\/4 reviewed fix/);
  await f.el('run-boundary-probe').click();
  assert.match(f.el('boundary-probe-status').textContent,/1 of 8 new inputs produced different behavior/);
  assert.equal(f.el('compare-replay-status').textContent,before);
  const [evidence]=f.el('boundary-probe-results').children;
  assert.equal(evidence.children[0].textContent,'Argument 1[1]["priceCents"] → 9007199254740992');
  const args=JSON.parse(evidence.children[2].textContent);
  assert.equal(args[0][1].id,'live');
  assert.equal(args[0][1].priceCents,Number.MAX_SAFE_INTEGER+1);
  assert.deepEqual(evidence.children.slice(3,7).map(item=>item.textContent),
   ['Baseline · Input preserved','"live"','Candidate · Input preserved','null']);
  await evidence.children.at(-1).click();
  assert.equal(f.el('probe-example-expected').value,'');
  f.el('probe-example-expected').value='null';
  await f.el('load-probe-example').click();
  assert.equal(f.el('active-run').hidden,true);
  const cases=JSON.parse(f.el('function-cases').value);
  assert.equal(cases.length,5);
  assert.deepEqual(cases[4].args,args);
  assert.equal(cases[4].expected,null);
  assert.match(f.el('function-instructions').value,/nonnegative safe integer/);
 }finally{await f.close();}
});
test('boundary probes expose a new disagreement while the original four checks still pass',async()=>{
 const f=await setup({hash:'#probe-boundaries'});
 try{
  const deadline=Date.now()+3000;
  while(f.el('boundary-probe').hidden&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  const before=f.el('compare-replay-status').textContent;
  assert.match(before,/4\/4 baseline → 4\/4 candidate/);
  await f.el('run-boundary-probe').click();
  assert.match(f.el('boundary-probe-status').textContent,/1 of 6 new inputs produced different behavior/);
  assert.equal(f.el('compare-replay-status').textContent,before);
  const evidence=f.el('boundary-probe-results').children[0];
  assert.deepEqual(evidence.children.map(node=>node.textContent),[
   'Argument 1 → ""','Input arguments','[""]','Baseline · Input preserved','{"cursor":""}','Candidate · Input preserved','{}',
   'Use this input for a test'
  ]);
  assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.el('comparison-failure').hidden,true);
  assert.deepEqual(f.calls.filter(c=>c.path==='/api/function/compare-replays').map(c=>c.body),[
   {example:'pagination-boundary'},{example:'pagination-boundary',probe:true}
  ]);
  await evidence.children.at(-1).click();
  assert.equal(f.el('probe-example-expected').value,'');
  assert.equal(f.activeElement,f.el('probe-example-expected'));
  await f.el('load-probe-example').click();
  assert.match(f.el('probe-example-status').textContent,/Enter the expected return as JSON/);
  assert.equal(f.el('function-source').value,'');
  f.el('probe-example-label').value='Keep an empty string cursor';
  f.el('probe-example-expected').value='{"cursor":""}';
  await f.el('load-probe-example').click();
  const cases=JSON.parse(f.el('function-cases').value);
  assert.equal(cases.length,5);
  assert.deepEqual(cases[4],{label:'Keep an empty string cursor',args:[''],expected:{cursor:''}});
  assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.el('compare-replay-status').textContent,before);
  await f.el('open-function').click();
  assert.equal(f.el('pass-count').textContent,'—');
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'4/5');
  const replay=await replayModule.replay(f.el('failure-replay-json').textContent);
  assert.deepEqual(replay.checks.filter(check=>!check.ok).map(check=>check.id),['case-05']);
 }finally{await f.close();}
});
test('intake explains malformed examples next to the form and a rejected contract preserves the current run',async()=>{
 const f=await setup();try{
  await f.el('bring-function').click();await f.el('fill-function-example').click();
  const cases=f.el('function-cases'),draft=cases.value,valid=JSON.parse(draft);
  cases.value=JSON.stringify([{label:'Valid JSON, wrong key',arg:[['alpha']],expected:['alpha']}]);
  await f.el('open-function').click();
  assert.match(f.el('function-status').textContent,/Example 1 needs exactly three fields/);
  assert.equal(f.activeElement,cases);assert.equal(cases.attributes.get('aria-invalid'),'true');
  assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.calls.some(c=>c.path==='/api/function/open'),false);
  assert.match(cases.value,/"arg"/);
  await f.el('try-function-example').click();await f.el('bring-function').click();
  cases.value=JSON.stringify([{...valid[0],label:'x'.repeat(81)}]);
  await f.el('open-function').click();
  assert.match(f.el('function-status').textContent,/bounded JSON examples/);
  assert.equal(f.el('pass-count').textContent,'3/5');
  assert.equal(f.el('function-intake').open,true);
  cases.value=draft;await f.el('open-function').click();
  assert.match(f.el('function-status').textContent,/Function opened/);
  assert.equal(cases.attributes.get('aria-invalid'),'false');
 }finally{await f.close();}
});
test('expected error codes survive repair, cloud preview, replay and the repeat-call editor',async()=>{
 const cloud=cloudFixture(),f=await setup({cloud});
 try{
  await f.el('bring-function').click();
  f.el('function-title').value='Normalize a project slug';
  f.el('function-instructions').value='Normalize valid slugs. Reject a slash with INVALID_SLUG.';
  f.el('function-export').value='normalizeSlug';
  f.el('function-source').value="exports.normalizeSlug=value=>value.includes('/')?null:value.trim().toLowerCase();";
  f.el('function-cases').value=JSON.stringify([
   {label:'Normalize a valid slug',args:[' Demo-1 '],expected:'demo-1'},
   {label:'Reject a slash',args:['demo/1'],throws:'INVALID_SLUG'},
  ]);
  await f.el('open-function').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'1/2');
  assert.equal(f.el('failure-preview-reason').textContent,'The function did not throw');
  const expected=f.el('checks').children[0].children[2].children[1].children[0];
  assert.equal(expected.children[0].textContent,'Expected error code');
  assert.equal(expected.children[1].textContent,'"INVALID_SLUG"');
  await f.el('preview-function-draft').click();
  const payload=JSON.parse(f.el('function-draft-data').textContent);
  assert.equal(payload.contract.cases[1].throws,'INVALID_SLUG');
  assert.equal(payload.failedFunctionExamples[0].expectation,'throw-code');
  assert.equal(JSON.parse(payload.failedFunctionExamples[0].expected),'INVALID_SLUG');
  assert.equal(cloud.calls.prompts.length,0);
  await f.el('cancel-function-draft').click();
  f.el('function-replacement').value="exports.normalizeSlug=value=>{if(value.includes('/'))throw Object.assign(new TypeError('PRIVATE_MESSAGE'),{code:'INVALID_SLUG'});return value.trim().toLowerCase();};";
  await f.el('load').click();await f.el('apply').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'2/2');
  assert.equal(f.el('checks').children[1].children[2].children[0].textContent,'Expected error code matched; inputs unchanged');
  assert.equal((await replayModule.replay(f.el('replay-json').textContent)).passed,2);
  await f.el('replay-download-contract').click();
  assert.equal(JSON.parse(await f.downloads[0].blob.text()).cases[1].throws,'INVALID_SLUG');
  f.el('repeat-example-case').value='case-02';
  await f.el('fill-repeat-example').click();
  assert.equal(f.el('challenge-throws').checked,true);
  assert.equal(f.el('challenge-expected').value,'INVALID_SLUG');
  await f.el('extend-function').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'3/3');
  const replay=JSON.parse(f.el('replay-json').textContent);
  assert.equal(JSON.parse(replay.files[1].content).cases[2].throws,'INVALID_SLUG');
 }finally{await f.close();}
});
test('an explicit draft download preserves incomplete text and a verified run survives draft loading',async()=>{
 const f=await setup();try{
  await passFunction(f);
  const fields={title:'Unfinished café case',instructions:'',export:'check',source:'exports.check = ',cases:'[{\n  "label": "unfinished"'};
  for(const [key,value] of Object.entries(fields))f.el('function-'+key).value=value;
  const before=f.calls.length;
  await f.el('download-intake-draft').click();
  const [{fileName,blob}]=f.downloads;assert.equal(fileName,'local-pit-crew.draft.json');
  assert.deepEqual(JSON.parse(await blob.text()),{schema:'local-pit-crew/intake-draft/v1',fields});
  assert.equal(f.calls.length,before);
  const picker=f.el('intake-draft-file'),load=f.el('load-intake-draft');
  f.el('function-source').value='CURRENT_DRAFT';
  picker.files=[new Blob(['{"schema":"wrong"}'])];picker.listeners.get('change')();await load.click();
  assert.equal(f.el('function-source').value,'CURRENT_DRAFT');
  picker.files=[blob];picker.listeners.get('change')();await load.click();
  for(const [key,value] of Object.entries(fields))assert.equal(f.el('function-'+key).value,value);
  assert.equal(f.el('pass-count').textContent,'5/5');assert.equal(f.calls.length,before);
  let unblock;const held=new Promise(resolve=>{unblock=resolve;});
  picker.files=[{size:blob.size,async arrayBuffer(){await held;return blob.arrayBuffer();}}];picker.listeners.get('change')();
  const pending=load.click();f.el('function-source').value='NEW_TYPING';unblock();await pending;
  assert.equal(f.el('function-source').value,'NEW_TYPING');assert.equal(f.calls.length,before);
 }finally{await f.close();}
});

test('tab-padding suggestions derive from a user function and skip an already tested variant',async()=>{
 const f=await setup();
 try{
  f.el('function-title').value='Merge colors';
  f.el('function-instructions').value='Keep the first color spelling, treating case and surrounding whitespace as equivalent.';
  f.el('function-export').value='mergeColors';
  f.el('function-source').value="exports.mergeColors = colors => {const seen = new Set(); return colors.filter(color => {const key=color.trim().toLowerCase(); if(seen.has(key)) return false; seen.add(key); return true;});};";
  f.el('function-cases').value=JSON.stringify([
   {label:'Repeat two colors',args:[[' Red ','red',' Blue ','blue']],expected:[' Red ',' Blue ']},
   {label:'Tab-padded red',args:[[' Red ','\tred',' Blue ','blue']],expected:[' Red ',' Blue ']}
  ]);
  await f.el('open-function').click();
  assert.equal(f.el('fill-tab-padding-challenge').hidden,true);
  await f.el('test').click();
  assert.equal(f.el('fill-tab-padding-challenge').hidden,false);
  await f.el('fill-tab-padding-challenge').click();
  assert.deepEqual(JSON.parse(f.el('challenge-args').value),[[' Red ','red',' Blue ','\tblue']]);
  assert.deepEqual(JSON.parse(f.el('challenge-expected').value),[' Red ',' Blue ']);
  assert.equal(f.el('pass-count').textContent,'2/2');
  assert.equal(f.calls.some(c=>c.path==='/api/function/extend'),false);
 }finally{await f.close();}
});

const corrected='/* checked é */\nmodule.exports={uniqueTags(tags){const seen=new Set();return tags.filter(tag=>{if(typeof tag!=="string")return false;const key=tag.trim().toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});}};';
function cloudFixture({attestationFails = false} = {}){
 const calls={init:0,prompts:[],schemas:[],native:0,factory:0},apps=[],config={firebase:{apiKey:'PUBLIC_KEY',projectId:'test-project',appId:'test-app'},appCheckSiteKey:'PUBLIC_SITE',appName:'test-ui-draft'};
 const environment={isSecureContext:true,document:{},navigator:{userActivation:{isActive:true}}};environment.window=environment;
 const reply=()=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({abstain:false,source:corrected,explanation:'PRIVATE_MODEL_RATIONALE'})}});
 let respond=async()=>reply();
 const sdk={SDK_VERSION:'13.3.0',InferenceMode:{ONLY_IN_CLOUD:'only_in_cloud'},InferenceSource:{IN_CLOUD:'in_cloud'},getApps:()=>apps,
  initializeApp(config,name){calls.init++;const app={name};apps.push(app);return app;},async deleteApp(app){apps.splice(apps.indexOf(app),1);},
  initializeAppCheck(app){return {app};},async getToken(){if(attestationFails)throw Error('rejected');return {token:'AUTHORED_TEST_TOKEN'};},
  ReCaptchaEnterpriseProvider:class{},GoogleAIBackend:class{},getAI:()=>({}),
  getGenerativeModel(_ai,params){calls.schemas.push(params.inCloudParams.generationConfig.responseJsonSchema);
   return{chromeAdapter:{mode:'only_in_cloud'},generateContent(prompt){calls.prompts.push(prompt);return respond();}};}};
 const client=createFirebaseFunctionDrafterCore({sdk,config,environment});
 const reviewer=createFirebaseCloudReviewerCore({sdk,config,environment});
 return{client,reviewer,config,calls,reply,set respond(value){respond=value;}};
}
test('an App Check refusal returns focus to a local recovery action without sending the prompt',async()=>{
 const cloud=cloudFixture({attestationFails:true}),f=await setup({cloud});
 try{
  await f.el('try-function-example').click();
  await f.el('review-cloud').click();
  await f.el('send-cloud').click();
  assert.match(f.el('cloud-status').textContent,/prompt stayed in this tab/);
  assert.equal(f.el('cloud-recovery').hidden,false);
  assert.equal(f.activeElement,f.el('continue-local-after-cloud'));
  assert.deepEqual(cloud.calls.prompts,[]);
  assert.equal(f.el('pass-count').textContent,'3/5');
  await f.el('cloud-recovery-recorded').click();
  assert.equal(f.el('recorded-hybrid').open,true);
  assert.equal(f.activeElement,f.el('recorded-hybrid-summary'));
  await f.el('recheck-recorded-hybrid').click();
  assert.match(f.el('compare-replay-status').textContent,/3\/5 baseline → 5\/5 candidate/);
  assert.equal(f.el('pass-count').textContent,'3/5');
  assert.deepEqual(cloud.calls.prompts,[]);
  await f.el('continue-local-after-cloud').click();
  assert.equal(f.activeElement,f.el('next-action'));
  await f.el('review-cloud').click();
  assert.equal(f.el('cloud-recovery').hidden,true);
 }finally{await f.close();}
});
test('a declined cloud patch offers the recorded comparison and leaves the repair unchanged',async()=>{
 const cloud=cloudFixture({attestationFails:true}),f=await setup({cloud});
 try{
  await f.el('try-function-example').click();
  await f.el('preview-function-draft').click();
  await f.el('send-function-draft').click();
  assert.equal(f.el('draft-recovery').hidden,false);
  assert.equal(f.activeElement,f.el('draft-recovery-recorded'));
  assert.deepEqual(cloud.calls.prompts,[]);
  assert.equal(f.el('pass-count').textContent,'3/5');
  await f.el('draft-recovery-recorded').click();
  assert.equal(f.el('recorded-hybrid').open,true);
  assert.equal(f.activeElement,f.el('recorded-hybrid-summary'));
  await f.el('preview-function-draft').click();
  assert.equal(f.el('draft-recovery').hidden,true);
 }finally{await f.close();}
});
test('a reviewed cloud example fills an editable form and only explicit checks change the verdict',async()=>{
 const cloud=cloudFixture(),f=await setup({cloud});
 cloud.respond=async()=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({
  assessment:'uncertain',explanation:'Tabs are absent from these examples.',nextCheck:'Try a tab-padded duplicate.',evidenceIds:[],
  example:{label:'Handle tabs',argsJson:'[["\\tOps","ops"]]',expectedJson:'["\\tOps"]'}
 })}});
 try{
  await f.el('try-function-example').click();
  await f.el('load-function-example-patch').click();
  await f.el('load').click();await f.el('apply').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'5/5');
  await f.el('review-cloud').click();
  assert.match(f.el('cloud-payload').textContent,/CHALLENGE_DATA_JSON:/);
  assert.equal(f.el('cloud-payload').textContent.split('\nCHALLENGE_DATA_JSON:\n')[1],f.el('cloud-data').textContent);
  assert.match(f.el('cloud-disclosure').textContent,/shares the checked function, its requirements and its existing examples/);
  assert.equal(f.el('cloud-exact').hidden,false);
  assert.equal(cloud.calls.prompts.length,0);
  await f.el('send-cloud').click();
  assert.equal(cloud.calls.prompts.length,1);
  assert.ok(cloud.calls.schemas[0].required.includes('example'));
  assert.deepEqual(cloud.calls.schemas[0].properties.assessment.enum,['uncertain']);
  assert.equal(f.el('cloud-data').textContent,'');
  assert.equal(f.el('challenge-args').value,'');
  const fill=f.el('cloud-result').children[0].children.find(child=>child.textContent==='Fill example for review');
  assert.ok(fill);await fill.click();
  assert.equal(f.el('challenge-label').value,'Handle tabs');
  assert.deepEqual(JSON.parse(f.el('challenge-expected').value),['\tOps']);
  assert.equal(f.el('pass-count').textContent,'5/5');
  assert.equal(f.calls.some(c=>c.path==='/api/function/extend'),false);
  f.el('challenge-label').value='My reviewed tab test';
  await f.el('extend-function').click();
  assert.equal(f.el('pass-count').textContent,'—');
  assert.equal(f.calls.find(c=>c.path==='/api/function/extend').body.example.label,'My reviewed tab test');
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'5/6');
 }finally{await f.close();}
});
test('reviewed cloud drafting preserves the fixed contract, stages a reported diff only on request, then verifies actual WASM checks',async()=>{
 const cloud=cloudFixture(),f=await setup({cloud});try{
  await f.el('try-function-example').click();await f.el('view-record').click();const before=JSON.parse(f.el('record-json').textContent);
  assert.equal(cloud.calls.factory,0);
  await f.el('preview-function-draft').click();const visible=f.el('function-draft-payload').textContent;
  assert.equal(cloud.calls.factory,1);
  assert.ok(visible.includes('FUNCTION_REPAIR_JSON:'));assert.equal(cloud.calls.init,0);assert.equal(cloud.calls.prompts.length,0);
  await f.el('send-function-draft').click();assert.equal(cloud.calls.prompts.length,1);assert.equal(cloud.calls.prompts[0],visible);
  assert.equal(f.el('review-function-draft').disabled,false);assert.equal(f.el('apply').disabled,true);
  assert.equal(f.calls.some(c=>c.body?.action==='propose-cloud'),false);await f.el('view-record').click();
  const received=JSON.parse(f.el('record-json').textContent);assert.equal(received.counts.coder,0);assert.equal(received.counts.cloudDraftCalls,1);assert.equal(received.counts.patches,0);
  assert.equal(f.el('next-action').textContent,'Review cloud diff');
  await f.el('next-action').click();assert.equal(f.el('apply').disabled,false);assert.match(f.el('proposal-source').textContent,/Browser-reported Firebase cloud draft/);
  assert.equal(f.el('next-action').textContent,'Review before Apply');await f.el('next-action').click();
  assert.equal(f.calls.some(c=>c.body?.action==='apply'),false,'Navigation must not silently apply the replacement');
  await f.el('apply').click();assert.equal(f.el('next-action').textContent,'Verify replacement');
  assert.match(f.el('status').textContent,/Replacement applied/);await f.el('next-action').click();
  assert.equal(f.el('next-action').textContent,'Finish checked repair');await f.el('next-action').click();await f.el('view-record').click();
  assert.equal(f.el('next-action').textContent,'View checked function');
  const record=JSON.parse(f.el('record-json').textContent);assert.equal(record.closed,true);assert.equal(record.checks.filter(c=>c.ok).length,5);
  assert.equal(record.files.find(f=>f.path==='contract.json').sha256,before.files.find(f=>f.path==='contract.json').sha256);
  assert.equal(record.cloudDraft.kind,'browser-reported-cloud-draft');assert.equal(record.cloudDraft.sourceSha256,record.files.find(f=>f.path==='src/function.js').sha256);
  assert.equal(record.counts.cloudDraftCalls,1);assert.equal(record.counts.localCoderCalls,0);assert.equal(record.counts.cloudReviewCalls,0);assert.equal(record.counts.advisorCalls,0);assert.equal(record.counts.modelCallsTotal,1);
  assert.equal(cloud.calls.native,0);assert.equal(JSON.stringify(record).includes('PRIVATE_MODEL_RATIONALE'),false);assert.equal(JSON.stringify(record).includes(corrected),false);
  assert.equal(f.el('checked-source').textContent,corrected);
 }finally{await f.close();}
});
test('cloud draft includes a current local hypothesis only after choosing its explicit preview',async()=>{
 const cloud=cloudFixture();
 const hypothesis='Use a Set to track tag keys and skip non-string values.';
 cloud.planner={state:{prepared:false,calls:0},stop(){},async dispose(){},
  async prepareFromUserGesture(){return{status:'prepared'};},
  async decide(snapshot){
   this.state.calls++;
   return{status:'decision',inferenceSource:'on_device',decision:{action:'code',objective:hypothesis,evidenceIds:[snapshot.evidence[0].id]}};
  }};
 const f=await setup({cloud});
 try{
  await f.el('try-function-example').click();
  assert.equal(f.el('preview-function-draft-with-nano').hidden,true);
  await f.el('diagnose').click();
  assert.equal(f.el('preview-function-draft-with-nano').hidden,false);
  await f.el('preview-function-draft').click();
  assert.equal(f.el('function-draft-payload').textContent.includes(hypothesis),false);
  assert.match(f.el('function-draft-disclosure').textContent,/5 fixed examples.*Nano hypothesis stays local/);
  await f.el('preview-function-draft-with-nano').click();
  const approved=f.el('function-draft-payload').textContent;
  assert.ok(approved.includes(hypothesis));
  assert.equal(approved.split('\nFUNCTION_REPAIR_JSON:\n')[1],f.el('function-draft-data').textContent);
  assert.equal(JSON.parse(f.el('function-draft-data').textContent).nanoHint,hypothesis);
  assert.match(f.el('function-draft-disclosure').textContent,/Nano hypothesis is included/);
  assert.equal(cloud.calls.prompts.length,0);
  await f.el('send-function-draft').click();
  assert.deepEqual(cloud.calls.prompts,[approved]);
  assert.equal(f.el('function-draft-data').textContent,'');
  await f.el('try-function-example').click();
  assert.equal(f.el('preview-function-draft-with-nano').hidden,true);
 }finally{await f.close();}
});
test('the cloud result compares its approved Nano hypothesis even if a newer diagnosis arrives',async()=>{
 const cloud=cloudFixture(),before='The plain object accepts inherited property names.',after='A second local hypothesis.';
 cloud.planner={state:{prepared:false,calls:0},stop(){},async dispose(){},
  async prepareFromUserGesture(){return{status:'prepared'};},
  async decide(snapshot){
   const objective=this.state.calls++===0?before:after;
   return{status:'decision',inferenceSource:'on_device',decision:{action:'code',objective,evidenceIds:[snapshot.evidence[0].id]}};
  }};
 const f=await setup({cloud});
 try{
  await f.el('try-function-example').click();
  await f.el('diagnose').click();
  const preview=f.el('review-cloud-with-nano');
  preview.focus();
  await preview.click();
  assert.equal(f.activeElement,f.el('cloud-preview-title'));
  const payload=JSON.parse(f.el('cloud-data').textContent);
  assert.equal(payload.nanoHint,before);
  assert.equal(cloud.calls.prompts.length,0);
  const response=Promise.withResolvers();
  cloud.respond=()=>response.promise;
  const pending=f.el('send-cloud').click();
  await settle();
  assert.equal(f.activeElement,f.el('cancel-cloud'));
  await f.el('diagnose').click();
  assert.equal(cloud.planner.state.calls,2);
  const answer={assessment:'challenges',explanation:'Test the tag constructor.',nextCheck:'Include a tag named constructor.',
   evidenceIds:[payload.evidence[0].id]};
  const fakeReply=answer=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify(answer)}});
  response.resolve(fakeReply(answer));
  await pending;
  const result=f.el('cloud-result');
  assert.equal(f.activeElement,result);
  assert.equal(result.hidden,false);
  const panels=result.children[0].children[0].children;
  assert.equal(panels[0].children[1].textContent,before);
  assert.equal(panels[1].children[1].textContent,answer.explanation);
  await f.el('view-record').click();
  const record=f.el('record-json').textContent;
  assert.equal(JSON.parse(record).cloudReview.includedNanoHypothesis,true);
  assert.equal(record.includes(before),false);
  assert.equal(f.el('pass-count').textContent,'3/5');

  cloud.respond=async()=>fakeReply({...answer,assessment:'uncertain'});
  await f.el('review-cloud').click();
  assert.equal(JSON.parse(f.el('cloud-data').textContent).nanoHint,null);
  await f.el('send-cloud').click();
  assert.equal(result.children[0].children[0].children[0].textContent,'Independent cloud review');
  await f.el('try-function-example').click();
  assert.equal(result.hidden,true);
 }finally{await f.close();}
});
test('local startup and checks work without Firebase configuration and AI preview can retry its request',async()=>{
 const cloud=cloudFixture();
 let requests=0;
 const f=await setup({cloud,async fetchFirebaseConfig(path){
  assert.equal(path,'/firebase-config.json');
  return ++requests===1?{ok:false}:{ok:true,json:async()=>({firebaseConfig:cloud.config})};
 }});
 try{
  await f.el('try-function-example').click();
  assert.equal(f.el('pass-count').textContent,'3/5');
  assert.equal(requests,0);
  assert.equal(cloud.calls.factory,0);
  await f.el('preview-function-draft').click();
  assert.equal(f.el('function-draft-preview').hidden,true);
  assert.match(f.el('function-draft-status').textContent,/Firebase setup could not load/);
  assert.equal(f.el('pass-count').textContent,'3/5');
  assert.equal(cloud.calls.adapterReads,undefined);
  await f.el('preview-function-draft').click();
  assert.equal(f.el('function-draft-preview').hidden,false);
  assert.equal(requests,2);
  assert.equal(cloud.calls.adapterReads,1);
  assert.equal(cloud.calls.factory,1);
  assert.equal(cloud.calls.prompts.length,0);
 }finally{await f.close();}
});
test('a cloud draft can be rejected without a controller proposal, and a new run revokes an old Send approval',async()=>{
 const cloud=cloudFixture(),f=await setup({cloud});try{
  await f.el('try-function-example').click();await f.el('preview-function-draft').click();await f.el('send-function-draft').click();
  await f.el('cancel-function-draft').click();assert.equal(f.el('function-draft-result').hidden,true);assert.equal(f.el('apply').disabled,true);
  await f.el('view-record').click();const rejected=JSON.parse(f.el('record-json').textContent);assert.equal(rejected.counts.coder,0);assert.equal(rejected.counts.cloudDraftCalls,1);assert.equal(rejected.cloudDraft,null);
  await f.el('preview-function-draft').click();await f.el('try-function-example').click();assert.equal(f.el('send-function-draft').disabled,true);
  await f.el('send-function-draft').click();assert.equal(cloud.calls.prompts.length,1);
  await f.el('view-record').click();const replacement=JSON.parse(f.el('record-json').textContent);assert.equal(replacement.counts.cloudDraftCalls,0);
 }finally{await f.close();}
});

test('quota failure explains recovery without retrying, changing source or blocking an explicit pasted repair',async()=>{
 const cloud=cloudFixture();cloud.respond=async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_URL_AND_BODY'),{code:'fetch-error',customErrorData:{status:429,errorDetails:['PRIVATE_DETAILS']}});};
 const f=await setup({cloud});try{
  await f.el('try-function-example').click();await f.el('view-record').click();const baseline=JSON.parse(f.el('record-json').textContent);
  await f.el('preview-function-draft').click();await f.el('send-function-draft').click();
  assert.match(f.el('function-draft-status').textContent,/rate or quota limit/);assert.match(f.el('function-draft-status').textContent,/No automatic retry/);
  assert.equal(f.el('function-draft-status').textContent.includes('PRIVATE_'),false);assert.equal(cloud.calls.prompts.length,1);
  assert.equal(f.el('send-function-draft').disabled,true);assert.equal(f.el('function-draft-result').hidden,true);assert.equal(f.el('apply').disabled,true);
  await f.el('view-record').click();const failed=JSON.parse(f.el('record-json').textContent);
  assert.deepEqual(failed.files,baseline.files);assert.equal(failed.counts.patches,0);assert.equal(failed.counts.cloudDraftCalls,1);
  f.el('function-replacement').value=corrected;await f.el('load').click();await f.el('apply').click();await f.el('test').click();await f.el('finish').click();
  assert.equal(f.el('pass-count').textContent,'5/5');assert.equal(cloud.calls.prompts.length,1);
 }finally{await f.close();}
});
test('closing a function during an abort-ignoring cloud call keeps its invocation count and discards the late draft',async()=>{
 const cloud=cloudFixture();let release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});cloud.respond=()=>{entered();return waiting;};
 const f=await setup({cloud});try{
  await f.el('try-function-example').click();await f.el('preview-function-draft').click();const pending=f.el('send-function-draft').click();await started;
  assert.equal(f.el('cloud-calls').textContent,'1');await f.el('cancel').click();await pending;release(cloud.reply());await settle();
  assert.equal(f.calls.some(c=>c.body?.action==='propose-cloud'),false);assert.equal(f.el('function-draft-result').hidden,true);
  await f.el('view-record').click();const record=JSON.parse(f.el('record-json').textContent);assert.equal(record.closed,true);assert.equal(record.cloudDraft,null);assert.equal(record.counts.cloudDraftCalls,1);assert.equal(record.counts.coder,0);
 }finally{release(cloud.reply());await f.close();}
});
async function passFunction(f){
 await f.el('try-function-example').click();f.el('function-replacement').value=corrected;
 await f.el('load').click();await f.el('apply').click();await f.el('test').click();
 assert.equal(f.el('pass-count').textContent,'5/5');
}
test('explicit checked-function download after Finish contains exact verified UTF-8 source, while the default record stays source-free',async()=>{
 const f=await setup();try{
  await passFunction(f);await f.el('finish').click();
  assert.equal(f.el('checked-function').hidden,false);assert.equal(f.el('checked-source').textContent,corrected);
  assert.equal(f.el('download-checked-function').disabled,false);await f.el('download-checked-function').click();
  assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].fileName,'uniqueTags.checked.js');assert.equal(await f.downloads[0].blob.text(),corrected);
  await f.el('view-record').click();const record=JSON.parse(f.el('record-json').textContent);
  assert.equal(record.closed,true);assert.equal(JSON.stringify(record).includes('checked é'),false);
  const bytes=Buffer.from(await f.downloads[0].blob.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),record.files.find(f=>f.path==='src/function.js').sha256);
 }finally{f.close();}
});
test('a checked-function download rejects corrupted bytes and an owner closed during hashing',async()=>{
 const corrupted=await setup({tamperCheckedSource:true});try{
  await passFunction(corrupted);await corrupted.el('download-checked-function').click();
  assert.equal(corrupted.downloads.length,0);assert.match(corrupted.el('checked-function-status').textContent,/did not match the checked hash/);
 }finally{corrupted.close();}
 let release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const stale=await setup({async digest(name,bytes){entered();await waiting;return webcrypto.subtle.digest(name,bytes);}});try{
  await passFunction(stale);const pending=stale.el('download-checked-function').click();await started;
  await stale.el('cancel').click();release();await pending;
  assert.equal(stale.downloads.length,0);assert.equal(stale.el('checked-function').hidden,true);assert.equal(stale.el('checked-source').textContent,'');
 }finally{release();stale.close();}
});

test('explicit replay export retains exact source and fixed cases, survives Finish and reruns actual WASM independently',async()=>{
 const f=await setup();try{
  await f.el('try-function-example').click();assert.equal(f.el('function-replay').hidden,true);
  f.el('function-replacement').value=corrected;await f.el('load').click();await f.el('apply').click();
  assert.equal(f.el('function-replay').hidden,true);await f.el('test').click();await f.el('finish').click();
  assert.equal(f.el('function-replay').hidden,false);assert.equal(f.el('download-function-replay').disabled,false);
  await f.el('download-function-replay').click();assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].fileName,'uniqueTags.replay.json');
  assert.equal(f.el('replay-ci-command').textContent,'npm run replay:function -- --contract function.contract.json --source src/my-function.js');
  const text=await f.downloads[0].blob.text();assert.equal(text,f.el('replay-json').textContent);
  const fresh=await replayModule.replay(text);assert.equal(fresh.status,'checked');assert.equal(fresh.passed,5);assert.equal(fresh.total,5);assert.equal(fresh.modelCalls,0);
  await f.el('view-record').click();const record=JSON.parse(f.el('record-json').textContent);
  assert.deepEqual(fresh.files,record.files);assert.equal(JSON.stringify(record).includes(corrected),false);
 }finally{f.close();}
});
test('a failure replay reruns a current failure without importing its verdict',async()=>{
 const f=await setup();
 try{
  assert.equal(f.el('failure-replay').hidden,true);
  await f.el('try-function-example').click();
  assert.equal(f.el('pass-count').textContent,'3/5');
  assert.equal(f.el('failure-replay').hidden,false);
  assert.equal(f.el('download-checked-function').disabled,true);
  await f.el('download-failure-replay').click();
  assert.equal(f.downloads[0].fileName,'function-failure.replay.json');
  assert.equal(f.el('failure-replay-ci-command').textContent,'npm run replay:function -- --contract function.contract.json --source src/my-function.js');
  const saved=await f.downloads[0].blob.text();
  assert.equal(saved,f.el('failure-replay-json').textContent);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(),['context','files','schema']);
  const fresh=await replayModule.replay(saved);
  assert.equal(fresh.passed,3);assert.equal(fresh.total,5);assert.equal(fresh.modelCalls,0);
  f.el('restore-replay-input').value=saved;
  await f.el('restore-function-replay').click();
  await f.el('open-function').click();
  assert.equal(f.el('pass-count').textContent,'—');
  assert.equal(f.el('failure-replay').hidden,true);
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'3/5');
  f.el('function-replacement').value=corrected;
  f.el('failure-replay-ci-help').open=true;
  await f.el('load').click();await f.el('apply').click();
  assert.equal(f.el('failure-replay').hidden,true);
  assert.equal(f.el('failure-replay-json').textContent,'');
  assert.equal(f.el('failure-replay-ci-help').open,false);
  assert.equal(f.el('failure-replay-ci-command').textContent,'');
  await f.el('download-failure-replay').click();
  await f.el('failure-replay-download-contract').click();
  assert.equal(f.downloads.length,1);
 }finally{await f.close();}
});
test('the failure replay copies only the displayed CI command and retains it when the clipboard is unavailable',async()=>{
 const copied=[];
 const f=await setup({clipboard:{async writeText(command){
  if(copied.length)throw Error('Clipboard denied');
  copied.push(command);
 }}});
 try{
  await f.el('try-function-example').click();
  const button=f.el('failure-replay-ci-copy'),status=f.el('failure-replay-ci-copy-status');
  assert.equal(button.hidden,false);
  button.disabled=false;
  await button.click();
  assert.deepEqual(copied,['npm run replay:function -- --contract function.contract.json --source src/my-function.js']);
  assert.equal(status.textContent,'Command copied.');
  await button.click();
  assert.match(status.textContent,/Select the command/);
  assert.equal(f.el('failure-replay-ci-command').textContent,copied[0]);
 }finally{await f.close();}
});
test('browser comparison reruns both saved versions locally and preserves the active run',async()=>{
 let hold=false,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const f=await setup({holdCheck:async()=>{if(hold)await gate;}});
 try{
  await f.el('try-function-example').click();
  const baseline=f.el('failure-replay-json').textContent;
  f.el('function-replacement').value=corrected;
  await f.el('load').click();await f.el('apply').click();await f.el('test').click();
  const candidate=f.el('replay-json').textContent;
  await f.el('view-record').click();const before=f.el('record-json').textContent;
  const baseInput=f.el('comparison-baseline-file'),candidateInput=f.el('comparison-candidate-file');
  baseInput.files=[new Blob([baseline])];candidateInput.files=[new Blob([candidate])];
  hold=true;
  const pending=f.el('compare-replays').click();
  assert.equal(f.el('try-shipping-example').disabled,true);
  assert.equal(f.el('cancel').disabled,true);
  const repairCalls=()=>f.calls.filter(c=>c.path==='/api/function/open'||c.path==='/api/function/action').length;
  const calls=repairCalls();
  await f.el('try-shipping-example').click();await f.el('cancel').click();
  assert.equal(repairCalls(),calls);
  release();
  await pending;
  assert.equal(f.el('try-shipping-example').disabled,false);
  assert.equal(f.el('cancel').disabled,false);
  assert.match(f.el('compare-replay-status').textContent,/3\/5 baseline → 5\/5 candidate/);
  assert.deepEqual(f.el('compare-replay-changes').children.map(el=>el.textContent),['Repaired: Keep special names, Ignore non-string values','Regressed: none']);
  assert.equal(f.el('comparison-failure').hidden,true);
  await f.el('view-record').click();assert.equal(f.el('record-json').textContent,before);
  candidateInput.files=[new Blob([baseline])];
  await f.el('compare-replays').click();
  assert.match(f.el('compare-replay-status').textContent,/same source/);
  assert.equal(f.el('compare-replay-changes').children.length,0);
 }finally{release();await f.close();}
});
test('the landing-page example exposes a same-score regression without files or a repair session',async()=>{
 const f=await setup();
 try{
  f.el('function-title').value='My intake draft';
  await f.el('compare-replay-example').click();
  assert.equal(f.el('function-intake').open,true);
  assert.equal(f.el('compare-replay-panel').open,true);
  assert.match(f.el('compare-replay-status').textContent,/Same score, different failures\. 3\/4 baseline → 3\/4 candidate/);
  assert.deepEqual(f.el('compare-replay-changes').children.map(el=>el.textContent),[
   'Repaired: Keep a zero cursor','Regressed: Omit an explicit null cursor'
  ]);
  const regression=f.el('comparison-evidence').children[1];
  assert.deepEqual(regression.children.map(el=>el.textContent),[
   'Regressed · Omit an explicit null cursor','Input arguments','[null]','Expected return','{}',
   'Baseline · Input preserved','{}','Candidate · Input preserved','{"cursor":null}'
  ]);
  assert.equal(f.el('function-title').value,'My intake draft');
  assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.calls.filter(call=>call.path==='/api/function/compare-replays').length,1);
  assert.equal(f.el('comparison-failure').hidden,false);
  await f.el('download-compared-failure').click();
  const [download]=f.downloads;
  assert.equal(download.fileName,'candidate-failure.replay.json');
  const exported=await download.blob.text(),packet=JSON.parse(exported);
  assert.equal(packet.context.title,'Keep valid page cursors');
  assert.match(packet.context.instructions,/Omit the cursor when it is null or absent/);
  const replayed=await replayModule.replay(exported);
  assert.deepEqual(replayed.checks.filter(check=>!check.ok).map(check=>check.id),['case-02']);
  await f.el('load-compared-failure').click();
  assert.equal(f.el('function-source').value,packet.files[0].content);
  assert.equal(f.el('function-instructions').value,packet.context.instructions);
  assert.equal(f.el('active-run').hidden,true);
  assert.equal(f.activeElement,f.el('function-title'));
  assert.equal(f.calls.filter(call=>call.path==='/api/function/open').length,0);
  await f.el('open-function').click();
  assert.equal(f.el('pass-count').textContent,'—');
  await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'3/4');
  assert.equal(f.el('finish').disabled,true);
 }finally{await f.close();}
});
test('the browser compares two local sources with the exact CI contract bytes',async()=>{
 const fixture=name=>readFile(new URL('../../../examples/validation/'+name,import.meta.url),'utf8');
 const [contract,baselineSource]=await Promise.all([fixture('function.contract.json'),fixture('normalize-slug.cjs')]);
 const candidateSource=baselineSource.replace('code: \'INVALID_SLUG\'','code: \'WRONG_CODE\'');
 const f=await setup();
 try{
  const setFile=(id,bytes)=>{
   const input=f.el(id);
   input.files=[new Blob([bytes])];
   input.listeners.get('change')();
  };
  const run=f.el('compare-contract-sources');
  setFile('comparison-contract-file',contract);
  setFile('comparison-old-source',baselineSource);
  assert.equal(run.disabled,true);
  setFile('comparison-new-source',candidateSource);
  assert.equal(run.disabled,false);
  await run.click();
  assert.equal(f.activeElement,f.el('compare-replay-status'));
  assert.match(f.el('compare-replay-status').textContent,/2\/2 baseline → 1\/2 candidate/);
  assert.match(f.el('comparison-evidence').children[0].children[0].textContent,/Regressed · Reject a slash/);
  assert.deepEqual(f.calls.filter(call=>call.body),[
   {path:'/api/function/compare-replays',body:{contract,baselineSource,candidateSource}}
  ]);
  await f.el('download-comparison-summary').click();
  const summary=await f.downloads[0].blob.text();
  assert.equal(JSON.parse(summary).contractSha256,createHash('sha256').update(contract).digest('hex'));
  assert(!summary.includes('demo/1')&&!summary.includes('INVALID_SLUG')&&!summary.includes('WRONG_CODE'));
  await f.el('download-compared-failure').click();
  const packet=JSON.parse(await f.downloads[1].blob.text());
  assert.equal(packet.files[0].content,candidateSource);
  assert.equal(packet.files[1].content,contract);
  assert.equal(packet.context,undefined);
  await f.el('load-compared-failure').click();
  assert.equal(f.el('function-instructions').value,'');
  assert.equal(f.el('active-run').hidden,true);

  setFile('comparison-new-source',baselineSource);
  await run.click();
  assert.match(f.el('compare-replay-status').textContent,/same source/);
  assert.equal(f.el('download-comparison-summary').hidden,true);
  setFile('comparison-new-source',candidateSource);
  setFile('comparison-contract-file','{}');
  await run.click();
  assert.match(f.el('compare-replay-status').textContent,/valid test contract/);
  assert.equal(f.el('comparison-failure').hidden,true);
 }finally{await f.close();}
});
test('a standalone JavaScript candidate runs the saved baseline examples without changing the active repair',async()=>{
 const f=await setup();
 try{
  await f.el('try-function-example').click();
  const baseline=f.el('failure-replay-json').textContent;
  const setCandidate=bytes=>{f.el('comparison-candidate-file').files=[Object.assign(new Blob([bytes]),{name:'current.CJS'})];};
  f.el('comparison-baseline-file').files=[new Blob([baseline])];
  await f.el('view-record').click();const before=f.el('record-json').textContent;
  setCandidate('\ufeff'+corrected);
  await f.el('compare-replays').click();
  assert.match(f.el('compare-replay-status').textContent,/3\/5 baseline → 5\/5 candidate/);
  assert.deepEqual(f.el('compare-replay-changes').children.map(el=>el.textContent),
   ['Repaired: Keep special names, Ignore non-string values','Regressed: none']);
  await f.el('view-record').click();assert.equal(f.el('record-json').textContent,before);

  const compareCalls=()=>f.calls.filter(call=>call.path==='/api/function/compare-replays').length;
  assert.equal(compareCalls(),1);
  setCandidate('é'.repeat(3001));
  await f.el('compare-replays').click();
  assert.match(f.el('compare-replay-status').textContent,/6,000 bytes/);
  assert.equal(compareCalls(),1);
  setCandidate(Uint8Array.of(0xff));
  await f.el('compare-replays').click();
  assert.match(f.el('compare-replay-status').textContent,/UTF-8 JavaScript/);
  assert.equal(compareCalls(),1);
  assert.equal(f.el('compare-replay-changes').children.length,0);

  setCandidate(JSON.parse(baseline).files[0].content);
  await f.el('compare-replays').click();
  assert.match(f.el('compare-replay-status').textContent,/same source/);
  assert.equal(f.el('compare-replay-changes').children.length,0);
  setCandidate(corrected+`
const deduplicate = module.exports.uniqueTags;
module.exports.uniqueTags = tags => {
 const result = deduplicate(tags);
 tags.length = 0;
 return result;
};`);
  await f.el('compare-replays').click();
  const mutation=f.el('comparison-evidence').children.find(detail=>detail.children[0].textContent==='Regressed · Preserve first spelling');
  assert.deepEqual(mutation.children.slice(-4).map(el=>el.textContent),[
   'Candidate · Input preservation failed','[" Ops ","API"]',
   'Candidate arguments after the call','[[]]'
  ]);
  setCandidate(JSON.parse(baseline).files[0].content+`
const original = module.exports.uniqueTags;
module.exports.uniqueTags = tags => tags.some(tag => typeof tag !== 'string') ? [] : original(tags);`);
  await f.el('compare-replays').click();
  assert.match(f.el('compare-replay-status').textContent,/Same score, changed results\. 3\/5 baseline → 3\/5 candidate/);
  const [changed]=f.el('comparison-evidence').children;
  assert.equal(f.el('comparison-evidence').children.length,1);
  assert.equal(changed.children[0].textContent,'Still failing, result changed · Ignore non-string values');
  assert.equal(changed.children.at(-3).textContent,'The function threw.');
  assert.equal(changed.children.at(-1).textContent,'[]');
  await f.el('download-comparison-summary').click();
  assert.equal(f.downloads[0].fileName,'pit-crew-comparison.json');
  const exported=await f.downloads[0].blob.text();
  const summary=JSON.parse(exported);
  assert.deepEqual(summary.changedFailures,['case-03']);
  assert.equal(summary.beforePassed,3);assert.equal(summary.afterPassed,3);
  assert.equal(summary.modelCalls,0);
  assert.match(summary.beforeWorkspaceHash,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(exported,/Ignore non-string values|uniqueTags|argumentsAfter|actualReturn|"API"/);
  await f.el('download-compared-failure').click();
  const failure=JSON.parse(await f.downloads[1].blob.text());
  assert.deepEqual(failure.context,JSON.parse(baseline).context);
  assert.deepEqual(failure.files[1],JSON.parse(baseline).files[1]);
  assert.match(failure.files[0].content,/tags\.some/);
  await f.el('view-record').click();
  const previousRecord=f.el('record-json').textContent;
  await f.el('load-compared-failure').click();
  assert.equal(f.el('function-source').value,failure.files[0].content);
  await f.el('view-record').click();
  assert.equal(f.el('record-json').textContent,previousRecord);
  setCandidate(JSON.parse(baseline).files[0].content);
  await f.el('compare-replays').click();
  assert.equal(f.el('download-comparison-summary').hidden,true);
  assert.equal(f.el('comparison-failure').hidden,true);
  f.el('function-title').value='Keep this draft';
  await f.el('load-compared-failure').click();
  assert.equal(f.el('function-title').value,'Keep this draft');
  await f.el('download-comparison-summary').click();
  await f.el('download-compared-failure').click();
  assert.equal(f.downloads.length,2);
 }finally{await f.close();}
});
test('a saved browser replay restores intent without replacing the active run, then opens unchecked and verifies afresh',async()=>{
 const f=await setup();try{
  await passFunction(f);await f.el('finish').click();await f.el('view-record').click();const finished=JSON.parse(f.el('record-json').textContent);
  const saved=f.el('replay-json').textContent;assert.equal(JSON.parse(saved).schema,'local-pit-crew/function-replay/v2');
  f.el('restore-replay-input').value=saved;await f.el('restore-function-replay').click();
  assert.equal(f.el('function-source').value,corrected);assert.equal(f.el('function-title').value,'Keep meaningful tag names');
  assert.match(f.el('function-instructions').value,/Names such as constructor/);assert.match(f.el('restore-replay-status').textContent,/active run is unchanged/);
  await f.el('view-record').click();assert.deepEqual(JSON.parse(f.el('record-json').textContent),finished);
  await f.el('open-function').click();assert.equal(f.el('finish').disabled,true);assert.equal(f.el('pass-count').textContent,'—');
  await f.el('view-record').click();const fresh=JSON.parse(f.el('record-json').textContent);assert.equal(fresh.counts.tests,0);assert.equal(fresh.counts.modelCallsTotal,0);assert.equal(fresh.publicChecksCurrent,false);
  await f.el('test').click();await f.el('view-record').click();const checked=JSON.parse(f.el('record-json').textContent);
  assert.equal(checked.checks.filter(c=>c.ok).length,5);assert.equal(checked.counts.tests,1);assert.equal(checked.counts.patches,0);assert.deepEqual(checked.files,finished.files);
 }finally{await f.close();}
});

test('a human counterexample forks a passing source, exposes a previously missed failure and requires a new reviewed repair',async()=>{
 const f=await setup();try{
  const cases=[{label:'zero',args:[[0]],expected:0},{label:'false',args:[[false]],expected:false},{label:'empty text',args:[['']],expected:''},{label:'absent',args:[[null]],expected:null}];
  f.el('function-title').value='First present';f.el('function-instructions').value='Return the first non-null item, preserving falsy values; return null when absent.';f.el('function-export').value='firstPresent';
  f.el('function-source').value='module.exports={firstPresent:values=>values[0]??null};';f.el('function-cases').value=JSON.stringify(cases);
  await f.el('open-function').click();await f.el('test').click();await f.el('finish').click();await f.el('view-record').click();const parent=JSON.parse(f.el('record-json').textContent);
  assert.equal(f.el('pass-count').textContent,'4/4');assert.equal(f.el('extend-function').disabled,false);
  f.el('challenge-args').value='[[null,4]]';f.el('challenge-expected').value='4';f.el('challenge-label').value='';await f.el('extend-function').click();
  assert.equal(f.el('pass-count').textContent,'4/4');assert.equal(f.el('cancel').disabled,true);await f.el('view-record').click();assert.deepEqual(JSON.parse(f.el('record-json').textContent),parent);
  f.el('function-title').value='KEEP MY UNSAVED INTAKE';f.el('challenge-label').value='PRIVATE_NEW_CASE';await f.el('extend-function').click();
  assert.equal(f.el('function-title').value,'KEEP MY UNSAVED INTAKE');assert.equal(f.el('challenge-args').value,'');assert.equal(f.el('pass-count').textContent,'—');assert.equal(f.el('finish').disabled,true);
  await f.el('view-record').click();const fresh=JSON.parse(f.el('record-json').textContent);assert.equal(fresh.counts.tests,0);assert.equal(fresh.counts.modelCallsTotal,0);
  assert.equal(fresh.challengeParent.sourceSha256,parent.files.find(f=>f.path==='src/function.js').sha256);assert.equal(fresh.challengeParent.contractSha256,parent.files.find(f=>f.path==='contract.json').sha256);assert.equal(fresh.challengeParent.caseCount,4);
  assert.equal(fresh.files.find(f=>f.path==='src/function.js').sha256,fresh.challengeParent.sourceSha256);assert.notEqual(fresh.files.find(f=>f.path==='contract.json').sha256,fresh.challengeParent.contractSha256);
  await f.el('test').click();assert.equal(f.el('pass-count').textContent,'4/5');assert.equal(f.el('finish').disabled,true);
  f.el('function-replacement').value='module.exports={firstPresent:values=>{const i=values.findIndex(x=>x!==null);return i<0?null:values[i];}};';await f.el('load').click();await f.el('apply').click();await f.el('test').click();await f.el('finish').click();await f.el('view-record').click();
  const repaired=JSON.parse(f.el('record-json').textContent);assert.equal(f.el('pass-count').textContent,'5/5');assert.equal(repaired.counts.modelCallsTotal,0);assert.equal(repaired.closed,true);assert.deepEqual(repaired.challengeParent,fresh.challengeParent);assert.equal(JSON.stringify(repaired).includes('PRIVATE_NEW_CASE'),false);
 }finally{await f.close();}
});
test('a repeated passing input reveals state carried across calls and replays the same failure in Node',async()=>{
 const f=await setup();
 try{
  const source='const seen = new Set(); exports.uniqueTags = tags => tags.filter(tag => { if (seen.has(tag)) return false; seen.add(tag); return true; });';
  const cases=[{label:'Keep Ops',args:[['Ops']],expected:['Ops']},{label:'Keep Billing',args:[['Billing']],expected:['Billing']}];
  f.el('function-title').value='Independent tag lists';
  f.el('function-instructions').value='Return the unique tags in each list. Keep calls independent.';
  f.el('function-export').value='uniqueTags';
  f.el('function-source').value=source;
  f.el('function-cases').value=JSON.stringify(cases);
  await f.el('open-function').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'2/2');
  assert.equal(f.el('repeat-example').hidden,false);
  assert.deepEqual(f.el('repeat-example-case').children.map(option=>option.textContent),['1. Keep Ops','2. Keep Billing']);
  await f.el('fill-repeat-example').click();
  assert.equal(f.el('challenge-label').value,'Repeat · Keep Ops');
  assert.deepEqual(JSON.parse(f.el('challenge-args').value),cases[0].args);
  assert.deepEqual(JSON.parse(f.el('challenge-expected').value),cases[0].expected);
  await f.el('extend-function').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'2/3');
  assert.equal(f.el('finish').disabled,true);
  assert.equal(f.el('failure-preview-reason').textContent,'Call 1 passed with these same arguments. Call 3 failed.');
  const replay=f.el('failure-replay-json').textContent;
  const replayed=await replayModule.replay(replay);
  assert.deepEqual(replayed.checks.filter(check=>!check.ok).map(check=>check.id),['case-03']);
  f.el('function-replacement').value='exports.uniqueTags = tags => [...new Set(tags)];';
  await f.el('load').click();await f.el('apply').click();await f.el('test').click();
  assert.equal(f.el('pass-count').textContent,'3/3');
  await f.el('view-record').click();
  assert.equal(JSON.parse(f.el('record-json').textContent).counts.modelCallsTotal,0);
 }finally{await f.close();}
});
test('invalid saved bytes preserve the draft and current verdict, and legacy replay leaves missing requirements empty',async()=>{
 const f=await setup();try{
  await passFunction(f);const packet=JSON.parse(f.el('replay-json').textContent);
  f.el('function-title').value='KEEP MY DRAFT';const corrupt=structuredClone(packet);corrupt.files[0].content+=' ';
  f.el('restore-replay-input').value=JSON.stringify(corrupt);await f.el('restore-function-replay').click();
  assert.equal(f.el('function-title').value,'KEEP MY DRAFT');assert.match(f.el('restore-replay-status').textContent,/draft is unchanged/);assert.equal(f.el('pass-count').textContent,'5/5');
  f.el('restore-replay-input').value=JSON.stringify({schema:'local-pit-crew/function-replay/v1',files:packet.files});
  await f.el('restore-function-replay').click();assert.equal(f.el('function-source').value,corrected);assert.equal(f.el('function-instructions').value,'');
  assert.match(f.el('restore-replay-status').textContent,/older replay has no saved requirements/);assert.equal(f.el('pass-count').textContent,'5/5');
 }finally{await f.close();}
});
test('choosing a replay file reads bounded UTF-8 locally and leaves validation explicit',async()=>{
 const f=await setup();
 try{
  await passFunction(f);
  const draft=f.el('function-source');
  draft.value='KEEP MY DRAFT';
  const input=f.el('restore-replay-input'),picker=f.el('restore-replay-file');
  const saved=f.el('replay-json').textContent,bytes=new TextEncoder().encode(saved);
  const choose=async file=>{picker.files=[file];await picker.listeners.get('change')();};
  await choose({size:80001,arrayBuffer(){assert.fail('Oversized file must not be read');}});
  assert.equal(input.value,'');
  await choose({size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer});
  assert.equal(input.value,'');
  let finishRead;
  const pending=choose({size:bytes.length,arrayBuffer:()=>new Promise(resolve=>{finishRead=resolve;})});
  input.value='MY PASTED TEXT';input.listeners.get('input')();
  finishRead(bytes.buffer);await pending;
  assert.equal(input.value,'MY PASTED TEXT');
  await choose({size:bytes.length,arrayBuffer:async()=>bytes.buffer});
  assert.equal(input.value,saved);
  assert.equal(draft.value,'KEEP MY DRAFT');
  assert.equal(f.calls.some(c=>c.path==='/api/function/replay'),false);
  await f.el('restore-function-replay').click();
  assert.equal(draft.value,corrected);
  assert.equal(f.el('pass-count').textContent,'5/5');
 }finally{await f.close();}
});
test('draft edits made during replay validation are not overwritten by a late response',async()=>{
 let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const f=await setup({holdReplay:()=>{entered();return held;}});try{
  await passFunction(f);f.el('restore-replay-input').value=f.el('replay-json').textContent;
  const pending=f.el('restore-function-replay').click();await started;f.el('function-source').value='MY NEW UNSAVED SOURCE';release();await pending;
  assert.equal(f.el('function-source').value,'MY NEW UNSAVED SOURCE');assert.match(f.el('restore-replay-status').textContent,/draft changed during validation/);
 }finally{release();await f.close();}
});

test('replay export checks contract bytes as well as source and discards a run closed during either digest',async()=>{
 const corrupted=await setup({tamperReplayContract:true});try{
  await corrupted.el('try-function-example').click();await corrupted.el('download-failure-replay').click();
  assert.equal(corrupted.downloads.length,0);assert.match(corrupted.el('failure-replay-status').textContent,/did not match/);
  await passFunction(corrupted);await corrupted.el('download-function-replay').click();
  assert.equal(corrupted.downloads.length,0);assert.match(corrupted.el('checked-function-status').textContent,/did not match/);
 }finally{corrupted.close();}
 let release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const stale=await setup({async digest(name,bytes){entered();await waiting;return webcrypto.subtle.digest(name,bytes);}});try{
  await passFunction(stale);const pending=stale.el('download-function-replay').click();await started;
  await stale.el('cancel').click();release();await pending;assert.equal(stale.downloads.length,0);assert.equal(stale.el('function-replay').hidden,true);
 }finally{release();stale.close();}
});
test('canceling quick entry during a late check cannot continue into source reads or publish its old verdict',async()=>{
 let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const f=await setup({holdCheck:()=>{entered();return held;}});try{
  const pending=f.el('try-function-example').click();await started;
  assert.equal(f.el('try-function-example').disabled,true);
  await f.el('cancel').click();release();await pending;await settle();
  assert.deepEqual(f.calls.filter(c=>c.path==='/api/function/action').map(c=>c.body.action),['test','cancel']);
  await f.el('view-record').click();const record=JSON.parse(f.el('record-json').textContent);
  assert.equal(record.closed,true);assert.deepEqual(record.checks,[]);assert.equal(record.publicChecksCurrent,false);
  assert.equal(f.el('finish').disabled,true);assert.equal(f.el('try-function-example').disabled,false);
 }finally{release();f.close();}
});
