'use strict';
// Explicit, real-model smoke check on a public authored fixture. Returned code is never executed.
const {OllamaCoderClient}=require('../local-pit-crew/src/ollama-coder-client.cjs');
const {CodingSession}=require('../local-pit-crew/src/coding-session.cjs');
const {getTasks,runAuthoredChecks}=require('../local-pit-crew/test/fixtures.cjs');
async function main(argv){
 if(argv.length!==2||argv[0]!=='--model')throw Error('usage: node scripts/smoke-ollama.cjs --model INSTALLED_MODEL');
 const coder=new OllamaCoderClient({model:argv[1],requestTimeoutMs:120000,maxOutputTokens:1024,keepAliveSeconds:30});
 let session;
 try{
  const reported=await coder.preflight(),task=getTasks().find(t=>t.id==='pagination-zero');
  const checkIds=(await runAuthoredChecks(task.id,'corrected')).checks.map(c=>c.id);
  session=new CodingSession({task:{id:task.id,prompt:task.prompt,files:task.files,writable:task.writable,checkIds},profile:reported.profile,coder,mode:'deterministic',providerTimeoutMs:120000});
  const started=performance.now(),result=await session.generatePatch(),elapsedMs=Math.round(performance.now()-started);
  const report={schema:'local-pit-crew/local-coder-smoke/v1',sample:task.id,configuration:reported.configuration,
   result:result.status,elapsedMs,providerInvocations:session.state.providerInvocations,
   proposal:session.state.proposal,observation:coder.state.lastObservation,
   generatedCodeExecuted:false,correctnessVerified:false,nanoUsed:false,networkLocalityVerified:false};
  console.log(JSON.stringify(report,null,2));
  if(result.status==='blocked')process.exitCode=1;
 }finally{session?.cancel();coder.stop();}
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
