'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {repairSnapshot,buildProofRecord,probeBrowserRuntime,downloadBrowserModel}=require('../ui/public/app.js');
const {createWorkbenchApp}=require('../ui/workbench-bridge.cjs');
const {parseFirebaseLaunchConfig,main}=require('../ui/firebase-workbench.cjs');
const {verifyFirebaseBundle}=require('../src/firebase-bundle.cjs');
const config={firebaseConfig:{firebase:{apiKey:'example-public-api-key',projectId:'example-project',appId:'example-app-id'},appCheckSiteKey:'example-public-site-key',appName:'example-bench'},contentSecurityPolicy:"default-src 'self'"};
function state(){return{mode:'authored-reference',task:{id:'pagination-zero'},sessionToken:'DO-NOT-EXPORT',firebaseConfig:{secret:'DO-NOT-EXPORT'},
 snapshot:{revision:3,closed:false,pending:null,publicChecksCurrent:false,originalTask:'original task',counts:{tests:1},
  manifest:[{path:'src/list.js',sha256:'a'.repeat(64)}],evidence:[{id:'e1',path:'src/list.js',sha256:'a'.repeat(64),content:'DO-NOT-EXPORT-SOURCE'},
   {id:'old',path:'src/list.js',sha256:'b'.repeat(64),content:'stale source'}]},checks:[{id:'zero-preserved',ok:false,message:'private log'}],events:[{id:'ev1',kind:'test',label:'Ran authored checks.'}]};}
test('Nano repair input requires a real failure and current read evidence',()=>{
 const s=state(),input=repairSnapshot(s);assert.deepEqual(input.evidence.map(e=>e.id),['e1']);
 assert.equal(input.semanticBranch,'repair-after-public-check-failure');assert.deepEqual(input.allowedActions,['code','ask_user']);
 assert.equal(input.originalTask,'original task');assert.equal(JSON.stringify(input).includes('sessionToken'),false);
 for(const mutate of [s=>s.snapshot.closed=true,s=>s.snapshot.pending={},s=>s.checks=[],s=>s.checks[0].ok=true,s=>s.snapshot.evidence=[]]){
  const s=state();mutate(s);assert.equal(repairSnapshot(s),null);
 }
});
test('evidence export allowlists records and keeps source, connection configuration and tokens private',()=>{
 const cloud={revision:3,model:'test-model',inferenceSource:'in_cloud',prompt:'DO-NOT-EXPORT-PROMPT',
  answer:{assessment:'uncertain',explanation:'DO-NOT-EXPORT-REVIEW',nextCheck:'DO-NOT-EXPORT-NEXT'}};
 const record=buildProofRecord(state(),{revision:3,action:'code',inferenceSource:'on_device',calls:1,objective:'DO-NOT-EXPORT-HINT'},1,cloud,1),text=JSON.stringify(record);
 assert.equal(text.includes('DO-NOT-EXPORT'),false);assert.equal(text.includes('private log'),false);
 assert.equal(record.evidenceKind,'authored-fixture-workflow');assert.equal(record.counts.coderCalls,0);
 assert.equal(record.heldOutCorrectness,false);assert.equal(record.nanoIdentityVerified,false);assert.equal(record.advisor.calls,1);
 assert.equal(record.cloudReview.assessment,'uncertain');assert.equal(record.counts.cloudCalls,1);
 assert.throws(()=>buildProofRecord(null));
});

test('live planner evidence retains only an owner-bound category, including after the backend closes',()=>{
 const s=state();s.mode='configured-local-unverified';s.sessionId='authored-live';s.snapshot.closed=true;
 const observation={sessionId:s.sessionId,revision:2,status:'blocked',inferenceSource:'in_cloud',diagnostic:'output-grounding',
  source:'DO-NOT-EXPORT',error:'DO-NOT-EXPORT'};
 const record=buildProofRecord(s,null,0,null,0,observation);
 assert.deepEqual(record.plannerObservation,{revision:2,status:'blocked',inferenceSource:null,diagnostic:'output-grounding',kind:'browser-client-observation'});
 assert.equal(JSON.stringify(record).includes('DO-NOT-EXPORT'),false);
 for(const change of [{sessionId:'another-owner'},{revision:99},{status:'invented'}])
  assert.equal(Object.hasOwn(buildProofRecord(s,null,0,null,0,{...observation,...change}),'plannerObservation'),false);
 assert.equal(buildProofRecord(s,null,0,null,0,{...observation,diagnostic:'DO-NOT-EXPORT'}).plannerObservation.diagnostic,null);
});
test('browser-only Firebase capability does not require or admit an arbitrary coder or verifier',async()=>{
 const app=await createWorkbenchApp({origin:'http://127.0.0.1:48118',firebaseConfig:config.firebaseConfig,browserBundleAvailable:true});
 const boot=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:{host:'127.0.0.1:48118'}});
 assert.equal(boot.body.capabilities.planner.available,true);assert.equal(boot.body.capabilities.live.available,false);
 assert.equal(boot.body.capabilities.live.canVerify,false);assert.deepEqual(boot.body.capabilities.planner.firebaseConfig,config.firebaseConfig);
});

