'use strict';
// Explicit full workbench: a trusted setup builds and qualifies the runner.
// Importing this launcher starts no process, model, engine request or server.
const fs=require('node:fs');
const {parseLaunchConfig,prepareOllamaWorkbench}=require('./ollama-workbench.cjs');
const {parseCoderLaunchConfig,prepareCoderWorkbench}=require('./coder-workbench.cjs');
const {prepareDockerVerifier}=require('../runner/docker/admission.cjs');
const {start}=require('./server.cjs');
const {parseFirebaseLaunchConfig}=require('./firebase-workbench.cjs');
const help=`Usage: npm run start:verified -- --config FILE --docker-socket SOCKET [options]

Verify local-model patches with the trusted Docker/QuickJS runner.
Node.js 24+, an installed Ollama model with cloud disabled, and a running Linux
Docker daemon are prerequisites. Setup builds and qualifies the runner before
opening the workbench; allow several minutes. No model is downloaded by setup.

  --config FILE          Explicit local JSON configuration (required)
  --docker-socket PATH   Linux Docker socket path (required)
  --coder-only           Ollama-only mode; no Firebase or Nano preparation needed
  --manual               Review pasted function patches; no Ollama required.
                         --config is optional and supplies browser Firebase only.
  --wsl-distro NAME      Windows WSL distro (default: Ubuntu-24.04)
  --port NUMBER          Fixed numeric loopback port, 1024-65535
  --app-check-debug      Explicit loopback-only Firebase development attestation
  --help                Show this help without contacting engines or Docker

Hybrid mode requires the full Firebase configuration and a ready on-device
browser model. On Windows, Docker and /usr/bin/node must be available in WSL.
See docs/local-coder.md and docs/firebase-setup.md for configuration examples.`;
const setupGuidance=Object.freeze({
 options:'Check the command options. Run npm run start:verified -- --help for usage.',
 config:'Check that --config names a readable JSON file matching docs/local-coder.md. An Ollama-only file needs --coder-only; hybrid mode needs the full Firebase configuration.',
 coder:'Check that the configured numeric-loopback Ollama daemon is running with cloud disabled and the selected model is already installed. Confirm configured version/digest pins against that daemon. See docs/local-coder.md.',
 verifier:'Check the Linux Docker socket and daemon permissions. On Windows, confirm --wsl-distro and /usr/bin/node inside that distro. If a build or self-test failed, inspect the bounded verifier output above. Qualification must pass before Verify can open. See docs/local-coder.md.',
 server:'Check that the selected loopback port is free, or omit --port to choose an unused port.'
});
class VerifiedSetupError extends Error{
 constructor(stage){super('Verified workbench setup failed at '+stage+'. '+setupGuidance[stage]+' No verified workbench is available from this launch.');}
}
function parseArguments(argv){
 const options={};
 for(let i=0;i<argv.length;i++){
  const name=argv[i];
  if(name==='--app-check-debug'&&!Object.hasOwn(options,'developmentAppCheck'))options.developmentAppCheck=true;
  else if(name==='--coder-only'&&!Object.hasOwn(options,'coderOnly'))options.coderOnly=true;
  else if(name==='--manual'&&!Object.hasOwn(options,'manual'))options.manual=true;
  else if(['--config','--docker-socket','--wsl-distro','--port'].includes(name)&&!Object.hasOwn(options,name)){
   const value=argv[++i];if(typeof value!=='string'||!value||value.startsWith('--'))throw Error('invalid-workbench-options');options[name]=value;
  }else throw Error('invalid-workbench-options');
 }
 if((!options.manual&&!options['--config'])||!options['--docker-socket']||options.manual&&options.coderOnly)throw Error('explicit-config-and-docker-socket-required');
 if(options.manual&&options.developmentAppCheck&&!options['--config'])throw Error('firebase-config-required-for-debug');
 if(options['--port']!==undefined&&(!/^\d{4,5}$/.test(options['--port'])||Number(options['--port'])<1024||Number(options['--port'])>65535))throw Error('invalid-loopback-port');
 return options;
}
function parseVerifiedConfig(raw,{coderOnly=false}={}){
 if(typeof coderOnly!=='boolean'||typeof raw!=='string'||Buffer.byteLength(raw)>20000)throw Error('invalid-verified-config');
 if(coderOnly){
  let value;try{value=JSON.parse(raw);}catch{throw Error('invalid-verified-config-json');}
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'ollama'))return parseCoderLaunchConfig(raw);
 }
 return parseLaunchConfig(raw);
}
async function main(argv){
 if(argv.length===1&&argv[0]==='--help'){console.log(help);return;}
 let stage='options';
 const setup=new AbortController();let prepared=null,registration=null,server=null,closed=false;
 const close=async()=>{
  if(closed)return;closed=true;setup.abort();prepared?.coder.stop();
  server?.closeAllConnections();server?.close();await registration?.close();
 };
 process.once('SIGTERM',close);process.once('SIGINT',close);
 try{
  const options=parseArguments(argv);stage='config';
  let config=null;
  if(options['--config']){
   const configPath=options['--config'],stat=fs.statSync(configPath);
   if(!stat.isFile()||stat.size>20000)throw Error('invalid-launch-config');
   const raw=fs.readFileSync(configPath,'utf8');
   config=options.manual?parseFirebaseLaunchConfig(raw):parseVerifiedConfig(raw,{coderOnly:options.coderOnly===true});
  }
  if(!options.manual){
   stage='coder';console.log('Checking the configured local coding engine and installed model.');
   prepared=Object.hasOwn(config,'firebaseConfig')?await prepareOllamaWorkbench({config}):await prepareCoderWorkbench({config});
  }
  stage='verifier';
  console.log('Building and qualifying pagination, settings isolation and JSON function verification. This can take several minutes.');
  registration=await prepareDockerVerifier({socket:options['--docker-socket'],distro:options['--wsl-distro'],signal:setup.signal});
  if(closed){await registration.close();throw Error('setup-canceled');}
  stage='server';
  server=await start({...(options.manual?{...config,functionVerifier:registration}:{live:{...prepared.live,coderOnlyPreview:options.coderOnly===true,publicVerifier:registration}}),developmentAppCheck:options.developmentAppCheck===true,
   port:options['--port']===undefined?0:Number(options['--port'])});
  console.log('Pagination, settings isolation and JSON function checks: runtime-qualified Docker/QuickJS. Asynchronous search stays unadmitted. Held-out correctness and Nano benefit are not established.');
  console.log(options.manual?'Manual function patches: no coding engine or model download required.':options.coderOnly?'Planning: deterministic local coder; no Nano preparation is required.':'Planning: Nano after a generated patch fails public checks; prepare the on-device browser model before opening the local coder.');
  return{server,coder:prepared?.coder??null,registration,close};
 }catch{await close();throw new VerifiedSetupError(stage);}
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error instanceof VerifiedSetupError?error.message:'Verified workbench setup failed. No generated-code admission was issued.');process.exitCode=1;});
module.exports={parseArguments,parseVerifiedConfig,main};
