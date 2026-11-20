'use strict';
// Import only authored core. Real Firebase entry/SDK/Vite/native model are NOT imported or executed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const localClientModule=require('../src/firebase-local-client.cjs');
const core=import('../web/firebase-planner-core.mjs');
const config={firebase:{apiKey:'authored-public-config',projectId:'authored-project',appId:'authored-app'},appCheckSiteKey:'authored-public-site-key',appName:'authored-pit-crew'};
const answer={revision:0,action:'ask_user',path:'',artifactId:'',evidenceIds:[],objective:'',reasonEvidenceIds:[]};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function fake(){
 let availability='available',raw;
 const calls={initializeApp:0,deleteApp:0,appCheck:0,getAI:0,createModel:0,initializeModel:0,generate:0,availability:0};
 const apps=[],env={isSecureContext:true,document:{},navigator:{userActivation:{isActive:true}}};env.window=env;
 env.LanguageModel={async availability(){calls.availability++;return availability;},async create(){throw Error('fake test never creates native sessions');}};
 const ai={chromeAdapterFactory(){}};
 const sdk={SDK_VERSION:'13.3.0',InferenceMode:{ONLY_ON_DEVICE:'only_on_device'},InferenceSource:{ON_DEVICE:'on_device'},
  getApps(){return apps;},initializeApp(options,name){calls.initializeApp++;const app={name,options};apps.push(app);return app;},
  async deleteApp(app){calls.deleteApp++;const at=apps.indexOf(app);if(at>=0)apps.splice(at,1);},
  initializeAppCheck(app,options){calls.appCheck++;assert.equal(options.isTokenAutoRefreshEnabled,false);return{app};},
  ReCaptchaEnterpriseProvider:class{constructor(siteKey){assert.equal(siteKey,config.appCheckSiteKey);}},
  GoogleAIBackend:class{},
  getAI(){calls.getAI++;return ai;},
  getGenerativeModel(_ai,params){
   calls.createModel++;assert.equal(params.mode,'only_on_device');
   raw={chromeAdapter:{mode:params.mode,languageModelProvider:env.LanguageModel,async createSession(){throw Error('authored contract does not create sessions');}},
    async initializeDeviceModel(){calls.initializeModel++;},
    async generateContent(){calls.generate++;return{response:{inferenceSource:'on_device',text:()=>JSON.stringify(answer)}};}};
   return raw;
  }};
 return{sdk,env,calls,ai,apps,get raw(){return raw;},set availability(value){availability=value;}};
}
async function adapter(f,options={}){const {createFirebasePlannerCore}=await core;return createFirebasePlannerCore({sdk:f.sdk,localClientModule,config:structuredClone(config),environment:f.env,...options});}
test('Firebase core module/adapter construction do not initialize SDK or model',async()=>{
 const f=fake(),a=await adapter(f);assert.equal(f.calls.initializeApp,0);assert.equal(f.calls.createModel,0);assert.equal(f.calls.generate,0);
 assert.equal(a.state.runtimeVerified,false);assert.equal(a.state.prepared,false);await a.dispose();
});
test('Firebase core rejects missing gesture/native/secure browser before all SDK actions',async()=>{
 for(const change of [f=>{f.env.navigator.userActivation.isActive=false;},f=>{f.env.LanguageModel=undefined;},f=>{f.env.isSecureContext=false;},f=>{f.env.window={};}]){
  const f=fake();change(f);const a=await adapter(f);
  assert.equal((await a.prepareFromUserGesture()).status,'blocked');assert.equal(f.calls.initializeApp,0);
  assert.equal(f.calls.createModel,0);assert.equal(f.calls.generate,0);await a.dispose();
 }
});
test('Firebase core blocks unavailable/downloading/downloadable before App Check or SDK init',async()=>{
 for(const availability of ['unavailable','downloading','downloadable']){
  const f=fake();f.availability=availability;const a=await adapter(f);
  assert.equal((await a.prepareFromUserGesture()).reason,'local-model-not-already-available');
  assert.equal(f.calls.initializeApp,0);assert.equal(f.calls.appCheck,0);assert.equal(f.calls.initializeModel,0);await a.dispose();
 }
});
test('Firebase core invokes the local-only client without starting App Check',async()=>{
 const f=fake(),a=await adapter(f);
 assert.equal((await a.prepareFromUserGesture()).status,'prepared');
 assert.equal(f.calls.initializeApp,1);assert.equal(f.calls.appCheck,0);assert.equal(f.calls.initializeModel,1);
 assert.equal(f.calls.generate,0);assert.equal(a.state.runtimeVerified,false);
 const result=await a.decide({revision:0,evidence:[],events:[]});
 assert.equal(result.status,'decision');assert.deepEqual(result.decision,answer);assert.equal(f.calls.generate,1);
 a.stop();assert.equal(a.state.prepared,false);await a.dispose();assert.equal(f.calls.deleteApp,1);
});

