'use strict';
// Fake SDK only. These tests do not perform cloud inference or prove App Check.
const test=require('node:test'),assert=require('node:assert/strict');
const core=import('../web/firebase-cloud-review-core.mjs');
const config={firebase:{apiKey:'PUBLIC-TEST-CONFIG',projectId:'test-project',appId:'test-app'},appCheckSiteKey:'PUBLIC-TEST-KEY',appName:'test-review'};
function snapshot(){return{revision:3,closed:false,pending:null,originalTask:'Preserve a valid zero cursor.',
 manifest:[{path:'src/list.js',sha256:'a'.repeat(64)}],evidence:[{id:'read-1',path:'src/list.js',sha256:'a'.repeat(64),content:'if(cursor)params.cursor=cursor;',private:'DO-NOT-SEND'}],
 publicChecks:[{id:'zero-preserved',ok:false,message:'DO-NOT-SEND-LOG'},{id:'null-omitted',ok:true}],
 sessionToken:'DO-NOT-SEND-TOKEN',events:[{label:'DO-NOT-SEND-EVENT'}]};}
const answer={assessment:'uncertain',explanation:'A truthiness check drops zero.',nextCheck:'Check the own cursor property for input zero.',evidenceIds:['read-1']};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fake(){
 const calls={init:0,appCheck:0,models:[],prompts:[],deleted:[]},apps=[];
 const env={isSecureContext:true,document:{},navigator:{userActivation:{isActive:true}}};env.window=env;
 let result=()=>Promise.resolve({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify(answer)}});
 const sdk={SDK_VERSION:'13.3.0',InferenceMode:{ONLY_IN_CLOUD:'only_in_cloud'},InferenceSource:{IN_CLOUD:'in_cloud'},
  getApps:()=>apps,initializeApp(options,name){calls.init++;const app={name};apps.push(app);return app;},
  deleteApp:async app=>{calls.deleted.push(app);const index=apps.indexOf(app);if(index>=0)apps.splice(index,1);},
  initializeAppCheck(app,options){calls.appCheck++;assert.equal(options.isTokenAutoRefreshEnabled,false);return {app};},
  async getToken(){return {token:'AUTHORED_TEST_TOKEN'};},
  ReCaptchaEnterpriseProvider:class{constructor(key){assert.equal(key,config.appCheckSiteKey);}},GoogleAIBackend:class{},
  getAI:()=>({}),getGenerativeModel(ai,params,options){calls.models.push({params,options});return{chromeAdapter:{mode:'only_in_cloud'},generateContent(prompt,options){calls.prompts.push({prompt,options});return result();}};}
 };
 return{sdk,env,calls,apps,set result(value){result=value;}};
}
async function reviewer(f){return(await core).createFirebaseCloudReviewerCore({sdk:f.sdk,config,environment:f.env});}

test('cloud failures expose only bounded SDK diagnostics, consume approval once and never retry',async()=>{
 const cases=[
  [{code:'fetch-error',customErrorData:{status:429}},'cloud-rate-limited'],
  [{code:'fetch-error',customErrorData:{status:403}},'cloud-access-denied'],
  [{code:'fetch-error',customErrorData:{status:401}},'cloud-unauthenticated'],
  [{code:'fetch-error',customErrorData:{status:404}},'cloud-model-unavailable'],
  [{code:'fetch-error',customErrorData:{status:400}},'cloud-request-rejected'],
  [{code:'fetch-error',customErrorData:{status:503}},'cloud-service-unavailable'],
  [{code:'api-not-enabled'},'cloud-service-not-enabled'],
  [{code:'appCheck/recaptcha-error'},'cloud-attestation-failed'],
  [{code:'fetch-error',customErrorData:{status:'429'}},'cloud-request-failed'],
  [{code:'other',customErrorData:{status:429}},'cloud-request-failed'],
  [{name:'AbortError'},'cloud-wait-ended']
 ];
 for(const [metadata,diagnostic]of cases){
  const f=fake(),r=await reviewer(f),approved=r.preview(snapshot());
  f.result=async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_MESSAGE'),metadata,{private:'PRIVATE_TOKEN'});};
  const result=await r.send(approved);assert.equal(result.status,'blocked');assert.equal(result.diagnostic,diagnostic);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(r.state.calls,1);assert.equal(f.calls.prompts.length,1);
  assert.equal((await r.send(approved)).reason,'review-current-payload-first');assert.equal(f.calls.prompts.length,1);await r.dispose();
 }
});

