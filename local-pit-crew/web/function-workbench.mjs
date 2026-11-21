import functions from '../src/function-workflow.cjs';
import contracts from '../runner/function-contract.cjs';
import replays from '../src/function-replay.cjs';
import controller from '../src/controller.cjs';
import codec from '../src/public-check-codec.cjs';
import comparison from '../src/public-check-changes.cjs';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const paginationExample={
 schema:contracts.TASK_SCHEMA,title:'Keep valid page cursors',exportName:'pageQuery',
 instructions:'Keep zero and string cursors. Omit the cursor when it is null or absent.',
 cases:[
  {label:'Keep a zero cursor',args:[0],expected:{cursor:0}},
  {label:'Omit an explicit null cursor',args:[null],expected:{}},
  {label:'Omit a missing cursor',args:[],expected:{}},
  {label:'Keep a string cursor',args:['next'],expected:{cursor:'next'}}
 ]
};
// This is tab-local workflow authority, not a Docker admission issuer. The
// shared controller keeps its original source/contract/revision invariants.
export function createBrowserFunctionWorkbench({reference,verifier}){
 let owner=null,ownerAdmissionId=null,pendingStart=null,epoch=0,admissionId=crypto.randomUUID();
 const lifetime=new AbortController();
 let comparing=false;
 const state=()=>owner?.state()??null;
 const fail=(status,error)=>({status,body:{error,state:state()}});
 const workflow={functionCapability:()=>verifier.capabilityFor(contracts.FUNCTION_SUITE),
  close(){epoch++;pendingStart=null;lifetime.abort();owner?.cancel();verifier.close();},
  async dispatch(request){
   const {method,pathname,body}=request;
   if(method==='GET'&&['/api/bootstrap','/api/state'].includes(pathname)){
    const result=await reference.dispatch(request);
    if(owner)result.body.state=state();
    if(pathname==='/api/bootstrap')result.body.startAdmissionId=admissionId;
    return result;
   }
   if(method==='POST'&&pathname==='/api/workbench/cancel-start'){
    if(!exact(body,['startAdmissionId']))return fail(409,'Malformed start cancellation.');
    if(body.startAdmissionId===admissionId)admissionId=crypto.randomUUID();
    if(pendingStart?.admissionId===body.startAdmissionId){epoch++;pendingStart=null;}
    if(ownerAdmissionId===body.startAdmissionId){epoch++;owner?.cancel();}
    return{status:200,body:{state:state(),startCanceled:true}};
   }
   if(method==='POST'&&pathname==='/api/function/replay'){
    if(!exact(body,['packet']))return fail(400,'Provide one saved replay case.');
    try{return{status:200,body:{replay:replays.prepareFunctionReplay(JSON.stringify(body.packet))}};}catch{return fail(400,'Replay case invalid. Check its format, size and file hashes.');}
   }
   if(method==='POST'&&pathname==='/api/function/compare-replays'){
    const error=(status,message)=>({status,body:{error:message}});
    const example=exact(body,['example'])&&body.example==='pagination';
    const repeat=exact(body,['repeat']);
    const source=exact(body,['baseline','source']);
    if(!example&&!repeat&&!source&&!exact(body,['baseline','candidate']))return error(400,'Choose a saved replay to repeat or compare it with a candidate source file.');
    if(lifetime.signal.aborted||comparing||pendingStart||state()?.snapshot?.pending)
     return error(409,'Wait for the current operation to finish and try again.');
    let files;
    try{
     if(repeat){
      const saved=replays.parseFunctionReplay(JSON.stringify(body.repeat));
      files={baselineFiles:saved,candidateFiles:saved};
     }else files=example?{
      baselineFiles:contracts.createFunctionTask({...paginationExample,source:'exports.pageQuery = cursor => cursor ? {cursor} : {};'}).files,
      candidateFiles:contracts.createFunctionTask({...paginationExample,source:'exports.pageQuery = cursor => cursor === undefined ? {} : {cursor};'}).files,
      context:{title:paginationExample.title,instructions:paginationExample.instructions}
     }:source?replays.prepareSourceComparison(JSON.stringify(body.baseline),body.source):
      replays.prepareReplayComparison(JSON.stringify(body.baseline),JSON.stringify(body.candidate));
    }
    catch(cause){return error(400,cause.message==='different-contracts'?'These replays use different contracts. Compare two versions with identical examples.':
     cause.message==='unchanged-source'?'Both versions contain the same source. Choose a different candidate.':
     source?'Check the baseline replay hash and use a nonempty JavaScript file up to 6,000 bytes.':'Check the replay formats and file hashes.');}
    comparing=true;
    try{
     const results=[];
     for(const version of [files.baselineFiles,files.candidateFiles]){
      const id=crypto.randomUUID(),suiteId=contracts.FUNCTION_SUITE,workspaceHash=controller.workspaceHash(version);
      const outcome=await verifier.runPublicChecks({id,suiteId,workspaceHash,files:version},{signal:lifetime.signal});
      const checked=codec.parsePublicCheckOutcome(outcome,{ticketId:id,suiteId,workspaceHash},version);
      if(lifetime.signal.aborted||checked.status!=='candidate-verdict')return error(503,'A run could not be verified. No comparison is available.');
      results.push(checked);
     }
     const {cases}=contracts.parseContractSource(files.baselineFiles[contracts.CONTRACT_PATH]);
     const checkLabels=Object.fromEntries(cases.map(({id,label})=>[id,label]));
     if(repeat){
      const difference=comparison.compareSameReplay(results[0].diagnostics,results[1].diagnostics);
      if(!difference)return error(503,'The repeated runs could not be compared.');
      const passingPerRun=results.map(run=>run.checks.filter(({ok})=>ok).length);
      return{status:200,body:{repeat:{workspaceHash:results[0].workspaceHash,runs:2,total:cases.length,
       passingPerRun,...difference},checkLabels}};
     }
     const compared=comparison.comparePublicChecks(...results);
     if(!compared)return error(503,'Run results could not be compared.');
     const observations=cases.flatMap(({id,args,expected},index)=>{
      const baseline=results[0].diagnostics[index],candidate=results[1].diagnostics[index];
      const changed=baseline.ok!==candidate.ok||comparison.changedWhileFailing(baseline,candidate);
      return changed?[{id,args:contracts.canonical(args),expected:contracts.canonical(expected),baseline,candidate}]:[];
     });
     const failureReplay=compared.afterPassed<compared.total
      ?replays.createFunctionReplay(files.candidateFiles,files.context):null;
     return{status:200,body:{comparison:compared,checkLabels,observations,failureReplay}};
    }catch{return error(503,'A version could not be verified. No comparison is available.');}
    finally{comparing=false;}
   }
   if(comparing&&method==='POST'&&['/api/function/open','/api/function/extend','/api/function/action','/api/start'].includes(pathname))
    return fail(409,'Wait for the replay comparison to finish.');
   if(method==='POST'&&['/api/function/open','/api/function/extend'].includes(pathname)){
    const extending=pathname==='/api/function/extend';
    if(!exact(body,extending?['sessionId','revision','example','startAdmissionId']:['spec','startAdmissionId'])||body.startAdmissionId!==admissionId)return fail(409,'The start offer changed. Refresh before starting again.');
    const parent=extending?owner?.state():null;
    if(extending&&(!parent||body.sessionId!==parent.sessionId||body.revision!==parent.snapshot.revision))return fail(409,'The checked parent changed. Review the current run.');
    if(!verifier.capabilityFor(contracts.FUNCTION_SUITE).available)return fail(503,'Browser function execution is unavailable. Use a current browser with workers and WebAssembly.');
    let task;try{task=extending?replays.createFunctionChallenge(parent,body.example):contracts.createFunctionTask(body.spec);}catch{return fail(400,extending?'Use a current passing function and one bounded new example, with at most eight examples total.':'Use one named synchronous export and 1-8 bounded JSON examples.');}
    const intent={epoch:++epoch,admissionId:body.startAdmissionId};pendingStart=intent;
    admissionId=crypto.randomUUID();owner?.cancel();
    const old=(await reference.dispatch({method:'GET',pathname:'/api/state'})).body.state;
    if(epoch!==intent.epoch||pendingStart!==intent)return fail(409,'Discarded an older function start.');
    if(old?.snapshot&&!old.snapshot.closed)await reference.dispatch({method:'POST',pathname:'/api/action',body:{sessionId:old.sessionId,revision:old.snapshot.revision,action:'cancel'}});
    if(epoch!==intent.epoch||pendingStart!==intent)return fail(409,'Discarded an older function start.');
    owner=functions.createFunctionWorkflow({task,verifier});
    ownerAdmissionId=intent.admissionId;pendingStart=null;
    return{status:200,body:{state:state(),openedFunctionSessionId:state().sessionId}};
   }
   if(method==='POST'&&pathname==='/api/function/action'){
    if(!owner)return fail(409,'Open your function first.');
    const started=owner,result=await started.action(body);
    if(owner!==started)return fail(409,'Discarded results from an older function run.');
    if(body?.action==='cancel'&&result.status===200)admissionId=crypto.randomUUID();
    return result;
   }
   if(method==='POST'&&pathname==='/api/start'){epoch++;pendingStart=null;}
   const result=await reference.dispatch(request);
   if(method==='POST'&&pathname==='/api/start'&&result.status===200){owner?.cancel();owner=null;ownerAdmissionId=null;admissionId=crypto.randomUUID();}
   return result;
  }
 };
 return{...workflow,async dispatch(request){
  const result=await workflow.dispatch(request);
  if(result.body)result.body.startAdmissionId=admissionId;
  return result;
 }};
}
