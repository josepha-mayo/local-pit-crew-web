'use strict';
// Immutable authored programs and shared public checks; no runtime code loading.
function createCatalog(assert){
const definitions=[
 {
  id:'pagination-zero',
  prompt:'Fix list: a cursor is absent only when null or undefined. Zero and the empty string are valid and must reach the adapter unchanged. Preserve the adapter and public API.',
  entry:'src/list.js',writable:['src/list.js'],
  files:{
   'src/list.js':"const {fetchPage}=require('./adapter');\nfunction list(cursor,limit=20){const params={limit};if(cursor)params.cursor=cursor;return fetchPage(params);}\nmodule.exports={list};\n",
   'src/adapter.js':"function fetchPage(params){return {...params};}\nmodule.exports={fetchPage};\n"
  },
  correction:{
   'src/list.js':"const {fetchPage}=require('./adapter');\nfunction list(cursor,limit=20){const params={limit};if(cursor!==null&&cursor!==undefined)params.cursor=cursor;return fetchPage(params);}\nmodule.exports={list};\n"
  },
  regressionTrap:{
   'src/list.js':"const {fetchPage}=require('./adapter');\nfunction list(cursor,limit=20){const params={limit,cursor};return fetchPage(params);}\nmodule.exports={list};\n"
  },
  checks:async api=>{
   const checks=[];const check=(id,fn)=>{try{fn();checks.push({id,ok:true});}catch(e){checks.push({id,ok:false,message:e.message});}};
   check('zero-preserved',()=>assert.equal(api.list(0).cursor,0));
   check('empty-preserved',()=>assert.equal(api.list('').cursor,''));
   check('undefined-absent',()=>assert.equal(Object.hasOwn(api.list(undefined),'cursor'),false));
   check('null-absent',()=>assert.equal(Object.hasOwn(api.list(null),'cursor'),false));
   check('string-preserved',()=>assert.equal(api.list('next-07').cursor,'next-07'));
   check('limit-preserved',()=>assert.equal(api.list(0,7).limit,7));
   return checks;
  }
 },
 {
  id:'config-isolation',
  prompt:'Fix cross-call state leakage in makeConfig. Returned retry objects must not share mutable state with defaults or earlier results. Preserve retries:0, defaults and the existing return shape.',
  entry:'src/config.js',writable:['src/config.js'],
  files:{
   'src/defaults.js':"module.exports={timeoutMs:500,retry:{attempts:3,delayMs:50}};\n",
   'src/config.js':"const defaults=require('./defaults');\nfunction makeConfig(options={}){const config={...defaults};if(options.timeoutMs!==undefined)config.timeoutMs=options.timeoutMs;if(options.retries!==undefined)config.retry.attempts=options.retries;return config;}\nmodule.exports={makeConfig};\n"
  },
  correction:{
   'src/config.js':"const defaults=require('./defaults');\nfunction makeConfig(options={}){const config={...defaults,retry:{...defaults.retry}};if(options.timeoutMs!==undefined)config.timeoutMs=options.timeoutMs;if(options.retries!==undefined)config.retry.attempts=options.retries;return config;}\nmodule.exports={makeConfig};\n"
  },
  checks:async api=>{
   const checks=[];const check=(id,fn)=>{try{fn();checks.push({id,ok:true});}catch(e){checks.push({id,ok:false,message:e.message});}};
   check('custom-default-isolation',()=>{api.makeConfig({retries:1});assert.equal(api.makeConfig().retry.attempts,3);});
   check('returned-mutation-isolation',()=>{const a=api.makeConfig();a.retry.delayMs=900;assert.equal(api.makeConfig().retry.delayMs,50);});
   check('different-retry-reference',()=>assert.notEqual(api.makeConfig().retry,api.makeConfig().retry));
   check('zero-retries',()=>assert.equal(api.makeConfig({retries:0}).retry.attempts,0));
   check('explicit-timeout',()=>assert.equal(api.makeConfig({timeoutMs:42}).timeoutMs,42));
   return checks;
  }
 },
 {
  id:'latest-request-wins',
  prompt:'Fix createSearch: only the latest started query may update state, whether requests fulfill or reject. Older requests must not overwrite results, loading or error. Preserve the async run API.',
  entry:'src/search.js',writable:['src/search.js'],
  files:{
   'src/search.js':"function createSearch(fetcher){const state={results:[],loading:false,error:null};async function run(query){state.loading=true;state.error=null;try{state.results=await fetcher(query);}catch(error){state.error=error.message;}finally{state.loading=false;}}return{state,run};}\nmodule.exports={createSearch};\n"
  },
  correction:{
   'src/search.js':"function createSearch(fetcher){const state={results:[],loading:false,error:null};let revision=0;async function run(query){const mine=++revision;state.loading=true;state.error=null;try{const results=await fetcher(query);if(mine===revision)state.results=results;}catch(error){if(mine===revision)state.error=error.message;}finally{if(mine===revision)state.loading=false;}}return{state,run};}\nmodule.exports={createSearch};\n"
  },
  checks:async api=>{
   const checks=[];async function check(id,fn){try{await fn();checks.push({id,ok:true});}catch(e){checks.push({id,ok:false,message:e.message});}}
   function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};}
   await check('old-success-not-overwrite',async()=>{const old=deferred(),fresh=deferred();const s=api.createSearch(q=>q==='old'?old.promise:fresh.promise);const a=s.run('old'),b=s.run('fresh');fresh.resolve(['fresh']);await b;old.resolve(['old']);await a;assert.deepEqual(Array.from(s.state.results),['fresh']);});
   await check('old-completion-not-stop-loading',async()=>{const old=deferred(),fresh=deferred();const s=api.createSearch(q=>q==='old'?old.promise:fresh.promise);const a=s.run('old'),b=s.run('fresh');old.resolve(['old']);await a;assert.equal(s.state.loading,true);fresh.resolve(['fresh']);await b;assert.equal(s.state.loading,false);});
   await check('old-error-not-poison-latest',async()=>{const old=deferred(),fresh=deferred();const s=api.createSearch(q=>q==='old'?old.promise:fresh.promise);const a=s.run('old'),b=s.run('fresh');fresh.resolve(['fresh']);await b;old.reject(new Error('old failed'));await a;assert.equal(s.state.error,null);});
   await check('latest-error-visible',async()=>{const s=api.createSearch(()=>Promise.reject(new Error('fresh failed')));await s.run('fresh');assert.equal(s.state.error,'fresh failed');assert.equal(s.state.loading,false);});
   return checks;
  }
 }
];
for(const t of definitions){Object.freeze(t.files);Object.freeze(t.correction);if(t.regressionTrap)Object.freeze(t.regressionTrap);Object.freeze(t.writable);Object.freeze(t);}
Object.freeze(definitions);
function getTasks(){return definitions.map(({id,prompt,entry,writable,files,correction,regressionTrap})=>({id,prompt,entry,writable:[...writable],files:{...files},correction:{...correction},...(regressionTrap?{regressionTrap:{...regressionTrap}}:{})}));}
return{definitions,getTasks};
}
module.exports={createCatalog};
