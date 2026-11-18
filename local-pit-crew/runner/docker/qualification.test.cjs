'use strict';
// Opt-in integration qualification. It needs a real, trusted local Linux Docker
// socket and the image built from this runner's Dockerfile. No mocked engine.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createDockerProbe}=require('./probe.cjs');
const {ADAPTER,CHECK_IDS,CONFIG_CHECK_IDS}=require('../policy.cjs');
const {FUNCTION_SUITE,FUNCTION_ENTRY,TASK_SCHEMA,createFunctionTask}=require('../function-contract.cjs');
const {getTasks}=require('../../test/fixtures.cjs');
const socket=process.env.PITCREW_DOCKER_SOCKET,image=process.env.PITCREW_DOCKER_IMAGE;
const task=getTasks().find(t=>t.id==='pagination-zero');
const input=source=>({suiteId:task.id,files:{'src/list.js':source,'src/adapter.js':ADAPTER}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function api(url){
 return new Promise((resolve,reject)=>{
  let bytes=0,chunks=[];
  const req=http.get({socketPath:socket,path:'/v1.47'+url,agent:false},res=>{
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>256000)req.destroy(Error('qualification-protocol-limit'));else chunks.push(chunk);});
   res.once('error',reject);res.once('end',()=>{
    clearTimeout(timer);
    try{resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}
   });
  });
  const timer=setTimeout(()=>req.destroy(Error('qualification-api-timeout')),3000);
  req.once('error',error=>{clearTimeout(timer);reject(error);});
 });
}
const filters=encodeURIComponent(JSON.stringify({label:['io.localpitcrew.policy=experimental-docker-quickjs-v1']}));
async function jobs(){
 const result=await api('/containers/json?all=1&filters='+filters);assert.equal(result.status,200);
 return result.value.filter(c=>c.ImageID===image);
}
async function stoppedChild(before){
 const deadline=Date.now()+40000;
 do{
  const fresh=(await jobs()).filter(c=>!before.has(c.Id));
  assert.ok(fresh.length<=1,'qualification must not overlap another owned run');
  if(fresh[0]?.State==='running'){
   const top=await api('/containers/'+fresh[0].Id+'/top?ps_args=-eo%20pid,ppid,stat,comm');
   if(top.status===200){
    const column=top.value.Titles.findIndex(x=>x==='STAT');
    if(column>=0&&top.value.Processes.some(row=>/^T/.test(row[column])))return fresh[0].Id;
   }
  }
  await sleep(25);
 }while(Date.now()<deadline);
 throw Error('stopped native child was not observed');
}
async function gone(id){
 const deadline=Date.now()+18000;
 do{
  try{
   const observed=await api('/containers/'+id+'/json');
   if(Date.now()>=deadline)return false;
   if(observed.status===404)return true;
  }catch(error){
   // Removal can temporarily hold the engine's inspect lock. A query timeout
   // is an unknown observation, not proof of a surviving or removed container.
   // Reobserve only within the unchanged cleanup deadline; require actual 404.
   if(error.message!=='qualification-api-timeout')throw error;
  }
  await sleep(50);
 }while(Date.now()<deadline);
 return false;
}
function clean(result,status){
 assert.equal(result.cleanupConfirmed,true,JSON.stringify(result));
 assert.equal(result.status,status,JSON.stringify(result));
 assert.equal(result.productionAdmitted,false);assert.equal(result.benchmarkEligible,false);
}
function delayedStartObservation(){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[__filename,'--slow-start-child'],{stdio:['ignore','pipe','pipe'],env:process.env});
  let bytes=0,chunks=[];
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>128000)child.kill('SIGKILL');else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>128000)child.kill('SIGKILL');});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{
   clearTimeout(timer);
   try{assert.equal(code,0,'delayed-start observer must finish normally');resolve(JSON.parse(Buffer.concat(chunks)));}catch(error){reject(error);}
  });
 });
}

