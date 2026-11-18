'use strict';
// Browser-only Firebase launch: no coder daemon, project creation or inference at startup.
const fs=require('node:fs');
const {start}=require('./server.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function parseFirebaseLaunchConfig(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>16000)throw Error('invalid-firebase-config-size');
 let c;try{c=JSON.parse(raw);}catch{throw Error('invalid-firebase-config-json');}
 const f=c?.firebaseConfig;
 if(!exact(c,['firebaseConfig','contentSecurityPolicy'])||!exact(f,['firebase','appCheckSiteKey','appName'])||
  !exact(f.firebase,['apiKey','projectId','appId'])||!Object.values(f.firebase).every(v=>typeof v==='string'&&v.length>0&&v.length<=300)||
  typeof f.appCheckSiteKey!=='string'||!f.appCheckSiteKey||f.appCheckSiteKey.length>300||
  typeof f.appName!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(f.appName)||
  typeof c.contentSecurityPolicy!=='string'||!c.contentSecurityPolicy||c.contentSecurityPolicy.length>8192||/[\r\n]/.test(c.contentSecurityPolicy))throw Error('invalid-firebase-launch-config');
 return structuredClone(c);
}
async function main(argv,{readFile=filename=>{
 const stat=fs.statSync(filename);if(!stat.isFile()||stat.size>16000)throw Error('invalid-firebase-config-file');
 return fs.readFileSync(filename,'utf8');
},startServer=start}={}){
 const usage=()=>Error('usage: node ui/firebase-workbench.cjs --config browser.local.json [--app-check-debug] [--port 1024-65535]');
 if(argv.length<2||argv[0]!=='--config')throw usage();
 const options={};
 for(let i=2;i<argv.length;i++){
  if(argv[i]==='--app-check-debug'&&!Object.hasOwn(options,'developmentAppCheck'))options.developmentAppCheck=true;
  else if(argv[i]==='--port'&&!Object.hasOwn(options,'port')&&/^\d{4,5}$/.test(argv[i+1]??'')){
   options.port=Number(argv[++i]);if(options.port<1024||options.port>65535)throw usage();
  }else throw usage();
 }
 const config=parseFirebaseLaunchConfig(readFile(argv[1]));
 return startServer({...config,...options});
}
if(require.main===module)main(process.argv.slice(2)).then(server=>{
 const close=()=>{server.closeAllConnections();server.close();};
 process.once('SIGINT',close);process.once('SIGTERM',close);
}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parseFirebaseLaunchConfig,main};
