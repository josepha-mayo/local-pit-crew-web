'use strict';
// Authored SDK/native-session lifecycle controls. No browser, model, SDK import or network.
const test=require('node:test'),assert=require('node:assert/strict');
const localClientModule=require('../src/firebase-local-client.cjs');
const core=import('../web/firebase-planner-core.mjs');
const answer={revision:0,action:'ask_user',path:'',artifactId:'',evidenceIds:[],objective:'',reasonEvidenceIds:[]},snapshot={revision:0,evidence:[],events:[]};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
async function setup({initializeSession=false}={}){
 const sessions=[],models=[],apps=[];let pendingCreate=null,pendingPrompt=null;
 const env={isSecureContext:true,document:{},navigator:{userActivation:{isActive:true}}};env.window=env;
 env.LanguageModel={async availability(){return'available';},async create(){
  const gate=pendingCreate;pendingCreate=null;if(gate){gate.entered.resolve();await gate.release.promise;}
  const session={destroyed:0,prompts:0,destroy(){if(this.destroyed)throw Error('authored-double-destroy');this.destroyed++;},
   async prompt(){assert.equal(this.destroyed,0);this.prompts++;const gate=pendingPrompt;pendingPrompt=null;if(gate){gate.entered.resolve();await gate.release.promise;}return JSON.stringify(answer);}};
  sessions.push(session);return session;
 }};
 const sdk={SDK_VERSION:'13.3.0',InferenceMode:{ONLY_ON_DEVICE:'only_on_device'},InferenceSource:{ON_DEVICE:'on_device'},
  getApps:()=>apps,initializeApp(_options,name){const app={name};apps.push(app);return app;},async deleteApp(app){apps.splice(apps.indexOf(app),1);},
  initializeAppCheck(){},ReCaptchaEnterpriseProvider:class{},GoogleAIBackend:class{},getAI(){return{chromeAdapterFactory(){}};},
  getGenerativeModel(_ai,params){
   const adapter={mode:params.mode,languageModelProvider:env.LanguageModel,oldSession:null,async createSession(){
    const session=await env.LanguageModel.create(params.onDeviceParams?.createOptions);this.oldSession?.destroy();this.oldSession=session;return session;
   }};
   const raw={chromeAdapter:adapter,async initializeDeviceModel(){if(initializeSession)await adapter.createSession();},
    async generateContent(){const session=await adapter.createSession(),text=await session.prompt();return{response:{inferenceSource:'on_device',text:()=>text}};}};
   models.push(raw);return raw;
  }};
 const {createFirebasePlannerCore}=await core,adapter=createFirebasePlannerCore({sdk,localClientModule,environment:env,config:{
  firebase:{apiKey:'authored-public',projectId:'authored-project',appId:'authored-app'},appCheckSiteKey:'authored-site',appName:'authored-session-lifecycle'}});
 return{adapter,sessions,models,sdk,env,deferCreation(){const gate={entered:deferred(),release:deferred()};pendingCreate=gate;return gate;},
  deferPrompt(){const gate={entered:deferred(),release:deferred()};pendingPrompt=gate;return gate;}};
}

test('Stop and Dispose explicitly destroy the current owned native session',async()=>{
 const f=await setup();await f.adapter.prepareFromUserGesture();await f.adapter.decide(snapshot);
 assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].destroyed,0);
 f.adapter.stop();assert.equal(f.sessions[0].destroyed,1);f.adapter.stop();assert.equal(f.sessions[0].destroyed,1);
 await f.adapter.prepareFromUserGesture();await f.adapter.decide(snapshot);assert.equal(f.sessions.length,2);
 await f.adapter.dispose();assert.equal(f.sessions[1].destroyed,1);await f.adapter.dispose();assert.equal(f.sessions[1].destroyed,1);
});

test('a normal SDK session replacement is not destroyed twice and another model stays open',async()=>{
 const f=await setup(),other=f.sdk.getGenerativeModel({}, {mode:'only_on_device',onDeviceParams:{}});
 const otherSession=await other.chromeAdapter.createSession();await f.adapter.prepareFromUserGesture();
 await f.adapter.decide(snapshot);await f.adapter.decide(snapshot);
 assert.equal(f.sessions[1].destroyed,1,'the authored SDK replaces its preceding session');assert.equal(f.sessions[2].destroyed,0);
 await f.adapter.dispose();assert.equal(f.sessions[2].destroyed,1);assert.equal(otherSession.destroyed,0);
 otherSession.destroy();
});

test('Dispose destroys an abort-ignoring late session before the SDK can prompt it',async()=>{
 // Cancellation now releases the caller first; observe the delegate's later cleanup separately.
 const f=await setup();await f.adapter.prepareFromUserGesture();const gate=f.deferCreation();
 const pending=f.adapter.decide(snapshot);await gate.entered.promise;await f.adapter.dispose();gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await pending).status,'discarded');assert.equal(f.sessions.length,1);
 assert.equal(f.sessions[0].destroyed,1);assert.equal(f.sessions[0].prompts,0);assert.equal(f.adapter.state.prepared,false);
});

