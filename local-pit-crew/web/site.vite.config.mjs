import {defineConfig} from 'vite';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {getTasks}=require('../test/fixtures.cjs');
// Only the immutable authored catalog is compiled here. Browser requests cannot
// submit code, select an executable path, or reach a runtime source evaluator.
export function authoredProgramsModule(tasks=getTasks()){
 const programs=Object.fromEntries(tasks.map(task=>[task.id,Object.fromEntries(['baseline','corrected',...(task.regressionTrap?['regression-trap']:[])].map(variant=>{
  const files=variant==='baseline'?task.files:{...task.files,...(variant==='regression-trap'?task.regressionTrap:task.correction)};
  const modules=Object.entries(files).map(([path,source])=>JSON.stringify(path)+':function(module,exports,require){\n'+source+'\n}').join(',\n');
  return[variant,`function(){const modules={${modules}},cache=new Map();function load(id){if(!Object.hasOwn(modules,id))throw Error('Unknown authored module');if(cache.has(id))return cache.get(id).exports;const module={exports:{}};cache.set(id,module);modules[id](module,module.exports,spec=>{if(!spec.startsWith('./'))throw Error('Unknown authored import');const base=id.includes('/')?id.slice(0,id.lastIndexOf('/')+1):'';return load(base+spec.slice(2)+(spec.endsWith('.js')?'':'.js'));});return module.exports;}return load(${JSON.stringify(task.entry)});}`];
 }))]));
 const source='{'+Object.entries(programs).map(([id,variants])=>JSON.stringify(id)+':{'+Object.entries(variants).map(([variant,factory])=>JSON.stringify(variant)+':'+factory).join(',')+'}').join(',')+'}';
 return `import catalogModule from '../src/reference-catalog.cjs';import {referenceAssert} from './reference-assert.mjs';
const {definitions}=catalogModule.createCatalog(referenceAssert),programs=${source};
export async function runAuthoredBrowserChecks(id,variant){
 if(typeof id!=='string'||typeof variant!=='string'||!Object.hasOwn(programs,id)||!Object.hasOwn(programs[id],variant))throw Error('Reference runner refuses arbitrary source/variant');
 const task=definitions.find(task=>task.id===id),checks=await task.checks(programs[id][variant]());
 return{taskId:id,variant,checks,pass:checks.every(check=>check.ok),scope:'authored reference programs only'};
}`;
}
const virtualId='virtual:authored-reference-programs',resolvedId=fileURLToPath(new URL('./authored-reference-programs.virtual.mjs',import.meta.url));
function externalInterpreterAsset(){return{name:'external-interpreter-asset',enforce:'pre',transform(source,id){
 if(!id.replaceAll('\\','/').endsWith('/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.browser.mjs'))return;
 // Vite library builds otherwise inline the 503 kB interpreter into both its
 // loader and the worker. Keep the pinned vendor fallback URL external too.
 const before='(new URL("emscripten-module.wasm",import.meta.url)).href';
 if(source.split(before).length!==2)throw Error('Pinned interpreter asset URL changed');
 return source.replace(before,'(new URL("emscripten-module.wasm?no-inline",import.meta.url)).href');
}};}
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),
 cacheDir:fileURLToPath(new URL('./.vite-cache-site',import.meta.url)),
 resolve:{alias:{'node:crypto':fileURLToPath(new URL('./reference-crypto.mjs',import.meta.url))},conditions:['browser','import','default']},
 worker:{
  format:'es',
  plugins:()=>[externalInterpreterAsset()],
  rolldownOptions:{output:{
   // Load the verifier's JavaScript in one request and cache its Wasm separately.
   codeSplitting:false,
   entryFileNames:'function-worker-[hash].mjs',
   assetFileNames:'function-[name]-[hash][extname]'
  }}
 },
 plugins:[externalInterpreterAsset(),{name:'closed-authored-programs',resolveId(id){if(id===virtualId)return resolvedId;},load(id){if(id===resolvedId)return authoredProgramsModule();}}],
 build:{rolldownOptions:{output:{comments:{legal:true},assetFileNames:'function-[name]-[hash][extname]'}},lib:{entry:fileURLToPath(new URL('./reference-app.mjs',import.meta.url)),formats:['es'],fileName:()=> 'reference-app.mjs'},
  outDir:fileURLToPath(new URL('./site-dist',import.meta.url)),emptyOutDir:true,sourcemap:false}
});
