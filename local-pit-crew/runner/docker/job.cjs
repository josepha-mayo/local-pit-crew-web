'use strict';
// Candidate strings reach only the QuickJS worker. This process has no host mount,
// network, capabilities, privileged UID, or Docker socket under the fixed policy.
const fs=require('node:fs'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process');
const {data,validateInput,gradeObservations}=require('../policy.cjs');
const {runCandidateProbe,runObservationMatrix}=require('../probe.cjs');
const {validateMatrix,validateMatrixObservations}=require('../matrix-policy.cjs');
const SCHEMA='local-pit-crew/container-job/v1';
const read=path=>fs.readFileSync(path,'utf8').trim();
function limits(){
 const status=read('/proc/self/status'),field=name=>status.match(new RegExp('^'+name+':\\s*(.+)$','m'))?.[1];
 return{uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),pid:process.pid,parentPid:process.ppid,
  node:process.version,noNewPrivileges:field('NoNewPrivs'),seccomp:field('Seccomp'),capabilities:field('CapEff'),
  permittedCapabilities:field('CapPrm'),inheritableCapabilities:field('CapInh'),ambientCapabilities:field('CapAmb'),
  memoryMax:read('/sys/fs/cgroup/memory.max'),swapMax:read('/sys/fs/cgroup/memory.swap.max'),
  cpuMax:read('/sys/fs/cgroup/cpu.max'),pidsMax:read('/sys/fs/cgroup/pids.max'),interfaces:Object.keys(os.networkInterfaces())};
}
function assertPolicy(f){
 if(f.uid!==10001||f.gid!==10001||f.groups.some(g=>g!==10001)||f.parentPid!==1||
  f.noNewPrivileges!=='1'||f.seccomp!=='2'||![f.capabilities,f.permittedCapabilities,f.inheritableCapabilities,f.ambientCapabilities].every(x=>/^0+$/.test(x))||f.memoryMax!=='201326592'||
  f.swapMax!=='0'||f.cpuMax!=='100000 100000'||f.pidsMax!=='32'||f.interfaces.some(name=>name!=='lo'))throw Error('policy-unavailable');
}
const respond=value=>{
 const text=JSON.stringify(value)+'\n';
 if(Buffer.byteLength(text)>16000)process.exit(125);
 process.stdout.write(text,()=>process.exit(0));
};
async function qualification(probe,argument,facts){
 switch(probe){
  case'limits':return facts;
  case'parent-signal':{
   let code=null;try{process.kill(1,'SIGKILL');}catch(error){code=error.code;}
   return{parentKillRejected:code==='EPERM',code};
  }
  case'stop-child':process.kill(process.pid,'SIGSTOP');return{};
  case'cpu-flood':while(true){} // Deliberate native-child fault; exercises kernel CPU bounds.
  case'memory-flood':{const memory=[];while(true)memory.push(Buffer.alloc(4*1024*1024,1));}
  case'pid-flood':{
   let blocked=0,created=0;
   for(let i=0;i<64;i++){
    const child=spawn('/bin/sleep',['30'],{stdio:'ignore'});
    child.once('spawn',()=>created++);child.once('error',error=>{if(error.code==='EAGAIN')blocked++;});
   }
   await new Promise(resolve=>setTimeout(resolve,150));return{created,blocked};
  }
  case'root-write':{
   let code=null;try{fs.writeFileSync('/pitcrew-write-probe','probe');}catch(error){code=error.code;}
   return{rootWriteRejected:['EROFS','EACCES'].includes(code),code};
  }
  case'host-file':{
   if(typeof argument!=='string'||!/^\/tmp\/pitcrew-[a-f0-9]{12}\/sentinel$/.test(argument))throw Error('invalid-probe');
   let code=null;try{fs.readFileSync(argument);}catch(error){code=error.code;}
   return{hostPathAbsent:code==='ENOENT',code};
  }
  case'network':{
   if(typeof argument!=='string'||!/^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\/$/.test(argument))throw Error('invalid-probe');
   return await new Promise(resolve=>{
    const req=http.get(argument,res=>{res.resume();resolve({reached:true});});
    req.once('error',error=>resolve({reached:false,code:error.code??'request-error'}));
    req.setTimeout(300,()=>req.destroy(Error('canary-timeout')));
   });
  }
  default:throw Error('unsupported-probe');
 }
}
async function run(raw){
 const facts=limits();assertPolicy(facts);
 const envelope=JSON.parse(raw);
 if(envelope?.kind==='qualification'){
  const x=data(envelope,['schema','kind','jobId','probe','argument']);
  if(x.schema!==SCHEMA||typeof x.jobId!=='string'||!/^[a-f0-9-]{36}$/.test(x.jobId))throw Error('invalid-envelope');
  return{schema:SCHEMA,jobId:x.jobId,kind:'qualification',facts:await qualification(x.probe,x.argument,facts)};
 }
 const matrix=envelope?.kind==='observation-matrix';
 const x=data(envelope,matrix?['schema','kind','jobId','input','cases']:['schema','kind','jobId','input']);
 if(x.schema!==SCHEMA||(!matrix&&x.kind!=='candidate')||typeof x.jobId!=='string'||!/^[a-f0-9-]{36}$/.test(x.jobId))throw Error('invalid-envelope');
 const input=validateInput(x.input),cases=matrix?validateMatrix(x.cases):null;
 if(matrix&&input.suiteId!=='pagination-zero')throw Error('unsupported-matrix-suite');
 const result=matrix?await runObservationMatrix(input,cases):await runCandidateProbe(input);
 const kind=matrix?'matrix-outcome':'candidate-outcome';
 if(result.status==='observed'){
  if(matrix)validateMatrixObservations(result.observations,cases);else gradeObservations(result.observations,input.suiteId,input.files);
  return{schema:SCHEMA,jobId:x.jobId,kind,status:'observed',observations:result.observations};
 }
 return{schema:SCHEMA,jobId:x.jobId,kind,status:result.status};
}
let bytes=0,chunks=[],accepted=false;
process.stdin.on('data',chunk=>{
 if(accepted)return;
 bytes+=chunk.length;if(bytes>160000)process.exit(125);chunks.push(chunk);
 const buffer=Buffer.concat(chunks),newline=buffer.indexOf(10);
 if(newline<0)return;
 accepted=true;process.stdin.pause();chunks=[];
 if(buffer.subarray(newline+1).toString('utf8').trim())process.exit(125);
 run(buffer.subarray(0,newline).toString('utf8')).then(respond).catch(()=>process.exit(125));
});
process.stdin.once('end',()=>{if(!accepted)process.exit(125);});