if(process.argv[2]==='--death-child'){
 const probe=createDockerProbe({socket,image});
 probe.runQualification('stop-child').then(()=>{process.exitCode=2;}).catch(()=>{process.exitCode=3;});
}else if(process.argv[2]==='--slow-start-child'){
 // Fault injection stays in this fixed test child. It delays only delivery of
 // the real engine's start response; no fake engine or admission is supplied.
 // Using the real socket also supports ordinary Docker-group users.
 const direct=http.request;
 http.request=function(options,callback){
  if(options.method==='POST'&&/\/start$/.test(options.path))return direct.call(http,options,response=>{
   response.pause();setTimeout(()=>{callback(response);response.resume();},6500);
  });
  return direct.apply(http,arguments);
 };
 const config=getTasks().find(t=>t.id==='config-isolation');
 createDockerProbe({socket,image}).runCandidate({suiteId:config.id,files:{...config.files,...config.correction}})
  .then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.exitCode=1;});
}else{
 // Include the additional delayed-response child on slower WSL hosts. This
 // suite budget does not change any per-job watchdog, CPU or memory limit.
 test('real Docker boundary and lifecycle qualification',{timeout:330000},async t=>{
  assert.equal(process.platform,'linux','run in Linux/WSL with a real local Docker engine');
  const probe=createDockerProbe({socket,image});
  const info=await api('/info');assert.equal(info.status,200);
  t.diagnostic(JSON.stringify({engine:info.value.ServerVersion,kernel:info.value.KernelVersion,driver:info.value.Driver,image}));

  await t.test('actual kernel policy and privilege separation',async()=>{
   const result=await probe.runQualification('limits');clean(result,'qualified-observation');
   assert.equal(result.facts.memoryMax,'201326592');assert.equal(result.facts.swapMax,'0');
   assert.equal(result.facts.pidsMax,'32');assert.equal(result.facts.cpuMax,'100000 100000');
   assert.equal(result.facts.uid,10001);assert.equal(result.facts.noNewPrivileges,'1');assert.equal(result.facts.seccomp,'2');
   assert.match(result.facts.capabilities,/^0+$/);assert.deepEqual(result.facts.interfaces,['lo']);
   const signal=await probe.runQualification('parent-signal');clean(signal,'qualified-observation');
   assert.equal(signal.facts.parentKillRejected,true);
   const write=await probe.runQualification('root-write');clean(write,'qualified-observation');assert.equal(write.facts.rootWriteRejected,true);
  });

  await t.test('real candidate baseline and correction retain typed semantics',async()=>{
   const baseline=await probe.runCandidate(input(task.files['src/list.js']));clean(baseline,'observed');
   assert.deepEqual(baseline.checks.filter(c=>!c.ok).map(c=>c.id),CHECK_IDS.slice(0,2));
   const fixed=await probe.runCandidate(input(task.correction['src/list.js']));clean(fixed,'observed');assert.ok(fixed.checks.every(c=>c.ok));
   assert.equal(fixed.observations[0].value.type,'number');assert.equal(fixed.observations[1].value.type,'string');
   const nulForgery=await probe.runCandidate(input(String.raw`module.exports={list(cursor,limit=20){return cursor==null?{limit}:{cursor:cursor===''?'\0tail':cursor,limit};}};`));
   clean(nulForgery,'observed');assert.equal(nulForgery.checks.find(c=>c.id==='empty-preserved').ok,false);
   assert.equal(nulForgery.observations[1].value.value,'\0tail');
  });

  await t.test('settings isolation observes actual cross-call state in the same confined runtime',async()=>{
   const config=getTasks().find(t=>t.id==='config-isolation');
   const baseline=await probe.runCandidate({suiteId:config.id,files:config.files});clean(baseline,'observed');
   assert.deepEqual(baseline.checks.filter(c=>!c.ok).map(c=>c.id),CONFIG_CHECK_IDS.slice(0,3));
   const fixed=await probe.runCandidate({suiteId:config.id,files:{...config.files,...config.correction}});clean(fixed,'observed');
   assert.ok(fixed.checks.every(c=>c.ok));assert.equal(fixed.observations[2].value.type,'boolean');
   for(const source of ["require('node:fs');",'while(true){}','module.exports={makeConfig(){return new Proxy({},{get(){while(true){}}});}};']){
    const result=await probe.runCandidate({suiteId:config.id,files:{...config.files,'src/config.js':source}});
    assert.notEqual(result.status,'observed');assert.equal(result.cleanupConfirmed,true);assert.equal(Object.hasOwn(result,'checks'),false);
   }
  });

  await t.test('own-function JSON contracts observe return data and input mutations independently',async()=>{
   const spec={schema:TASK_SCHEMA,title:'Qualification function',instructions:'Sort without changing the input array.',exportName:'sortCopy',
    source:'module.exports={sortCopy:xs=>xs.sort()};',
    cases:[{label:'sort',args:[['b','a']],expected:['a','b']},{label:'empty',args:[[]],expected:[]}]};
   const selected=createFunctionTask(spec),request=source=>({suiteId:FUNCTION_SUITE,files:{...selected.files,[FUNCTION_ENTRY]:source}});
   const baseline=await probe.runCandidate(request(selected.files[FUNCTION_ENTRY]));clean(baseline,'observed');
   assert.deepEqual(baseline.checks,[{id:'case-01',ok:false},{id:'case-02',ok:true}]);
   const fixed=await probe.runCandidate(request('module.exports={sortCopy:xs=>[...xs].sort()};'));clean(fixed,'observed');assert.ok(fixed.checks.every(c=>c.ok));
   assert.equal(baseline.observations[0].output,'["a","b"]');assert.equal(baseline.observations[0].argsAfter,'[["a","b"]]');
  });

  await t.test('own-function observers survive poisoned intrinsics and keep expected values outside the guest',async()=>{
   const task=createFunctionTask({schema:TASK_SCHEMA,title:'Data boundary',instructions:'Return the input data.',exportName:'fn',
    source:'module.exports={fn:x=>x};',cases:[{label:'nested',args:[{text:'value',items:[0,false,null]}],expected:{items:[0,false,null],text:'value'}}]});
   const poisoned="JSON.stringify=()=>'{\"forged\":true}';JSON.parse=()=>['forged'];Object.prototype.toJSON=()=>({forged:true});Object.getOwnPropertyDescriptors=()=>({});module.exports={fn:()=>({forged:true})};";
   const rejected=await probe.runCandidate({suiteId:FUNCTION_SUITE,files:{...task.files,[FUNCTION_ENTRY]:poisoned}});clean(rejected,'observed');assert.equal(rejected.checks[0].ok,false);
   const isolation=createFunctionTask({schema:TASK_SCHEMA,title:'No host bindings',instructions:'Report unavailable host globals.',exportName:'fn',
    source:'module.exports={fn:()=>[typeof expected,typeof contract,typeof process,typeof require,typeof fetch,typeof Worker]};',
    cases:[{label:'capabilities',args:[],expected:Array(6).fill('undefined')}]});
   const result=await probe.runCandidate({suiteId:FUNCTION_SUITE,files:isolation.files});clean(result,'observed');assert.equal(result.checks[0].ok,true);
  });

  await t.test('own-function failures preserve resource and exception distinctions',async()=>{
   const task=createFunctionTask({schema:TASK_SCHEMA,title:'Failure boundary',instructions:'Return zero.',exportName:'fn',
    source:'module.exports={fn:()=>0};',cases:[{label:'zero',args:[],expected:0}]});
   const request=source=>({suiteId:FUNCTION_SUITE,files:{...task.files,[FUNCTION_ENTRY]:source}});
   const thrown=await probe.runCandidate(request("module.exports={fn:()=>{throw Error('PRIVATE-DO-NOT-EXPOSE');}};"));clean(thrown,'observed');
   assert.equal(thrown.checks[0].ok,false);assert.equal(JSON.stringify(thrown).includes('PRIVATE'),false);
   for(const source of ['while(true){};','module.exports={fn:()=>{while(true){}}};','module.exports={fn:()=>{const xs=[];while(true)xs.push(new Array(10000).fill(1));}};']){
    const result=await probe.runCandidate(request(source));assert.equal(result.cleanupConfirmed,true);assert.notEqual(result.status,'observed');assert.equal(result.checks,undefined);
   }
   const after=await probe.runCandidate(request(task.files[FUNCTION_ENTRY]));clean(after,'observed');assert.equal(after.checks[0].ok,true);
  });

  await t.test('a slow start response cannot consume the input window of an already started job',async()=>{
   const started=Date.now(),result=await delayedStartObservation();
   clean(result,'observed');assert.ok(result.checks.every(c=>c.ok));
   assert.ok(Date.now()-started>=6500,'the real start response must be delayed beyond the unchanged five-second watchdog');
  });

  await t.test('independent matrix reports only actual typed facts and never a public verdict',async()=>{
   const cases=[{id:'matrix-false',cursor:{type:'boolean',value:false},limit:null,read:'cursor'},
    {id:'matrix-negative-zero',cursor:{type:'number',value:'0',negativeZero:true},limit:null,read:'cursor'},
    {id:'matrix-nul-control',cursor:{type:'string',value:'x\0y'},limit:null,read:'cursor'},
    {id:'matrix-surrogate-control',cursor:{type:'string',value:'\udc00x'},limit:null,read:'cursor'},
    {id:'matrix-null-limit-control',cursor:{type:'string',value:'next'},limit:{type:'null'},read:'limit'}];
   const fixed=await probe.runObservationMatrix(input(task.correction['src/list.js']),cases);clean(fixed,'observed');
   assert.deepEqual(fixed.observations.map(x=>x.value),cases.map(x=>x.read==='limit'?x.limit:x.cursor));assert.equal(Object.hasOwn(fixed,'checks'),false);
   const limited=await probe.runObservationMatrix(input('while(true){}'),cases);
   assert.notEqual(limited.status,'observed');assert.equal(limited.cleanupConfirmed,true);assert.equal(Object.hasOwn(limited,'checks'),false);
  });

  await t.test('guest attacks cannot forge observations or obtain host capabilities',async()=>{
   const poison=await probe.runCandidate(input('Object.prototype.hasOwnProperty=()=>false;Function.prototype.call=()=>false;module.exports={list(cursor,limit=20){return {cursor,limit};}};'));
   clean(poison,'observed');assert.deepEqual(poison.checks.filter(c=>!c.ok).map(c=>c.id),['undefined-absent','null-absent']);
   for(const source of [
    'while(true){}',
    'module.exports={list(){return {get cursor(){while(true){}}};}};',
    'module.exports={list(){return new Proxy({},{getOwnPropertyDescriptor(){while(true){}}});}};',
    'const memory=[];while(true)memory.push(new Array(10000).fill(1));',
    "require('node:fs').readFileSync('/etc/passwd');",
    'function(',
    "module.exports={list(){return {cursor:'x'.repeat(1000000)};}};"
   ]){
    const result=await probe.runCandidate(input(source));assert.equal(result.cleanupConfirmed,true,JSON.stringify(result));
    assert.notEqual(result.status,'observed');assert.equal(Object.hasOwn(result,'checks'),false);
   }
   const closed=await probe.runCandidate(input(`
    for(const key of ['process','Buffer','fetch','XMLHttpRequest','Worker','parentPort','postMessage','console','std','os'])
     if(typeof globalThis[key]!=='undefined')throw Error('capability exposed');
    ${task.correction['src/list.js']}`));
   clean(closed,'observed');assert.ok(closed.checks.every(c=>c.ok));
  });

  await t.test('host filesystem and a reachable network canary remain inaccessible',async()=>{
   const root='/tmp/pitcrew-'+crypto.randomBytes(6).toString('hex'),sentinel=root+'/sentinel',secret=crypto.randomBytes(32);
   fs.mkdirSync(root,{mode:0o700});fs.writeFileSync(sentinel,secret,{mode:0o600});
   let hits=0;const server=http.createServer((_req,res)=>{hits++;res.end('canary');});
   await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
   try{
    assert.deepEqual(fs.readFileSync(sentinel),secret);
    const file=await probe.runQualification('host-file',sentinel);clean(file,'qualified-observation');assert.equal(file.facts.hostPathAbsent,true);
    const address=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address;
    assert.ok(address,'qualification needs a reachable host IPv4 canary');
    const target='http://'+address+':'+server.address().port+'/';
    await new Promise((resolve,reject)=>{const req=http.get(target,res=>{res.resume();res.once('end',resolve);});req.once('error',reject);req.setTimeout(1000,()=>req.destroy(Error('positive control timed out')));});
    assert.equal(hits,1);
    const network=await probe.runQualification('network',target);clean(network,'qualified-observation');assert.equal(network.facts.reached,false);assert.equal(hits,1);
    assert.deepEqual(fs.readFileSync(sentinel),secret);
   }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.unlinkSync(sentinel);fs.rmdirSync(root);
   }
  });

  await t.test('native CPU, memory, process and stopped-child faults are bounded',async()=>{
   for(const name of ['cpu-flood','memory-flood','stop-child']){
    const start=Date.now(),result=await probe.runQualification(name);clean(result,'container-limit');
    assert.ok([124,137].includes(result.exitCode),JSON.stringify(result));assert.ok(Date.now()-start<60000);
    assert.equal(Object.hasOwn(result,'checks'),false);
   }
   const pids=await probe.runQualification('pid-flood');clean(pids,'qualified-observation');assert.ok(pids.facts.blocked>0);assert.ok(pids.facts.created<32);
  });

  await t.test('cancel and a competing request preserve exact ownership and allow recovery',async()=>{
   const already=new AbortController();already.abort();clean(await probe.runQualification('limits',null,{signal:already.signal}),'aborted');
   const before=new Set((await jobs()).map(c=>c.Id)),controller=new AbortController();
   const running=probe.runQualification('stop-child',null,{signal:controller.signal});
   clean(await probe.runCandidate(input(task.correction['src/list.js'])),'busy');
   try{await stoppedChild(before);}finally{controller.abort();}
   clean(await running,'aborted');assert.equal(probe.state.quarantined,false);
   const after=await probe.runCandidate(input(task.correction['src/list.js']));clean(after,'observed');assert.ok(after.checks.every(c=>c.ok));
  });

  await t.test('container watchdog survives controller SIGKILL and removes stopped descendants',async()=>{
   const before=new Set((await jobs()).map(c=>c.Id));
   const child=spawn(process.execPath,[__filename,'--death-child'],{stdio:'ignore',env:{...process.env,PITCREW_DOCKER_SOCKET:socket,PITCREW_DOCKER_IMAGE:image}});
   const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
   let id;
   try{
    id=await stoppedChild(before);assert.equal(child.kill('SIGKILL'),true);
    assert.equal((await exited).signal,'SIGKILL');
    assert.equal(await gone(id),true,'independent PID 1 guard must remove its namespace without the controller');
   }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
   const next=await probe.runCandidate(input(task.correction['src/list.js']));clean(next,'observed');assert.ok(next.checks.every(c=>c.ok));
   assert.deepEqual((await jobs()).map(c=>c.Id).sort(),[...before].sort());
  });
 });
}
