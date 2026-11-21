'use strict';
// Build a static reference bench. No inference or credentials are requested here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {parseFirebaseLaunchConfig}=require('../ui/firebase-workbench.cjs');
const {verifyFirebaseBundle}=require('../src/firebase-bundle.cjs');
const {staticCachePolicy}=require('../src/static-cache-policy.cjs');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),out=path.join(web,'site-dist');
const readText=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fingerprint(name,bytes){
 const extension=path.extname(name);
 return name.slice(0,-extension.length)+'-'+sha256(bytes).slice(0,16)+extension;
}
function writeStartupAsset(name,bytes){
 const file=fingerprint(name,bytes);
 fs.writeFileSync(path.join(out,file),bytes);
 return file;
}
async function main(argv){
 if(argv.length!==0&&(argv.length!==2||argv[0]!=='--config'))throw Error('usage: npm run build:web -- [--config browser.local.json]');
 const config=argv.length?parseFirebaseLaunchConfig(fs.readFileSync(path.resolve(argv[1]),'utf8')):null;
 if(!await verifyFirebaseBundle())throw Error('Rebuild the pinned Firebase asset before building the web app');
 const built=spawnSync(process.execPath,[path.join(web,'node_modules/vite/bin/vite.js'),'build','--config','site.vite.config.mjs'],{cwd:web,stdio:'inherit'});
 if(built.status!==0)throw Error('Static reference build failed');
 const source=path.join(root,'ui/public');
 const app=writeStartupAsset('app.js',readText(path.join(source,'app.js')));
 const style=writeStartupAsset('style.css',readText(path.join(source,'style.css')));
 const compiledEntry=path.join(out,'reference-app.mjs');
 const entry=fingerprint('reference-app.mjs',fs.readFileSync(compiledEntry));
 fs.renameSync(compiledEntry,path.join(out,entry));
 const interpreters=fs.readdirSync(out).filter(name=>name.endsWith('.wasm'));
 if(interpreters.length!==1||staticCachePolicy(interpreters[0])==='no-store')throw Error('Expected one fingerprinted browser interpreter');
 // These two direct links always run browser checks as soon as the app mounts.
 // Start the interpreter download alongside the app modules for those visits.
 const preloadInterpreter=`const cancelInterpreterPreload=(()=>{
 if(location.hash!=='#checkout-repair'&&location.hash!=='#same-score')return;
 if(typeof Worker!=='function'||typeof WebAssembly!=='object'||typeof AbortController!=='function'||typeof fetch!=='function')return;
 const controller=new AbortController();
 fetch(${JSON.stringify('/'+interpreters[0])},{signal:controller.signal,priority:'low'})
  .then(response=>response.ok?response.arrayBuffer():undefined).catch(()=>{});
 return ()=>controller.abort();
})();`;
 const bootstrap=`import("/${entry}").then(({startBrowserReferenceApp})=>startBrowserReferenceApp({cancelInterpreterPreload})).catch(()=>{
 cancelInterpreterPreload?.();
 const status=document.getElementById('entry-status');
 status.textContent='The repair bench could not load. Reload to fetch the current build.';
 status.className='status error';
 const retry=document.getElementById('reload-bench');
 retry.hidden=false;
 retry.addEventListener('click',()=>location.reload(),{once:true});
});`;
 const html=readText(path.join(source,'index.html'))
  .replace('href="/style.css"','href="/'+style+'"')
  .replace('<script src="/browser-planner-pump.js" defer></script>','')
  .replace('<script src="/app.js" defer></script>',
   '<link rel="modulepreload" href="/'+entry+'"><link rel="modulepreload" href="/'+app+'"><script>'+preloadInterpreter+'</script><script type="module">'+bootstrap+'</script>')
  .replace('</head>','<meta name="local-pit-crew-firebase" content="'+(config?'configured':'disabled')+'">\n<meta name="local-pit-crew-app" content="/'+app+'">\n</head>')
  .replace('127.0.0.1 / LOCAL COMPANION','BROWSER REPAIR BENCH')
  .replace('Connecting to the local service…','Opening the repair bench…')
  .replace('Checking function execution support…</p>','Checking function execution support…</p><button id="reload-bench" class="secondary" hidden>Reload the bench</button>');
 fs.writeFileSync(path.join(out,'index.html'),html);
 fs.copyFileSync(path.join(source,'checkout-preview.jpg'),path.join(out,'checkout-preview.jpg'));
 for(const file of ['firebase-planner.mjs','firebase-bundle.json'])fs.copyFileSync(path.join(source,file),path.join(out,file));
 const licenses=['@noble/hashes','quickjs-emscripten-core','@jitl/quickjs-wasmfile-release-sync','@jitl/quickjs-ffi-types'];
 fs.writeFileSync(path.join(out,'LICENSES.txt'),fs.readFileSync(path.join(root,'../LICENSE'),'utf8')+licenses.map(name=>'\n\n'+name+'\n'+fs.readFileSync(path.join(web,'node_modules',name,'LICENSE'),'utf8')).join(''));
 fs.writeFileSync(path.join(out,'firebase-config.json'),JSON.stringify({firebaseConfig:config?.firebaseConfig??null},null,2)+'\n');
 const directives=(config?.contentSecurityPolicy??"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'").split(';').map(s=>s.trim()).filter(Boolean);
 const scripts=directives.findIndex(s=>s.split(/\s/)[0]==='script-src');
 if(scripts<0||directives[scripts].split(/\s+/).includes("'unsafe-eval'"))throw Error('Explicit script policy without JavaScript eval required');
 if(!directives[scripts].split(/\s+/).includes("'wasm-unsafe-eval'"))directives[scripts]+=" 'wasm-unsafe-eval'";
 const startupHashes=[preloadInterpreter,bootstrap].map(script=>"'sha256-"+crypto.createHash('sha256').update(script).digest('base64')+"'");
 for(const [index,directive] of directives.entries())if(/^script-src(?:-elem)?\s/.test(directive))
  directives[index]+=' '+startupHashes.join(' ');
 const workers=directives.findIndex(s=>s.split(/\s/)[0]==='worker-src');
 if(workers>=0)directives[workers]="worker-src 'self'";else directives.push("worker-src 'self'");
 const csp=directives.join('; ');
 const headers={'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':config?'strict-origin-when-cross-origin':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store'};
 const cachePolicies=Object.fromEntries(fs.readdirSync(out).filter(name=>fs.statSync(path.join(out,name)).isFile()&&staticCachePolicy(name)!=='no-store').map(name=>[name,staticCachePolicy(name)]));
 const offlineSource=readText(path.join(web,'offline-worker.js'));
 const immutable=Object.keys(cachePolicies).sort();
 const publicFiles=['index.html','checkout-preview.jpg',...(config?['firebase-config.json','firebase-planner.mjs']:[])];
 const cachedFiles=Object.fromEntries([...immutable,...publicFiles].map(name=>[name,fs.readFileSync(path.join(out,name))]));
 const release=crypto.createHash('sha256').update(offlineSource).update(JSON.stringify(headers));
 for(const [name,bytes] of Object.entries(cachedFiles))release.update(name).update(bytes);
 const version=release.digest('hex').slice(0,16);
 cachedFiles['index.html']=Buffer.from(html.replace('</head>','<meta name="local-pit-crew-offline-build" content="'+version+'">\n</head>'));
 fs.writeFileSync(path.join(out,'index.html'),cachedFiles['index.html']);
 const offlineBuild={version,immutable:immutable.map(name=>'/'+name),publicFiles:publicFiles.map(name=>'/'+name),
  digests:Object.fromEntries(Object.entries(cachedFiles).map(([name,bytes])=>['/'+name,sha256(bytes)]))};
 fs.writeFileSync(path.join(out,'offline-worker.js'),'const offlineBuild = '+JSON.stringify(offlineBuild)+';\n'+offlineSource);
 fs.writeFileSync(path.join(out,'_headers'),'/*\n'+Object.entries(headers).map(([key,value])=>'  '+key+': '+value).join('\n')+'\n'+Object.entries(cachePolicies).map(([name,value])=>'/'+name+'\n  Cache-Control: '+value+'\n').join(''));
 fs.writeFileSync(path.join(out,'hosting-headers.json'),JSON.stringify(headers,null,2)+'\n');
 fs.writeFileSync(path.join(out,'firebase.json'),JSON.stringify({hosting:{public:'.',ignore:['firebase.json','hosting-headers.json','**/.*'],headers:[{source:'**',headers:Object.entries(headers).map(([key,value])=>({key,value}))},...Object.entries(cachePolicies).map(([name,value])=>({source:'/'+name,headers:[{key:'Cache-Control',value}]}))]}},null,2)+'\n');
 const files=fs.readdirSync(out).filter(file=>fs.statSync(path.join(out,file)).isFile());
 const manifest={schema:'local-pit-crew/static-reference-build/v1',firebaseConfigured:!!config,
  execution:'authored-drills-and-bounded-function-worker',storage:'browser-memory',appCheckDebug:false,cachePolicies,
  files:Object.fromEntries(files.map(file=>[file,sha256(fs.readFileSync(path.join(out,file)))]))};
 fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('Static reference bench built; Firebase configured:',!!config);
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