test('invalid cloud receipts and output stay distinct from provider rate limits without exposing raw output',async()=>{
 for(const [response,diagnostic]of [[{inferenceSource:'on_device',text:()=>JSON.stringify(answer)},'cloud-source-unconfirmed'],
  [{inferenceSource:'in_cloud',text:()=>'{PRIVATE_BODY'},'cloud-response-rejected'],
  [{inferenceSource:'in_cloud',text(){throw Object.assign(Error('PRIVATE_BODY'),{code:'fetch-error',customErrorData:{status:429}});}},'cloud-response-rejected']]){
  const f=fake(),r=await reviewer(f);f.result=async()=>({response});const result=await r.send(r.preview(snapshot()));
  assert.equal(result.diagnostic,diagnostic);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);await r.dispose();
 }
 const {cloudFailureMessage}=require('../ui/public/app.js');
 assert.equal(cloudFailureMessage({diagnostic:'PRIVATE_UNKNOWN',message:'PRIVATE_RAW'}).includes('PRIVATE_'),false);
 for(const diagnostic of ['__proto__','toString','constructor'])assert.match(cloudFailureMessage({diagnostic}),/^The cloud request did not finish/);
});

test('failed App Check holds back the preview and leaves the inference budget available',async()=>{
 const f=fake();
 const outcomes=[new Error('PRIVATE_ATTESTATION_ERROR'),{}, {token:'AUTHORED_TEST_TOKEN'}];
 f.sdk.getToken=async check=>{
  assert.equal(check.app,f.apps[0]);
  const next=outcomes.shift();
  if(next instanceof Error)throw next;
  return next;
 };
 const r=await reviewer(f);
 for(let attempt=0;attempt<2;attempt++){
  const approval=r.preview(snapshot());
  assert.deepEqual(await r.send(approval),{status:'blocked',reason:'cloud-review-failed',diagnostic:'cloud-attestation-failed'});
  assert.equal((await r.send(approval)).reason,'review-current-payload-first');
 }
 assert.equal(r.state.calls,0);
 assert.deepEqual(f.calls.models,[]);
 assert.deepEqual(f.calls.prompts,[]);
 const approval=r.preview(snapshot());
 assert.equal((await r.send(approval)).status,'review');
 assert.equal(f.calls.appCheck,1);
 assert.equal(f.calls.prompts[0].prompt,approval.prompt);
 await r.dispose();
});

test('stopping while attestation is pending cannot send a prompt after the token arrives',async()=>{
 const f=fake(),token=deferred();
 f.sdk.getToken=()=>token.promise;
 const r=await reviewer(f),pending=r.send(r.preview(snapshot()));
 r.stop();
 assert.deepEqual(await pending,{status:'discarded'});
 token.resolve({token:'LATE_TEST_TOKEN'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.state.calls,0);
 assert.deepEqual(f.calls.prompts,[]);
 await r.dispose();
});

test('a suggested example cannot duplicate an existing input or exceed the checked contract limits',async()=>{
 const s={kind:'checked-function-challenge',revision:8,publicChecksCurrent:true,requirements:'Accept a number and return it.',
  files:{'src/function.js':'exports.run = n => n;',
   'contract.json':JSON.stringify({schema:'local-pit-crew/function-contract/v1',exportName:'run',
    cases:[{id:'case-01',label:'One',args:[1],expected:1}]})}};
 const f=fake(),r=await reviewer(f);
 for(const argsJson of ['[1]','{"value":2}','['.concat('0,'.repeat(8),'0]')]){
  f.result=async()=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({
   ...answer,evidenceIds:[],example:{label:'Another number',argsJson,expectedJson:'2'}
  })}});
  assert.equal((await r.send(r.preview(s))).diagnostic,'cloud-response-rejected');
 }
 assert.throws(()=>r.preview({...s,publicChecksCurrent:false}),/checked-parent-required/);
 assert.throws(()=>r.preview({...s,closed:true}),/checked-parent-required/);
 await r.dispose();
});

