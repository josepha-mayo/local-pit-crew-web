'use strict';
// Authored SDK responses only. No cloud/native inference, App Check or network.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const contracts=require('../runner/function-contract.cjs'),core=import('../web/firebase-function-draft-core.mjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const config={firebase:{apiKey:'PUBLIC_TEST_KEY',projectId:'test-project',appId:'test-app'},appCheckSiteKey:'PUBLIC_TEST_SITE',appName:'test-draft'};
const corrected="module.exports={clamp(value,min,max){if(typeof value!=='number'||!Number.isFinite(value))return null;return Math.max(min,Math.min(max,value));}};";
function snapshot(){
 const task=contracts.createFunctionTask({schema:contracts.TASK_SCHEMA,title:'Clamp a value',instructions:'Clamp a finite number between the bounds. Return null for non-number input and preserve input arguments.',exportName:'clamp',source:'module.exports={clamp:(value,min,max)=>Math.max(min,Math.min(max,value||min))};',cases:[{label:'zero',args:[0,-10,10],expected:0},{label:'numeric text',args:['5',0,10],expected:null}]});
 return{revision:7,closed:false,pending:null,originalTask:task.prompt,sessionToken:'PRIVATE_TOKEN',
  manifest:Object.entries(task.files).map(([path,content])=>({path,sha256:hash(content)})),
  evidence:Object.entries(task.files).map(([path,content],i)=>({id:'read-'+i,path,content,sha256:hash(content),private:'PRIVATE_READ_FIELD'})),
  publicChecks:[{id:'case-01',ok:false},{id:'case-02',ok:false}],
  failedFunctionExamples:[{id:'case-01',status:'returned',args:'[0,-10,10]',expected:'0',actual:'-10',inputPreserved:true,argumentsAfter:null}]};
}
function fake(){
 const calls={init:0,appCheck:0,models:[],prompts:[],deleted:[]},apps=[];
 const env={isSecureContext:true,document:{},navigator:{userActivation:{isActive:true}}};env.window=env;
 let result=()=>Promise.resolve({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({abstain:false,source:corrected,explanation:'Preserve zero and reject non-number input before clamping.'})}});
 const sdk={SDK_VERSION:'13.3.0',InferenceMode:{ONLY_IN_CLOUD:'only_in_cloud'},InferenceSource:{IN_CLOUD:'in_cloud'},getApps:()=>apps,
  initializeApp(options,name){calls.init++;const app={name};apps.push(app);return app;},async deleteApp(app){calls.deleted.push(app);apps.splice(apps.indexOf(app),1);},
  initializeAppCheck(app,options){calls.appCheck++;assert.equal(options.isTokenAutoRefreshEnabled,false);return {app};},
  async getToken(){return {token:'AUTHORED_TEST_TOKEN'};},ReCaptchaEnterpriseProvider:class{},GoogleAIBackend:class{},getAI:()=>({}),
  getGenerativeModel(ai,params,options){
   calls.models.push({params,options});return{chromeAdapter:{mode:'only_in_cloud'},generateContent(prompt,options){calls.prompts.push({prompt,options});return result();}};
  }};
 return{sdk,env,calls,apps,set result(value){result=value;}};
}
async function drafter(f){return(await core).createFirebaseFunctionDrafterCore({sdk:f.sdk,config,environment:f.env});}
test('cloud function preview verifies exact current source and fixed contract without SDK work or private control data',async()=>{
 const f=fake(),r=await drafter(f),s=snapshot(),preview=r.preview(s);
 assert.equal(f.calls.init,0);assert.equal(f.calls.prompts.length,0);assert.ok(Object.isFrozen(preview));assert.equal(preview.revision,7);
 assert.equal(preview.prompt.includes('PRIVATE_'),false);const data=JSON.parse(preview.prompt.split('\nFUNCTION_REPAIR_JSON:\n')[1]);
 assert.equal(data.source.content,s.evidence[0].content);assert.equal(data.contract.cases[1].expected,null);assert.equal(data.failedFunctionExamples[0].actual,'-10');
 assert.equal(Object.hasOwn(data,'sessionToken'),false);assert.match(preview.prompt,/Do not claim the proposal was executed or verified/);
 s.evidence[0].content='MUTATED_AFTER_PREVIEW';s.revision=99;
 const result=await r.send(preview);assert.equal(result.status,'draft');assert.equal(result.revision,7);assert.equal(result.source,corrected);
 assert.equal(result.generation.beforeSourceSha256,data.source.sha256);assert.equal(result.generation.sourceSha256,hash(corrected));
 assert.equal(f.calls.prompts[0].prompt,preview.prompt);const {params,options}=f.calls.models[0];
 assert.equal(params.mode,'only_in_cloud');assert.equal(params.inCloudParams.generationConfig.maxOutputTokens,2048);assert.equal(options.timeout,60000);
 assert.equal(r.state.calls,1);await r.dispose();
});
test('invalid function contexts revoke old approval before any SDK initialization',async()=>{
 for(const mutate of [s=>s.closed=true,s=>s.evidence.pop(),s=>s.evidence[0].sha256='a'.repeat(64),s=>s.evidence[0].content+=' ',
  s=>s.publicChecks[0].id='invented',s=>s.publicChecks.forEach(c=>c.ok=true),s=>s.failedFunctionExamples[0].expected='1',
  s=>s.manifest.push({...s.manifest[0]})]){
  const f=fake(),r=await drafter(f),previous=r.preview(snapshot()),invalid=snapshot();mutate(invalid);assert.throws(()=>r.preview(invalid));
  assert.equal((await r.send(previous)).status,'blocked');assert.equal(f.calls.init,0);assert.equal(r.state.calls,0);await r.dispose();
 }
 const f=fake(),r=await drafter(f),preview=r.preview(snapshot());
 assert.equal((await r.send({...preview})).status,'blocked');f.env.navigator.userActivation.isActive=false;
 assert.equal((await r.send(preview)).status,'blocked');assert.equal(f.calls.init,0);await r.dispose();
});
test('draft output cannot supply bindings, change the contract, exceed limits or claim a contradictory abstention',async()=>{
 for(const answer of [{abstain:false,source:corrected,explanation:'why',revision:7},
  {abstain:false,source:corrected,explanation:'why',contract:{}},{abstain:'false',source:corrected,explanation:'why'},
  {abstain:false,source:'',explanation:'why'},{abstain:false,source:'é'.repeat(3001),explanation:'why'},
  {abstain:true,source:corrected,explanation:'why'},{abstain:false,source:corrected,explanation:'é'.repeat(601)},
  {abstain:false,source:snapshot().evidence[0].content,explanation:'unchanged'}]){
  const f=fake(),r=await drafter(f);f.result=async()=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify(answer)}});
  assert.equal((await r.send(r.preview(snapshot()))).status,'blocked');assert.equal(r.state.calls,1);await r.dispose();
 }
 const f=fake(),r=await drafter(f);f.result=async()=>({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({abstain:true,source:'',explanation:'More evidence is needed.'})}});
 const result=await r.send(r.preview(snapshot()));assert.equal(result.status,'needs-evidence');assert.equal(Object.hasOwn(result,'source'),false);await r.dispose();
});
test('stopped draft requests discard late model output, and colliding apps are never owned or deleted',async()=>{
 const f=fake(),r=await drafter(f);let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 f.result=()=>new Promise(resolve=>{release=resolve;entered();});const pending=r.send(r.preview(snapshot()));await started;r.stop();assert.equal((await pending).status,'discarded');
 release({response:{inferenceSource:'in_cloud',text:()=>JSON.stringify({abstain:false,source:corrected,explanation:'late'})}});await Promise.resolve();
 assert.equal(r.state.busy,false);assert.equal(r.state.calls,1);await r.dispose();
 const collision=fake(),other={name:'test-draft-cloud-function-draft'};collision.apps.push(other);const blocked=await drafter(collision);
 assert.equal((await blocked.send(blocked.preview(snapshot()))).status,'blocked');assert.equal(blocked.state.calls,0);await blocked.dispose();assert.deepEqual(collision.calls.deleted,[]);
});
