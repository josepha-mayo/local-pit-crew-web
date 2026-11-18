'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process');
const {createHash}=require('node:crypto');
const {createFunctionTask,TASK_SCHEMA,FUNCTION_ENTRY,CONTRACT_PATH,LIMITS}=require('../function-contract.cjs');
const {createFunctionReplay,parseFunctionReplay,prepareFunctionReplay,MAX_REPLAY_BYTES}=require('../../src/function-replay.cjs');
const {replay,compareReplays}=require('../../../scripts/replay-function.cjs');
const files=source=>createFunctionTask({schema:TASK_SCHEMA,title:'Private title',instructions:'Sort a copy without changing inputs.',exportName:'sortCopy',
 source:source??'/* é */ module.exports={sortCopy:values=>[...values].sort()};',cases:[{label:'Private case',args:[['b','a']],expected:['a','b']}]}).files;
test('portable UTF-8 source and exact fixed contract replay through fresh real WASM checks with no model',async()=>{
 const original=files(),packet=createFunctionReplay(original),text=JSON.stringify(packet);
 assert.deepEqual(parseFunctionReplay(text),original);
 const result=await replay(text);assert.equal(result.status,'checked');assert.equal(result.passed,1);assert.equal(result.total,1);assert.equal(result.modelCalls,0);
 assert.equal(result.verification.boundary,'node-worker-quickjs');assert.equal(result.verification.qualifiedDocker,false);
 assert.equal(result.files[0].sha256,packet.files[0].sha256);assert.equal(result.files[1].sha256,packet.files[1].sha256);
 assert.equal(JSON.stringify(result).includes('Private'),false);assert.equal(JSON.stringify(result).includes(original[FUNCTION_ENTRY]),false);
});
test('modern replay preserves requirements and legacy replay never invents missing intent or imports a verdict',async()=>{
 const original=files(),context={title:'Sort a copy',instructions:'Preserve inputs and duplicates while sorting strings.'};
 const packet=createFunctionReplay(original,context),text=JSON.stringify(packet),prepared=prepareFunctionReplay(text);
 assert.equal(packet.schema,'local-pit-crew/function-replay/v2');assert.equal(prepared.contextRestored,true);
 assert.equal(prepared.spec.title,context.title);assert.equal(prepared.spec.instructions,context.instructions);
 assert.deepEqual(createFunctionTask(prepared.spec).files,original);assert.equal((await replay(text)).passed,1);
 const legacy=prepareFunctionReplay(JSON.stringify(createFunctionReplay(original)));
 assert.equal(legacy.contextRestored,false);assert.equal(legacy.spec.instructions,'');assert.throws(()=>createFunctionTask(legacy.spec));
 for(const mutate of [p=>p.context.instructions=42,p=>p.context.instructions='',p=>p.context.instructions='é'.repeat(501),p=>p.context.checked=true,p=>p.verdict='passed']){
  const invalid=structuredClone(packet);mutate(invalid);assert.throws(()=>prepareFunctionReplay(JSON.stringify(invalid)));
 }
});
test('replay rejects changed bytes, extra verdicts, unknown paths and oversized data before running source',async()=>{
 for(const mutate of [p=>p.files[0].content='while(true){}',p=>p.files[1].content+=' ',p=>p.checked=true,p=>p.files[0].path='../escape.js',p=>p.files.reverse(),p=>p.files.push(p.files[0])]){
  const packet=createFunctionReplay(files());mutate(packet);await assert.rejects(replay(JSON.stringify(packet)));
 }
 assert.throws(()=>parseFunctionReplay(' '.repeat(MAX_REPLAY_BYTES+1)));assert.throws(()=>parseFunctionReplay('{'));
});
test('matching hashes do not import success: changed code is regraded and input mutation still fails',async()=>{
 const packet=createFunctionReplay(files('module.exports={sortCopy:values=>values.sort()};'));
 const result=await replay(JSON.stringify(packet));assert.equal(result.status,'checked');assert.equal(result.total,1);assert.equal(result.passed,0);assert.equal(result.checks[0].ok,false);
 const unavailable=await replay(JSON.stringify(createFunctionReplay(files('module.exports={sortCopy(){while(true){}}};'))));
 assert.equal(unavailable.status,'unavailable');assert.deepEqual(unavailable.checks,[]);assert.equal(unavailable.total,0);
});
test('replay comparison shows repaired and regressed IDs even when the passing total stays the same',async()=>{
 const packet=source=>JSON.stringify(createFunctionReplay(createFunctionTask({schema:TASK_SCHEMA,title:'Hidden title',
  instructions:'Return the provided value unchanged.',exportName:'identity',source,cases:[
   {label:'Hidden zero case',args:[0],expected:0},{label:'Hidden text case',args:[''],expected:''}
  ]}).files));
 const before=packet('exports.identity = x => x === 0 ? 1 : x;');
 const after=packet("exports.identity = x => x === '' ? 'changed' : x;");
 const result=await compareReplays(before,after);
 assert.equal(result.status,'checked');assert.equal(result.modelCalls,0);
 assert.deepEqual({before:result.baseline.passed,after:result.candidate.passed}, {before:1,after:1});
 assert.deepEqual(result.comparison.repaired,['case-01']);assert.deepEqual(result.comparison.regressed,['case-02']);
 assert.deepEqual(result.comparison.changedFailures,[]);
 const stillFailing=await compareReplays(before,packet("exports.identity = x => x === 0 ? 'PRIVATE_RETURN' : x;"));
 assert.equal(stillFailing.status,'checked');
 assert.deepEqual(stillFailing.comparison.changedFailures,['case-01']);
 assert.deepEqual(stillFailing.comparison.repaired,[]);
 assert.deepEqual(stillFailing.comparison.regressed,[]);
 assert.doesNotMatch(JSON.stringify(stillFailing),/Hidden|PRIVATE_RETURN|exports\.identity/);
 assert.doesNotMatch(JSON.stringify(result),/Hidden|exports\.identity/);
 const filesWithDifferentContract=parseFunctionReplay(after);
 filesWithDifferentContract[CONTRACT_PATH]=filesWithDifferentContract[CONTRACT_PATH]+' ';
 await assert.rejects(compareReplays(before,JSON.stringify(createFunctionReplay(filesWithDifferentContract))),/different-contracts/);
 await assert.rejects(compareReplays(before,before),/unchanged-source/);
 const unavailable=await compareReplays(before,packet('exports.identity = () => {while(true){}};'));
 assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.comparison,null);
});
test('CLI returns distinct passing, mismatching and invalid exit codes without host source evaluation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pitcrew-replay-'));
 try{
  const command=path.resolve(__dirname,'../../../scripts/replay-function.cjs');
  for(const [name,packet,exit]of [['pass',createFunctionReplay(files()),0],['fail',createFunctionReplay(files('module.exports={sortCopy:values=>values.sort()};')),1],['invalid',{schema:'made-up',source:'throw Error("PRIVATE_ERROR")'},2]]){
   const file=path.join(dir,name+'.json');await fs.writeFile(file,JSON.stringify(packet));
   const result=await new Promise(resolve=>execFile(process.execPath,[command,file],{timeout:5000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
   assert.equal(result.code,exit);assert.equal((result.stdout+result.stderr).includes('PRIVATE_ERROR'),false);
   if(exit<2){const report=JSON.parse(result.stdout);assert.equal(report.modelCalls,0);assert.equal(report.status,'checked');}
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('JUnit reports bind fresh passing or failing observations and keep unavailable execution distinct without private case data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pitcrew-junit-'));
 try{
  const command=path.resolve(__dirname,'../../../scripts/replay-function.cjs');
  const invoke=args=>new Promise(resolve=>execFile(process.execPath,[command,...args],{timeout:5000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
  const mixed=createFunctionReplay(createFunctionTask({schema:TASK_SCHEMA,title:'Private transform',instructions:'Preserve falsy inputs.',exportName:'identity',source:'module.exports={identity:x=>x||7};',cases:[{label:'Private zero',args:[0],expected:0},{label:'Private false',args:[false],expected:false},{label:'Private positive',args:[7],expected:7}]}).files);
  for(const [name,packet,exit,failures,errors,total]of [
   ['pass',createFunctionReplay(files()),0,0,0,1],
   ['mutation',createFunctionReplay(files('module.exports={sortCopy:values=>values.sort()};')),1,1,0,1],
   ['mixed',mixed,1,2,0,3],
   ['unavailable',createFunctionReplay(files('module.exports={sortCopy(){while(true){}}};')),2,0,1,1],
   ['invalid',{schema:'made-up',source:'PRIVATE_SOURCE_NEVER_EXECUTED'},2,0,1,1]
  ]){
   const file=path.join(dir,name+' private.json'),output=path.join(dir,name+' & summary.xml');await fs.writeFile(file,JSON.stringify(packet));
   const result=await invoke([file,'--junit',output]),xml=await fs.readFile(output,'utf8');
   assert.equal(result.code,exit);assert.match(xml,new RegExp('<testsuite name="Local Pit Crew function replay" tests="'+total+'" failures="'+failures+'" errors="'+errors+'" skipped="0">'));
   assert.equal((xml.match(/<testcase /g)||[]).length,total);assert.equal((xml.match(/<failure /g)||[]).length,failures);assert.equal((xml.match(/<error /g)||[]).length,errors);
   assert.match(xml,/<property name="modelCalls" value="0"\/>/);
   for(const secret of ['Private','PRIVATE_SOURCE','sortCopy','values.sort','["b","a"]',file,output])assert.equal((xml+result.stdout+result.stderr).includes(secret),false);
   if(!errors){
    assert.equal(xml.includes('<testcase classname="local-pit-crew.function.'+packet.files[1].sha256+'" name="case-01">'),true);
    const report=JSON.parse(result.stdout);assert.equal(report.total,total);assert.equal(report.passed,total-failures);assert.equal(report.modelCalls,0);
   }else{assert.match(xml,/<testcase classname="local-pit-crew.replay(?:\.[a-f0-9]{64})?" name="verification">/);assert.equal(xml.includes('name="case-01"'),false);}
   if(name!=='invalid')for(const file of packet.files)assert.equal(xml.includes(file.sha256),true);
   else assert.equal(xml.includes('.sha256'),false);
   const repeated=await invoke([file,'--junit',output]);assert.equal(repeated.code,2);assert.equal(repeated.stdout,'');assert.equal(await fs.readFile(output,'utf8'),xml);
  }
  const input=path.join(dir,'pass private.json'),original=await fs.readFile(input,'utf8');
  assert.equal((await invoke([input,'--junit',input])).code,2);assert.equal(await fs.readFile(input,'utf8'),original);
  const failing=path.join(dir,'mutation private.json'),comparisonXml=path.join(dir,'comparison.xml');
  const comparison=await invoke([failing,'--against',input,'--junit',comparisonXml]);
  assert.equal(comparison.code,0);assert.deepEqual(JSON.parse(comparison.stdout).comparison.repaired,['case-01']);
  assert.match(await fs.readFile(comparisonXml,'utf8'),/tests="1" failures="0" errors="0"/);
  const regression=await invoke([input,'--against',failing]);
  assert.equal(regression.code,1);assert.deepEqual(JSON.parse(regression.stdout).comparison.regressed,['case-01']);
  for(const args of [[input,'--junit'],[input,'--unknown',path.join(dir,'unknown.xml')],[input,'--junit',path.join(dir,'missing','report.xml')]]){
   const result=await invoke(args);assert.equal(result.code,2);assert.equal(result.stdout,'');
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('CLI checks the current source bytes against the replay contract as the source file changes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pitcrew-replay-source-'));
 try{
  const command=path.resolve(__dirname,'../../../scripts/replay-function.cjs');
  const invoke=args=>new Promise(resolve=>execFile(process.execPath,[command,...args],{timeout:5000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
  const input=path.join(dir,'frozen.replay.json'),source=path.join(dir,'current function.js'),reportPath=path.join(dir,'current.xml');
  const packet=createFunctionReplay(files()),original=JSON.stringify(packet);
  await fs.writeFile(input,original);
  const mutated='module.exports={sortCopy:values=>values.sort()};';
  const corrected='\ufeff/* é */\r\nmodule.exports={sortCopy:values=>[...values].sort()};\r\n';
  for(const [text,exit]of [[mutated,1],[corrected,0]]){
   await fs.writeFile(source,text);
   const run=await invoke([input,'--source',source,...(exit===0?['--junit',reportPath]:[])]);
   assert.equal(run.code,exit);
   const result=JSON.parse(run.stdout),sha256=createHash('sha256').update(text).digest('hex');
   assert.deepEqual(result.files,[{path:FUNCTION_ENTRY,sha256},{path:CONTRACT_PATH,sha256:packet.files[1].sha256}]);
   assert.deepEqual(result.checks,[{id:'case-01',ok:exit===0}]);assert.equal(result.modelCalls,0);
   assert.equal(await fs.readFile(source,'utf8'),text);
   if(exit===0){
    const xml=await fs.readFile(reportPath,'utf8');
    assert.ok(xml.includes(sha256));assert.ok(xml.includes(packet.files[1].sha256));
    assert.doesNotMatch(xml,/sortCopy|current function/);
   }
  }
  for(const invalid of [Buffer.from([0xff]),' '.repeat(LIMITS.sourceBytes)+corrected]){
   await fs.writeFile(source,invalid);
   assert.equal((await invoke([input,'--source',source])).code,2);
  }
  await fs.writeFile(source,corrected);
  assert.equal((await invoke([input,'--source',source,'--against',input])).code,2);
  assert.equal((await invoke([input,'--source',source,'--compare-source',source])).code,2);
  const baseline=path.join(dir,'failed.replay.json'),comparisonXml=path.join(dir,'comparison.xml');
  await fs.writeFile(baseline,JSON.stringify(createFunctionReplay(files(mutated))));
  const compared=await invoke([baseline,'--compare-source',source,'--junit',comparisonXml]);
  assert.equal(compared.code,0);
  const comparison=JSON.parse(compared.stdout);
  assert.deepEqual(comparison.comparison.repaired,['case-01']);
  assert.equal(comparison.candidate.files[0].sha256,createHash('sha256').update(corrected).digest('hex'));
  assert.match(await fs.readFile(comparisonXml,'utf8'),/tests="1" failures="0" errors="0"/);
  assert.equal((await invoke([input,'--compare-source',source,'--against',baseline])).code,2);
  assert.equal(await fs.readFile(input,'utf8'),original);
  packet.files[0].content+=' ';
  await fs.writeFile(input,JSON.stringify(packet));
  assert.equal((await invoke([input,'--source',source])).code,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