test('cloud preview is bounded, immutable and allowlisted without SDK initialization',async()=>{
 const f=fake(),r=await reviewer(f),s=snapshot(),review=r.preview(s);
 assert.equal(f.calls.init,0);assert.equal(f.calls.prompts.length,0);assert.equal(r.state.runtimeVerified,false);
 assert.equal(review.model,'gemini-3.5-flash-lite');assert.equal(review.revision,3);assert.ok(Object.isFrozen(review));
 assert.equal(review.prompt.includes('DO-NOT-SEND'),false);assert.ok(review.prompt.includes('if(cursor)'));
 assert.equal(review.prompt.includes('null-omitted'),false);assert.equal(review.prompt.includes('zero-preserved'),true);
 assert.equal(review.prompt.split('\nREVIEW_DATA_JSON:\n')[1],review.payloadJson);
 assert.deepEqual(JSON.parse(review.payloadJson).failedCheckIds,['zero-preserved']);
 s.evidence[0].content='CHANGED AFTER PREVIEW';assert.equal(review.prompt.includes('CHANGED AFTER PREVIEW'),false);
 assert.throws(()=>{review.prompt='replaced';});await r.dispose();assert.equal(f.calls.deleted.length,0);
});

test('cloud send requires the exact current preview and a secure user gesture before SDK work',async()=>{
 const f=fake(),r=await reviewer(f),old=r.preview(snapshot()),current=r.preview(snapshot());
 for(const value of [null,old,{...current}])assert.equal((await r.send(value)).reason,'review-current-payload-first');
 for(const mutate of [()=>f.env.navigator.userActivation.isActive=false,()=>{f.env.navigator.userActivation.isActive=true;f.env.isSecureContext=false;}]){
  mutate();assert.equal((await r.send(current)).reason,'secure-browser-gesture-required');
 }
 assert.equal(f.calls.init,0);assert.equal(f.calls.prompts.length,0);await r.dispose();
});

test('cloud sends precisely the reviewed prompt with cloud-only mode and validates cited advice',async()=>{
 const f=fake(),r=await reviewer(f),review=r.preview(snapshot()),result=await r.send(review);
 assert.equal(result.status,'review');assert.deepEqual(result.answer,answer);assert.equal(result.inferenceSource,'in_cloud');
 assert.equal(result.includedNanoHypothesis,false);
 assert.equal(f.calls.init,1);assert.equal(f.calls.appCheck,1);assert.equal(f.calls.prompts[0].prompt,review.prompt);
 const {params,options}=f.calls.models[0];assert.equal(params.mode,'only_in_cloud');assert.equal(params.inCloudParams.model,review.model);
 assert.equal(params.inCloudParams.generationConfig.responseMimeType,'application/json');assert.equal(options.timeout,60000);
 assert.ok(f.calls.prompts[0].options.signal instanceof AbortSignal);assert.equal(r.state.calls,1);
 assert.equal((await r.send(review)).status,'blocked');await r.dispose();assert.equal(f.calls.deleted.length,1);
});

test('cloud preview rejects stale/empty/oversized evidence and includes only a current on-device hint',async()=>{
 for(const mutate of [s=>s.closed=true,s=>s.pending={},s=>s.publicChecks[0].ok=true,s=>s.evidence=[],
  s=>s.evidence[0].sha256='b'.repeat(64),s=>s.evidence[0].content='x'.repeat(12001),s=>s.originalTask='x'.repeat(4001)]){
  const f=fake(),r=await reviewer(f),s=snapshot();mutate(s);assert.throws(()=>r.preview(s));assert.equal(f.calls.init,0);await r.dispose();
 }
 const f=fake(),r=await reviewer(f);
 const hint={revision:3,inferenceSource:'on_device',objective:'AN ON-DEVICE HYPOTHESIS'};
 assert.equal(r.preview(snapshot(),hint).prompt.includes(hint.objective),true);
 for(const h of [{...hint,revision:2},{...hint,inferenceSource:'in_cloud'}])assert.equal(r.preview(snapshot(),h).prompt.includes(hint.objective),false);
 await r.dispose();
});

