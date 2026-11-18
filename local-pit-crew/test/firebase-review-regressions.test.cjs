'use strict';
// Authored deferred rejection/success controls only; no Firebase SDK, native model or network.
const test=require('node:test'),assert=require('node:assert/strict');
const localClientModule=require('../src/firebase-local-client.cjs');
const core=import('../web/firebase-planner-core.mjs');
const answer={revision:0,action:'ask_user',path:'',artifactId:'',evidenceIds:[],objective:'',reasonEvidenceIds:[]};
const state={revision:0,evidence:[],events:[]};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function setup(){
 const env={isSecureContext:true,document:{},navigator:{userActivation:{isActive:true}}};env.window=env;
 env.LanguageModel={async availability(){return'available';},async create(){}};
 let raw;const apps=[],calls={initialize:0,deleted:0,generate:0};
 const sdk={SDK_VERSION:'13.3.0',InferenceMode:{ONLY_ON_DEVICE:'only_on_device'},InferenceSource:{ON_DEVICE:'on_device'},
  initializeApp(_config,name){calls.initialize++;const app={name};apps.push(app);return app;},getApps(){return apps;},
  async deleteApp(app){calls.deleted++;apps.splice(apps.indexOf(app),1);},
  initializeAppCheck(){},ReCaptchaEnterpriseProvider:class{},GoogleAIBackend:class{},
  getAI(){return{chromeAdapterFactory(){}};},
  getGenerativeModel(_ai,params){
   raw={chromeAdapter:{mode:params.mode,languageModelProvider:env.LanguageModel,async createSession(){throw Error('authored race control does not create sessions');}},async initializeDeviceModel(){},
    async generateContent(){calls.generate++;return{response:{inferenceSource:'on_device',text:()=>JSON.stringify(answer)}};}};
   return raw;
  }};
 const {createFirebasePlannerCore}=await core;
 const adapter=createFirebasePlannerCore({sdk,localClientModule,environment:env,config:{
  firebase:{apiKey:'authored-public-key',projectId:'authored-project',appId:'authored-app'},appCheckSiteKey:'authored-public-site',appName:'authored-race-app'}});
 assert.equal((await adapter.prepareFromUserGesture()).status,'prepared');
 return{adapter,env,calls,get raw(){return raw;}};
}
test('Firebase review: dispose then deferred availability rejection resolves discarded without null dereference',async()=>{
 const f=await setup(),entered=deferred(),late=deferred();
 f.env.LanguageModel.availability=()=>{entered.resolve();return late.promise;};
 const pending=f.adapter.decide(state);await entered.promise;await f.adapter.dispose();
 late.reject(Error('PRIVATE_LATE_AVAILABILITY_ERROR'));
 assert.deepEqual(await pending,{status:'discarded'});
 assert.equal(f.calls.generate,0);assert.equal(f.calls.deleted,1);
 assert.equal(f.adapter.state.disposed,true);assert.equal(f.adapter.state.prepared,false);assert.equal(f.adapter.state.sdkInitialized,false);
});
test('Firebase review: dispose then deferred generation rejection resolves discarded with no raw error',async()=>{
 const f=await setup(),entered=deferred(),late=deferred();
 f.raw.generateContent=()=>{entered.resolve();return late.promise;};
 const pending=f.adapter.decide(state);await entered.promise;await f.adapter.dispose();
 late.reject(Error('PRIVATE_LATE_GENERATION_ERROR'));
 const result=await pending;assert.deepEqual(result,{status:'discarded'});
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(f.calls.deleted,1);
 assert.equal(f.adapter.state.disposed,true);assert.equal(f.adapter.state.prepared,false);
});
test('Firebase review: dispose also discards late successful generation without state revival',async()=>{
 const f=await setup(),entered=deferred(),late=deferred();
 f.raw.generateContent=()=>{entered.resolve();return late.promise;};
 const pending=f.adapter.decide(state);await entered.promise;await f.adapter.dispose();
 late.resolve({response:{inferenceSource:'on_device',text:()=>JSON.stringify(answer)}});
 assert.deepEqual(await pending,{status:'discarded'});
 assert.equal(f.adapter.state.disposed,true);assert.equal(f.adapter.state.sdkInitialized,false);assert.equal(f.adapter.state.prepared,false);
});
test('Firebase review: stop and reprepare preserve new client lifetime when old generation rejects',async()=>{
 const f=await setup(),entered=deferred(),late=deferred();
 f.raw.generateContent=()=>{entered.resolve();return late.promise;};
 const pending=f.adapter.decide(state);await entered.promise;f.adapter.stop();
 assert.equal((await f.adapter.prepareFromUserGesture()).status,'prepared');
 late.reject(Error('PRIVATE_OLD_LIFETIME_ERROR'));
 assert.deepEqual(await pending,{status:'discarded'});assert.equal(f.adapter.state.prepared,true);
 assert.equal((await f.adapter.decide(state)).status,'decision');
 assert.equal(f.calls.initialize,1);await f.adapter.dispose();assert.equal(f.calls.deleted,1);
});

test('Firebase review: rejected output carries a bounded category instead of raw response or provider data',async()=>{
 for(const [text,diagnostic]of [['PRIVATE NOT JSON','output-json'],['{}','output-fields'],
  [JSON.stringify({...answer,revision:9}),'output-revision'],[JSON.stringify({...answer,reasonEvidenceIds:['PRIVATE_UNKNOWN_ID']}),'output-citations']]){
  const f=await setup();f.raw.generateContent=async()=>({response:{inferenceSource:'on_device',text:()=>text}});
  const result=await f.adapter.decide(state);assert.equal(result.diagnostic,diagnostic);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);await f.adapter.dispose();
 }
 const f=await setup();f.raw.generateContent=async()=>{throw Error('PRIVATE_PROVIDER_DETAILS');};
 const result=await f.adapter.decide(state);assert.equal(result.diagnostic,'generation-failed');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);await f.adapter.dispose();
});
