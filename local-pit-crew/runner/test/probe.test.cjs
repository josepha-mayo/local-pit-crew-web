'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {runCandidateProbe} = require('../probe.cjs');
const {ADAPTER, CHECK_IDS, validateInput, gradeObservations} = require('../policy.cjs');
const {getTasks} = require('../../test/fixtures.cjs');
const task = getTasks().find(t => t.id === 'pagination-zero');
const input = source => ({suiteId: task.id, files: {'src/list.js': source, 'src/adapter.js': ADAPTER}});
const corrected = task.correction['src/list.js'];
function coldProbe(body){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['-e',body],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});
  let bytes=0,chunks=[];const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>64000)child.kill('SIGKILL');else chunks.push(b);});
  child.stderr.on('data',b=>{bytes+=b.length;if(bytes>64000)child.kill('SIGKILL');});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);try{assert.equal(code,0);resolve(JSON.parse(Buffer.concat(chunks)));}catch(error){reject(error);}});
 });
}

test('cancelling cold trusted-engine preparation creates no candidate worker and permits recovery',async()=>{
 const result=await coldProbe(`
  const {runCandidateProbe}=require('./probe.cjs');
  const t=require('../test/fixtures.cjs').getTasks().find(t=>t.id==='pagination-zero');
  const input={suiteId:t.id,files:{...t.files,...t.correction}},abort=new AbortController();
  const pending=runCandidateProbe(input,{signal:abort.signal});abort.abort();
  pending.then(async cancelled=>process.stdout.write(JSON.stringify({cancelled,recovered:await runCandidateProbe(input)}))).catch(()=>{process.exitCode=1;});
 `);
 assert.equal(result.cancelled.status,'aborted');assert.equal(result.cancelled.workerCreated,false);assert.equal(result.cancelled.cleanupConfirmed,true);
 assert.equal(result.recovered.status,'observed');assert.ok(result.recovered.checks.every(c=>c.ok));
});

test('cold engine preparation cannot rebind the captured candidate to later caller mutations',async()=>{
 const result=await coldProbe(`
  const {runCandidateProbe}=require('./probe.cjs');
  const t=require('../test/fixtures.cjs').getTasks().find(t=>t.id==='pagination-zero');
  const input={suiteId:t.id,files:{...t.files}},pending=runCandidateProbe(input);
  input.files['src/list.js']=t.correction['src/list.js'];
  pending.then(result=>process.stdout.write(JSON.stringify(result))).catch(()=>{process.exitCode=1;});
 `);
 assert.equal(result.status,'observed');assert.deepEqual(result.checks.filter(c=>!c.ok).map(c=>c.id),CHECK_IDS.slice(0,2));
 assert.equal(result.cleanupConfirmed,true);
});

test('real QuickJS export calls reproduce baseline failure and the authored correction', async () => {
  const baseline = await runCandidateProbe(input(task.files['src/list.js']));
  assert.equal(baseline.status, 'observed');
  assert.deepEqual(baseline.checks.filter(c => !c.ok).map(c => c.id), CHECK_IDS.slice(0, 2));
  const fixed = await runCandidateProbe(input(corrected));
  assert.equal(fixed.status, 'observed'); assert.ok(fixed.checks.every(c => c.ok));
  assert.equal(fixed.cleanupConfirmed, true); assert.equal(fixed.productionAdmitted, false);
});

test('pilot input rejects changed adapters, extra files, unsupported suites and getters before creating a worker', async () => {
  for (const x of [
    {suiteId: 'unknown', files: task.files},
    {suiteId: task.id, files: {...task.files, 'src/adapter.js': 'changed'}},
    {suiteId: task.id, files: {...task.files, 'other.js': 'extra'}},
    input('a'.repeat(24001)), {...input(corrected), extra: true}
  ]) await assert.rejects(runCandidateProbe(x));
  let calls = 0;
  const fields = {}; Object.defineProperty(fields, 'suiteId', {get() { calls++; return task.id; }});
  await assert.rejects(runCandidateProbe(fields)); assert.equal(calls, 0);
  assert.deepEqual(validateInput(input(corrected)).files, input(corrected).files);
});

