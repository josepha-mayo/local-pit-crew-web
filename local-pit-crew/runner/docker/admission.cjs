'use strict';
// Trusted, explicit setup only. Importing this file performs no I/O or execution.
// Callers cannot register their own callback, image hash or qualification receipt.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createDockerProbe}=require('./probe.cjs');
const {data,validateInput,hash,SUPPORTED_SUITES}=require('../policy.cjs');
const {workspaceHash}=require('../../src/controller.cjs');
const {FUNCTION_SUITE}=require('../function-contract.cjs');
const admissions=new WeakMap();
const sourceRoot=path.resolve(__dirname,'..');
const imageFiles=['Dockerfile','.dockerignore','package.json','package-lock.json','worker.cjs','matrix-worker.cjs','matrix-policy.cjs','function-contract.cjs','function-guest.cjs','function-worker.cjs','function-executor.cjs','primitive-codec.cjs','compiled-wasm.cjs','probe.cjs','policy.cjs','identity.cjs','docker/init.cjs','docker/job.cjs'];
const hostFiles=['docker/probe.cjs','docker/admission.cjs','docker/qualification.test.cjs','docker/sidecar.cjs','docker/wsl.cjs'];
function sourceSnapshot(){
 return Object.fromEntries([...imageFiles,...hostFiles].map(name=>{
  const filename=path.join(sourceRoot,name),stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128000)throw Error('untrusted-runner-source');
  return[name,fs.readFileSync(filename)];
 }));
}
const identities=source=>Object.fromEntries(Object.entries(source).map(([name,bytes])=>[name,hash(bytes)]));
function childRun(command,args,{env,cwd,signal,timeoutMs,maxBytes=128000,failureCode='runner-setup-failed'}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('setup-aborted'));return;}
  const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  let bytes=0,failed=false,done=false,setupTail=Buffer.alloc(0);
  const terminate=()=>{failed=true;child.kill('SIGKILL');};
  const consume=chunk=>{
   bytes+=chunk.length;
   if(['runner-runtime-qualification-failed','runner-image-build-failed'].includes(failureCode))setupTail=Buffer.concat([setupTail,chunk]).subarray(-48000);
   if(bytes>maxBytes)terminate();
  };
  child.stdout.on('data',consume);child.stderr.on('data',consume);
  const timer=setTimeout(terminate,timeoutMs);signal?.addEventListener('abort',terminate,{once:true});
  const finish=error=>{
   if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',terminate);
   if(error||failed||signal?.aborted){
    // These are the curated build and fixed qualification programs, never the
    // user's candidate or provider logs. Keep setup evidence in the console.
    if(setupTail.length&&!signal?.aborted)process.stderr.write('Verifier setup failed (bounded trusted build/self-test output):\n'+setupTail.toString('utf8')+'\n');
    reject(Error(failureCode));
   }else resolve();
  };
  child.once('error',finish);child.once('exit',code=>finish(code===0?null:Error('runner-setup-failed')));
 });
}
function removeStaging(staging){
 // The setup owns this unpredictable, mode-0700 directory. Check its resolved
 // location before a recursive cleanup, including on failure/cancellation.
 const resolved=fs.realpathSync(staging),temporaryRoot=fs.realpathSync(os.tmpdir());
 if(!resolved.startsWith(temporaryRoot+path.sep)||!path.basename(resolved).startsWith('pitcrew-build-')||fs.lstatSync(staging).isSymbolicLink())throw Error('unsafe-staging-cleanup');
 fs.rmSync(resolved,{recursive:true,force:true});
}
async function prepareDockerVerifier({socket,distro,signal}={}){
 if(process.platform==='win32'){
  const sourceHashes=identities(sourceSnapshot());
  const prepared=await require('./wsl.cjs').prepareWslRuntime({socket,distro,signal});
  if(JSON.stringify(identities(sourceSnapshot()))!==JSON.stringify(sourceHashes)){
   await prepared.registration.close();throw Error('runner-changed-during-qualification');
  }
  admissions.set(prepared.registration,prepared.admission);return prepared.registration;
 }
 if(process.platform!=='linux')throw Error('docker-verifier-requires-linux');
 // The probe validates the socket before any build or engine request. This
 // placeholder cannot be run: the actual image is created from trusted files.
 createDockerProbe({socket,image:'sha256:'+'0'.repeat(64)});
 const docker=fs.realpathSync('/usr/bin/docker'),stat=fs.statSync(docker);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o022)!==0)throw Error('untrusted-docker-client');
 const source=sourceSnapshot(),sourceHashes=identities(source),staging=fs.mkdtempSync(path.join(os.tmpdir(),'pitcrew-build-'));
 fs.chmodSync(staging,0o700);
 let image;
 const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8'};
 try{
  const context=path.join(staging,'context'),config=path.join(staging,'client'),iid=path.join(staging,'image-id');
  fs.mkdirSync(context,{mode:0o700});fs.mkdirSync(config,{mode:0o700});fs.mkdirSync(path.join(context,'docker'),{mode:0o700});
  fs.writeFileSync(path.join(config,'config.json'),'{}\n',{mode:0o600});
  // These public runtime files must remain readable by the unprivileged job
  // after Docker COPY preserves their mode. The enclosing staging dir is 0700.
  for(const name of imageFiles)fs.writeFileSync(path.join(context,name),source[name],{mode:0o644});
  await childRun(docker,['--config',config,'--host','unix://'+socket,'build','--network','host','--pull=false','--iidfile',iid,context],
   {cwd:context,env,signal,timeoutMs:180000,failureCode:'runner-image-build-failed'});
  const imageStat=fs.lstatSync(iid);if(!imageStat.isFile()||imageStat.size>100)throw Error('invalid-built-image');
  image=fs.readFileSync(iid,'utf8').trim();if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('invalid-built-image');
 }finally{removeStaging(staging);}
 // Full real-engine qualification runs as a trusted child, including SIGKILL of
 // a separate controller and outside canaries. No supplied status can skip it.
 await childRun(process.execPath,['--test','--test-reporter=spec',path.join(__dirname,'qualification.test.cjs')],
  {cwd:sourceRoot,env:{...env,PITCREW_DOCKER_SOCKET:socket,PITCREW_DOCKER_IMAGE:image},signal,timeoutMs:360000,failureCode:'runner-runtime-qualification-failed'});
 if(signal?.aborted||JSON.stringify(identities(sourceSnapshot()))!==JSON.stringify(sourceHashes))throw Error('runner-changed-during-qualification');
 const probe=createDockerProbe({socket,image}),lifetime=new AbortController();
 const qualifiedAt=new Date().toISOString(),active=new Set();let closed=false;
 const capabilityFor=suiteId=>Object.freeze({available:!closed&&!probe.state.quarantined&&SUPPORTED_SUITES.includes(suiteId),
  admissionKind:'qualified-docker-quickjs-repair-v2',qualified:!closed&&!probe.state.quarantined&&SUPPORTED_SUITES.includes(suiteId),
  runnerImageId:image,qualifiedAt,benchmarkEligible:false,reason:!SUPPORTED_SUITES.includes(suiteId)?'unsupported-suite':closed?'runtime-unavailable':probe.state.quarantined?'cleanup-uncertain':null});
 const admission=Object.freeze({
  capabilityFor,
  async runPublicChecks(ticket,{signal}={}){
   const t=data(ticket,['id','suiteId','workspaceHash','files']);
   if(typeof t.id!=='string'||!t.id||Buffer.byteLength(t.id)>200||typeof t.workspaceHash!=='string'||!/^[a-f0-9]{64}$/.test(t.workspaceHash))throw Error('invalid-check-ticket');
   const binding={ticketId:t.id,suiteId:t.suiteId,workspaceHash:t.workspaceHash};
   const unavailable=reason=>({status:'unavailable',...binding,reason});
   if(!capabilityFor(t.suiteId).available)return unavailable(capabilityFor(t.suiteId).reason);
   const input=validateInput({suiteId:t.suiteId,files:t.files});
   if(workspaceHash(input.files)!==t.workspaceHash)return unavailable('protocol-invalid');
   if(JSON.stringify(identities(sourceSnapshot()))!==JSON.stringify(sourceHashes)){closed=true;return unavailable('not-qualified');}
   const operation=probe.runCandidate(input,{signal:signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal});
   active.add(operation);let result;
   try{result=await operation;}finally{active.delete(operation);}
   if(!result.cleanupConfirmed)return unavailable('cleanup-uncertain');
   if(closed||signal?.aborted||result.status==='aborted')return unavailable('aborted');
   if(result.status==='observed')return{status:'candidate-verdict',...binding,checks:result.checks,
    ...(t.suiteId===FUNCTION_SUITE?{observations:result.observations}:{})};
   return unavailable(result.status==='protocol-invalid'?'protocol-invalid':result.status==='expired'?'expired':'runtime-unavailable');
  }
 });
 const registration=Object.freeze({
  kind:'runtime-qualified-docker-quickjs',
  evidence:Object.freeze({image,sourceHashes:Object.freeze(sourceHashes),policy:'experimental-docker-quickjs-v1',
   generatedAt:qualifiedAt,qualifiedSuites:Object.freeze([...SUPPORTED_SUITES]),benchmarkEligible:false}),
  async close(){closed=true;lifetime.abort();await Promise.allSettled([...active]);}
 });
 admissions.set(registration,admission);
 return registration;
}
function resolveDockerAdmission(registration){
 // WeakMap identity is local to this issuer. Copies, hashes, callbacks and
 // serialized receipts cannot mint an admission capability.
 return registration&&typeof registration==='object'?admissions.get(registration)??null:null;
}
module.exports={prepareDockerVerifier,resolveDockerAdmission};
