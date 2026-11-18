'use strict';
const path=require('node:path'),crypto=require('node:crypto'),{spawn,execFile}=require('node:child_process');
const {data,validateInput,SUPPORTED_SUITES}=require('../policy.cjs');
const {workspaceHash}=require('../../src/controller.cjs');
const SCHEMA='local-pit-crew/wsl-verifier/v1',WSL='C:\\Windows\\System32\\wsl.exe';
const unavailable=(ticket,reason)=>({status:'unavailable',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,reason});
async function prepareWslRuntime({socket,distro='Ubuntu-24.04',signal}={}){
 if(process.platform!=='win32'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(distro)||typeof socket!=='string'||!socket.startsWith('/')||socket.includes('\0')||socket.length>200)throw Error('invalid-wsl-verifier-options');
 if(signal?.aborted)throw Error('setup-aborted');
 const executable=await new Promise((resolve,reject)=>execFile(WSL,['-d',distro,'--user','root','--exec','wslpath','-u',path.join(__dirname,'sidecar.cjs')],
  {windowsHide:true,encoding:'utf8',maxBuffer:4096,timeout:30000,signal},(error,stdout)=>error?reject(Error('wsl-path-unavailable')):resolve(stdout.trim())));
 if(!executable.startsWith('/')||executable.includes('\n')||executable.includes('\0'))throw Error('invalid-sidecar-path');
 const child=spawn(WSL,['-d',distro,'--user','root','--exec','/usr/bin/node','--disable-sigusr1',executable,'--socket',socket],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let closed=false,closing=false,ready=false,buffer=Buffer.alloc(0),setupErrorTail=Buffer.alloc(0),errorBytes=0,pending=null,readyResolve,readyReject,exitResolve;
 const exited=new Promise(resolve=>{exitResolve=resolve;});
 const handshaking=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const timer=setTimeout(()=>stop('runner-setup-timeout'),570000);
 const abortSetup=()=>stop('runner-setup-aborted');signal?.addEventListener('abort',abortSetup,{once:true});
 function stop(reason){
  if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abortSetup);
  if(!ready&&reason==='channel-exited'&&!signal?.aborted&&setupErrorTail.length)
   process.stderr.write('WSL verifier setup diagnostics (bounded):\n'+setupErrorTail.toString('utf8')+'\n');
  readyReject(Error(reason));
  if(pending){const owner=pending;pending=null;owner.finish(unavailable(owner.ticket,'cleanup-uncertain'));}
  child.stdin.destroy();child.kill('SIGKILL');
 }
 function write(packet){
  if(closed)throw Error('closed-channel');
  child.stdin.write(JSON.stringify({schema:SCHEMA,...packet})+'\n',error=>{if(error)stop('channel-write-failed');});
 }
 child.stdin.on('error',()=>stop('channel-write-failed'));
 child.stderr.on('data',chunk=>{
  errorBytes+=chunk.length;
  if(!ready)setupErrorTail=Buffer.concat([setupErrorTail,chunk]).subarray(-48000);
  if(errorBytes>128000)stop('channel-error-limit');
 });
 child.once('error',()=>{stop('wsl-unavailable');exitResolve();});
 child.once('exit',()=>{stop('channel-exited');exitResolve();});
 child.stdout.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>128000){stop('channel-output-limit');return;}
  let newline;
  while((newline=buffer.indexOf(10))>=0){
   const line=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
   try{
    const p=JSON.parse(line.toString('utf8'));
    if(p.schema!==SCHEMA)throw Error();
    if(!ready){
     data(p,['schema','kind','evidence']);if(p.kind!=='ready'||!/^sha256:[a-f0-9]{64}$/.test(p.evidence?.image)||
      p.evidence?.benchmarkEligible!==false||JSON.stringify(p.evidence?.qualifiedSuites)!==JSON.stringify(SUPPORTED_SUITES))throw Error();
     ready=true;clearTimeout(timer);signal?.removeEventListener('abort',abortSetup);readyResolve(p.evidence);
    }else{
     data(p,['schema','kind','id','outcome']);
     if(p.kind!=='result'||!pending||p.id!==pending.id)throw Error();
     const owner=pending;pending=null;owner.finish(p.outcome);
    }
   }catch{stop('channel-protocol-invalid');return;}
  }
 });
 if(signal?.aborted)abortSetup();
 const evidence=await handshaking;
 const capabilityFor=suiteId=>Object.freeze({available:!closed&&!closing&&SUPPORTED_SUITES.includes(suiteId),
  admissionKind:'qualified-docker-quickjs-repair-v2',qualified:!closed&&!closing&&SUPPORTED_SUITES.includes(suiteId),benchmarkEligible:false,
  runnerImageId:evidence.image,qualifiedAt:evidence.generatedAt,
  reason:!SUPPORTED_SUITES.includes(suiteId)?'unsupported-suite':closed||closing?'runtime-unavailable':null});
 const admission=Object.freeze({
  capabilityFor,
  async runPublicChecks(ticket,{signal}={}){
   const t=data(ticket,['id','suiteId','workspaceHash','files']);
   if(typeof t.id!=='string'||!t.id||Buffer.byteLength(t.id)>200||typeof t.workspaceHash!=='string'||!/^[a-f0-9]{64}$/.test(t.workspaceHash))throw Error('invalid-check-ticket');
   if(!capabilityFor(t.suiteId).available)return unavailable(t,capabilityFor(t.suiteId).reason);
   const input=validateInput({suiteId:t.suiteId,files:t.files});if(workspaceHash(input.files)!==t.workspaceHash)return unavailable(t,'protocol-invalid');
   if(signal?.aborted)return unavailable(t,'aborted');if(pending)return unavailable(t,'runtime-unavailable');
   return new Promise(resolve=>{
    const id=crypto.randomUUID();let timeout;
    const abort=()=>{try{write({kind:'abort',id});}catch{stop('channel-abort-failed');}};
    pending={id,ticket:t,finish(outcome){clearTimeout(timeout);signal?.removeEventListener('abort',abort);resolve(outcome);}};
    timeout=setTimeout(()=>stop('channel-job-timeout'),90000);
    signal?.addEventListener('abort',abort,{once:true});
    try{write({kind:'run',id,ticket:{...t,files:input.files}});if(signal?.aborted)abort();}catch{stop('channel-write-failed');}
   });
  }
 });
 const registration=Object.freeze({kind:'runtime-qualified-docker-quickjs',evidence:Object.freeze({...evidence,
  sourceHashes:Object.freeze({...evidence.sourceHashes}),qualifiedSuites:Object.freeze([...evidence.qualifiedSuites]),transport:'owned-wsl-stdio'}),
  async close(){
   closing=true;
   if(!closed){try{write({kind:'close'});}catch{stop('channel-close-failed');}}
   const deadline=setTimeout(()=>stop('channel-close-timeout'),20000);
   try{await exited;}finally{clearTimeout(deadline);}
  }
 });
 return{registration,admission};
}
module.exports={prepareWslRuntime};