test('guest has no Node, network, filesystem, worker, stdout or framing capabilities', async () => {
  const server = http.createServer((req, res) => { hits++; res.end('unexpected'); });
  let hits = 0;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const guard = `
      for(const key of ['process','Buffer','fetch','XMLHttpRequest','Worker','parentPort','postMessage','console','std','os']) {
        if(typeof globalThis[key]!=='undefined')throw Error('capability exposed');
      }
      let refused=0;
      for(const name of ['node:fs','node:child_process','http','../../secret']){
        try{require(name);}catch{refused++;}
      }
      if(refused!==4)throw Error('import escaped');
      try{globalThis.constructor.constructor('return process')();throw Error('process escaped');}
      catch(e){if(e.message==='process escaped')throw e;}
      try{fetch('http://127.0.0.1:${server.address().port}/canary');}catch{}
    `;
    const result = await runCandidateProbe(input(guard + corrected));
    assert.equal(result.status, 'observed'); assert.ok(result.checks.every(c => c.ok));
    assert.equal(hits, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('intrinsic poisoning cannot forge own-property absence', async () => {
  const result = await runCandidateProbe(input(`
    Object.prototype.hasOwnProperty=()=>false;
    Function.prototype.call=()=>false;
    module.exports={list(cursor,limit=20){return {cursor,limit};}};
  `));
  assert.equal(result.status, 'observed');
  assert.deepEqual(result.checks.filter(c => !c.ok).map(c => c.id), ['undefined-absent', 'null-absent']);
});

test('undefined, null, empty text, negative zero and inherited properties keep distinct semantics', async () => {
  const negative = await runCandidateProbe(input(`module.exports={list(cursor,limit=20){if(cursor===0)return{cursor:-0,limit};return cursor==null?{limit}:{cursor,limit};}};`));
  assert.equal(negative.status, 'observed'); assert.equal(negative.checks[0].ok, false);
  assert.equal(negative.observations[0].value.negativeZero, true);
  const inherited = await runCandidateProbe(input(`module.exports={list(cursor,limit=20){const o=Object.create({cursor:123});o.limit=limit;if(cursor!=null)o.cursor=cursor;return o;}};`));
  assert.equal(inherited.status, 'observed'); assert.ok(inherited.checks.every(c => c.ok));
});

test('NUL-prefixed text cannot impersonate an empty cursor and null remains an observed primitive', async () => {
  const forged = await runCandidateProbe(input(String.raw`
    module.exports={list(cursor,limit=20){return cursor==null?{limit}:{cursor:cursor===''?'\0tail':cursor,limit};}};
  `));
  assert.equal(forged.status, 'observed');
  assert.equal(forged.checks.find(c => c.id === 'empty-preserved').ok, false);
  assert.equal(forged.observations[1].value.value, '\0tail');
  assert.equal(forged.checks.filter(c => c.ok).length, 5);
  const nulled = await runCandidateProbe(input('module.exports={list(cursor,limit=20){return{cursor:null,limit};}};'));
  assert.equal(nulled.status, 'observed');
  assert.deepEqual(nulled.observations[0].value, {type:'null'});
  assert.equal(nulled.checks[0].ok, false);
});

test('cyclic values, toJSON and coercion hooks never run in host observation conversion', async () => {
  const result = await runCandidateProbe(input(`
    const cycle={};cycle.self=cycle;
    cycle.toJSON=()=>{while(true){}};cycle.toString=()=>{while(true){}};
    cycle[Symbol.toPrimitive]=()=>{while(true){}};
    module.exports={list(cursor,limit=20){return cursor==null?{limit}:{cursor:cycle,limit};}};
  `));
  assert.equal(result.status, 'observed');
  assert.equal(result.observations[0].value.type, 'object'); assert.equal(result.checks[0].ok, false);
  assert.equal(result.cleanupConfirmed, true);
});

test('adversarial guest work terminates without fabricating six failed checks', async t => {
  const attacks = {
    'top-level loop': 'while(true){}',
    'function loop': 'module.exports={list(){while(true){}}};',
    'getter loop': 'module.exports={list(){return {get cursor(){while(true){}}};}};',
    'proxy trap loop': 'module.exports={list(cursor){return cursor==null?new Proxy({},{getOwnPropertyDescriptor(){while(true){}}}):{cursor};}};',
    'allocation flood': 'const values=[];while(true){values.push(new Array(10000).fill(1));}',
    'recursion': 'function f(){return f()}f();',
    'throwing conversion': 'throw {get message(){while(true){}},toString(){while(true){}}};',
    'forbidden require': "require('node:fs').writeFileSync('escape-canary','bad');",
    'syntax error': 'function(',
    'oversized observation': "module.exports={list(){return {cursor:'x'.repeat(1000000)};}};"
  };
  for (const [name, source] of Object.entries(attacks)) await t.test(name, async () => {
    const result = await runCandidateProbe(input(source));
    assert.notEqual(result.status, 'observed'); assert.equal(result.cleanupConfirmed, true);
    assert.equal(Object.hasOwn(result, 'checks'), false); assert.equal(result.productionAdmitted, false);
  });
  const next = await runCandidateProbe(input(corrected));
  assert.equal(next.status, 'observed'); assert.ok(next.checks.every(c => c.ok));
});

test('cancellation, already-aborted signals and concurrent admission clean up only the owned worker', async () => {
  const aborted = new AbortController(); aborted.abort();
  const before = await runCandidateProbe(input(corrected), {signal: aborted.signal});
  assert.equal(before.workerCreated, false); assert.equal(before.status, 'aborted');
  const controller = new AbortController();
  const running = runCandidateProbe(input('while(true){}'), {signal: controller.signal});
  const competing = await runCandidateProbe(input(corrected));
  assert.equal(competing.status, 'busy'); assert.equal(competing.workerCreated, false);
  controller.abort();
  const canceled = await running;
  assert.equal(canceled.status, 'aborted'); assert.equal(canceled.cleanupConfirmed, true); assert.equal(canceled.workerCreated, true);
  const after = await runCandidateProbe(input(corrected)); assert.equal(after.status, 'observed');
});

test('typed observation grading refuses forged or partial protocols', () => {
  assert.throws(() => gradeObservations([]));
  assert.throws(() => gradeObservations(CHECK_IDS.map(id => ({id, kind: 'property-value', value: {type: 'string', value: 'forged'}}))));
});
