'use strict';
// Experimental Docker transport. It does not issue production admission.
// Only a trusted, root-owned local Unix socket is supported; no remote Docker API.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {data,validateInput,gradeObservations}=require('../policy.cjs');
const {validateMatrix,validateMatrixObservations}=require('../matrix-policy.cjs');
const SCHEMA='local-pit-crew/container-job/v1',POLICY='experimental-docker-quickjs-v1';
const busySockets=new Set(),quarantinedSockets=new Set();
const fail=code=>Object.assign(Error(code),{code});
function rootSocket(socket){
 if(process.platform!=='linux'||typeof socket!=='string'||path.resolve(socket)!==socket||socket.includes('\0'))throw fail('unsupported-socket');
 const stat=fs.lstatSync(socket),parent=fs.statSync(path.dirname(socket));
 if(!stat.isSocket()||stat.uid!==0||(stat.mode&7)!==0||parent.uid!==0||(parent.mode&2)!==0)throw fail('untrusted-socket');
}
function request(socket,method,url,body,{signal,timeoutMs=15000,accept=[200,201,204,304],maxBytes=128000}={}){
 return new Promise((resolve,reject)=>{
  const encoded=body===undefined?null:Buffer.from(JSON.stringify(body));let bytes=0,chunks=[],done=false;
  const req=http.request({socketPath:socket,path:'/v1.47'+url,method,agent:false,
   headers:encoded?{'Content-Type':'application/json','Content-Length':encoded.length}:{}},res=>{
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){req.destroy(fail('protocol-limit'));return;}chunks.push(chunk);});
   res.once('end',()=>{
    if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(!accept.includes(res.statusCode)){reject(Object.assign(fail('docker-status'),{httpStatus:res.statusCode}));return;}
    let value=null;try{if(bytes)value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reject(fail('protocol-invalid'));return;}
    resolve({status:res.statusCode,value});
   });
   res.once('error',()=>finish(fail('docker-response-failed')));
  });
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error);};
  const abort=()=>req.destroy(fail('aborted'));
  const timer=setTimeout(()=>req.destroy(fail('expired')),timeoutMs);
  req.once('error',error=>finish(['aborted','expired','protocol-limit'].includes(error.code)?error:fail('docker-unavailable')));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  req.end(encoded);
 });
}
function waitMonitor(socket,id,signal){
 let cancel;let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const result=new Promise((resolve,reject)=>{
  let done=false,bytes=0,chunks=[];
  const req=http.request({socketPath:socket,path:'/v1.47/containers/'+id+'/wait?condition=next-exit',method:'POST',agent:false},res=>{
   if(res.statusCode!==200){req.destroy(fail('wait-status'));return;}
   readyResolve();
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096){req.destroy(fail('wait-protocol'));return;}chunks.push(chunk);});
   res.once('end',()=>{
    if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Number.isInteger(value.StatusCode)||value.Error?.Message)throw Error();resolve(value.StatusCode);}
    catch{reject(fail('wait-protocol'));}
   });
   res.once('error',()=>finish());
  });
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);readyReject(fail('wait-unavailable'));reject(fail('wait-unavailable'));};
  const timer=setTimeout(()=>req.destroy(fail('wait-expired')),45000);
  const abort=()=>req.destroy(fail('aborted'));
  cancel=()=>req.destroy(fail('wait-canceled'));req.once('error',finish);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();req.end();
 });
 // Both channels are observed even if setup/cancellation prevents awaiting one.
 void ready.catch(()=>{});void result.catch(()=>{});
 return{ready,result,cancel:()=>cancel()};
}
function attach(socket,id,payload,signal){
 let cancel,started,readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const result=new Promise((resolve,reject)=>{
  let connection=null,done=false,stdout=[],outBytes=0,errBytes=0,pending=Buffer.alloc(0);
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const finish=error=>{
   if(done)return;done=true;cleanup();
   // A hijacked Docker connection may be half open after stdout EOF. Closing
   // our stdin side is necessary for daemon-side attach/teardown to finish.
   connection?.destroy();req.destroy();
   if(error){readyReject(error);reject(error);}else resolve(Buffer.concat(stdout).toString('utf8'));
  };
  const req=http.request({socketPath:socket,path:'/v1.47/containers/'+id+'/attach?stream=1&stdin=1&stdout=1&stderr=1',method:'POST',agent:false,
   headers:{Connection:'Upgrade',Upgrade:'tcp'} });
  const receive=chunk=>{
   pending=Buffer.concat([pending,chunk]);
   if(pending.length>64000){connection.destroy(fail('output-limit'));return;}
   while(pending.length>=8){
    const stream=pending[0],size=pending.readUInt32BE(4);
    if(![1,2].includes(stream)||pending[1]||pending[2]||pending[3]||size>32000){connection.destroy(fail('output-protocol'));return;}
    if(pending.length<8+size)return;
    const content=pending.subarray(8,8+size);pending=pending.subarray(8+size);
    if(stream===1){outBytes+=size;if(outBytes>16000){connection.destroy(fail('output-limit'));return;}stdout.push(content);}
    else{errBytes+=size;if(errBytes>16000){connection.destroy(fail('output-limit'));return;}}
   }
  };
  req.once('upgrade',(_res,socketStream,head)=>{
   if(done){socketStream.destroy();return;}
   connection=socketStream;
   connection.on('data',receive);connection.once('error',()=>finish(fail('attach-failed')));
   connection.once('end',()=>finish(pending.length?fail('output-protocol'):null));
   connection.once('close',()=>finish(pending.length?fail('output-protocol'):null));
   if(head.length)receive(head);
   if(signal?.aborted){connection.destroy(fail('aborted'));return;}
   clearTimeout(timer);
   readyResolve();
   // Stdin remains attached; the fixed job reader accepts precisely one line.
   connection.write(payload);
  });
  req.once('response',res=>{res.resume();finish(fail('attach-status'));});
  req.once('error',()=>finish(fail(signal?.aborted?'aborted':'attach-failed')));
  const abort=()=>{connection?.destroy(fail('aborted'));req.destroy(fail('aborted'));};
  cancel=()=>finish(fail('aborted'));
  const expire=()=>{connection?.destroy(fail('expired'));req.destroy(fail('expired'));};
  let timer=setTimeout(expire,8000);
  // The start RPC has its own deadline. Preserve the original output-wait
  // deadline after it returns; PID 1 still enforces five seconds independently.
  started=()=>{if(!done)timer=setTimeout(expire,8000);};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();req.end();
 });
 void ready.catch(()=>{});void result.catch(()=>{});
 return{ready,result,started:()=>started(),cancel:()=>cancel()};
}
function containerConfig(image,jobId){
 return{Image:image,Entrypoint:['/usr/local/bin/node','--disable-sigusr1','--max-old-space-size=16','/opt/pitcrew/docker/init.cjs'],Cmd:[],
  OpenStdin:true,StdinOnce:false,Tty:false,AttachStdin:true,AttachStdout:true,AttachStderr:true,
  Labels:{'io.localpitcrew.policy':POLICY,'io.localpitcrew.job':jobId},
  HostConfig:{AutoRemove:true,NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:['SETUID','SETGID'],
   SecurityOpt:['no-new-privileges'],Memory:192*1024*1024,MemorySwap:192*1024*1024,NanoCpus:1000000000,PidsLimit:32,CgroupnsMode:'private',IpcMode:'private',
   ShmSize:1048576,LogConfig:{Type:'none',Config:{}},
   Tmpfs:{'/tmp':'rw,nosuid,nodev,noexec,size=8m,uid=10001,gid=10001,mode=0700'},
   Ulimits:[{Name:'cpu',Soft:2,Hard:2},{Name:'nofile',Soft:128,Hard:128},{Name:'core',Soft:0,Hard:0},{Name:'fsize',Soft:8388608,Hard:8388608}]}};
}
function owned(container,id,image,jobId){
 if(container.Id!==id||container.Image!==image||container.Config?.Labels?.['io.localpitcrew.policy']!==POLICY||
  container.Config?.Labels?.['io.localpitcrew.job']!==jobId)throw fail('ownership-mismatch');
}
function inspectPolicy(container,expected){
 const h=container.HostConfig,e=expected.HostConfig;
 for(const key of ['AutoRemove','NetworkMode','ReadonlyRootfs','Privileged','Memory','MemorySwap','NanoCpus','PidsLimit','CgroupnsMode','IpcMode','ShmSize'])
  if(h[key]!==e[key])throw fail('policy-mismatch');
 const capabilities=x=>(x??[]).map(v=>v.replace(/^CAP_/,'' )).sort().join(',');
 if(capabilities(h.CapDrop)!=='ALL'||capabilities(h.CapAdd)!=='SETGID,SETUID'||
  !h.SecurityOpt?.some(v=>v==='no-new-privileges'||v==='no-new-privileges=true')||h.SecurityOpt.some(v=>/unconfined/.test(v))||
  h.LogConfig?.Type!=='none'||h.Binds?.length||h.VolumesFrom?.length||
  container.Mounts?.some(m=>m.Type!=='tmpfs'||m.Destination!=='/tmp')||
  h.Tmpfs?.['/tmp']!==e.Tmpfs['/tmp'])throw fail('policy-mismatch');
 for(const limit of e.Ulimits)if(!h.Ulimits?.some(x=>x.Name===limit.Name&&x.Soft===limit.Soft&&x.Hard===limit.Hard))throw fail('policy-mismatch');
}
async function removeOwned(socket,{id,name,image,jobId}){
 // AutoRemove can overlap our explicit removal. A 409 is not proof of cleanup:
 // confirm disappearance by ID before releasing the one-job lease.
 const until=Date.now()+15000;let removalIssued=false;
 do{
  const found=await request(socket,'GET','/containers/'+(id??name)+'/json',undefined,{accept:[200,404]});
  if(found.status===404){if(id)return true;}
  else{
   const actual=found.value;id??=actual.Id;owned(actual,id,image,jobId);
   if(!removalIssued){
    await request(socket,'DELETE','/containers/'+id+'?force=true',undefined,{accept:[204,404,409]});
    removalIssued=true;
   }
  }
  await new Promise(resolve=>setTimeout(resolve,50));
 }while(Date.now()<until);
 return false;
}
function createDockerProbe({socket,image}={}){
 rootSocket(socket);
 if(typeof image!=='string'||!/^sha256:[a-f0-9]{64}$/.test(image))throw fail('immutable-image-required');
 async function run(envelope,{signal}={}){
  const base={kind:POLICY,productionAdmitted:false,benchmarkEligible:false};
  if(signal?.aborted)return{...base,status:'aborted',cleanupConfirmed:true};
  if(quarantinedSockets.has(socket))return{...base,status:'cleanup-uncertain',cleanupConfirmed:false};
  if(busySockets.has(socket))return{...base,status:'busy',cleanupConfirmed:true};
  busySockets.add(socket);
  // Docker itself reserves this name across controller processes. A second
  // process cannot bypass the one-job limit with its own in-memory lease.
  const jobId=crypto.randomUUID(),name='pitcrew-quickjs-active-job';
  const payload=JSON.stringify({schema:SCHEMA,jobId,...envelope})+'\n';
  let id=null,monitor=null,stream=null,createIssued=false,result={...base,status:'runtime-unavailable'},cleanupConfirmed=false,stage='engine';
  try{
   rootSocket(socket);
   const info=(await request(socket,'GET','/info',undefined,{signal})).value;
   if(info.CgroupVersion!=='2'||!info.MemoryLimit||!info.SwapLimit||!info.PidsLimit||!info.SecurityOptions?.some(x=>x==='name=seccomp,profile=builtin'))throw fail('unsupported-engine');
   const config=containerConfig(image,jobId);createIssued=true;stage='create';
   const created=(await request(socket,'POST','/containers/create?name='+name,config,{signal})).value;
   if(typeof created.Id!=='string'||! /^[a-f0-9]{64}$/.test(created.Id))throw fail('protocol-invalid');id=created.Id;
   stage='inspect';const inspected=(await request(socket,'GET','/containers/'+id+'/json',undefined,{signal})).value;
   owned(inspected,id,image,jobId);inspectPolicy(inspected,config);
   stage='monitor';monitor=waitMonitor(socket,id,signal);
   await monitor.ready;
   // Establish stdin/output before starting PID 1's independent deadline. A
   // delayed start response must not consume the job's input/execution window.
   stage='attach';stream=attach(socket,id,payload,signal);await stream.ready;
   stage='start';await request(socket,'POST','/containers/'+id+'/start',undefined,{signal,timeoutMs:30000,accept:[204]});
   stream.started();
   if(signal?.aborted)throw fail('aborted');
   stage='execution';const text=await stream.result,exitCode=await monitor.result;
   if(signal?.aborted)throw fail('aborted');
   if(exitCode!==0)result={...base,status:'container-limit',exitCode};
   else{
    const packet=JSON.parse(text);
    if(packet?.schema!==SCHEMA||packet.jobId!==jobId)throw fail('protocol-invalid');
    if(envelope.kind==='qualification'){
     data(packet,['schema','jobId','kind','facts']);if(packet.kind!=='qualification')throw fail('protocol-invalid');
     result={...base,status:'qualified-observation',facts:packet.facts};
    }else if(packet.status==='observed'){
     data(packet,['schema','jobId','kind','status','observations']);
     if(envelope.kind==='observation-matrix'){
      if(packet.kind!=='matrix-outcome')throw fail('protocol-invalid');
      result={...base,status:'observed',observations:validateMatrixObservations(packet.observations,envelope.cases)};
     }else{
      if(packet.kind!=='candidate-outcome')throw fail('protocol-invalid');
      result={...base,status:'observed',observations:packet.observations,checks:gradeObservations(packet.observations,envelope.input.suiteId,envelope.input.files)};
     }
    }else{
     data(packet,['schema','jobId','kind','status']);
     const allowed=['resource-limit','guest-exception-or-engine-limit','unsupported-export','oversized-observation','cleanup-uncertain','runtime-failed','worker-failed','wall-limit','protocol-invalid'];
     if(packet.kind!==(envelope.kind==='observation-matrix'?'matrix-outcome':'candidate-outcome')||!allowed.includes(packet.status))throw fail('protocol-invalid');
     result={...base,status:packet.status};
    }
   }
  }catch(error){
   const competing=stage==='create'&&error.code==='docker-status'&&error.httpStatus===409;
   if(competing)createIssued=false; // A definite conflict created no owned job.
   const codes=['unsupported-engine','docker-status','docker-response-failed','docker-unavailable','expired','aborted','protocol-invalid','protocol-limit','ownership-mismatch','policy-mismatch','wait-unavailable','attach-failed','attach-status','output-protocol'];
   result={...base,status:signal?.aborted?'aborted':competing?'busy':error.code==='protocol-invalid'?'protocol-invalid':error.code==='expired'?'expired':'runtime-unavailable',
    diagnostic:{stage,code:codes.includes(error.code)?error.code:'invalid-response'}};
  }
  finally{
   stream?.cancel();
   try{
    cleanupConfirmed=createIssued?await removeOwned(socket,{id,name,image,jobId}):true;
   }catch(error){cleanupConfirmed=false;result.cleanupDiagnostic=error.code==='expired'?'expired':'cleanup-request-failed';}
   monitor?.cancel();if(!cleanupConfirmed)quarantinedSockets.add(socket);busySockets.delete(socket);
  }
  return{...result,cleanupConfirmed,...(!cleanupConfirmed?{status:'cleanup-uncertain'}:{})};
 }
 return Object.freeze({
  runCandidate(input,options){return run({kind:'candidate',input:validateInput(input)},options);},
  runObservationMatrix(input,cases,options){const parsed=validateInput(input);if(parsed.suiteId!=='pagination-zero')throw Error('unsupported-matrix-suite');return run({kind:'observation-matrix',input:parsed,cases:validateMatrix(cases)},options);},
  runQualification(probe,argument=null,options){
   if(!['limits','parent-signal','stop-child','cpu-flood','memory-flood','pid-flood','root-write','host-file','network'].includes(probe))throw fail('unsupported-probe');
   if(probe==='host-file'?typeof argument!=='string'||!/^\/tmp\/pitcrew-[a-f0-9]{12}\/sentinel$/.test(argument):
    probe==='network'?typeof argument!=='string'||!/^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\/$/.test(argument):argument!==null)throw fail('unsupported-probe-argument');
   return run({kind:'qualification',probe,argument},options);
  },
  get state(){return{active:busySockets.has(socket),quarantined:quarantinedSockets.has(socket),productionAdmitted:false};}
 });
}
module.exports={createDockerProbe};