test('cloud response refuses source contradictions, invented citations, invalid fields and ungrounded agreement',async()=>{
 for(const result of [
  {response:{inferenceSource:'on_device',text:()=>JSON.stringify(answer)}},
  {inferenceSource:'on_device',response:{inferenceSource:'in_cloud',text:()=>JSON.stringify(answer)}},
  ...[{...answer,evidenceIds:['invented']},{...answer,evidenceIds:[]},{...answer,assessment:'supports'},{...answer,extra:'x'},
   {...answer,nextCheck:''},{...answer,explanation:'x'.repeat(8001)}].map(a=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify(a)}}))
 ]){
  const f=fake();f.result=async()=>result;const r=await reviewer(f);
  assert.equal((await r.send(r.preview(snapshot()))).reason,'cloud-review-failed');assert.equal(r.state.calls,1);await r.dispose();
 }
});

test('cloud can challenge a current Nano hypothesis and spends at most five explicit calls',async()=>{
 const f=fake();f.result=async()=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({...answer,assessment:'challenges'})}});
 const r=await reviewer(f),hint={revision:3,inferenceSource:'on_device',objective:'A possible diagnosis.'};
 for(let i=0;i<5;i++){
  const result=await r.send(r.preview(snapshot(),hint));
  assert.equal(result.status,'review');assert.equal(result.includedNanoHypothesis,true);
 }
 assert.equal((await r.send(r.preview(snapshot(),hint))).reason,'cloud-call-budget');assert.equal(f.calls.prompts.length,5);await r.dispose();
});

test('cloud stop releases an abort-ignoring request and discards late output without reviving a review',{timeout:1000},async()=>{
 const f=fake(),gate=deferred(),entered=deferred();f.result=()=>{entered.resolve();return gate.promise;};const r=await reviewer(f);
 const pending=r.send(r.preview(snapshot()));assert.equal(r.state.busy,true);
 await entered.promise;
 r.stop();assert.equal((await pending).status,'discarded');assert.equal(r.state.busy,false);
 assert.equal(f.calls.prompts[0].options.signal.aborted,true);gate.resolve({response:{inferenceSource:'in_cloud',text(){throw Error('must not consume stale text');}}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(r.state.calls,1);await r.dispose();
});

test('cloud deadline releases a stuck delegate, requests HTTP abort and consumes late rejection',async t=>{
 const f=fake(),gate=deferred(),entered=deferred();f.result=()=>{entered.resolve();return gate.promise;};const r=await reviewer(f);
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=r.send(r.preview(snapshot()));await entered.promise;t.mock.timers.tick(60000);
 assert.equal((await pending).reason,'cloud-wait-ended');assert.equal(r.state.busy,false);
 assert.equal(f.calls.prompts[0].options.signal.aborted,true);
 gate.reject(Error('DO-NOT-EXPOSE-PROVIDER-DETAILS'));await Promise.resolve();await r.dispose();
});

test('a failed replacement preview revokes the preceding approval',async()=>{
 const f=fake(),r=await reviewer(f),previous=r.preview(snapshot()),invalid=snapshot();invalid.closed=true;
 assert.throws(()=>r.preview(invalid));assert.equal((await r.send(previous)).reason,'review-current-payload-first');
 assert.equal(f.calls.init,0);await r.dispose();
});

test('cloud dispose does not delete a colliding app and later work remains closed',async()=>{
 const f=fake(),other={name:config.appName+'-cloud-review'};f.apps.push(other);const r=await reviewer(f);
 assert.equal((await r.send(r.preview(snapshot()))).reason,'cloud-review-failed');assert.equal(f.calls.init,0);
 await r.dispose();assert.equal(f.calls.deleted.length,0);assert.throws(()=>r.preview(snapshot()));assert.equal((await r.send(null)).status,'blocked');
});

test('cloud setup failure can retry using only its own app, without duplicate App Check initialization',async()=>{
 const f=fake(),getModel=f.sdk.getGenerativeModel;let tries=0;
 f.sdk.getGenerativeModel=(...args)=>{if(++tries===1)throw Error('temporary setup failure');return getModel(...args);};
 const r=await reviewer(f);assert.equal((await r.send(r.preview(snapshot()))).reason,'cloud-review-failed');
 assert.equal(r.state.calls,0);assert.equal((await r.send(r.preview(snapshot()))).status,'review');
 assert.equal(f.calls.init,1);assert.equal(f.calls.appCheck,1);assert.equal(f.calls.prompts.length,1);
 await r.dispose();assert.equal(f.calls.deleted.length,1);
});