test('coder-only preview does not require Firebase, initialize a planner or admit Verify',async()=>{
 const profile={kind:'runtime-reported',profileHash:'a'.repeat(64),modelId:'AUTHORED-PREVIEW',modelDigest:'b'.repeat(64),engineBuild:'AUTHORED-FAKE'};
 const app=await createWorkbenchApp({origin:'http://127.0.0.1:48118',live:{profile,coder:{locality:'local-only',generate:async()=>{throw Error('unused');}},coderOnlyPreview:true,providerTimeoutMs:120000}});
 const boot=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:{host:'127.0.0.1:48118'}});
 assert.equal(boot.body.capabilities.live.available,true);assert.equal(boot.body.capabilities.live.plannerRequired,false);
 assert.equal(boot.body.capabilities.live.canVerify,false);assert.equal(boot.body.capabilities.planner.available,false);
 const started=await app.dispatch({method:'POST',pathname:'/api/workbench/start',headers:{host:'127.0.0.1:48118',origin:'http://127.0.0.1:48118','content-type':'application/json','x-pitcrew-token':boot.body.sessionToken},body:{taskId:'pagination-zero',startAdmissionId:boot.body.startAdmissionId}});
 assert.equal(started.status,200);assert.equal(started.body.state.canVerify,false);assert.deepEqual(started.body.state.providerInvocations,{coder:0,planner:0});
});
test('Firebase launcher validates bounded public configuration before it starts a server',async()=>{
 assert.deepEqual(parseFirebaseLaunchConfig(JSON.stringify(config)),config);
 for(const c of [{...config,extra:true},{...config,firebaseConfig:{...config.firebaseConfig,debugToken:'secret'}},{...config,contentSecurityPolicy:'x\r\ny'}])assert.throws(()=>parseFirebaseLaunchConfig(JSON.stringify(c)));
 assert.throws(()=>parseFirebaseLaunchConfig('x'.repeat(17000)));
 let starts=0;await assert.rejects(main([],{startServer:async()=>starts++}));assert.equal(starts,0);
 await main(['--config','example.local.json'],{readFile:()=>JSON.stringify(config),startServer:async c=>{starts++;assert.deepEqual(c,config);}});assert.equal(starts,1);
 await main(['--config','example.local.json','--app-check-debug'],{readFile:()=>JSON.stringify(config),startServer:async c=>{starts++;assert.deepEqual(c,{...config,developmentAppCheck:true});}});
 await main(['--config','example.local.json','--app-check-debug','--port','59514'],{readFile:()=>JSON.stringify(config),startServer:async c=>{assert.deepEqual(c,{...config,developmentAppCheck:true,port:59514});}});
 for(const flags of [['--port','0'],['--port','65536'],['--port'],['--port','59514','--port','59515'],['--app-check-debug','--app-check-debug']]){
  await assert.rejects(main(['--config','example.local.json',...flags],{readFile:()=>{throw Error('must validate flags before file access');}}),/usage:/);
 }
 await assert.rejects(main(['--config','example.local.json','--unknown'],{readFile:()=>{throw Error('must validate arguments first');}}),/usage:/);
});
test('served Firebase bundle matches the pinned dependencies, build inputs and bytes',async()=>{
 assert.equal(await verifyFirebaseBundle(),true);
});

test('native browser readiness is distinct from extension support and never initializes a model',async()=>{
 assert.equal((await probeBrowserRuntime({isSecureContext:true})).status,'native-api-absent');
 assert.equal((await probeBrowserRuntime({isSecureContext:false})).status,'insecure-context');
 let initialized=0;
 for(const availability of ['available','downloadable','downloading','unavailable','unexpected']){
  const result=await probeBrowserRuntime({isSecureContext:true,LanguageModel:{
   availability:async options=>{assert.equal(options.expectedInputs[0].type,'text');return availability;},
   create:()=>{initialized++;throw Error('must not initialize');}
  }});
  assert.equal(result.status,availability==='unexpected'?'unknown-availability':availability);
  assert.equal(result.nanoIdentityVerified,false);
 }
 assert.equal(initialized,0);
 assert.equal((await probeBrowserRuntime({isSecureContext:true,LanguageModel:{availability:()=>new Promise(()=>{}),create(){}}},5)).status,'availability-check-failed');
});

