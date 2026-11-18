'use strict';
// Explicit coder-only preview. It does not prepare Nano or admit generated-code execution.
const fs=require('node:fs');
const {OllamaCoderClient}=require('../src/ollama-coder-client.cjs');
const {start}=require('./server.cjs');
function parseCoderLaunchConfig(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>16000)throw Error('invalid-coder-config-size');
 let c;try{c=JSON.parse(raw);}catch{throw Error('invalid-coder-config-json');}
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).length!==1||!Object.hasOwn(c,'ollama')||
  !c.ollama||typeof c.ollama!=='object'||Array.isArray(c.ollama)||!Object.hasOwn(c.ollama,'model'))throw Error('invalid-coder-config');
 const {providerTimeoutMs=120000,...options}=c.ollama;
 const allowed=['model','endpoint','contextTokens','maxOutputTokens','keepAliveSeconds','thinking','expectedVersion','expectedDigest','profileContextHash','requestTimeoutMs','responseMode'];
 if(Object.keys(options).some(key=>!allowed.includes(key))||!Number.isSafeInteger(providerTimeoutMs)||providerTimeoutMs<1||providerTimeoutMs>120000)throw Error('invalid-coder-options');
 return structuredClone(c);
}
async function prepareCoderWorkbench({config,requestJSON}={}){
 const c=parseCoderLaunchConfig(JSON.stringify(config)),{providerTimeoutMs=120000,...options}=c.ollama;
 const coder=new OllamaCoderClient({...options,requestJSON}),abort=new AbortController();let timer;
 try{
  const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('coder-preflight-deadline'));},providerTimeoutMs);});
  const reported=await Promise.race([coder.preflight({signal:abort.signal}),timedOut]);
  return{coder,reported,live:{coder,profile:reported.profile,coderOnlyPreview:true,providerTimeoutMs}};
 }catch(error){coder.stop();throw error;}
 finally{clearTimeout(timer);}
}
async function main(argv){
 if(argv.length!==2||argv[0]!=='--config')throw Error('usage: node ui/coder-workbench.cjs --config coder.local.json');
 const stat=fs.statSync(argv[1]);if(!stat.isFile()||stat.size>16000)throw Error('invalid-coder-config-size');
 const config=parseCoderLaunchConfig(fs.readFileSync(argv[1],'utf8'));
 const {coder,live}=await prepareCoderWorkbench({config});
 try{
  const server=await start({live});
  const close=()=>{coder.stop();server.closeAllConnections();server.close();};
  process.once('SIGINT',close);process.once('SIGTERM',close);
  return{server,coder};
 }catch(error){coder.stop();throw error;}
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Coder preview failed. Check the explicit configuration and local daemon.');process.exitCode=1;});
module.exports={main,parseCoderLaunchConfig,prepareCoderWorkbench};
