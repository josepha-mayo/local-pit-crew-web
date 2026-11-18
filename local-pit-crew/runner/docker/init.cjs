'use strict';
// Trusted PID 1. It never parses task input or reads candidate output.
// Exiting PID 1 tears down the entire container PID namespace, including orphans.
const fs=require('node:fs'),{spawn}=require('node:child_process');
const stop=code=>process.exit(code);
try{
 const status=fs.readFileSync('/proc/self/status','utf8');
 const field=name=>status.match(new RegExp('^'+name+':\\s*(.+)$','m'))?.[1];
 if(process.platform!=='linux'||process.pid!==1||process.getuid()!==0||process.getgid()!==0||
  field('NoNewPrivs')!=='1'||field('Seccomp')!=='2'||BigInt('0x'+field('CapEff'))!==192n||
  BigInt('0x'+field('CapPrm'))!==192n||BigInt('0x'+field('CapBnd'))!==192n||
  BigInt('0x'+field('CapInh'))!==0n||BigInt('0x'+field('CapAmb'))!==0n)stop(125);
 process.setgroups([]);
}catch{stop(125);}
for(const signal of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT','SIGUSR1','SIGUSR2'])process.on(signal,()=>stop(125));
process.on('uncaughtException',()=>stop(125));
process.on('unhandledRejection',()=>stop(125));
const deadline=setTimeout(()=>stop(124),5000);
const child=spawn('/usr/local/bin/node',['--disable-sigusr1','--max-old-space-size=32','/opt/pitcrew/docker/job.cjs'],{
 cwd:'/opt/pitcrew',uid:10001,gid:10001,stdio:'inherit',
 env:{PATH:'/usr/local/bin:/usr/bin:/bin',NODE_ENV:'production',LANG:'C.UTF-8',TZ:'UTC',HOME:'/nonexistent'}
});
child.once('error',()=>stop(125));
child.once('exit',(code,signal)=>{
 clearTimeout(deadline);
 stop(Number.isInteger(code)?code:signal==='SIGKILL'?137:125);
});
