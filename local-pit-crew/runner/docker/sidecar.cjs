'use strict';
// Fixed Linux endpoint on an owned stdio pipe. There is no TCP listener, shell,
// arbitrary command endpoint, caller-supplied image or admission bypass.
const {prepareDockerVerifier,resolveDockerAdmission}=require('./admission.cjs');
const {data}=require('../policy.cjs');
const SCHEMA='local-pit-crew/wsl-verifier/v1';
const send=packet=>process.stdout.write(JSON.stringify({schema:SCHEMA,...packet})+'\n');
async function main(argv){
 if(argv.length!==2||argv[0]!=='--socket')throw Error('invalid-sidecar-arguments');
 const lifetime=new AbortController();let registration=null,active=null,closed=false,buffer=Buffer.alloc(0);
 const close=async()=>{
  if(closed)return;closed=true;lifetime.abort();active?.abort.abort();
  await registration?.close();process.exit(0);
 };
 process.once('SIGTERM',close);process.once('SIGINT',close);process.stdin.once('end',close);
 process.stdin.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>128000){void close();return;}
  let newline;
  while((newline=buffer.indexOf(10))>=0){
   const line=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
   let packet;
   try{packet=JSON.parse(line.toString('utf8'));}catch{void close();return;}
   void receive(packet).catch(close);
  }
 });
 async function receive(packet){
  if(closed||packet?.schema!==SCHEMA)throw Error('invalid-channel');
  if(packet.kind==='close'){data(packet,['schema','kind']);await close();return;}
  if(packet.kind==='abort'){
   const p=data(packet,['schema','kind','id']);if(active?.id===p.id)active.abort.abort();return;
  }
  const p=data(packet,['schema','kind','id','ticket']);
  if(p.kind!=='run'||typeof p.id!=='string'||!/^[a-f0-9-]{36}$/.test(p.id)||!registration||active)throw Error('invalid-run');
  const owner={id:p.id,abort:new AbortController()};active=owner;
  try{
   const outcome=await resolveDockerAdmission(registration).runPublicChecks(p.ticket,{signal:owner.abort.signal});
   if(!closed)send({kind:'result',id:p.id,outcome});
  }finally{if(active===owner)active=null;}
 }
 registration=await prepareDockerVerifier({socket:argv[1],signal:lifetime.signal});
 if(closed){await registration.close();return;}
 send({kind:'ready',evidence:registration.evidence});
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{process.stderr.write('Verifier setup failed.\n');process.exitCode=1;process.stdin.destroy();});
module.exports={main};