test('Firebase repair-only preparation carries source-grounded advice through the guarded SDK adapter',async()=>{
 const f=fake(),a=await adapter(f);await a.prepareFromUserGesture({repairAdviceOnly:true});
 f.raw.generateContent=async()=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({needsMoreEvidence:false,
  evidenceId:'current-read',sourceQuote:'if(cursor)',cause:'The guard drops falsy values.',change:'Use a nullish guard.'})}});
 const result=await a.decide({revision:13,evidence:[{id:'current-read',content:'if(cursor)'}],events:[]});
 assert.equal(result.status,'decision');assert.equal(result.decision.revision,13);
 assert.equal(result.decision.path,'');assert.equal(result.decision.artifactId,'');
 assert.deepEqual(result.decision.evidenceIds,['current-read']);
 f.raw.generateContent=async()=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({needsMoreEvidence:false,
  evidenceId:'current-read',sourceQuote:'PRIVATE_NONEXISTENT_QUOTE',cause:'A claim.',change:'A change.'})}});
 const rejected=await a.decide({revision:13,evidence:[{id:'current-read',content:'if(cursor)'}],events:[]});
 assert.equal(rejected.diagnostic,'output-grounding');assert.equal(JSON.stringify(rejected).includes('PRIVATE'),false);
 await a.dispose();
});

