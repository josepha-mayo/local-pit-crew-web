'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseArguments,parseVerifiedConfig}=require('../ui/verified-workbench.cjs');
const {prepareCoderWorkbench}=require('../ui/coder-workbench.cjs');
const {createWorkbenchApp}=require('../ui/workbench-bridge.cjs');
const {buildProofRecord,viewModel}=require('../ui/public/app.js');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const launch=args=>new Promise(resolve=>execFile(process.execPath,[path.resolve(__dirname,'../ui/verified-workbench.cjs'),...args],
 {timeout:5000,windowsHide:true,encoding:'utf8'},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
function configFile(t,content){const filename=path.join(os.tmpdir(),'pitcrew-launch-'+crypto.randomUUID()+'.json');
 fs.writeFileSync(filename,content,{flag:'wx'});t.after(()=>fs.unlinkSync(filename));return filename;}

test('verified CLI help succeeds without configuration, model setup or verifier qualification',async()=>{
 const result=await launch(['--help']);assert.equal(result.code,0);assert.equal(result.stderr,'');
 assert.match(result.stdout,/--coder-only/);assert.match(result.stdout,/--wsl-distro/);
 assert.doesNotMatch(result.stdout,/Checking the configured|Building and qualifying/);
});

test('verified CLI distinguishes option and configuration failures without echoing private inputs',async t=>{
 const secret='authored-private-value-'+crypto.randomUUID(),filename=configFile(t,'{"private":"'+secret+'", broken JSON');
 const options=await launch(['--'+secret]);assert.equal(options.code,1);assert.match(options.stderr,/failed at options\./);assert.match(options.stderr,/--help/);
 const config=await launch(['--config',filename,'--docker-socket','/unused/socket','--coder-only']);
 assert.equal(config.code,1);assert.match(config.stderr,/failed at config\./);assert.match(config.stderr,/Ollama-only file needs --coder-only/);
 for(const result of [options,config]){assert.doesNotMatch(result.stdout+result.stderr,new RegExp(secret));assert.ok(!result.stderr.includes(filename));assert.doesNotMatch(result.stderr,/SyntaxError|at Object\./);}
});

test('verified CLI explains an engine rejection and does not leak its response or proceed to Docker',async t=>{
 const secret='authored-private-engine-'+crypto.randomUUID(),calls=[];
 const server=http.createServer((req,res)=>{calls.push(req.url);res.writeHead(503,{'Content-Type':'text/plain'});res.end(secret);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const filename=configFile(t,JSON.stringify({ollama:{model:secret,endpoint:'http://127.0.0.1:'+server.address().port,requestTimeoutMs:1000}}));
 const result=await launch(['--config',filename,'--docker-socket','/unused/socket','--coder-only']);
 assert.equal(result.code,1);assert.match(result.stderr,/failed at coder\./);assert.match(result.stderr,/cloud disabled/);
 assert.deepEqual(calls,['/api/version']);assert.doesNotMatch(result.stdout+result.stderr,new RegExp(secret));assert.doesNotMatch(result.stdout,/Building and qualifying/);
});

test('verified CLI distinguishes verifier setup failure after metadata-only engine preflight',async t=>{
 const model='authored-coder:7b',calls=[],replies={
  '/api/version':{version:'0.40.16'},'/api/status':{cloud:{disabled:true,source:'authored-test'}},
  '/api/tags':{models:[{name:model,model,digest:'a'.repeat(64),size:100,details:{format:'gguf',quantization_level:'Q4_K_M'}}]},
  '/api/show':{details:{format:'gguf',quantization_level:'Q4_K_M'},capabilities:['completion'],template_source:'go_template',template:'authored-template',system:'',parameters:'',messages:[]}
 };
 const server=http.createServer((req,res)=>{calls.push(req.url);req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(replies[req.url]??{}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const filename=configFile(t,JSON.stringify({ollama:{model,endpoint:'http://127.0.0.1:'+server.address().port}}));
 const result=await launch(['--config',filename,'--docker-socket','relative-not-a-socket','--coder-only']);
 assert.equal(result.code,1);assert.match(result.stderr,/failed at verifier\./);assert.match(result.stderr,/Linux Docker socket/);assert.match(result.stderr,/--wsl-distro/);
 assert.deepEqual(calls,['/api/version','/api/status','/api/tags','/api/show']);assert.doesNotMatch(result.stdout,/Pagination and settings-isolation public checks: runtime-qualified/);
});

test('an Ollama-only config requires explicit coder-only mode; full Firebase configs retain both modes',()=>{
 const minimal={ollama:{model:'authored-coder:7b',responseMode:'file-contents'}};
 assert.deepEqual(parseVerifiedConfig(JSON.stringify(minimal),{coderOnly:true}),minimal);
 assert.throws(()=>parseVerifiedConfig(JSON.stringify(minimal)));
 const full={...minimal,firebaseConfig:{firebase:{apiKey:'public-example',projectId:'example',appId:'public-app'},appCheckSiteKey:'public-site',appName:'test'},contentSecurityPolicy:"default-src 'self'"};
 for(const coderOnly of [false,true])assert.deepEqual(parseVerifiedConfig(JSON.stringify(full),{coderOnly}),full);
 for(const value of [{...minimal,publicVerifier:true},{...minimal,skipQualification:true},{ollama:{...minimal.ollama,requestJSON:'callback'}},
  {ollama:{...minimal.ollama,providerTimeoutMs:120001}},[],null])assert.throws(()=>parseVerifiedConfig(JSON.stringify(value),{coderOnly:true}));
 assert.throws(()=>parseVerifiedConfig(' '.repeat(20001),{coderOnly:true}));
});

test('minimal preparation uses only authored engine metadata and cannot admit Verify or initialize Firebase',async()=>{
 const model='authored-coder:7b',digest='a'.repeat(64),calls=[];
 const replies={
  '/api/version':{version:'0.40.16'},'/api/status':{cloud:{disabled:true,source:'authored-test'}},
  '/api/tags':{models:[{name:model,model,digest,size:100,details:{format:'gguf',quantization_level:'Q4_K_M'}}]},
  '/api/show':{details:{format:'gguf',quantization_level:'Q4_K_M'},capabilities:['completion'],template_source:'go_template',template:'authored-template',system:'',parameters:'',messages:[]}
 };
 const prepared=await prepareCoderWorkbench({config:{ollama:{model,responseMode:'file-contents'}},requestJSON:async request=>{
  calls.push(request.pathname);assert.ok(Object.hasOwn(replies,request.pathname),'no inference, pull, Firebase or cloud route');return structuredClone(replies[request.pathname]);
 }});
 try{
  assert.deepEqual(calls,['/api/version','/api/status','/api/tags','/api/show']);
  assert.equal(prepared.live.providerTimeoutMs,120000);assert.equal(Object.hasOwn(prepared.live,'firebaseConfig'),false);
  const app=await createWorkbenchApp({origin:'http://127.0.0.1:48118',live:prepared.live});
  const boot=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:{host:'127.0.0.1:48118'}});
  assert.equal(boot.body.capabilities.live.available,true);assert.equal(boot.body.capabilities.live.canVerify,false);
  assert.equal(boot.body.capabilities.planner.available,false);
 }finally{prepared.coder.stop();}
});

test('minimal preparation keeps the total preflight deadline even if an authored transport ignores abort',async()=>{
 await assert.rejects(prepareCoderWorkbench({config:{ollama:{model:'authored-coder:7b',providerTimeoutMs:5}},requestJSON:()=>new Promise(()=>{})}),/coder-preflight-deadline/);
});

test('minimal preparation rejects remote endpoints before contacting a daemon',async()=>{
 let calls=0;
 await assert.rejects(prepareCoderWorkbench({config:{ollama:{model:'authored-coder:7b',endpoint:'https://example.com'}},requestJSON:async()=>{calls++;}}));
 assert.equal(calls,0);
});
test('verified launcher requires an explicit socket/config and exposes no caller qualification bypass',()=>{
 for(const args of [[],['--config','example.json'],['--docker-socket','/var/run/docker.sock'],
  ['--config','example.json','--docker-socket','/var/run/docker.sock','--image','sha256:'+'a'.repeat(64)],
  ['--config','example.json','--docker-socket','/var/run/docker.sock','--skip-qualification'],
  ['--config','example.json','--docker-socket','/var/run/docker.sock','--coder-only','--coder-only']])assert.throws(()=>parseArguments(args));
 const result=parseArguments(['--config','example.json','--docker-socket','/var/run/docker.sock','--port','59514','--app-check-debug']);
 assert.equal(result.developmentAppCheck,true);assert.equal(result['--port'],'59514');
 assert.equal(result.coderOnly,undefined);
 assert.equal(parseArguments(['--config','example.json','--docker-socket','/var/run/docker.sock','--coder-only']).coderOnly,true);
 assert.throws(()=>parseArguments(['--config','example.json','--coder-only']));
 assert.equal(parseArguments(['--manual','--docker-socket','/var/run/docker.sock']).manual,true);
 for(const flags of [['--manual'],['--manual','--coder-only','--docker-socket','/var/run/docker.sock'],['--manual','--manual','--docker-socket','/var/run/docker.sock'],['--manual','--app-check-debug','--docker-socket','/var/run/docker.sock']])assert.throws(()=>parseArguments(flags));
});
test('qualified runner UI/export keeps subsystem qualification separate from model and held-out claims',()=>{
 const state={mode:'configured-local-unverified',task:{id:'pagination-zero'},canVerify:true,
  verification:{admissionKind:'qualified-docker-quickjs-repair-v2',qualified:true,runnerImageId:'sha256:'+'a'.repeat(64),qualifiedAt:'2026-11-16T00:00:00.000Z'},
  snapshot:{revision:1,closed:false,publicChecksCurrent:false,manifest:[],counts:{}},checks:[]};
 assert.equal(viewModel(state).isolated,true);assert.equal(viewModel({...state,verification:{...state.verification,qualified:false}}).isolated,false);
 const record=buildProofRecord(state);assert.equal(record.publicVerifier.qualified,true);assert.equal(record.publicVerifier.runnerImageId,state.verification.runnerImageId);
 assert.equal(record.runtimeVerified,false);assert.equal(record.heldOutCorrectness,false);assert.equal(record.nanoIdentityVerified,false);assert.equal(record.publicVerifier.benchmarkEligible,false);
});
