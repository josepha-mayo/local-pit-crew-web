'use strict';
// Explicit-config manual launcher. Importing this module does not read config, contact engines or start a server.
const fs=require('node:fs');
const {OllamaCoderClient}=require('../src/ollama-coder-client.cjs');
const {start}=require('./server.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function parseLaunchConfig(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>20000)throw Error('invalid-launch-config-size');
 let c;try{c=JSON.parse(raw);}catch{throw Error('invalid-launch-config-json');}
 if(!exact(c,['ollama','firebaseConfig','contentSecurityPolicy'])||!c.ollama||typeof c.ollama!=='object'||Array.isArray(c.ollama))throw Error('invalid-launch-config-fields');
 const allowed=['endpoint','model','contextTokens','maxOutputTokens','keepAliveSeconds','thinking','expectedVersion','expectedDigest','profileContextHash','requestTimeoutMs','providerTimeoutMs','responseMode'];
 if(!Object.hasOwn(c.ollama,'model')||Object.keys(c.ollama).some(k=>!allowed.includes(k)))throw Error('invalid-ollama-launch-options');
 if(c.ollama.providerTimeoutMs!==undefined&&(!Number.isSafeInteger(c.ollama.providerTimeoutMs)||c.ollama.providerTimeoutMs<1||c.ollama.providerTimeoutMs>120000))throw Error('invalid-total-provider-deadline');
 const f=c.firebaseConfig;
 if(!exact(f,['firebase','appCheckSiteKey','appName'])||!exact(f.firebase,['apiKey','projectId','appId'])||
  !Object.values(f.firebase).every(x=>typeof x==='string'&&x.length>0&&x.length<=300)||
  typeof f.appCheckSiteKey!=='string'||!f.appCheckSiteKey||f.appCheckSiteKey.length>300||
  typeof f.appName!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(f.appName)||
  typeof c.contentSecurityPolicy!=='string'||!c.contentSecurityPolicy||c.contentSecurityPolicy.length>8192||/[\r\n]/.test(c.contentSecurityPolicy))throw Error('invalid-public-browser-config');
 return structuredClone(c);
}
async function prepareOllamaWorkbench({config,requestJSON,onFault}={}){
 const c=parseLaunchConfig(JSON.stringify(config));
 const {providerTimeoutMs=15000,...coderOptions}=c.ollama;
 const coder=new OllamaCoderClient({...coderOptions,requestJSON,onFault}),deadline=new AbortController();let timer;
 try{
  const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{deadline.abort();reject(Error('ollama-preflight-deadline'));},providerTimeoutMs);});
  const reported=await Promise.race([coder.preflight({signal:deadline.signal}),timedOut]);
  return{coder,reported,live:{coder,profile:reported.profile,firebaseConfig:c.firebaseConfig,contentSecurityPolicy:c.contentSecurityPolicy,providerTimeoutMs}};
 }catch{coder.stop();throw Error('ollama-workbench-preflight-failed');}
 finally{clearTimeout(timer);}
}
async function main(argv,{readFile=filename=>{
 const st=fs.statSync(filename);if(!st.isFile()||st.size>20000)throw Error('invalid-config-file');
 return fs.readFileSync(filename,'utf8');
},requestJSON,startServer=start,log=console.log,onFault=({code})=>console.error('Local coder status:',code)}={}){
 if(argv.length!==2||argv[0]!=='--config')throw Error('usage: node ui/ollama-workbench.cjs --config EXPLICIT_CONFIG_JSON');
 const config=parseLaunchConfig(readFile(argv[1]));
 const prepared=await prepareOllamaWorkbench({config,requestJSON,onFault});
 try{
  const server=await startServer({live:prepared.live});
  log('Local engine metadata passed consistency checks. This is not no-egress, model quality or hardware-fit evidence.');
  log('No isolated verifier is registered by this launcher; returned code stays unverified/in memory.');
  log('Total provider deadline: '+prepared.live.providerTimeoutMs+'ms (15-second default); per-HTTP deadlines remain separate. This is a configured limit, not measured speed or stopped upstream computation.');
  return{server,coder:prepared.coder,reported:prepared.reported};
 }catch{prepared.coder.stop();throw Error('ollama-workbench-start-failed');}
}
if(require.main===module){
 main(process.argv.slice(2)).then(({server,coder})=>{
  const stop=()=>{coder.stop();server.close(()=>{process.exitCode=0;});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }).catch(error=>{
  console.error(error.message?.startsWith('usage:')?error.message:'Local workbench did not start. Check approved configuration/resources; no result is claimed.');
  process.exitCode=1;
 });
}
module.exports={parseLaunchConfig,prepareOllamaWorkbench,main};