test('Dispose during initialization releases a late session without reviving model readiness',async()=>{
 const f=await setup({initializeSession:true}),gate=f.deferCreation(),pending=f.adapter.prepareFromUserGesture();
 await gate.entered.promise;await f.adapter.dispose();gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await pending).status,'discarded');assert.equal(f.sessions.length,1);
 assert.equal(f.sessions[0].destroyed,1);assert.equal(f.sessions[0].prompts,0);assert.equal(f.adapter.state.prepared,false);
});

test('Dispose during replacement releases both the prior session and an abort-ignoring successor once',async()=>{
 const f=await setup();await f.adapter.prepareFromUserGesture();await f.adapter.decide(snapshot);
 const gate=f.deferCreation(),pending=f.adapter.decide(snapshot);await gate.entered.promise;
 await f.adapter.dispose();assert.equal(f.sessions[0].destroyed,1);gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await pending).status,'discarded');assert.equal(f.sessions.length,2);
 assert.equal(f.sessions[0].destroyed,1);assert.equal(f.sessions[1].destroyed,1);assert.equal(f.sessions[1].prompts,0);
});

test('Native preparation deadline releases a stuck availability wait before all SDK initialization',{timeout:1000},async t=>{
 const f=await setup(),entered=deferred(),late=deferred();t.after(()=>f.adapter.dispose());
 f.env.LanguageModel.availability=()=>{entered.resolve();return late.promise;};t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.adapter.prepareFromUserGesture();await entered.promise;t.mock.timers.tick(90000);
 assert.deepEqual(await pending,{status:'blocked',reason:'native-operation-timeout',diagnostic:'operation-timeout'});
 assert.equal(f.adapter.state.busy,false);assert.equal(f.adapter.state.prepared,false);assert.equal(f.adapter.state.sdkInitialized,false);assert.equal(f.models.length,0);
 f.env.LanguageModel.availability=async()=> 'available';assert.equal((await f.adapter.prepareFromUserGesture()).status,'prepared');
 late.resolve('available');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.adapter.state.prepared,true);assert.equal(f.models.length,1);
});

test('Native initialization timeout destroys an abort-ignoring late session before any prompt',{timeout:1000},async t=>{
 const f=await setup({initializeSession:true}),gate=f.deferCreation();t.after(()=>f.adapter.dispose());t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.adapter.prepareFromUserGesture();await gate.entered.promise;t.mock.timers.tick(90000);
 assert.equal((await pending).diagnostic,'operation-timeout');assert.equal(f.adapter.state.busy,false);
 gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].destroyed,1);assert.equal(f.sessions[0].prompts,0);
 assert.equal((await f.adapter.prepareFromUserGesture()).status,'prepared');assert.equal(f.adapter.state.prepared,true);assert.equal(f.sessions[1].destroyed,0);
});

test('Native inference deadline closes its owned session and a late reply cannot revive it',{timeout:1000},async t=>{
 const f=await setup();t.after(()=>f.adapter.dispose());t.mock.timers.enable({apis:['setTimeout']});await f.adapter.prepareFromUserGesture();
 const gate=f.deferPrompt(),pending=f.adapter.decide(snapshot);await gate.entered.promise;t.mock.timers.tick(90000);
 assert.deepEqual(await pending,{status:'blocked',reason:'native-operation-timeout',diagnostic:'operation-timeout'});
 assert.equal(f.sessions[0].destroyed,1);assert.equal(f.adapter.state.busy,false);assert.equal(f.adapter.state.prepared,false);
 assert.equal((await f.adapter.prepareFromUserGesture()).status,'prepared');assert.equal((await f.adapter.decide(snapshot)).status,'decision');
 gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.adapter.state.prepared,true);assert.equal(f.sessions[1].destroyed,0);assert.equal(f.adapter.state.calls,2);
});

test('Stop releases Native preparation immediately and its old finally cannot unlock a replacement',{timeout:1000},async t=>{
 const f=await setup(),entered=deferred(),old=deferred();t.after(()=>f.adapter.dispose());t.mock.timers.enable({apis:['setTimeout']});
 f.env.LanguageModel.availability=()=>{entered.resolve();return old.promise;};const first=f.adapter.prepareFromUserGesture();await entered.promise;
 f.adapter.stop();assert.deepEqual(await first,{status:'discarded'});assert.equal(f.adapter.state.busy,false);
 const newer=deferred();f.env.LanguageModel.availability=()=>newer.promise;const second=f.adapter.prepareFromUserGesture();assert.equal(f.adapter.state.busy,true);
 old.resolve('available');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.adapter.state.busy,true);assert.equal(f.models.length,0);
 newer.resolve('available');assert.equal((await second).status,'prepared');assert.equal(f.adapter.state.busy,false);assert.equal(f.models.length,1);
});