test('Firebase source-line advice uses the guarded on-device adapter and rejects invalid preparation before SDK work',async()=>{
 const invalid=fake(),unused=await adapter(invalid);
 for(const options of [{repairAdviceFormat:'source-line'},{repairAdviceOnly:true,repairAdviceFormat:'automatic'}])
  assert.equal((await unused.prepareFromUserGesture(options)).reason,'invalid-preparation-mode');
 assert.equal(invalid.calls.initializeApp,0);await unused.dispose();
 const f=fake(),a=await adapter(f);assert.equal((await a.prepareFromUserGesture({repairAdviceOnly:true,repairAdviceFormat:'source-line'})).status,'prepared');
 f.raw.generateContent=async()=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({needsMoreEvidence:false,
  sourceNumber:1,lineNumber:1,cause:'The guard drops falsy cursors.',change:'Use a nullish check.'})}});
 const result=await a.decide({revision:13,evidence:[{id:'current-read',content:'if(cursor)'}],events:[]});
 assert.equal(result.status,'decision');assert.deepEqual(result.decision.evidenceIds,['current-read']);
 assert.match(result.decision.objective,/App-bound source line 1/);assert.equal(f.calls.generate,0,'authored replacement method does not invoke an SDK model');await a.dispose();
});
test('Firebase core refuses wrong bundle and unknown/mismatched internal adapter before model methods',async()=>{
 const cases=[
  f=>{f.ai.chromeAdapterFactory=undefined;},
  f=>{const old=f.sdk.getGenerativeModel;f.sdk.getGenerativeModel=(...args)=>{const raw=old(...args);raw.chromeAdapter=undefined;return raw;};},
  f=>{const old=f.sdk.getGenerativeModel;f.sdk.getGenerativeModel=(...args)=>{const raw=old(...args);raw.chromeAdapter.mode='prefer_on_device';return raw;};},
  f=>{const old=f.sdk.getGenerativeModel;f.sdk.getGenerativeModel=(...args)=>{const raw=old(...args);raw.chromeAdapter.languageModelProvider={};return raw;};}
 ];
 for(const change of cases){
  const f=fake();change(f);const a=await adapter(f);
  assert.equal((await a.prepareFromUserGesture()).status,'blocked');
  assert.equal(f.calls.initializeModel,0);assert.equal(f.calls.generate,0);assert.equal(a.state.prepared,false);await a.dispose();
 }
});
test('Firebase model shape mutation after prepare blocks before raw generate',async()=>{
 for(const change of [
  f=>{f.raw.chromeAdapter=undefined;},
  f=>{f.raw.chromeAdapter.mode='only_in_cloud';},
  f=>{f.env.LanguageModel={async availability(){return'available';},async create(){}};}
 ]){
  const f=fake(),a=await adapter(f);await a.prepareFromUserGesture();change(f);
  assert.equal((await a.decide({revision:0,evidence:[],events:[]})).status,'blocked');
  assert.equal(f.calls.generate,0);assert.equal(a.state.prepared,false);await a.dispose();
 }
});
test('Firebase unexpected returned source is reported as investigation, not prevented-egress proof',async()=>{
 const f=fake(),a=await adapter(f);await a.prepareFromUserGesture();
 f.raw.generateContent=async()=>{f.calls.generate++;return{response:{inferenceSource:'in_cloud',text:()=>JSON.stringify(answer)}};};
 assert.equal((await a.decide({revision:0,evidence:[],events:[]})).reason,'unexpected-inference-source-investigate-egress');
 assert.equal(f.calls.generate,1,'fake delegate was called; post-call check cannot undo egress');
 assert.equal(a.state.prepared,false);await a.dispose();
});
test('Firebase SDK dependencies are snapshotted and raw provider errors are not returned',async()=>{
 const f=fake(),a=await adapter(f);
 f.sdk.getGenerativeModel=()=>{throw Error('caller mutation');};
 assert.equal((await a.prepareFromUserGesture()).status,'prepared');
 f.raw.generateContent=async()=>{throw Error('PRIVATE_PROVIDER_ERROR');};
 const result=await a.decide({revision:0,evidence:[],events:[]});
 assert.equal(result.status,'blocked');assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER_ERROR'),false);
 assert.equal(a.state.prepared,false);await a.dispose();
});
test('Firebase owned app collision never deletes or reuses another existing app',async()=>{
 const f=fake();const existing={name:config.appName,options:{existing:true}};f.apps.push(existing);
 const a=await adapter(f);assert.equal((await a.prepareFromUserGesture()).status,'blocked');
 assert.equal(f.calls.initializeApp,0);assert.equal(f.calls.deleteApp,0);assert.deepEqual(f.apps,[existing]);await a.dispose();
});
test('Firebase stop during preflight discards without initializing app or native model',async()=>{
 const f=fake(),wait=deferred();f.env.LanguageModel.availability=()=>wait.promise;
 const a=await adapter(f),pending=a.prepareFromUserGesture();a.stop();wait.resolve('available');
 assert.equal((await pending).status,'discarded');assert.equal(f.calls.initializeApp,0);assert.equal(f.calls.initializeModel,0);await a.dispose();
});
test('Firebase unknown SDK version/constants rejected before SDK initialization',async()=>{
 const {createFirebasePlannerCore}=await core;
 for(const change of [f=>{f.sdk.SDK_VERSION='future-version';},f=>{f.sdk.InferenceMode.ONLY_ON_DEVICE=undefined;},f=>{f.sdk.InferenceSource.ON_DEVICE=undefined;}]){
  const f=fake();change(f);
  assert.throws(()=>createFirebasePlannerCore({sdk:f.sdk,localClientModule,config,environment:f.env}),/unsupported-firebase-dependencies/);
  assert.equal(f.calls.initializeApp,0);assert.equal(f.calls.generate,0);
 }
});
test('real Firebase entry has actual vendor imports but is not imported by these tests',()=>{
 const entry=fs.readFileSync(path.join(__dirname,'../web/firebase-planner.mjs'),'utf8');
 for(const name of ['firebase/app','firebase/app-check','firebase/ai'])assert.ok(entry.includes("from '"+name+"'"));
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../web/package.json'),'utf8'));
 assert.equal(pkg.dependencies.firebase,'13.3.0');assert.equal(pkg.devDependencies.vite,'8.3.8');
 assert.ok(!entry.includes('prepareFromUserGesture()'),'entry does not automatically initialize');
});