test('native setup requires a gesture, reports actual progress and destroys only its owned session',async()=>{
 let creates=0,destroys=0,available=false;const progress=[];
 const environment={isSecureContext:true,navigator:{userActivation:{isActive:true}},LanguageModel:{
  availability:async()=>available?'available':'downloadable',
  create:async options=>{creates++;options.monitor({addEventListener(name,callback){assert.equal(name,'downloadprogress');callback({loaded:0.5,total:1});}});available=true;return{destroy(){destroys++;}};}
 }};
 const result=await downloadBrowserModel(environment,{onProgress:value=>progress.push(value)});
 assert.equal(result.status,'available');assert.deepEqual(progress,[50]);assert.equal(creates,1);assert.equal(destroys,1);
 await downloadBrowserModel(environment);assert.equal(creates,1);
 environment.navigator.userActivation.isActive=false;
 assert.equal((await downloadBrowserModel(environment)).status,'gesture-required');assert.equal(creates,1);
});

test('aborted native setup does not create a session or initiate inference',async()=>{
 const controller=new AbortController();controller.abort();let creates=0;
 const environment={isSecureContext:true,navigator:{userActivation:{isActive:true}},LanguageModel:{availability:async()=> 'downloadable',create(){creates++;}}};
 assert.equal((await downloadBrowserModel(environment,{signal:controller.signal})).status,'aborted');assert.equal(creates,0);
});

test('cancel releases a stuck native availability check without starting a download',{timeout:1000},async()=>{
 const controller=new AbortController();let resolveAvailability,creates=0;
 const environment={isSecureContext:true,navigator:{userActivation:{isActive:true}},LanguageModel:{
  availability:()=>new Promise(resolve=>{resolveAvailability=resolve;}),create(){creates++;}
 }};
 const waiting=downloadBrowserModel(environment,{signal:controller.signal});
 controller.abort();assert.equal((await waiting).status,'aborted');
 resolveAvailability('downloadable');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(creates,0);
});

test('cancel releases an abort-ignoring native create and disposes its late session once',{timeout:1000},async()=>{
 const controller=new AbortController(),progress=[];let resolveCreate,emitProgress,destroys=0,started;
 const created=new Promise(resolve=>{started=resolve;});
 const environment={isSecureContext:true,navigator:{userActivation:{isActive:true}},LanguageModel:{
  availability:async()=> 'downloadable',
  create:options=>{
   assert.equal(options.signal,controller.signal);
   options.monitor({addEventListener(name,callback){emitProgress=callback;}});
   started();return new Promise(resolve=>{resolveCreate=resolve;});
  }
 }};
 const waiting=downloadBrowserModel(environment,{signal:controller.signal,onProgress:value=>progress.push(value)});
 await created;emitProgress({loaded:0.25,total:1});controller.abort();
 assert.equal((await waiting).status,'aborted');assert.equal(destroys,0);
 emitProgress({loaded:0.75,total:1});resolveCreate({destroy(){destroys++;}});
 await new Promise(resolve=>setImmediate(resolve));controller.abort();
 assert.equal(destroys,1);assert.deepEqual(progress,[25]);
});

test('cancel during final readiness releases and destroys the owned native session',{timeout:1000},async()=>{
 const controller=new AbortController();let calls=0,destroys=0,checking;
 const finalCheck=new Promise(resolve=>{checking=resolve;});
 const environment={isSecureContext:true,navigator:{userActivation:{isActive:true}},LanguageModel:{
  availability:()=>{if(++calls===1)return Promise.resolve('downloadable');checking();return new Promise(()=>{});},
  create:async()=>({destroy(){destroys++;}})
 }};
 const waiting=downloadBrowserModel(environment,{signal:controller.signal});
 await finalCheck;controller.abort();assert.equal((await waiting).status,'aborted');assert.equal(destroys,1);
});

test('native setup failure and late rejection are observed without leaking a session',{timeout:1000},async()=>{
 const controller=new AbortController();let rejectCreate,started;
 const created=new Promise(resolve=>{started=resolve;});
 const environment={isSecureContext:true,navigator:{userActivation:{isActive:true}},LanguageModel:{
  availability:async()=> 'downloadable',create:()=>{started();return new Promise((_,reject)=>{rejectCreate=reject;});}
 }};
 const waiting=downloadBrowserModel(environment,{signal:controller.signal});
 await created;controller.abort();assert.equal((await waiting).status,'aborted');
 rejectCreate(Error('native work rejected after cancellation'));await new Promise(resolve=>setImmediate(resolve));
 environment.LanguageModel.create=()=>{throw Error('native setup failed synchronously');};
 assert.equal((await downloadBrowserModel(environment)).status,'download-failed');
});
