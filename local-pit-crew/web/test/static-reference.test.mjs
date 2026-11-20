import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash as browserHash} from '../reference-crypto.mjs';
const require=createRequire(import.meta.url),{getTasks,runAuthoredChecks}=require('../../test/fixtures.cjs');
const {staticCachePolicy,IMMUTABLE_CACHE}=require('../../src/static-cache-policy.cjs');
const base=new URL('../site-dist/',import.meta.url);
const artifactNames=await readdir(base);
function startupAsset(prefix,extension){
 const matches=artifactNames.filter(name=>name.startsWith(prefix+'-')&&name.endsWith(extension));
 assert.equal(matches.length,1,prefix);
 return matches[0];
}
const appAsset=startupAsset('app','.js'),entryAsset=startupAsset('reference-app','.mjs');
const cssAsset=startupAsset('style','.css');
const {createBrowserReferenceApp,runAuthoredBrowserChecks}=await import(new URL(entryAsset,base));
test('compiled browser programs match the Node reference checks and reset module state',async()=>{
 for(let repeat=0;repeat<2;repeat++)for(const task of getTasks())for(const variant of ['baseline','corrected',...(task.regressionTrap?['regression-trap']:[])]){
  const actual=await runAuthoredBrowserChecks(task.id,variant),expected=await runAuthoredChecks(task.id,variant);
  assert.deepEqual(actual.checks.map(({id,ok})=>({id,ok})),expected.checks.map(({id,ok})=>({id,ok})));
  assert.equal(actual.pass,expected.pass);
 }
});
test('compiled reference runner rejects code and unknown program selectors',async()=>{
 await assert.rejects(runAuthoredBrowserChecks('pagination-zero',"process.exit()"));
 await assert.rejects(runAuthoredBrowserChecks("module.exports={}",'baseline'));
 await assert.rejects(runAuthoredBrowserChecks('__proto__','baseline'));
 await assert.rejects(runAuthoredBrowserChecks('pagination-zero','toString'));
 await assert.rejects(runAuthoredBrowserChecks('config-isolation','regression-trap'));
});
test('browser source hashes agree with Node SHA-256, including UTF-8 source',()=>{
 for(const text of ['', 'abc', 'zero\0empty\n', '日本語 😀 café',...getTasks().flatMap(task=>Object.values(task.files))]){
  assert.equal(browserHash('sha256').update(text).digest('hex'),createHash('sha256').update(text).digest('hex'));
 }
});
test('static workflow completes every authored repair and keeps edits in its own tab state',async()=>{
 const request=await createBrowserReferenceApp(),boot=await(await request('/api/bootstrap')).json();
 const post=async(path,body)=>{
  const response=await request(path,{method:'POST',headers:{'Content-Type':'application/json','X-Pitcrew-Token':boot.sessionToken},body:JSON.stringify(body)});
  assert.equal(response.ok,true,JSON.stringify(await response.json()));return response.json();
 };
 for(const task of getTasks()){
  let {state}=await post('/api/start',{taskId:task.id});
  const act=async(action,extra={})=>{({state}=await post('/api/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra}));};
  await act('test');assert.ok(state.checks.some(check=>!check.ok));
  for(const path of Object.keys(task.files))await act('read',{path});
  const staleRevision=state.snapshot.revision;
  await act('load-authored');
  const stale=await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Pitcrew-Token':boot.sessionToken},body:JSON.stringify({sessionId:state.sessionId,revision:staleRevision,action:'apply'})});
  assert.equal(stale.status,409);
  await act('apply');assert.equal(state.snapshot.publicChecksCurrent,false);
  await act('test');assert.ok(state.checks.every(check=>check.ok));
  assert.equal(state.storage,'browser-memory');assert.equal(state.snapshot.publicChecksCurrent,true);
  await act('finish');assert.equal(state.snapshot.closed,true);
 }
 const fresh=await createBrowserReferenceApp();
 assert.equal((await(await fresh('/api/bootstrap')).json()).state.snapshot,null);
});
test('static transport is explicit, rejects unrecognized routes, and never uses network for drills',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected drill network request');};
 try{
  const request=await createBrowserReferenceApp();
  const boot=await(await request('/api/bootstrap')).json();assert.equal(boot.capabilities.planner.available,false);
  await assert.rejects(request('/api/workbench/start',{method:'POST'}));
  await assert.rejects(request('/api/start',{method:'POST',body:'{}'}));
  const config={firebase:{projectId:'fixture-project'},appName:'fixture'};
  const configured=await createBrowserReferenceApp(config),configuredBoot=await(await configured('/api/bootstrap')).json();
  assert.equal(configuredBoot.capabilities.planner.available,true);
 }finally{globalThis.fetch=oldFetch;}
});
test('built static artifact has no host JavaScript evaluator, Node imports or App Check debug bootstrap',async()=>{
 const names=await readdir(base);
 for(const name of names.filter(name=>/\.(m?js|html)$/.test(name))){
  const text=await readFile(new URL(name,base),'utf8');
  assert.doesNotMatch(text,/\beval\s*\(|new\s+Function\s*\(|(?:from|import\s*\()\s*['"]node:/,name);
  // The pinned Firebase SDK contains its own optional debug-token machinery.
  // Our entrypoints must never activate it in the hosted build.
  if(name!=='firebase-planner.mjs')assert.doesNotMatch(text,/FIREBASE_APPCHECK_DEBUG_TOKEN\s*=/,name);
  assert.doesNotMatch(text,/app-check-development\.js/,name);
 }
 const manifest=JSON.parse(await readFile(new URL('build-manifest.json',base),'utf8'));
 const config=JSON.parse(await readFile(new URL('firebase-config.json',base),'utf8'));
 assert.deepEqual(Object.keys(config),['firebaseConfig']);
 assert.equal(config.firebaseConfig!==null,manifest.firebaseConfigured);
 if(config.firebaseConfig){
  assert.deepEqual(Object.keys(config.firebaseConfig).sort(),['appCheckSiteKey','appName','firebase']);
  assert.deepEqual(Object.keys(config.firebaseConfig.firebase).sort(),['apiKey','appId','projectId']);
 }
 assert.equal(manifest.appCheckDebug,false);assert.equal(manifest.execution,'authored-drills-and-bounded-function-worker');
 const workerScripts=Object.keys(manifest.files).filter(name=>/^function-.*\.mjs$/.test(name));
 assert.equal(workerScripts.length,1,'The browser verifier loads one JavaScript asset');
 assert.match(workerScripts[0],/^function-worker-/);
 const wasm=Object.keys(manifest.files).filter(name=>name.endsWith('.wasm'));
 assert.equal(wasm.length,1);assert.equal((await readFile(new URL(wasm[0],base))).byteLength,503134);
 for(const name of names.filter(name=>/\.(m?js)$/.test(name)))assert.doesNotMatch(await readFile(new URL(name,base),'utf8'),/data:application\/wasm;base64/,'Interpreter must not be duplicated in JS');
 for(const [name,hash]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(await readFile(new URL(name,base))).digest('hex'),hash,name);
 for(const name of [appAsset,entryAsset,cssAsset]){
  assert.match(name,new RegExp('-'+manifest.files[name].slice(0,16)+'\\.(?:m?js|css)$'));
  assert.equal(manifest.cachePolicies[name],IMMUTABLE_CACHE);
 }
 assert.deepEqual(manifest.cachePolicies,Object.fromEntries(Object.keys(manifest.files).filter(name=>staticCachePolicy(name)!=='no-store').map(name=>[name,IMMUTABLE_CACHE])));
 const firebase=JSON.parse(await readFile(new URL('firebase.json',base),'utf8'));
 for(const [name,value]of Object.entries(manifest.cachePolicies))assert.deepEqual(firebase.hosting.headers.find(rule=>rule.source==='/'+name).headers,[{key:'Cache-Control',value}]);
});
test('distributed browser assets retain upstream notices and the full hash-library license',async()=>{
 const firebase=await readFile(new URL('firebase-planner.mjs',base),'utf8');
 assert.ok(/@license[\s\S]{0,100}Copyright 20\d\d Google LLC/.test(firebase),'Firebase copyright notice retained');
 assert.ok(/Licensed under the Apache License, Version 2\.0/.test(firebase),'Firebase license notice retained');
 const licenses=await readFile(new URL('LICENSES.txt',base),'utf8');
 assert.match(licenses,/@noble\/hashes/);assert.match(licenses,/Copyright \(c\) 2022 Paul Miller/);
 assert.match(licenses,/The above copyright notice and this permission notice shall be included/);
});

test('static preview serves the compiled app with CSP and has no task mutation endpoints',async t=>{
 const server=await require('../../scripts/preview-web.cjs').start();
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;
 const page=await fetch(origin);assert.equal(page.status,200);
 assert.equal(page.headers.get('cache-control'),'no-store');
 assert.match(page.headers.get('content-security-policy'),/object-src 'none'/);
 assert.doesNotMatch(page.headers.get('content-security-policy'),/(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
 assert.match(page.headers.get('content-security-policy'),/'wasm-unsafe-eval'/);
 assert.match(page.headers.get('content-security-policy'),/worker-src 'self'/);
 const manifest=JSON.parse(await readFile(new URL('build-manifest.json',base),'utf8'));
 assert.equal(page.headers.get('referrer-policy'),manifest.firebaseConfigured?'strict-origin-when-cross-origin':'no-referrer');
 const html=await page.text();
 for(const expected of ['rel="modulepreload" href="/'+entryAsset+'"','rel="modulepreload" href="/'+appAsset+'"','name="local-pit-crew-app" content="/'+appAsset+'"','href="/'+cssAsset+'"','id="reload-bench"'])assert.ok(html.includes(expected),expected);
 assert.doesNotMatch(html,/browser-planner-pump/);
 assert.equal(Object.keys(manifest.files).some(name=>name.startsWith('browser-planner-pump')),false);
 const bootstrap=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(bootstrap?.includes('import("/'+entryAsset+'")'));
 assert.ok(page.headers.get('content-security-policy').includes("'sha256-"+createHash('sha256').update(bootstrap).digest('base64')+"'"));
 assert.doesNotMatch(page.headers.get('content-security-policy'),/'unsafe-inline'/);
 const asset=await fetch(origin+'/'+entryAsset);assert.equal(asset.status,200);
 assert.match(asset.headers.get('content-type'),/javascript/);
 const wasmName=Object.keys(manifest.files).find(name=>name.endsWith('.wasm'));
 const wasm=await fetch(origin+'/'+wasmName);assert.equal(wasm.headers.get('content-type'),'application/wasm');assert.equal(wasm.headers.get('cache-control'),IMMUTABLE_CACHE);
 for(const name of Object.keys(manifest.cachePolicies))assert.equal((await fetch(origin+'/'+name)).headers.get('cache-control'),IMMUTABLE_CACHE,name);
 for(const name of ['firebase-config.json','firebase-planner.mjs','build-manifest.json'])assert.equal((await fetch(origin+'/'+name)).headers.get('cache-control'),'no-store',name);
 for(const name of ['app.js','reference-app.mjs','style.css','browser-planner-pump.js'])assert.equal((await fetch(origin+'/'+name)).status,404,name);
 for(const name of ['index.html','function-unhashed.mjs','../function-worker-12345678.mjs','function-worker-12345678.mjs?x','function-runtime-12345678.json'])assert.equal(staticCachePolicy(name),'no-store');
 assert.equal((await fetch(origin+'/api/start',{method:'POST',body:'{}'})).status,404);
 assert.equal((await fetch(origin+'/.git/config')).status,404);
});
test('served UI mounts after DOM readiness and uses the real browser-memory workflow',async()=>{
 class Element{
  constructor(){this.children=[];this.listeners=new Map();this.disabled=true;this.value='';}
  addEventListener(name,fn){this.listeners.set(name,fn);}append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}click(){return this.listeners.get('click')?.();}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={readyState:'complete',getElementById:get,createElement:()=>new Element(),
  addEventListener(){throw Error('DOMContentLoaded already happened');}};
 const window={document,LocalPitCrewReferenceRequest:await createBrowserReferenceApp(),
  fetch(){throw Error('Authored drill attempted HTTP');},addEventListener(){},setTimeout,clearTimeout};
 const source=await readFile(new URL(appAsset,base),'utf8');
 assert.equal(source,await readFile(new URL('../../ui/public/app.js',import.meta.url),'utf8'));
 vm.runInNewContext(source,{window},{timeout:1000});
 const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
 await settle();assert.equal(get('open').disabled,false);assert.equal(get('open-live').hidden,true);
 get('sample').value='pagination-zero';await get('investigate').click();await settle();
 assert.equal(get('pass-count').textContent,'4/6');assert.equal(get('source-evidence').open,true);
 assert.equal(get('coder-calls').textContent,'0');assert.equal(get('planner-calls').textContent,'0');assert.equal(get('cloud-calls').textContent,'0');
 assert.equal(get('load-trap').disabled,false);assert.equal(get('check-changes').hidden,true);assert.equal(get('test').disabled,true);
 await get('load-trap').click();await settle();assert.match(get('proposal-source').textContent,/Authored regression trap/);
 await get('apply').click();await settle();await get('test').click();await settle();
 assert.equal(get('pass-count').textContent,'4/6');assert.equal(get('finish').disabled,true);assert.equal(get('check-changes').hidden,false);
 const text=element=>[element.textContent??'',...element.children.map(text)].join(' ');
 assert.match(text(get('check-changes')),/Same total, different behavior/);assert.match(text(get('check-changes')),/null-absent/);assert.match(text(get('check-changes')),/undefined-absent/);
 assert.equal(get('load').disabled,false);assert.equal(get('apply').disabled,true);
 await get('load').click();await settle();assert.equal(get('patch-state').textContent,'REVIEW REQUIRED');assert.equal(get('apply').disabled,false);
 await get('apply').click();await settle();assert.equal(get('check-changes').hidden,true);
 await get('test').click();await settle();assert.equal(get('pass-count').textContent,'6/6');
 assert.match(text(get('check-changes')),/4\/6 → 6\/6/);assert.doesNotMatch(text(get('check-changes')),/Now failing/);
 assert.equal(get('finish').disabled,false);assert.match(get('scope-copy').textContent,/Reloading resets/);
 await get('finish').click();await settle();await get('view-record').click();const record=JSON.parse(get('record-json').textContent);
 assert.equal(record.closed,true);assert.equal(record.counts.patches,2);assert.equal(record.counts.tests,3);assert.equal(record.counts.advisorCalls,0);assert.equal(record.counts.cloudCalls,0);assert.equal(record.counts.coderCalls,0);
 assert.equal(record.checkChanges.afterPassed,6);assert.deepEqual(record.checkChanges.regressed,[]);
 get('sample').value='config-isolation';await get('open').click();await settle();assert.equal(get('load-trap').hidden,true);assert.equal(get('check-changes').hidden,true);
});
