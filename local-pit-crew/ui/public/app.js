(function(global){
 'use strict';
 const impacts={
  'pagination-zero':'A valid zero cursor disappears. People can miss records without seeing an error.',
  'config-isolation':'One call changes the defaults for the next. Retry settings leak across requests.',
  'latest-request-wins':'A slow, older search overwrites the new one. The screen shows the wrong answer.'
 };
 const functionExample={title:'Keep meaningful tag names',exportName:'uniqueTags',
  instructions:'Deduplicate tags by trimmed lowercase text, preserve the first original string and order, and ignore blank or non-string values. Names such as constructor and __proto__ are valid tags. Do not mutate the input.',
  source:'function uniqueTags(tags) {\n  const seen = {};\n  return tags.filter(tag => {\n    const key = tag.trim().toLowerCase();\n    if (!key || seen[key]) return false;\n    seen[key] = true;\n    return true;\n  });\n}\nmodule.exports = { uniqueTags };',
  cases:[{label:'Keep special names',args:[['constructor','__proto__']],expected:['constructor','__proto__']},
   {label:'Preserve first spelling',args:[[' Ops ','ops','API','api']],expected:[' Ops ','API']},
   {label:'Ignore non-string values',args:[['API',null,42,'','   ','api','UI']],expected:['API','UI']},
   {label:'Accept an empty list',args:[[]],expected:[]},
   {label:'Preserve original order',args:[['b','a','B']],expected:['b','a']}]};
 // Both authored replacements use the same logic except for whitespace handling.
 const exampleReplacement=trim=>`function uniqueTags(tags) {
  const seen = new Set();
  return tags.filter(tag => {
    if (typeof tag !== 'string') return false;
    const key = ${trim}.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
module.exports = { uniqueTags };`;
 const exampleFirstPatch=exampleReplacement("tag.replace(/^ +| +$/g, '')");
 const exampleFinalPatch=exampleReplacement('tag.trim()');
 const tagWalkthrough={spec:functionExample,firstPatch:exampleFirstPatch,finalPatch:exampleFinalPatch,
  firstLabel:'Fill authored first patch',finalLabel:'Fill authored whitespace fix'};
 const shippingRecordedPatch="exports.shippingQuote = (quotes, currency) => { let best = null; for (const q of quotes) { if (q && typeof q.id === 'string' && q.id !== '' && q.available === true && q.currency === currency && Number.isInteger(q.priceCents) && q.priceCents >= 0) { if (!best || q.priceCents < best.priceCents) { best = q; } } } return best ? best.id : null; };";
 const shippingWalkthrough={
  spec:{
  title:"Choose a shipping quote",exportName:"shippingQuote",
  instructions:"Return the id of the first quote with the lowest valid priceCents in the requested currency, or null. A valid quote is a non-null object with a nonempty string id, available exactly true, currency exactly equal to the requested string, and a nonnegative safe integer priceCents. Ignore other rows. Preserve both input arguments and the order of the quotes. On price ties keep the earlier input. The first argument is an array; the second argument is a currency string.",
  source:"exports.shippingQuote = (quotes, currency) => quotes.sort((a, b) => a.priceCents - b.priceCents).find(q => q.available && q.currency === currency && q.priceCents)?.id ?? null;",
  cases:[
   {"label":"Free delivery beats a paid quote","args":[[{"id":"paid","available":true,"currency":"USD","priceCents":799},{"id":"free","available":true,"currency":"USD","priceCents":0}],"USD"],"expected":"free"},
   {"label":"Ignore unavailable rates","args":[[{"id":"disabled","available":false,"currency":"USD","priceCents":1},{"id":"live","available":true,"currency":"USD","priceCents":10}],"USD"],"expected":"live"},
   {"label":"Keep the first equal-price quote","args":[[{"id":"first","available":true,"currency":"USD","priceCents":10},{"id":"later","available":true,"currency":"USD","priceCents":10}],"USD"],"expected":"first"},
   {"label":"No supported currency","args":[[{"id":"eur","available":true,"currency":"EUR","priceCents":1}],"USD"],"expected":null}
  ]
 },
  firstPatch:shippingRecordedPatch,finalPatch:shippingRecordedPatch.replace('Number.isInteger','Number.isSafeInteger'),
  firstLabel:'Fill recorded Gemini patch',finalLabel:'Fill reviewed safe-integer fix',
  challenge:{"label":"Reject unsafe integer","args":[[{"id":"too-high","available":true,"currency":"USD","priceCents":9007199254740992}],"USD"],"expected":null}
 };
 const plannerDiagnostics={
  'readiness-failed':'The on-device model was no longer ready.',
  'generation-failed':'The on-device generation did not finish successfully.',
  'operation-timeout':'The on-device operation exceeded its 90-second wait. Its owned session was canceled.',
  'output-json':'Nano returned malformed JSON.',
  'output-size':'Nano exceeded the response size limit.',
  'output-fields':'Nano returned an unexpected response shape.',
  'output-revision':'Nano returned a stale revision.',
  'output-types':'Nano returned invalid field types.',
  'output-citations':'Nano cited unknown evidence.',
  'output-grounding':'Nano\'s repair citation does not match the current source.',
  'output-arguments':'Nano returned invalid action arguments.',
  'output-action':'Nano chose an action outside this workflow.',
  'output-unusable':'Nano did not return usable repair advice.',
  'unexpected-inference-source':'The reported inference source was unexpected. Stop and inspect possible cloud traffic.'
 };
 function cloudFailureMessage(result){
  const messages={
   'cloud-rate-limited':'Google reported a rate or quota limit. Wait before sending a new request; the project quota may also be exhausted.',
   'cloud-access-denied':'Google refused this request. Check App Check, API key restrictions and project permissions.',
   'cloud-unauthenticated':'Google could not authenticate this request. Check Firebase and App Check setup.',
   'cloud-model-unavailable':'The configured cloud model was not found or is unavailable to this project.',
   'cloud-service-not-enabled':'Firebase AI Logic is not enabled for this project. Check its project setup.',
   'cloud-attestation-failed':'Firebase App Check could not verify this browser. You can continue with local checks.',
   'cloud-service-unavailable':'The cloud service could not complete this request. Try again later if you still need it.',
   'cloud-request-rejected':'Google rejected the request format or configuration. Check the app and model setup.',
   'cloud-source-unconfirmed':'The response did not confirm cloud inference. It was rejected.',
   'cloud-response-rejected':'The cloud response did not meet the required output contract. It was rejected.',
   'cloud-wait-ended':'The cloud wait ended. A request already sent may continue at the provider.'
  };
  const message=typeof result?.diagnostic==='string'&&Object.hasOwn(messages,result.diagnostic)?messages[result.diagnostic]:'The cloud request did not finish. Check the connection and Firebase setup.';
  return message+' No replacement was applied. No automatic retry or fallback was made.';
 }
 function plannerObservationRecord(state,observation){
  if(state?.mode!=='configured-local-unverified'||!state.snapshot||typeof state.sessionId!=='string'||observation?.sessionId!==state.sessionId||
   !Number.isSafeInteger(observation?.revision)||observation.revision<0||observation.revision>state.snapshot?.revision||
   !['decision','blocked'].includes(observation.status))return null;
  return{revision:observation.revision,status:observation.status,
   inferenceSource:observation.status==='decision'&&observation.inferenceSource==='on_device'?'on_device':null,
   diagnostic:observation.status==='blocked'&&typeof observation.diagnostic==='string'&&Object.hasOwn(plannerDiagnostics,observation.diagnostic)?observation.diagnostic:null,
   ...(observation.adviceFormat==='source-line'||observation.adviceFormat==='verbatim-quote'?{adviceFormat:observation.adviceFormat}:{}),
   kind:'browser-client-observation'};
 }
 async function probeBrowserRuntime(environment=global,timeoutMs=5000){
  if(environment.isSecureContext!==true)return{status:'insecure-context',nanoIdentityVerified:false};
  const api=environment.LanguageModel;
  if(!api||typeof api.availability!=='function'||typeof api.create!=='function')return{status:'native-api-absent',nanoIdentityVerified:false};
  let timer;
  try{
   const availability=await Promise.race([
    api.availability({expectedInputs:[{type:'text',languages:['en']}],expectedOutputs:[{type:'text',languages:['en']}]}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('readiness-timeout')),timeoutMs);})
   ]);
   return{status:['available','downloadable','downloading','unavailable'].includes(availability)?availability:'unknown-availability',nanoIdentityVerified:false};
  }catch{return{status:'availability-check-failed',nanoIdentityVerified:false};}
  finally{clearTimeout(timer);}
 }
 async function downloadBrowserModel(environment=global,{signal,onProgress=()=>{}}={}){
  if(environment.isSecureContext!==true||environment.navigator?.userActivation?.isActive!==true)return{status:'gesture-required'};
  const api=environment.LanguageModel;
  if(!api||typeof api.availability!=='function'||typeof api.create!=='function')return{status:'native-api-absent'};
  const options={expectedInputs:[{type:'text',languages:['en']}],expectedOutputs:[{type:'text',languages:['en']}]};
  let session,finished=false;
  const destroy=owned=>{try{owned?.destroy();}catch{/* Dispose only this action's session. */}};
  // Native setup may ignore AbortSignal. Release the UI promptly and dispose a
  // late session when it eventually arrives; this does not attest download stop.
  function waitForNative(value,onLate=()=>{}){
   return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    const abort=()=>{if(settled)return;settled=true;cleanup();reject(Error('setup-wait-aborted'));};
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve(value).then(result=>{
     if(settled){onLate(result);return;}
     settled=true;cleanup();resolve(result);
    },error=>{if(settled)return;settled=true;cleanup();reject(error);});
    if(signal?.aborted)abort();
   });
  }
  try{
   if(signal?.aborted)return{status:'aborted'};
   const availability=await waitForNative(api.availability(options));
   if(availability==='available')return{status:'available'};
   if(availability!=='downloadable'&&availability!=='downloading')return{status:'unavailable'};
   if(signal?.aborted)return{status:'aborted'};
   session=await waitForNative(api.create({...options,signal,monitor(monitor){
    monitor.addEventListener('downloadprogress',event=>{
     if(finished||signal?.aborted)return;
     const fraction=Number.isFinite(event.total)&&event.total>0?event.loaded/event.total:event.loaded;
     if(Number.isFinite(fraction)&&fraction>=0&&fraction<=1){try{onProgress(Math.round(fraction*100));}catch{/* Progress does not control setup. */}}
    });
   }}),destroy);
   if(signal?.aborted)return{status:'aborted'};
   return{status:await waitForNative(api.availability(options))==='available'?'available':'readiness-unconfirmed'};
  }catch{return{status:signal?.aborted?'aborted':'download-failed'};}
  finally{finished=true;destroy(session);}
 }
 function repairSnapshot(state){
  const s=state?.snapshot;
  if(!s||s.closed||s.pending||!state.checks?.some(c=>c.ok===false))return null;
  const evidence=(s.evidence??[]).filter(e=>(s.manifest??[]).some(m=>m.path===e.path&&m.sha256===e.sha256));
  if(!evidence.length)return null;
  if(state.mode==='function-contract'&&!evidence.some(e=>e.path==='src/function.js'))return null;
  const failedFunctionExamples=state.mode==='function-contract'?state.checks.filter(c=>!c.ok).flatMap(({id})=>{
   const detail=functionCheckDetails(state,id),diagnostic=state.checkDiagnostics?.find(c=>c.id===id);
   return detail?[{id,status:diagnostic.status,args:detail.args,expected:detail.expected,
    actual:diagnostic.status==='returned'?diagnostic.actualReturn:null,inputPreserved:diagnostic.inputPreserved,
    argumentsAfter:detail.argumentsAfter}]:[];
  }):[];
  return{...s,evidence,events:state.events??[],publicChecks:state.checks.map(({id,ok})=>({id,ok})),
   ...(failedFunctionExamples.length?{failedFunctionExamples}:{}),
   semanticBranch:'repair-after-public-check-failure',allowedActions:['code','ask_user']};
 }
 function publicCheckChangesRecord(state){
  const c=state?.checkChanges,checks=state?.checks;
  if(!c||state.snapshot?.pending||!Array.isArray(checks)||checks.length!==c.total||
   !['beforeWorkspaceHash','afterWorkspaceHash'].every(k=>typeof c[k]==='string'&&/^[a-f0-9]{64}$/.test(c[k]))||c.beforeWorkspaceHash===c.afterWorkspaceHash||
   !['beforePassed','afterPassed','total'].every(k=>Number.isSafeInteger(c[k]))||c.total<1||c.beforePassed<0||c.beforePassed>c.total||c.afterPassed<0||c.afterPassed>c.total||
   !checks.every(check=>typeof check.id==='string'&&typeof check.ok==='boolean')||new Set(checks.map(check=>check.id)).size!==checks.length||
   checks.filter(check=>check.ok).length!==c.afterPassed)return null;
  const current=new Map(checks.map(check=>[check.id,check.ok]));
  if(!['regressed','repaired'].every(k=>Array.isArray(c[k])&&new Set(c[k]).size===c[k].length&&c[k].every(id=>typeof id==='string'&&id.length>0&&id.length<=120&&current.get(id)===(k==='repaired')))||
   c.regressed.some(id=>c.repaired.includes(id))||c.afterPassed-c.beforePassed!==c.repaired.length-c.regressed.length||
   c.regressed.length>c.beforePassed||c.repaired.length>c.total-c.beforePassed)return null;
  return{beforeWorkspaceHash:c.beforeWorkspaceHash,afterWorkspaceHash:c.afterWorkspaceHash,
   beforePassed:c.beforePassed,afterPassed:c.afterPassed,total:c.total,regressed:[...c.regressed],repaired:[...c.repaired]};
 }
 function buildProofRecord(state,advisor=null,advisorCalls=0,cloud=null,cloudCalls=0,plannerObservation=null,cloudDraftCalls=0){
  if(!state?.snapshot||!state.task)throw Error('Open a run before exporting.');
  const s=state.snapshot,reference=state.mode==='authored-reference',planner=plannerObservationRecord(state,plannerObservation);
  // An allowlist keeps source, tokens, project configuration and private provider data out.
  return{schema:'local-pit-crew/run-evidence/v1',sample:state.task.id,mode:state.mode,
   evidenceKind:reference?'authored-fixture-workflow':state.mode==='function-contract'?'user-function-contract-workflow':'unverified-provider-workflow',
   runtimeVerified:false,heldOutCorrectness:false,nanoIdentityVerified:false,networkLocalityVerified:false,
   revision:s.revision,closed:s.closed,publicChecksCurrent:s.publicChecksCurrent,
   checks:(state.checks??[]).map(({id,ok})=>({id,ok})),
   checkChanges:publicCheckChangesRecord(state),
   files:(s.manifest??[]).map(({path,sha256})=>({path,sha256})),
   model:state.providerProfile?Object.fromEntries(['modelId','modelDigest','engineBuild','profileHash'].map(key=>[key,state.providerProfile[key]])):null,
   publicVerifier:state.verification?{admissionKind:state.verification.admissionKind,qualified:state.verification.qualified===true,
    runnerImageId:state.verification.runnerImageId??null,qualifiedAt:state.verification.qualifiedAt??null,benchmarkEligible:false}:null,
   counts:{...Object.fromEntries(['decisions','coder','patches','tests'].map(key=>[key,s.counts?.[key]??0])),
    coderCalls:(state.providerInvocations?.coder??0)+cloudDraftCalls,plannerCalls:state.providerInvocations?.planner??0,advisorCalls,cloudCalls:cloudCalls+cloudDraftCalls,
    localCoderCalls:state.providerInvocations?.coder??0,cloudReviewCalls:cloudCalls,cloudDraftCalls,
    modelCallsTotal:(state.providerInvocations?.coder??0)+(state.providerInvocations?.planner??0)+advisorCalls+cloudCalls+cloudDraftCalls},
   cloudDraft:state.proposal?.kind==='browser-cloud-draft'?{kind:'browser-reported-cloud-draft',...Object.fromEntries(['model','inferenceSource','revision','beforeSourceSha256','contractSha256','sourceSha256'].map(key=>[key,state.proposal.generation?.[key]]))}:null,
   challengeParent:state.challengeParent&&Number.isSafeInteger(state.challengeParent.caseCount)&&state.challengeParent.caseCount>=1&&state.challengeParent.caseCount<8&&
    ['sourceSha256','contractSha256'].every(key=>typeof state.challengeParent[key]==='string'&&/^[a-f0-9]{64}$/.test(state.challengeParent[key]))?
    {kind:'app-reported-previous-checked-contract',...Object.fromEntries(['sourceSha256','contractSha256','caseCount'].map(key=>[key,state.challengeParent[key]]))}:null,
   advisor:advisor?{revision:advisor.revision,action:advisor.action,inferenceSource:advisor.inferenceSource,
    calls:advisor.calls,kind:'model-reported-repair-hint'}:null,
   cloudReview:cloud?{revision:cloud.revision,model:cloud.model,inferenceSource:cloud.inferenceSource,
    assessment:cloud.answer?.assessment,includedNanoHypothesis:cloud.includedNanoHypothesis===true,
    kind:cloud.answer?.example?'model-proposed-example':'model-reported-second-opinion'}:null,
   ...(planner?{plannerObservation:planner}:{}),
   events:(state.events??[]).map(({kind,label})=>({kind,label}))};
 }
 function argumentPath([index,...keys]){
  return index===undefined?'Arguments':'Argument '+(index+1)+keys.map(key=>'['+JSON.stringify(key)+']').join('');
 }
 function firstInputChange(before,after,path=[]){
  if(Object.is(before,after))return null;
  if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)!==Array.isArray(after))return{path,before,after};
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   const child=[...path,Array.isArray(before)?Number(key):key];
   const oldValue=Object.hasOwn(before,key)?before[key]:undefined;
   const newValue=Object.hasOwn(after,key)?after[key]:undefined;
   const difference=firstInputChange(oldValue,newValue,child);
   if(difference)return difference;
  }
  return null;
 }
 function inputValuePreview(value){
  if(value===undefined)return 'Missing';
  if(Array.isArray(value))return 'Array';
  if(value&&typeof value==='object')return 'Object';
  return Object.is(value,-0)?'-0':JSON.stringify(value);
 }
 function functionCheckDetails(state,id){
  if(state?.task?.id!=='json-function-v1'||state.snapshot?.pending)return null;
  const check=state.checks?.find(c=>c.id===id),d=state.checkDiagnostics?.find(c=>c.id===id),example=state.task.counterexamples?.find(c=>c.id===id);
  if(!check||!d||!example||d.ok!==check.ok||!['returned','threw','unserializable'].includes(d.status)||
   typeof d.returnMatches!=='boolean'||typeof d.inputPreserved!=='boolean'||d.ok!==(d.returnMatches&&d.inputPreserved))return null;
  const reasons=[];
  if(d.status==='threw')reasons.push('The function threw an error');
  else if(d.status==='unserializable')reasons.push('The return value is outside the supported JSON data limits');
  else if(!d.returnMatches)reasons.push('The return value differs');
  let changedInput=null;
  if(!d.inputPreserved){
   reasons.push(d.argumentsAfter===null?'Input arguments became unsupported data':'Input arguments changed');
   try{
    if(typeof d.argumentsAfter==='string'){
     const change=firstInputChange(example.args,JSON.parse(d.argumentsAfter));
     if(change)changedInput={path:argumentPath(change.path),before:inputValuePreview(change.before),after:inputValuePreview(change.after)};
    }
   }catch{/* An unavailable comparison never supplies a guessed path. */}
  }
  return{summary:check.ok?'Return matched; inputs unchanged':reasons.join('. '),
   args:JSON.stringify(example.args,null,2),expected:JSON.stringify(example.expected,null,2),
   actual:d.status==='returned'?d.actualReturn:d.status==='threw'?'No return value. Error contents are withheld.':'Unsupported JSON return value.',
   argumentsAfter:d.inputPreserved?null:d.argumentsAfter??'Input arguments are no longer supported JSON data.',
   changedInput,returnMatches:d.returnMatches};
 }
 function checkedFunctionForDownload(state){
  const s=state?.snapshot,file=state?.checkedFunction,checks=state?.checks,examples=state?.task?.counterexamples;
  if(state?.mode!=='function-contract'||s?.publicChecksCurrent!==true||s.pending||!file||file.path!=='src/function.js'||
   typeof file.fileName!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}\.checked\.js$/.test(file.fileName)||
   typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||!Array.isArray(s.manifest)||!s.manifest.some(m=>m?.path===file.path&&m.sha256===file.sha256)||
   typeof file.content!=='string'||!file.content.length||new TextEncoder().encode(file.content).length>6000||
   !Array.isArray(checks)||!checks.length||checks.length>8||checks.length!==file.checkedExamples||!Array.isArray(examples)||examples.length!==checks.length||
   !checks.every(c=>typeof c?.id==='string'&&c.ok===true&&examples.some(e=>e?.id===c.id))||new Set(checks.map(c=>c.id)).size!==checks.length)return null;
  return{path:file.path,fileName:file.fileName,sha256:file.sha256,content:file.content,checkedExamples:file.checkedExamples};
 }
 function cloudChallengeSnapshot(state){
  if(state?.snapshot?.closed)return null;
  const replay=checkedReplayForDownload(state)?.packet;
  if(!replay?.context||state.checkedFunction.checkedExamples>=8)return null;
  const {revision,publicChecksCurrent}=state.snapshot;
  return{kind:'checked-function-challenge',revision,publicChecksCurrent,requirements:replay.context.instructions,
   files:Object.fromEntries(replay.files.map(({path,content})=>[path,content]))};
 }
 function tabPaddingChallenge(state,checked){
  if(!checked||checked.checkedExamples>=8)return null;
  const cases=state.task.counterexamples;
  const existingArgs=new Set(cases.map(({args})=>JSON.stringify(args)));
  for(const {args,expected} of cases){
   if(args.length!==1||!Array.isArray(args[0])||!Array.isArray(expected))continue;
   const values=args[0],retained=new Set(expected),firstSpelling=new Map();
   for(const [index,value] of values.entries()){
    if(typeof value!=='string')continue;
    const key=value.trim().toLowerCase();
    if(!key)continue;
    if(!firstSpelling.has(key)){firstSpelling.set(key,value);continue;}
    if(value!==value.trim()||value.length>=512||retained.has(value)||!retained.has(firstSpelling.get(key)))continue;
    const variant=[...values];variant[index]='\t'+value;
    if(!existingArgs.has(JSON.stringify([variant])))return{label:'Tab-pad an omitted duplicate',args:[variant],expected};
   }
  }
  return null;
 }
 function nonnegativeIntegerFields(value,path=[],fields=[]){
  if(Number.isSafeInteger(value)&&value>=0)fields.push({path,value});
  else if(value&&typeof value==='object'){
   for(const [key,item] of Object.entries(value))nonnegativeIntegerFields(item,[...path,Array.isArray(value)?Number(key):key],fields);
  }
  return fields;
 }
 function replayPacketMatchesManifest(state,packet){
  const modern=packet?.schema==='local-pit-crew/function-replay/v2';
  if(!packet||Object.keys(packet).length!==(modern?3:2)||!modern&&packet.schema!=='local-pit-crew/function-replay/v1'||!Array.isArray(packet.files)||packet.files.length!==2)return false;
  if(modern&&(!packet.context||Object.keys(packet.context).length!==2||typeof packet.context.title!=='string'||!packet.context.title.trim()||packet.context.title.length>80||typeof packet.context.instructions!=='string'||!packet.context.instructions.trim()||new TextEncoder().encode(packet.context.instructions).length>1000))return false;
  for(let i=0;i<2;i++){
   const row=packet.files[i],path=i===0?'src/function.js':'contract.json';
   if(!row||Object.keys(row).length!==3||row.path!==path||typeof row.content!=='string'||new TextEncoder().encode(row.content).length>(i===0?6000:5000)||
    !state.snapshot?.manifest?.some(m=>m.path===path&&m.sha256===row.sha256)||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))return false;
  }
  return true;
 }
 function checkedReplayForDownload(state){
  const file=checkedFunctionForDownload(state),packet=state?.checkedReplay;
  if(!file||!replayPacketMatchesManifest(state,packet))return null;
  if(packet.files[0].content!==file.content||packet.files[0].sha256!==file.sha256)return null;
  return{fileName:file.fileName.replace(/checked\.js$/,'replay.json'),packet:JSON.parse(JSON.stringify(packet))};
 }
 function failureReplayForDownload(state){
  const s=state?.snapshot,packet=state?.failedReplay;
  if(state?.mode!=='function-contract'||!s||s.closed||s.pending||s.publicChecksCurrent||
   !state.checks?.some(c=>c.ok===false)||!replayPacketMatchesManifest(state,packet))return null;
  return{fileName:'function-failure.replay.json',packet:JSON.parse(JSON.stringify(packet))};
 }
 function viewModel(state){
  const s=state?.snapshot,opened=!!s,closed=!!s?.closed,live=state?.mode==='configured-local-unverified',ownFunction=state?.mode==='function-contract';
  const isolated=(live||ownFunction)&&state.verification?.qualified===true&&state.verification?.admissionKind==='qualified-docker-quickjs-repair-v2';
  const browserFunction=ownFunction&&state.verification?.admissionKind==='browser-worker-quickjs';
  const applied=state?.proposal?.applied??(s?.counts?.patches>0);
  const trapChecked=state?.proposal?.kind==='regression-trap'&&applied&&s?.counts?.tests===2&&state.checks?.some(c=>!c.ok);
  return{
   opened,closed,live,isolated,ownFunction,browserFunction,title:state?.task?.title??'No authored sample opened',
   canLoad:opened&&!closed&&!s.pending&&(!ownFunction||(s.counts?.coder??0)<2)&&(live||ownFunction?(!state.proposal||applied):!state.proposal||trapChecked),
   canLoadTrap:opened&&!closed&&!live&&!s.pending&&state.task?.hasRegressionTrap===true&&!state.proposal&&s.counts.patches===0&&s.counts.tests===1&&state.checks?.some(c=>!c.ok),
   canApply:opened&&!closed&&!s.pending&&!!state.proposal&&!applied,
   canTest:opened&&!closed&&!s.pending&&(live?state.canVerify===true:!state.checks?.length),canFinish:opened&&!closed&&s.publicChecksCurrent,
   canCancel:opened&&!closed,
   status:ownFunction?(closed?'Function session closed. Untested behavior remains unknown.':s.publicChecksCurrent?'Your counterexamples pass for this exact source. Untested behavior remains unknown.':state.setupRetryPending?'The browser verifier could not start. Retry verification to keep the current source and examples.':state.proposal&&!applied?'Review the proposed change before Apply. Your fixed examples stay unchanged.':applied&&!state.checks?.length?'Replacement applied. Verify it against the same fixed examples.':state.checks?.length?'A counterexample failed. Inspect the evidence and choose a repair.':'Run your baseline counterexamples, then inspect the source.'):
    !opened?'Open an authored sample.':closed?(live?'Configured local session closed. No model correctness is claimed.':'Reference session closed. No model result is claimed.'):
    live?(s.publicChecksCurrent?'Backend supplied public checks passed. Not held-out correctness.':state.checks?.length?'Backend supplied public checks failed. No task success is claimed.':isolated?'Generate a local patch, review the diff, apply it, then verify.':'Configured local preview. Provider output remains unverified.'):
    s.publicChecksCurrent?'Authored public checks passed. This is not a benchmark result.':
    state.checks?.length?'Authored public checks found the seeded bug.':'Inspect files or load the explicitly authored example patch.'
  };
 }
 if(typeof module==='object'&&module.exports){module.exports={viewModel,repairSnapshot,buildProofRecord,probeBrowserRuntime,downloadBrowserModel,functionExample,functionCheckDetails,checkedFunctionForDownload,checkedReplayForDownload,cloudFailureMessage};return;}
 const document=global.document;
 if(!document)return;
 function mount(){
  const el=id=>document.getElementById(id);
  // The native link can be clicked while the module is still loading. Honor
  // its URL fragment when mounting instead of losing that first interaction.
  if(global.location?.hash==='#function-intake')el('function-intake').open=true;
  const transport=(path,options)=>(global.LocalPitCrewReferenceRequest??global.fetch.bind(global))(path,options);
  let token=null,current=null,sequence=0,busy=false,inspection=null,liveCapability=null,liveClient=null,livePump=null,liveTimer=null,liveEpoch=0,liveStarting=false;
  let startAdmissionId=null,activeStartAdmissionId=null,comparisonBusy=false;
  let functionCapability=null;
  let plannerCapability=null,advisorEpoch=0,advisorRecord=null,advisorCalls=0,advisorSession=null,livePlannerObservation=null;
  let releaseAdvisor=null;
  const hosted=typeof global.LocalPitCrewReferenceRequest==='function';
  let firebaseLoading=null,firebaseLoaded=false,pageLeaving=false;
  let browserReadiness=null;
  const blockedNativeStatus={
   'native-api-absent':'This browser does not expose the Prompt API. Open this bench in supported desktop Chrome.',
   'insecure-context':'Open the HTTPS demo or use a trustworthy loopback address.',
   'unavailable':'This browser reports the on-device model is unavailable. Use supported desktop Chrome or check readiness again.',
   'downloadable':'The browser can download the on-device model. Open model setup to start it.',
   'downloading':'The browser is downloading the model. Check readiness again when setup finishes.'
  };
  const nanoSetupMessage=()=>blockedNativeStatus[browserReadiness];
  const savedOfflineBench=()=>hosted&&global.navigator?.serviceWorker?.controller?.scriptURL===global.location?.origin+'/offline-worker.js';
  const firebaseAvailable=client=>!!client||(hosted&&!firebaseLoaded&&!!plannerCapability?.available);
  async function readFirebaseConfig(){
   const existing=plannerCapability?.firebaseConfig??liveCapability?.firebaseConfig;
   if(existing)return existing;
   if(!hosted||!plannerCapability?.available)throw Error('firebase-configuration-unavailable');
   // Firebase web identifiers are public. Load them when the user opens a
   // Firebase feature or explicitly checks on-device setup.
   const response=await global.fetch('/firebase-config.json',{
    credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)
   });
   if(!response.ok)throw Error('firebase-configuration-unavailable');
   const {firebaseConfig}=await response.json();
   if(!firebaseConfig)throw Error('firebase-configuration-unavailable');
   return firebaseConfig;
  }
  function loadFirebaseClients(){
   if(firebaseLoaded)return Promise.resolve();
   if(!firebaseLoading){
    firebaseLoading=readFirebaseConfig().then(async config=>{
     if(pageLeaving)throw Error('page-leaving');
     const firebaseEntry='/firebase-planner.mjs';
     const createPlanner=global.LocalPitCrewCreateFirebasePlanner;
     const entry=createPlanner
      ?{createFirebasePlanner:createPlanner,createFirebaseCloudReviewer:global.LocalPitCrewCreateFirebaseCloudReviewer,createFirebaseFunctionDrafter:global.LocalPitCrewCreateFirebaseFunctionDrafter}
      :await import(/* @vite-ignore */ firebaseEntry);
     if(pageLeaving)throw Error('page-leaving');
     liveClient=entry.createFirebasePlanner(config);
     cloudClient=entry.createFirebaseCloudReviewer?.(config)??null;
     draftClient=entry.createFirebaseFunctionDrafter?.(config)??null;
     firebaseLoaded=true;
    }).finally(()=>{firebaseLoading=null;});
   }
   return firebaseLoading;
  }
  let guidedRun=null;
  function guidedChallengeControl(state,checkedFile){
   const walkthrough=state?.sessionId===guidedRun?.sessionId?guidedRun?.walkthrough:null;
   if(!walkthrough||state.challengeParent||checkedFile?.content!==walkthrough.firstPatch)return null;
   if(walkthrough===shippingWalkthrough)return 'fill-shipping-challenge';
   return tabPaddingChallenge(state,checkedFile)?'fill-tab-padding-challenge':null;
  }
  let browserProbeEpoch=0;
  let browserDownload=null;
  let cloudClient=null,cloudReview=null,cloudRecord=null,cloudBusy=false,cloudEpoch=0,cloudContext=null,cloudSession=null,cloudCalls=0;
  let draftClient=null,draftReview=null,draftResult=null,draftBusy=false,draftEpoch=0,draftContext=null,draftSession=null,draftCalls=0,draftStatus='Optional cloud generation. Review the full request before sending it to Google.';
  function node(tag,text,className){
   const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;
  }
  function renderReplayCommand(prefix,replay){
   const command=replay?'npm run replay:function -- '+replay.fileName+' --source src/my-function.js':'';
   el(prefix+'-ci-command').textContent=command;
   el(prefix+'-ci-copy').hidden=!command||typeof global.navigator?.clipboard?.writeText!=='function';
   el(prefix+'-ci-copy-status').textContent='';
   if(!replay)el(prefix+'-ci-help').open=false;
  }
  for(const prefix of ['replay','failure-replay'])el(prefix+'-ci-copy').addEventListener('click',async()=>{
   const button=el(prefix+'-ci-copy'),command=el(prefix+'-ci-command').textContent;
   if(button.hidden||button.disabled||!command)return;
   const owner=current;
   button.disabled=true;
   let status;
   try{await global.navigator.clipboard.writeText(command);status='Command copied.';}
   catch{status='Could not copy. Select the command above to copy it.';}
   finally{button.disabled=false;}
   if(current===owner)el(prefix+'-ci-copy-status').textContent=status;
  });
  let repeatSession=null;
  function renderRepeatExample(state,checked,blocked){
   const session=checked&&checked.checkedExamples<8?state.sessionId:null;
   const picker=el('repeat-example-case');
   if(session!==repeatSession){
    repeatSession=session;
    picker.replaceChildren();
    if(session){
     for(const [index,example] of state.task.counterexamples.entries()){
      const option=node('option',(index+1)+'. '+example.label);
      option.value=example.id;picker.append(option);
     }
     picker.value=state.task.counterexamples[0].id;
    }
   }
   el('repeat-example').hidden=!session;
   picker.disabled=el('fill-repeat-example').disabled=blocked||!session;
  }
  function earlierPassingCall(state,id){
   const cases=state?.task?.counterexamples;
   if(!cases)return '';
   const current=cases.findIndex(example=>example.id===id);
   if(current<1)return '';
   const {args,expected}=cases[current];
   const key=JSON.stringify([args,expected]);
   const earlier=cases.slice(0,current).findIndex(example=>JSON.stringify([example.args,example.expected])===key&&
    state.checks.some(check=>check.id===example.id&&check.ok));
   return earlier<0?'':'Call '+(earlier+1)+' passed with these same arguments. Call '+(current+1)+' failed.';
  }
  let boundarySession=null,boundaryFields=[];
  function renderNumericBoundary(state,checked,blocked){
   const session=checked&&checked.checkedExamples<8?state.sessionId:null;
   const picker=el('numeric-boundary-field'),fill=el('fill-numeric-boundary');
   if(session!==boundarySession){
    boundarySession=session;boundaryFields=[];picker.replaceChildren();
    if(session){
     for(const {id,args} of state.task.counterexamples){
      const fields=nonnegativeIntegerFields(args);
      if(!fields.length)continue;
      const group=node('optgroup');group.label=state.task.checkLabels?.[id]??id;
      for(const {path,value} of fields){
       const option=node('option',argumentPath(path)+' · '+value);option.value=String(boundaryFields.length);
       boundaryFields.push({args,path});group.append(option);
      }
      picker.append(group);
     }
     if(boundaryFields.length)picker.value='0';
    }
   }
   el('numeric-boundary').hidden=!boundaryFields.length;
   picker.disabled=fill.disabled=blocked||!boundaryFields.length;
  }
  function sourceComparison(before,after){
   const original=Array.from(before),replacement=Array.from(after);
   const sharedLimit=Math.min(original.length,replacement.length);
   let prefix=0,suffix=0;
   while(prefix<sharedLimit&&original[prefix]===replacement[prefix])prefix++;
   while(suffix<sharedLimit-prefix&&original[original.length-1-suffix]===replacement[replacement.length-1-suffix])suffix++;
   const renderSource=(source,characters,className)=>{
    const end=characters.length-suffix;
    if(end===prefix)return node('pre',source,className);
    const block=node('pre',undefined,className);
    block.append(node('span',characters.slice(0,prefix).join('')),node('mark',characters.slice(prefix,end).join(''),'source-change'),node('span',characters.slice(end).join('')));
    return block;
   };
   return [renderSource(before,original,'before'),renderSource(after,replacement,'after')];
  }
  function observedPair(className,beforeLabel,before,afterLabel,after,changed){
   const pair=node('div',undefined,'counterexample-pair '+className+(changed?' changed':''));
   for(const [label,value] of [[beforeLabel,before],[afterLabel,after]]){
    const item=node('div');
    item.append(node('div',label,'code-label'),node('pre',value));
    pair.append(item);
   }
   return pair;
  }
  function render(state){
   const advisorBusy=!!releaseAdvisor;
   const context=state?.sessionId+':'+state?.snapshot?.revision+':'+state?.snapshot?.closed;
   if(context!==draftContext){draftContext=context;draftEpoch++;draftClient?.stop();draftReview=null;draftResult=null;draftBusy=false;draftStatus='Optional cloud generation. Review the full request before sending it to Google.';}
   if(draftSession!==state?.sessionId){draftSession=state?.sessionId;draftCalls=0;}
   if(context!==cloudContext){
    cloudContext=context;cloudEpoch++;cloudClient?.stop();cloudReview=null;cloudRecord=null;cloudBusy=false;
    el('cloud-status').textContent='Review the complete request before sending it to Google.';
   }
   if(cloudSession!==state?.sessionId){cloudSession=state?.sessionId;cloudCalls=0;}
   if(advisorSession!==state?.sessionId){advisorSession=state?.sessionId;advisorRecord=null;advisorCalls=0;livePlannerObservation=null;}
   if(advisorRecord?.revision!==state?.snapshot?.revision)advisorRecord=null;
   current=state;const view=viewModel(state),s=state?.snapshot,blocked=busy||!!inspection;
   el('open').disabled=blocked||!token;el('sample').disabled=blocked||!token;el('investigate').disabled=blocked||!token;
   el('open-function').disabled=blocked||!token||!functionCapability?.available;
   el('restore-function-replay').disabled=blocked||!token;
   el('try-function-example').disabled=blocked||!token||!functionCapability?.available;
   el('try-hybrid-example').disabled=el('try-function-example').disabled;
   el('try-hybrid-example').hidden=!plannerCapability?.available;
   el('try-shipping-example').disabled=el('try-function-example').disabled;
   el('try-missed-test').disabled=el('try-function-example').disabled;
   el('active-run').hidden=!s;
   el('entry-status').textContent=functionCapability?.available?(functionCapability.admissionKind==='browser-worker-quickjs'?'Checks run in this tab. Model advice is optional.':'Function checks are available. Model advice is optional.'):'Function checks are unavailable here. You can still explore the practice drills.';
   el('function-patch').hidden=!view.ownFunction;
   if(el('sample').value==='json-function-v1'){el('open').disabled=true;el('investigate').disabled=true;}
   el('open-live').disabled=blocked||!token||!liveCapability?.available||(liveCapability.plannerRequired!==false&&!liveClient);
   el('mode-chip').textContent=view.live?'Configured local, unverified':'Reference workflow';
   el('scope-title').textContent=view.live?'Configured local mode. Outputs are not verified.':'Authored reference patches. Optional model opinions.';
   el('scope-copy').textContent=view.live?'Uses a host-configured provider on an authored sample. Returned code is data until a separately verified backend is registered. No benchmark or hardware-fit result is claimed.':'This exercises the persisted workflow controller with named examples. Patches are authored test corrections, not model output. Your repositories are not opened.';
   if(state?.storage==='browser-memory'){
    el('scope-copy').textContent='These authored drills run in this tab. Reloading resets the run. Read the source, investigate the failure and review a known correction. Firebase model opinions are optional; your repositories are not opened.';
    el('open-live').hidden=true;
   }
   if(view.isolated){
    el('mode-chip').textContent='Local patches · isolated checks';
    el('scope-title').textContent='Generate. Inspect. Earn the fix.';
    el('scope-copy').textContent='Your local model proposes a change. Review and apply the exact diff, then check the current source in a qualified Docker/QuickJS runner. These public sample checks do not establish held-out correctness. Your repositories are not opened.';
   }
   if(!view.live&&!view.ownFunction&&(advisorBusy||advisorCalls)){
    el('mode-chip').textContent=advisorBusy?'Nano diagnosis in progress':'Nano diagnosis attempted';
    el('scope-title').textContent=advisorBusy?'Nano is inspecting this failure.':'Reference patch workflow with a separate Nano diagnosis.';
    el('scope-copy').textContent='The correction remains an authored example. Nano advice is shown separately, with its SDK-reported inference source. Your repositories are not opened.';
   }
   el('checks-copy').textContent=view.live?(state.canVerify?'Trusted-backend supplied public checks, not held-out grading.':'No verified isolated backend is registered. Returned code cannot be run here.'):'Authored public reference checks, not held-out benchmark results.';
   if(view.isolated)el('checks-copy').textContent='The current in-memory source runs inside a fresh, resource-limited Docker/QuickJS job. Results cover this public sample contract.';
   el('load').textContent=view.live?'Generate local patch':state?.proposal?.kind==='regression-trap'?'Load authored correction':'Load authored example patch';
   el('load-trap').hidden=view.live||state?.task?.hasRegressionTrap!==true;
   el('trap-help').hidden=el('load-trap').hidden;
   el('test').textContent=view.live?'Request backend public checks':'Run authored public checks';
   if(view.isolated)el('test').textContent='Verify current source';
   el('finish').textContent=view.live?'Finish public-check workflow':'Finish reference workflow';
   el('scope-footer').textContent=view.live?'Hardware fit, Nano identity, network locality and model correctness remain unverified. No user repository is opened.':'Authored public checks do not establish model quality, Nano identity, privacy or production readiness.';
   if(view.ownFunction){
    el('mode-chip').textContent='Your function · fixed counterexamples';
    el('scope-title').textContent='A repair has to earn every check.';
    el('scope-copy').textContent=view.browserFunction?'This function runs in a separate browser worker using a bounded interpreter. Compare actual results and changed inputs, review your replacement and check it against the same examples. Reloading clears this run.':'Paste a replacement, inspect the exact diff and verify it in the qualified Docker/QuickJS runner. Return values and JSON-visible input preservation are checked. Your contract stays read-only.';
    el('load').textContent='Review pasted patch';el('test').textContent='Verify my counterexamples';el('finish').textContent='Finish checked repair';
    el('checks-copy').textContent='Your JSON examples run against this exact function source. Passing examples do not prove general correctness.';
    el('scope-footer').textContent='Source and counterexamples are excluded from the default evidence export. Cloud requests send only the prompt you explicitly approve.';
   }
   el('task').textContent=state?.task?.prompt??'Open a sample to inspect its task.';
   el('sample-impact').textContent=state?.task?.id==='json-function-v1'?'Your counterexamples define the contract. Check every changed behavior.':impacts[state?.task?.id]??'Three isolated examples of bugs that quietly hurt real software.';
   if(state?.challengeParent)el('sample-impact').textContent='Extended contract: kept '+state.challengeParent.caseCount+' previous examples and added one. This new run requires fresh checks.';
   el('session-marker').textContent=s?'REV '+s.revision+' / '+(s.closed?'CLOSED':'BENCH RUN'):'NO ACTIVE RUN';
   const phase={baseline:!!state?.checks?.length||state?.events?.some(e=>e.kind==='test'),inspect:!!s?.evidence?.length,patch:!!state?.proposal,verify:!!s?.publicChecksCurrent};
   let next=true;for(const [name,done]of Object.entries(phase)){el('phase-'+name).className=done?'done':next?'active':'';if(!done)next=false;}
   el('patch-state').textContent=state?.proposal?((state.proposal.applied??(s?.counts.patches>0))?'APPLIED IN MEMORY':'REVIEW REQUIRED'):'AWAITING PATCH';
   const checkedFile=checkedFunctionForDownload(state);
   el('checked-function').hidden=!checkedFile;
   el('checked-source').textContent=checkedFile?.content??'';
   el('checked-function-copy').textContent=checkedFile?checkedFile.checkedExamples+'/'+checkedFile.checkedExamples+' fixed examples passed. '+checkedFile.fileName:'';
   el('download-checked-function').disabled=blocked||cloudBusy||!checkedFile;
   el('challenge-function').hidden=!checkedFile;
   el('extend-function').disabled=blocked||cloudBusy||!checkedFile||checkedFile.checkedExamples>=8;
   renderRepeatExample(state,checkedFile,el('extend-function').disabled);
   renderNumericBoundary(state,checkedFile,el('extend-function').disabled);
   const walkthrough=state?.sessionId===guidedRun?.sessionId?guidedRun?.walkthrough:null;
   const showHybridReview=walkthrough&&guidedRun.focusModelReview;
   const startsWithRecordedDraft=walkthrough===shippingWalkthrough&&guidedRun.startWithDraft&&!state.challengeParent;
   if(startsWithRecordedDraft){
    el('scope-title').textContent='Would you ship the recorded Gemini patch?';
    el('scope-copy').textContent='The patch sees the original four examples. The extra check expects null for a price above JavaScript’s safe integer range.';
   }
   el('load-function-example-patch').hidden=!walkthrough||!view.canLoad||startsWithRecordedDraft;
   el('load-function-example-patch').disabled=blocked||cloudBusy||el('load-function-example-patch').hidden;
   el('load-function-example-patch').textContent=(state?.challengeParent?walkthrough?.finalLabel:walkthrough?.firstLabel)??'Fill example patch';
   el('shipping-example-note').hidden=walkthrough!==shippingWalkthrough;
   const challengeControl=guidedChallengeControl(state,checkedFile);
   el('fill-shipping-challenge').hidden=challengeControl!=='fill-shipping-challenge';
   el('fill-shipping-challenge').disabled=el('extend-function').disabled;
   el('fill-tab-padding-challenge').hidden=!tabPaddingChallenge(state,checkedFile);
   el('fill-tab-padding-challenge').disabled=el('extend-function').disabled;
   el('challenge-status').textContent=checkedFile?.checkedExamples>=8?'This contract already uses all eight example slots.':
    'Starts a new unchecked run with this exact source, every existing example and your one added example. The current contract stays unchanged.';
   const replay=checkedReplayForDownload(state);
   el('download-function-replay').disabled=blocked||cloudBusy||!replay;
   el('function-replay').hidden=!replay;el('replay-json').textContent=replay?JSON.stringify(replay.packet,null,2)+'\n':'';
   renderReplayCommand('replay',replay);
   el('checked-function-status').textContent='';
   const failedReplay=failureReplayForDownload(state);
   el('failure-replay').hidden=!failedReplay;
   el('download-failure-replay').disabled=blocked||cloudBusy||!failedReplay;
   el('failure-replay-json').textContent=failedReplay?JSON.stringify(failedReplay.packet,null,2)+'\n':'';
   renderReplayCommand('failure-replay',failedReplay);
   el('failure-replay-status').textContent='';
   const total=state?.checks?.length??0,passed=state?.checks?.filter(c=>c.ok).length??0;
   el('pass-count').textContent=total?passed+'/'+total:'—';
   el('pass-label').textContent=state?.checks?.length?(s?.publicChecksCurrent?'PUBLIC CHECKS PASS':'FAILURE TO INVESTIGATE'):'NO CHECKS RUN';
   el('coder-calls').textContent=String(state?.providerInvocations?.coder??0);
   el('planner-calls').textContent=String((state?.providerInvocations?.planner??0)+advisorCalls);
   el('advisor-copy').textContent=view.ownFunction?'Nano receives the current source and failed examples, including expected and actual returns and observed input changes. It reasons on-device; review its hint before editing.':'A failed check and the source give Nano something specific to reason about. Its hint stays separate from the patch.';
   if(showHybridReview)el('advisor-copy').textContent='Nano reads the source and failed examples on this device.';
   el('diagnose').disabled=blocked||view.live||!firebaseAvailable(liveClient)||!!nanoSetupMessage()||!repairSnapshot(state);
   el('stop-diagnosis').hidden=!advisorBusy;
   el('open-browser-setup').hidden=view.live||!plannerCapability?.available;
   el('export').disabled=!s;
   el('readiness').replaceChildren();
   const firebaseStatus=hosted&&plannerCapability?.available
    ?(firebaseLoaded?'Firebase AI Logic: loaded':'Firebase AI Logic: loads on first AI action')
    :(plannerCapability?.bundleReady?'Firebase bundle: integrity checked':'Firebase bundle: unavailable');
   const configStatus=plannerCapability?.configReady||firebaseLoaded?'Firebase / App Check: configured':
    hosted&&plannerCapability?.available?'Firebase / App Check: config loads on first AI action':'Firebase / App Check: setup required';
   for(const line of ['Reference drills: ready',firebaseStatus,configStatus,
    liveCapability?.available?'Local coder: configured':'Local coder: setup required',
    state?.canVerify||view.ownFunction&&functionCapability?.available?'Source verifier: available':'Source verifier: qualification required'])el('readiness').append(node('li',line));
   if(state?.providerProfile)el('readiness').append(node('li','Model: '+state.providerProfile.modelId+' / '+state.providerProfile.engineBuild));
   if(!advisorRecord){
    const observation=plannerObservationRecord(state,livePlannerObservation);
    el('advisor-status').textContent=observation?.status==='blocked'?
     (plannerDiagnostics[observation.diagnostic]??'The browser planner did not return accepted advice.')+(s?.closed?' This local run stopped.':' No repair advice was accepted.'):
     observation?.status==='decision'?'The browser planner returned advice for revision '+observation.revision+'. Its inference source is SDK-reported.':
     view.live?(liveCapability?.plannerRequired===false?(plannerCapability?.available?
      'This run uses the local coder. Open a reference run to ask Nano separately.':
      'This run uses the local coder. Configure Firebase to enable separate Nano advice.'):
      'Nano repair planning runs automatically after an applied patch fails public checks. The app binds its selected source line to this revision.'):
     !plannerCapability?.available?'Launch with your Firebase configuration to connect Nano. Reference drills work now.':
     nanoSetupMessage()??(!repairSnapshot(state)?'Run a failing baseline, then read a file. Nano needs current evidence.':
       browserReadiness==='available'?(liveClient?'Chrome reports an available model and Firebase is loaded for this tab.':
        'Chrome reports an available model. Open model setup to prepare this tab for offline diagnosis.'):
        'On-device diagnosis needs a ready browser model. Check model setup or ask Nano to try.');
   }
   el('advisor-result').replaceChildren();
   if(advisorRecord){const hint=node('div',advisorRecord.objective,'advisor-hint');hint.append(node('small','REV '+advisorRecord.revision+' / '+advisorRecord.inferenceSource+' (SDK-reported) · '+advisorRecord.evidenceIds.length+' source citations'));el('advisor-result').append(hint);}
   const status=view.canFinish&&challengeControl
    ?startsWithRecordedDraft?'The recorded draft passed all four original checks. Run the unsafe-price check next.':'All current examples passed. Try one more case before finishing.'
    :view.status;
   const message=view.ownFunction&&total&&!s.pending&&!view.closed?passed+' of '+total+' examples passed. '+status:status;
   if(el('status').textContent!==message)el('status').textContent=message;
   el('status').className='status';
   for(const [id,enabled]of Object.entries({load:view.canLoad,'load-trap':view.canLoadTrap,apply:view.canApply,test:view.canTest,finish:view.canFinish,cancel:view.canCancel}))el(id).disabled=!enabled||(blocked&&id!=='cancel');
   if(comparisonBusy)el('cancel').disabled=true;
   if(view.live&&liveCapability?.plannerRequired!==false&&!liveClient?.state.prepared)el('load').disabled=true;
   if(liveStarting||activeStartAdmissionId)el('cancel').disabled=false;
   el('files').replaceChildren();
   for(const file of s?.manifest??[]){
    const item=node('div',undefined,'file-row'),label=node('span',file.path),button=node('button',s.evidence.some(e=>e.path===file.path&&e.sha256===file.sha256)?'Read again':'Read','tiny');
    button.setAttribute?.('aria-label',button.textContent+' '+file.path);
    button.disabled=blocked||view.closed;button.addEventListener('click',()=>action('read',{path:file.path}));
    item.append(label,button);el('files').append(item);
   }
   el('proposal-source').textContent=state?.proposal?.source??(view.ownFunction?'No replacement reviewed. Paste your proposed full function source.':view.live?'No patch generated yet. A host provider is configured; no verified result.':'No patch loaded. Use the authored correction to inspect the repair workflow.');
   el('patches').replaceChildren();
   if(!state?.proposal)el('patches').append(node('p','Every proposed change gets a before and after.','empty-state'));
   for(const edit of state?.proposal?.edits??[]){
    const block=node('div',undefined,'patch');
    const [before,after]=sourceComparison(edit.find,edit.replace);
    const label=state.proposal.kind==='browser-cloud-draft'?'Cloud-proposed replacement (browser-reported)':view.ownFunction?'Your pasted replacement':view.live?'Provider-reported patch':state.proposal.kind==='regression-trap'?'Authored regression trap':'Authored correction';
    block.append(node('h3',edit.path),node('div','Before','code-label'),before,node('div',label,'code-label'),after);
    el('patches').append(block);
   }
   if(state?.proposal?.kind==='browser-cloud-draft'&&typeof state.proposal.explanation==='string')el('patches').append(node('p',state.proposal.explanation,'muted'));
   el('evidence').replaceChildren();
   for(const evidence of s?.evidence??[]){
    const currentRead=s.manifest.some(m=>m.path===evidence.path&&m.sha256===evidence.sha256),block=node('div');
    block.append(node('h3',evidence.path),node('p',currentRead?'Current source read.':'Earlier source read. The current file has changed.','muted'),node('pre',evidence.content));el('evidence').append(block);
   }
   const changes=publicCheckChangesRecord(state),comparison=el('check-changes');comparison.replaceChildren();comparison.hidden=!changes;
   if(changes){
    comparison.className='check-changes'+(changes.regressed.length?' has-regression':'');
    comparison.append(node('strong',changes.regressed.length?(changes.beforePassed===changes.afterPassed?'Same total, different behavior':'Previously passing checks regressed'):'Check-by-check progress'),
     node('p',changes.beforePassed+'/'+changes.total+' → '+changes.afterPassed+'/'+changes.total,'check-delta'));
    for(const [key,label]of [['repaired','Now passing'],['regressed','Now failing']]){
     if(changes[key].length){const list=node('ul');for(const id of changes[key])list.append(node('li',id));comparison.append(node('span',label,'code-label'),list);}
    }
    comparison.append(node('p','Compared with the previous checked source. Public sample checks only.','muted'));
   }
   el('checks').replaceChildren();
   const checks=state?.checks??[];
   const failing=checks.filter(check=>!check.ok);
   const orderedChecks=view.ownFunction?[...failing,...checks.filter(check=>check.ok)]:checks;
   const addedExample=state?.challengeParent
    ?state.task?.counterexamples?.[state.challengeParent.caseCount]?.id
    :null;
   const firstFailure=view.ownFunction?failing[0]:null;
   const firstDiagnostic=firstFailure?functionCheckDetails(state,firstFailure.id):null;
   const modelEvidence=el('model-review-evidence');
   const showModelEvidence=showHybridReview&&firstDiagnostic;
   modelEvidence.replaceChildren();
   modelEvidence.hidden=!showModelEvidence;
   if(showModelEvidence){
    const label=state.task.checkLabels?.[firstFailure.id]??firstFailure.id;
    modelEvidence.append(node('h3','Observed in the browser'),
     node('p',passed+'/'+total+' passing · '+label),
     observedPair('counterexample-returns','Expected return',firstDiagnostic.expected.replace(/\n\s*/g,' '),
      'Observed return',firstDiagnostic.actual.replace(/\n\s*/g,' '),!firstDiagnostic.returnMatches));
   }
   el('inspect-failed-example').hidden=!firstDiagnostic;
   el('failure-preview').hidden=!firstDiagnostic;
   el('failure-preview-count').textContent=firstDiagnostic?(checks.length-failing.length)+'/'+checks.length+' passing':'';
   el('failure-preview-name').textContent=firstDiagnostic?(state.task.checkLabels?.[firstFailure.id]??firstFailure.id):'';
   el('failure-preview-reason').textContent=firstDiagnostic?
    earlierPassingCall(state,firstFailure.id)||firstDiagnostic.summary:'';
   for(const check of orderedChecks){
    const block=node('div',undefined,'check '+(check.ok?'pass':'fail'));
    const name=node('span',state.task?.checkLabels?.[check.id]??check.id);
    if(check.id===addedExample)name.append(node('span','Added counterexample','added-counterexample'));
    block.append(node('span',check.ok?'PASS':'FAIL','result'),name);
    const diagnostic=functionCheckDetails(state,check.id);
    if(diagnostic){
     const detail=node('details',undefined,'counterexample-detail');detail.open=!check.ok;
     detail.append(node('summary',diagnostic.summary),observedPair('counterexample-returns',
      'Expected return',diagnostic.expected,'Observed return',diagnostic.actual,!diagnostic.returnMatches));
     if(!check.ok){
      const earlier=earlierPassingCall(state,check.id);
      if(earlier)detail.append(node('p',earlier,'repeat-call-evidence'));
     }
     if(diagnostic.argumentsAfter===null)detail.append(node('div','Input arguments','code-label'),node('pre',diagnostic.args));
     else{
      const inputs=observedPair('counterexample-inputs','Input before the call',diagnostic.args,'Input after the call',diagnostic.argumentsAfter,true);
      const change=diagnostic.changedInput;
      if(change){
       const full=node('details',undefined,'counterexample-full-inputs');
       full.append(node('summary','View full arguments'),inputs);
       detail.append(node('p','First observed input change: '+change.path,'counterexample-input-change'),
        observedPair('counterexample-input-values','Before',change.before,'After',change.after,true),full);
      }else detail.append(inputs);
     }
     detail.append(node('p','Observed for this checked source. Your examples define the expected behavior.','muted'));
     if(check===firstFailure&&guidedRun?.sessionId===state.sessionId){
      const back=node('button','Return to repair controls','secondary');
      back.id='return-to-repair';back.type='button';back.disabled=blocked;
      back.addEventListener('click',()=>el('next-action').focus?.());
      detail.append(back);
     }
     block.append(detail);
    }
    if(!check.ok&&check.message)block.append(node('pre',check.message));el('checks').append(block);
   }
   el('events').replaceChildren();
   if(!state?.events?.length)el('events').append(node('li','No reference session has started.','muted'));
   for(const event of state?.events??[])el('events').append(node('li',event.label));
   if(!s){el('mode-chip').textContent='Ready for a repair';el('scope-footer').textContent='Fixed examples. Reviewed changes. Visible results.';}
   renderCloud();
   renderFunctionDraft();
  }
  function renderPromptPreview(prefix,review){
   el(prefix+'-preview').hidden=!review;
   el(prefix+'-payload').textContent=review?.prompt??'';
   const payloadJson=review?.payloadJson,exact=el(prefix+'-exact'),data=el(prefix+'-data');
   data.textContent=payloadJson??'';data.hidden=!payloadJson;
   exact.hidden=!review;
   if(!review)exact.open=false;
   else if(!payloadJson)exact.open=true;
   return payloadJson?JSON.parse(payloadJson):null;
  }
  function renderFunctionDraft(){
   const s=current?.snapshot,view=viewModel(current),allowed=view.ownFunction&&view.canLoad&&(s?.counts?.coder??0)<2&&current.checks?.some(c=>c.ok===false);
   el('cloud-function-draft').hidden=!view.ownFunction;
   el('preview-function-draft').disabled=busy||!!inspection||cloudBusy||!firebaseAvailable(draftClient)||!allowed||(draftClient?.state.calls??0)>=5;
   el('preview-function-draft-with-nano').hidden=!view.ownFunction||!currentNanoHint();
   el('preview-function-draft-with-nano').disabled=el('preview-function-draft').disabled;
   el('send-function-draft').disabled=busy||!!inspection||cloudBusy||!draftClient||!draftReview||!allowed;
   const data=renderPromptPreview('function-draft',draftReview);
   const examples=data?.contract.cases.length,failures=data?.failedFunctionExamples?.length??0;
   el('function-draft-disclosure').textContent=data?
    'This request shares the function, its requirements, '+examples+(examples===1?' fixed example and ':' fixed examples and ')+failures+' failed check '+(failures===1?'observation.':'observations.')+
    (data.nanoHint?' The Nano hypothesis is included.':' The Nano hypothesis stays local.'):'';
   el('cancel-function-draft').hidden=!draftReview&&!draftBusy&&!draftResult;
   el('function-draft-result').hidden=!draftResult;
   el('function-draft-explanation').textContent=draftResult?.explanation??'';el('function-draft-source').textContent=draftResult?.source??'';
   el('review-function-draft').disabled=busy||!!inspection||cloudBusy||!draftResult||!allowed;
   let status=draftStatus;
   if(!draftReview&&!draftBusy&&!draftResult&&current?.proposal?.kind==='browser-cloud-draft')status=current.proposal.applied?(s.publicChecksCurrent?'The cloud draft passed your fixed examples. Untested behavior remains unknown.':'The cloud draft is applied in memory. Verify every fixed example.'):'Cloud draft ready. Review the exact diff before Apply.';
   else if(!firebaseAvailable(draftClient))status='Configure Firebase to request cloud drafts. Pasted replacements remain available.';
   else if(!draftReview&&!draftBusy&&!view.closed&&(s?.counts?.coder??0)>=2)status='This run has used its two proposal slots. Reopen to try another repair path.';
   else if(!draftReview&&!draftBusy&&!draftResult&&(draftClient?.state.calls??0)>=5)status='This tab has used its five cloud draft requests. Pasted replacements remain available.';
   el('function-draft-status').textContent=status;
   renderNextAction();
  }
  function nextAction(){
   const view=viewModel(current);
   if(!view.ownFunction)return null;
   if(view.closed)return checkedFunctionForDownload(current)?{label:'View checked function',target:'checked-function'}:{label:'Start another function',target:'function-intake'};
   if(busy||inspection||cloudBusy)return{label:'Working…',waiting:true};
   if(view.canFinish){
    const challenge=guidedChallengeControl(current,checkedFunctionForDownload(current));
    if(challenge==='fill-shipping-challenge'&&guidedRun.startWithDraft)return{label:'Run the unsafe-price check',missedTest:true};
    return challenge?{label:'Try a new counterexample',target:'challenge-function',focus:challenge}:{label:'Finish checked repair',action:'finish'};
   }
   if(view.canApply)return{label:'Review before Apply',target:'apply'};
   if(view.canTest)return{label:current.setupRetryPending?'Retry verification':current.proposal?.applied?'Verify replacement':'Run baseline checks',action:'test'};
   if(draftResult)return{label:'Review cloud diff',action:'review-function-draft'};
   if(draftReview)return{label:'Review cloud request',target:'function-draft-preview',focus:'send-function-draft'};
   const examplePatch=el('load-function-example-patch');
   const focus=!examplePatch.hidden&&!examplePatch.disabled?'load-function-example-patch':firebaseAvailable(draftClient)?'preview-function-draft':'function-replacement';
   return{label:'Choose a repair',target:'change-panel',focus};
  }
  function renderNextAction(){
   const next=nextAction(),button=el('next-action');button.hidden=!next;
   button.textContent=next?.label??'';
   const disabled=!next||!!next.waiting||(next.action?el(next.action).disabled:false);
   // Keep the active control in the keyboard path while a check is running.
   const retainFocus=disabled&&next&&document.activeElement===button;
   button.disabled=disabled&&!retainFocus;
   button.setAttribute?.('aria-disabled',String(disabled));
  }
  el('next-action').addEventListener('click',()=>{
   const next=nextAction();if(!next||next.waiting)return;
   if(next.missedTest)return runMissedShippingTest();
   if(next.action){const button=el(next.action);if(!button.disabled)return button.click();return;}
   const target=el(next.target);if(next.target==='function-intake'||next.target==='challenge-function')target.open=true;
   if(next.target==='checked-function'){const detail=target.querySelector?.('details');if(detail)detail.open=true;}
   target.scrollIntoView?.({block:'start',behavior:'auto'});
   const focus=next.focus?el(next.focus):target;focus.focus?.({preventScroll:true});
  });
  function stopFunctionDraft(){
   draftEpoch++;draftClient?.stop();draftReview=null;draftResult=null;if(draftBusy)busy=false;draftBusy=false;
   draftStatus='Patch request closed. A request already sent may continue at the provider.';
  }
  function renderCloud(){
   el('view-record').disabled=!current?.snapshot||busy||!!inspection||cloudBusy;
   el('record-preview').hidden=true;el('record-json').textContent='';
   if(current?.mode==='authored-reference'&&current?.snapshot){
    if(cloudBusy||cloudCalls){
     el('mode-chip').textContent=cloudBusy?'Cloud review in progress':advisorCalls?'Nano + cloud attempted':'Cloud review attempted';
     el('scope-title').textContent='Reference patches with separate model opinions.';
     el('scope-copy').textContent='The correction remains an authored example. Cloud advice uses the prompt you reviewed and is shown separately from Nano advice and the patch.';
    }else if(!releaseAdvisor&&!advisorCalls){
     el('mode-chip').textContent='Reference workflow';el('scope-title').textContent='Authored reference patches. Optional model opinions.';
     el('scope-copy').textContent=current?.storage==='browser-memory'?'These authored drills run in this tab. Reloading resets the run. Example patches are authored; model advice is optional and shown separately.':'Follow a known correction through the bench. Example patches are authored; model advice is optional and shown separately.';
    }
   }
   const challenge=cloudChallengeSnapshot(current);
   const reviewable=challenge||['authored-reference','function-contract'].includes(current?.mode)&&repairSnapshot(current);
   el('cloud-heading').textContent=challenge?'Look for a missed case':'Challenge the diagnosis';
   el('cloud-copy').textContent=challenge?'Ask Gemini to suggest one more example for this passing function. You decide the expected return and run it locally.':
    'Ask Gemini for a counterexample or a next check. Review what leaves your device first. Works without the on-device model.';
   if(!challenge&&guidedRun?.focusModelReview&&guidedRun.sessionId===current?.sessionId){
    el('cloud-copy').textContent='Preview what you’ll send to Gemini for a second opinion.';
   }
   el('review-cloud').textContent=challenge?'Review request for a new example':'Review cloud payload';
   el('review-cloud').disabled=busy||!!inspection||cloudBusy||!firebaseAvailable(cloudClient)||!reviewable;
   el('review-cloud-with-nano').hidden=!!challenge||!reviewable||!currentNanoHint()||!firebaseAvailable(cloudClient);
   el('review-cloud-with-nano').disabled=el('review-cloud').disabled;
   if(current?.mode==='configured-local-unverified')el('cloud-status').textContent=plannerCapability?.available?
    'Cloud review is available in reference runs. Finish or close this run to switch.':
    'Configure Firebase to enable cloud review.';
   el('send-cloud').disabled=busy||!!inspection||cloudBusy||!cloudReview;
   const data=renderPromptPreview('cloud',cloudReview?.approval);
   el('cloud-disclosure').textContent=data?.files?
    'This request shares the checked function, its requirements and its existing examples.':
    data?'This request shares the task, source evidence and failed check IDs.'+
     (data.nanoHint?' The Nano hypothesis is included.':' The Nano hypothesis stays local.'):'';
   el('cancel-cloud').hidden=!cloudReview&&!cloudBusy;
   el('cloud-calls').textContent=String(cloudCalls+draftCalls);
   const output=el('cloud-result');
   output.replaceChildren();output.hidden=!cloudRecord;
   if(cloudRecord){
    const answer=cloudRecord.answer,block=node('div',undefined,'advisor-hint');
    const {example}=answer;
    const opinion=node('div');
    opinion.append(node('h3',example?'Suggested example':cloudRecord.reviewedHint?'Gemini’s second opinion':'Independent cloud review'),
     node('p',answer.explanation));
    if(cloudRecord.reviewedHint){
     const hypothesis=node('div',undefined,'reviewed-hypothesis');
     hypothesis.append(node('h3','Nano hypothesis sent to Gemini'),node('p',cloudRecord.reviewedHint));
     const comparison=node('div',undefined,'model-opinion-comparison');
     comparison.append(hypothesis,opinion);block.append(comparison);
    }else block.append(opinion);
    block.append(node('h3','Next check to try'),node('p',answer.nextCheck),
     node('small','REV '+cloudRecord.revision+' / '+cloudRecord.model+' / in_cloud (SDK-reported)'+
      (example?'':' · '+answer.evidenceIds.length+' source citations')));
    if(example&&challenge){
     const load=node('button','Fill example for review','secondary');
     load.type='button';load.disabled=busy||!!inspection||cloudBusy;
     load.addEventListener('click',()=>{
      if(busy||inspection||cloudBusy||cloudRecord?.answer!==answer||!cloudChallengeSnapshot(current))return;
      fillChallengeExample(example,'Check the suggested arguments and expected return against your requirements. Edit them before starting if needed.');
     });
     block.append(load);
    }
    output.append(block);
   }
  }
  function fillChallengeExample({label,args,expected},message){
   el('challenge-function').open=true;
   el('challenge-label').value=label;
   el('challenge-args').value=JSON.stringify(args,null,2);
   el('challenge-expected').value=expected===undefined?'':JSON.stringify(expected,null,2);
   el('challenge-status').textContent=message;
   const expectedInput=el('challenge-expected');
   expectedInput.focus?.({preventScroll:true});
   expectedInput.scrollIntoView?.({block:'center',behavior:'auto'});
  }
  async function request(path,body,onStale){
   // Synchronous start guard: never send a competing start while any request is pending.
   if(busy&&['/api/start','/api/workbench/start','/api/function/open','/api/function/extend'].includes(path))return;
   const mine=++sequence;busy=true;if(current)render(current);
   if(body?.action==='generate'){el('status').textContent='Generating with the local coder. Close remains available.';el('coder-calls').textContent='…';}
   else if(body?.action==='test')el('status').textContent='Running the public checks…';
   try{
    const response=await transport(path,{
     method:body===undefined?'GET':'POST',credentials:'same-origin',
     headers:body===undefined?{}:{'Content-Type':'application/json','X-Pitcrew-Token':token},body:body===undefined?undefined:JSON.stringify(body)
    });
    const data=await response.json();if(mine!==sequence){if(onStale)void onStale(data);return;}
    if(data.startAdmissionId)startAdmissionId=data.startAdmissionId;
    if(data.state)current=data.state;
    busy=false;if(current)render(current);
    if(!response.ok){el('status').textContent=data.error??'Reference action failed.';el('status').className='status error';}
    return data;
   }catch{
    if(mine!==sequence)return;
    busy=false;if(current)render(current);
    el('status').textContent='Local service unavailable. Backend state and cancellation are unconfirmed.';el('status').className='status error';
   }
  }
  async function cancelStaleStart(data){
   const state=data?.state,pair=data?.plannerPair;
   if(token&&!data.error&&state?.mode==='function-contract'&&typeof state.sessionId==='string'&&data.openedFunctionSessionId===state.sessionId&&Number.isSafeInteger(state.snapshot?.revision)){
    try{await transport('/api/function/action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Pitcrew-Token':token},body:JSON.stringify({sessionId:state.sessionId,revision:state.snapshot.revision,action:'cancel'})});}catch{/* Exact old owner only; cancellation is unconfirmed. */}
    return;
   }
   if(!token||!pair||pair.sessionId!==state?.sessionId||state.mode!=='configured-local-unverified'||!Number.isSafeInteger(state.snapshot?.revision))return;
   // Best effort, exact returned owner only. Never render old data or stop a replacement client.
   try{await global.fetch('/api/workbench/action',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-Pitcrew-Token':token},
    body:JSON.stringify({sessionId:state.sessionId,revision:state.snapshot.revision,action:'cancel'})});}catch{/* Lost response/late admission remains unconfirmed. */}
  }
  async function action(name,extra={},inspectionOwner=null){
   if(comparisonBusy)return;
   if(name==='cancel')stopFunctionDraft();
   if(inspection&&inspectionOwner!==inspection&&name!=='cancel')return;
   if(name==='cancel'&&activeStartAdmissionId){
    const admission=activeStartAdmissionId;activeStartAdmissionId=null;stopLive();
    const result=await request('/api/workbench/cancel-start',{startAdmissionId:admission});
    if(result?.startCanceled&&!current?.snapshot)el('status').textContent='Local start canceled before opening a sample.';
    return result;
   }
   if(name==='cancel')stopLive();
   if(!current?.sessionId){
    if(name==='cancel'){busy=false;if(current)render(current);el('status').textContent='Local start canceled. Backend state is unconfirmed until a response is received.';}
    return;
   }
   const ownerSession=current.sessionId,live=current.mode==='configured-local-unverified',ownerEpoch=liveEpoch,ownerPump=livePump;
   const result=await request(live?'/api/workbench/action':current.mode==='function-contract'?'/api/function/action':'/api/action',{sessionId:ownerSession,revision:current.snapshot.revision,action:live&&name==='load-authored'?'generate':name,...extra});
   if(live&&result&&ownerEpoch===liveEpoch&&ownerPump===livePump&&current?.sessionId===ownerSession&&current.snapshot.closed)stopLive();
   return result;
  }
  async function guidedAction(name,button,extra){
   const run=guidedRun;
   const stayWithRun=run&&run.sessionId===current?.sessionId&&document.activeElement===el(button);
   const result=await action(name,extra);
   const focused=document.activeElement;
   if(result?.state&&!result.error&&stayWithRun&&run===guidedRun&&current?.sessionId===run.sessionId
    &&(!focused||focused===document.body||focused===el(button)))el('next-action').focus?.();
   return result;
  }
  function stopLive(){
   liveEpoch++;advisorEpoch++;sequence++;liveStarting=false;inspection=null;
   cloudEpoch++;cloudClient?.stop();cloudReview=null;cloudBusy=false;
   if(liveTimer!==null){global.clearTimeout(liveTimer);liveTimer=null;}
   livePump?.stop();livePump=null;
   if(releaseAdvisor)releaseAdvisor();else liveClient?.stop();
  }
  function pumpLoop(pump){
   const tick=async()=>{
    if(livePump!==pump)return;
    try{
     const result=await pump.runOne();
     if(livePump!==pump)return;
     if(result.status==='blocked'){stopLive();el('status').textContent='Browser planner stopped. Reconnect or close this session; no verified result is claimed.';return;}
    }catch{if(livePump===pump)stopLive();return;}
    if(livePump===pump)liveTimer=global.setTimeout(tick,250);
   };
   void tick();
  }
  async function startLive(){
   if(inspection)return;
   if(!busy&&liveCapability?.available&&liveCapability.plannerRequired===false){
    stopLive();const mine=liveEpoch;activeStartAdmissionId=startAdmissionId;liveStarting=true;
    const data=await request('/api/workbench/start',{taskId:el('sample').value,startAdmissionId:activeStartAdmissionId},cancelStaleStart);
    if(mine!==liveEpoch)return;
    liveStarting=false;if(data)activeStartAdmissionId=null;if(current)render(current);return;
   }
   if(busy||!liveClient||!liveCapability?.available)return;
   stopLive();const ownerClient=liveClient,ownerEpoch=liveEpoch,chosenTask=el('sample').value,admission=startAdmissionId;
   activeStartAdmissionId=admission;
   liveStarting=true;busy=true;if(current)render(current);
   let prepared;
   try{
    // Invoke synchronously in this user action, before the first await.
    prepared=await ownerClient.prepareFromUserGesture({repairAdviceOnly:true,repairAdviceFormat:'source-line'});
   }catch{
    if(ownerEpoch===liveEpoch&&ownerClient===liveClient)ownerClient.stop();
    prepared={status:'blocked'};
   }
   if(ownerEpoch!==liveEpoch||ownerClient!==liveClient)return;
   busy=false;
   if(prepared.status!=='prepared'){
    liveStarting=false;activeStartAdmissionId=null;if(current)render(current);
    el('status').textContent=prepared.reason==='native-operation-timeout'?
     'Nano setup exceeded its 90-second wait. Check browser model readiness before starting a new run.':
     'Local browser model is not ready. No cloud fallback or verified result.';return;
   }
   const data=await request('/api/workbench/start',{taskId:chosenTask,startAdmissionId:admission},cancelStaleStart);
   if(ownerEpoch!==liveEpoch||ownerClient!==liveClient){if(data)void cancelStaleStart(data);return;}
   liveStarting=false;
   if(data)activeStartAdmissionId=null;
   if(!data?.plannerPair){ownerClient.stop();if(current)render(current);return;}
   const transport=global.LocalPitCrewBrowserPlanner.createFetchPlannerTransport({
    companion:global.location.origin,sessionId:data.plannerPair.sessionId,workerId:global.crypto.randomUUID(),
    authToken:data.plannerPair.authToken,fetchImpl:global.fetch.bind(global)});
   livePump=global.LocalPitCrewBrowserPlanner.createBrowserPlannerPump({client:ownerClient,transport,onObservation:observation=>{
    if(ownerEpoch!==liveEpoch||current?.sessionId!==data.state?.sessionId)return;
    livePlannerObservation={...observation,adviceFormat:'source-line'};if(current)render(current);
   }});
   pumpLoop(livePump);if(current)render(current);
  }
  async function inspectFailure(){
   if(busy||inspection||!token)return;
   stopLive();const owner={taskId:el('sample').value,sessionId:null};inspection=owner;
   const ownsRun=()=>inspection===owner&&current?.sessionId===owner.sessionId&&current?.mode==='authored-reference'&&!current.snapshot?.closed;
   try{
    const opened=await request('/api/start',{taskId:owner.taskId});
    if(inspection!==owner||opened?.error||opened?.state?.task?.id!==owner.taskId||!opened?.state?.snapshot)return;
    owner.sessionId=opened.state.sessionId;if(!ownsRun())return;
    const checked=await action('test',{},owner);if(!ownsRun()||checked?.error||!checked?.state?.checks?.length)return;
    const paths=current.snapshot.manifest.map(file=>file.path);
    for(const path of paths){
     if(!ownsRun())return;
     const read=await action('read',{path},owner);if(!ownsRun()||read?.error||!read?.state)return;
    }
    el('source-evidence').open=true;
    const failed=current.checks.filter(check=>!check.ok).length;
    el('status').textContent=failed?failed+' public checks failed. Current source is ready. Review the evidence, then choose a diagnosis or the authored example patch.':
     'The authored baseline checks passed. No failing example was established.';
   }finally{
    if(inspection===owner){
     const status=el('status').textContent,statusClass=el('status').className;inspection=null;if(current)render(current);
     el('status').textContent=status;el('status').className=statusClass;
    }
   }
  }
  el('investigate').addEventListener('click',inspectFailure);
  el('open').addEventListener('click',()=>{if(busy||inspection)return;stopLive();return request('/api/start',{taskId:el('sample').value});});
  el('open-live').addEventListener('click',startLive);
  el('open-browser-setup').addEventListener('click',()=>{
   el('runtime-setup').open=true;
   el('check-browser').focus?.();
  });
  async function prepareDiagnosisTab(){
   if(!liveClient){
    if(global.navigator?.onLine===false&&!savedOfflineBench())return 'Chrome has the model. Connect to load Firebase for offline diagnosis in this tab.';
    el('browser-status').textContent='Chrome has the model. Loading Firebase for this tab…';
    try{await loadFirebaseClients();}
    catch{return 'Chrome has the model. The Firebase client could not load. Check your connection and try again.';}
   }
   return 'Chrome reports an available model and Firebase is loaded. You can try an offline diagnosis in this tab.';
  }
  el('check-browser').addEventListener('click',async()=>{
   const mine=++browserProbeEpoch;el('check-browser').disabled=true;
   el('browser-status').textContent='Checking browser model readiness. No repair prompt is being sent…';
   const result=await probeBrowserRuntime(global);
   if(mine!==browserProbeEpoch)return;
   browserReadiness=result.status;
   const messages={
    'native-api-absent':'This browser does not expose the native Prompt API required by this Firebase on-device adapter. Extensions do not supply it.',
    'available':'The native model reports available. Firebase initialization and the required Nano identity still need verification.',
    'downloadable':'The native model reports downloadable. Choose Download on-device model to request setup. Chrome also manages background downloads.',
    'downloading':'The native model reports a download in progress. Chrome controls the download; this check sends no repair prompt.',
    'unavailable':'The native model reports unavailable on this browser or device.',
    'insecure-context':'This page needs HTTPS or a trustworthy loopback origin for the native model API.',
    'unknown-availability':'The browser returned an unrecognized availability result.',
    'availability-check-failed':'The availability check failed or timed out. No inference was requested.'
   };
   const message=result.status==='available'&&hosted&&plannerCapability?.available?
    await prepareDiagnosisTab():messages[result.status];
   if(mine!==browserProbeEpoch)return;
   el('browser-status').textContent=message;el('check-browser').disabled=false;
   el('download-browser-model').hidden=!['downloadable','downloading'].includes(result.status);
   if(current)render(current);
  });
  el('download-browser-model').addEventListener('click',async()=>{
   if(browserDownload){browserDownload.abort();el('browser-status').textContent='Stopping the setup wait and requesting native cancellation…';return;}
   const owner=new global.AbortController();browserDownload=owner;const mine=++browserProbeEpoch;
   el('download-browser-model').textContent='Stop waiting';el('check-browser').disabled=true;
   el('browser-status').textContent='Starting the browser’s on-device model download. This may take several minutes…';
   const timer=global.setTimeout(()=>owner.abort(),600000);
   const result=await downloadBrowserModel(global,{signal:owner.signal,onProgress:percent=>{
    if(mine===browserProbeEpoch&&!owner.signal.aborted)el('browser-status').textContent='Downloading the on-device model… '+percent+'%';
   }});
   global.clearTimeout(timer);if(mine!==browserProbeEpoch||browserDownload!==owner)return;
   browserDownload=null;el('download-browser-model').textContent='Download on-device model';el('check-browser').disabled=false;
   el('download-browser-model').hidden=true;
   const message=result.status==='available'?(hosted&&plannerCapability?.available?
    await prepareDiagnosisTab():'The native model is available. Firebase inference and Nano identity still need verification.'):
    result.status==='aborted'?'Stopped waiting. The browser may continue downloading; check availability before retrying.':
    'Model setup did not finish: '+result.status+'. No inference was requested.';
   if(mine!==browserProbeEpoch)return;
   el('browser-status').textContent=message;
   if(result.status==='available'){browserReadiness='available';if(current)render(current);}
  });
  el('stop-diagnosis').addEventListener('click',()=>{
   if(!releaseAdvisor)return;
   advisorEpoch++;
   releaseAdvisor();
   render(current);
   el('advisor-status').textContent='Stopped the Nano diagnosis. Continue from the current failing checks.';
   el('diagnose').focus?.();
  });
  el('diagnose').addEventListener('click',async()=>{
   const snapshot=repairSnapshot(current);if(busy||inspection||nanoSetupMessage()||!snapshot||!firebaseAvailable(liveClient)||!['authored-reference','function-contract'].includes(current.mode))return;
   if(!liveClient){
    if(hosted&&global.navigator?.onLine===false&&!savedOfflineBench()){
     el('advisor-status').textContent='Connect once and use model setup to load Firebase for offline diagnosis in this tab.';
     return;
    }
    const session=current.sessionId,requestEpoch=advisorEpoch;
    el('advisor-status').textContent='Loading Firebase AI Logic…';
    try{await loadFirebaseClients();}catch{
     if(current?.sessionId===session&&requestEpoch===advisorEpoch)el('advisor-status').textContent='Firebase AI Logic could not load. Try again.';
     return;
    }
    if(pageLeaving||busy||inspection||nanoSetupMessage()||requestEpoch!==advisorEpoch||current?.sessionId!==session||current.snapshot.revision!==snapshot.revision)return;
    if(!liveClient){render(current);return;}
    if(global.navigator?.userActivation?.isActive===false){
     render(current);
     el('advisor-status').textContent='Firebase AI Logic loaded. Click Ask Nano again to run the diagnosis.';
     return;
    }
   }
   const owner=current.sessionId,revision=snapshot.revision,mine=++advisorEpoch,client=liveClient;
   const callsBefore=client.state.calls??0;
   const finish=()=>{
    if(releaseAdvisor!==finish)return;
    releaseAdvisor=null;
    if(current?.sessionId===owner)advisorCalls+=Math.max(0,(client.state.calls??callsBefore)-callsBefore);
    client.stop();
    busy=false;
   };
   releaseAdvisor=finish;
   busy=true;render(current);el('advisor-status').textContent='Nano is inspecting the failed checks. You can stop and keep working from these checks.';
   let message;
   try{
    const repairAdviceFormat=hosted&&current.mode==='function-contract'?'source-line':'verbatim-quote';
    const prepared=await client.prepareFromUserGesture({repairAdviceOnly:true,repairAdviceFormat});
    if(mine!==advisorEpoch)return;
    if(prepared.status!=='prepared')throw Error(prepared.reason==='native-operation-timeout'?
     'Nano setup exceeded its 90-second wait. No diagnosis was accepted; check model readiness before trying again.':
     'Nano is not ready. Check Chrome model availability and Firebase setup.');
    const result=await client.decide(snapshot);
    if(mine!==advisorEpoch||current?.sessionId!==owner||current?.snapshot?.revision!==revision)return;
    const d=result?.decision,known=new Set(snapshot.evidence.map(e=>e.id));
    if(result.status!=='decision'){
     if(result.reason==='unexpected-inference-source-investigate-egress')throw Error('Unexpected inference source. Stop and investigate possible cloud traffic.');
     const diagnostics={'readiness-failed':'Browser model readiness could not be confirmed.','generation-failed':'The on-device model call failed.',
      'operation-timeout':'Nano exceeded its 90-second wait. No diagnosis was accepted; its owned session was canceled.',
      'output-json':'Nano returned malformed JSON.','output-size':'Nano exceeded the output size limit.','output-fields':'Nano returned an unexpected response shape.',
      'output-revision':'Nano returned a stale revision.','output-types':'Nano returned invalid field types.','output-citations':'Nano cited unknown evidence.',
      'output-grounding':'Nano quoted code that does not match the current source.',
      'output-arguments':'Nano returned arguments that do not match its chosen action.','output-action':'Nano chose an action outside this advisor’s scope.','output-unusable':'Nano returned an unusable decision.'};
     throw Error(diagnostics[result.diagnostic]??'The on-device diagnosis did not return a validated decision.');
    }
    if(!['code','ask_user'].includes(d?.action))throw Error('Nano chose a workflow action instead of a repair hint. No change was applied.');
    if(result.inferenceSource!=='on_device'||
     (d.action==='code'&&(!d.evidenceIds?.length||d.evidenceIds.some(id=>!known.has(id))||!d.objective||d.objective.length>2000)))throw Error('Nano did not return a usable, evidence-linked repair hint.');
    advisorRecord={revision,action:d.action,inferenceSource:result.inferenceSource,calls:(client.state.calls??callsBefore+1)-callsBefore,
     evidenceIds:d.evidenceIds,objective:d.action==='code'?d.objective:'Nano requested manual review. Inspect the failure before changing the code.'};
    message=d.action==='code'?
     'Nano returned a repair hint. Review it before changing code; this is not a verified fix.':
     'Nano requested more evidence. Inspect the current failure and read relevant source before trying again.';
   }catch(error){message=error.message??'Nano diagnosis failed. No repair was applied.';}
   finally{
    if(releaseAdvisor===finish){
     const focusStopped=document.activeElement===el('stop-diagnosis');
     finish();
     if(current){render(current);if(message&&current.sessionId===owner)el('advisor-status').textContent=message;}
     if(focusStopped&&!el('diagnose').disabled)el('diagnose').focus?.();
    }
   }
  });
  async function previewCloudReview(includeNano){
   const challenge=cloudChallengeSnapshot(current),snapshot=challenge??repairSnapshot(current);
   if(busy||inspection||cloudBusy||!firebaseAvailable(cloudClient)||!snapshot||!['authored-reference','function-contract'].includes(current.mode))return;
   const hint=includeNano?currentNanoHint():null;
   if(includeNano&&(!hint||challenge))return;
   const session=current.sessionId,requestEpoch=++cloudEpoch;
   cloudReview=null;
   renderCloud();
   try{
    if(!cloudClient)await loadFirebaseClients();
    if(pageLeaving||busy||inspection||cloudBusy||requestEpoch!==cloudEpoch||current?.sessionId!==session||current.snapshot.revision!==snapshot.revision)return;
    if(hint&&hint!==currentNanoHint()){
     el('cloud-status').textContent='Nano’s hypothesis changed. Review a fresh request to choose what to share.';
     return;
    }
    cloudReview={approval:cloudClient.preview(snapshot,hint),hint:hint?.objective};cloudRecord=null;
    el('cloud-status').textContent=challenge?'Send shares this checked function, its requirements and its existing examples with Google via Firebase AI Logic.':
     hint?'Send shares the task, source evidence, failed checks and the Nano hypothesis shown below with Google.':
      'Send shares the task, source evidence and failed checks shown below with Google. Your Nano hypothesis stays local.';
   }catch{if(current?.sessionId!==session||requestEpoch!==cloudEpoch)return;cloudReview=null;el('cloud-status').textContent='Cloud review could not be prepared. Check the connection and current source evidence, then try again.';}
   renderCloud();
   const trigger=el(includeNano?'review-cloud-with-nano':'review-cloud');
   if(cloudReview&&document.activeElement===trigger)el('cloud-preview-title').focus?.();
  }
  el('review-cloud').addEventListener('click',()=>previewCloudReview(false));
  el('review-cloud-with-nano').addEventListener('click',()=>previewCloudReview(true));
  el('send-cloud').addEventListener('click',async()=>{
   if(busy||inspection||cloudBusy||!cloudReview||!cloudClient)return;
   const client=cloudClient,{approval,hint}=cloudReview,owner=current?.sessionId,mine=++cloudEpoch,callsBefore=client.state.calls;
   cloudBusy=true;cloudReview=null;renderCloud();el('cloud-status').textContent='Sending the reviewed prompt for a cloud second opinion…';
   el('cancel-cloud').focus?.();
   try{
    const result=await client.send(approval);
    if(mine!==cloudEpoch||current?.sessionId!==owner||current?.snapshot?.revision!==approval.revision)return;
    if(result.status!=='review'){el('cloud-status').textContent=cloudFailureMessage(result);return;}
    cloudRecord={...result,reviewedHint:result.includedNanoHypothesis?hint:undefined};
    el('cloud-status').textContent=result.answer.example?'Cloud example received. Review the expected return before starting the extended check.':
     'Cloud opinion received. A suggested check still needs review and execution; no fix has been verified.';
   }catch{if(mine===cloudEpoch)el('cloud-status').textContent='Cloud review did not finish. Check Firebase/App Check setup or quota. No automatic retry or fallback was made.';}
   finally{
    if(current?.sessionId===owner)cloudCalls+=Math.max(0,client.state.calls-callsBefore);
    if(mine===cloudEpoch){
     cloudBusy=false;
     const restoreFocus=document.activeElement===el('cancel-cloud');
     renderCloud();
     if(restoreFocus)el(cloudRecord?'cloud-result':'review-cloud').focus?.();
    }
   }
  });
  el('cancel-cloud').addEventListener('click',()=>{
   cloudEpoch++;cloudClient?.stop();cloudReview=null;cloudBusy=false;
   el('cloud-status').textContent='Cloud review closed. A request already sent may continue at the provider.';renderCloud();
   el('review-cloud').focus?.();
  });
  function currentNanoHint(){
   return advisorRecord?.revision===current?.snapshot?.revision&&advisorRecord?.action==='code'&&
    advisorRecord.inferenceSource==='on_device'&&new TextEncoder().encode(advisorRecord.objective).length<=2000?advisorRecord:null;
  }
  async function previewFunctionDraft(includeNano){
   if(busy||inspection||cloudBusy||!firebaseAvailable(draftClient)||current?.mode!=='function-contract'||!viewModel(current).canLoad||!current.checks?.some(c=>c.ok===false)||(current.snapshot.counts?.coder??0)>=2)return;
   const hint=includeNano?currentNanoHint():null;
   if(includeNano&&!hint)return;
   const owner={sessionId:current.sessionId};inspection=owner;
   draftReview=null;draftResult=null;
   const owns=()=>inspection===owner&&current?.sessionId===owner.sessionId&&current.mode==='function-contract'&&!current.snapshot?.closed;
   try{
    if(!draftClient)await loadFirebaseClients();
    if(!owns())return;
    for(const path of ['src/function.js','contract.json']){
     const m=current.snapshot.manifest.find(m=>m.path===path);
     if(!current.snapshot.evidence.some(e=>e.path===path&&e.sha256===m?.sha256)){
      const result=await action('read',{path},owner);if(!owns()||result?.error)return;
     }
    }
    if(!owns())return;
    if(hint&&hint!==currentNanoHint()){
     draftReview=null;
     draftStatus='The evidence changed while preparing this request. Ask Nano again for a current hypothesis, or review a request without it.';
     return;
    }
    draftReview=draftClient.preview(repairSnapshot(current),hint);
    draftStatus=hint?'This request includes the Nano hypothesis. Review the complete text before sending it to Google.':
     'Review the function, fixed examples and observations before sending them to Google.';
   }catch{if(owns()){
    draftReview=null;
    draftStatus=draftClient?'A bounded patch request could not be prepared. Check the current function, contract and example limits.':
     'Firebase setup could not load. Check the connection and try again. Local checks and pasted patches still work.';
   }}
   finally{if(inspection===owner){inspection=null;if(current)render(current);}}
  }
  el('preview-function-draft').addEventListener('click',()=>previewFunctionDraft(false));
  el('preview-function-draft-with-nano').addEventListener('click',()=>previewFunctionDraft(true));
  el('send-function-draft').addEventListener('click',async()=>{
   if(busy||inspection||cloudBusy||!draftClient||!draftReview||current?.mode!=='function-contract')return;
   const client=draftClient,approved=draftReview,owner=current.sessionId,mine=++draftEpoch,callsBefore=client.state.calls;
   draftReview=null;draftBusy=true;busy=true;draftStatus='Verifying this browser with Firebase App Check…';render(current);
   try{
    const result=await client.send(approved,()=>{
     draftCalls+=client.state.calls-callsBefore;
     draftStatus='Requesting a cloud replacement. Review and Apply are still required before code changes.';
     render(current);
    });
    if(mine!==draftEpoch||current?.sessionId!==owner||current?.snapshot?.revision!==approved.revision||current.snapshot.closed)return;
    if(result.status==='needs-evidence'){draftStatus='Model requested more evidence: '+result.explanation;return;}
    if(result.status!=='draft'||result.inferenceSource!=='in_cloud'){draftStatus=cloudFailureMessage(result);return;}
    draftResult=result;draftStatus='Cloud draft received. Review its diff before Apply and local verification.';
   }catch{if(mine===draftEpoch)draftStatus='Cloud generation did not finish. Check Firebase/App Check setup or quota. No replacement was applied.';}
   finally{if(mine===draftEpoch){draftBusy=false;busy=false;}if(current)render(current);}
  });
  el('review-function-draft').addEventListener('click',async()=>{
   if(busy||inspection||cloudBusy||!draftResult||current?.mode!=='function-contract'||current.snapshot.revision!==draftResult.revision)return;
   const result=draftResult,owner=current.sessionId;draftResult=null;
   const staged=await action('propose-cloud',{source:result.source,generation:result.generation,explanation:result.explanation});
   if(current?.sessionId===owner&&staged?.error){draftStatus='The cloud draft could not be bound to the current run. No replacement was applied.';render(current);}
  });
  el('cancel-function-draft').addEventListener('click',()=>{stopFunctionDraft();if(current)render(current);});
  const currentRecord=()=>buildProofRecord(current,advisorRecord,advisorCalls,cloudRecord,cloudCalls,livePlannerObservation,draftCalls);
  function downloadLocalFile(bytes,type,fileName){
   const url=global.URL.createObjectURL(new global.Blob([bytes],{type})),link=document.createElement('a');
   link.href=url;link.download=fileName;
   try{link.click();}finally{global.setTimeout(()=>global.URL.revokeObjectURL(url),1000);}
  }
  async function downloadFunction(kind){
   if(busy||inspection||cloudBusy)return;
   const status=el(kind==='failure'?'failure-replay-status':'checked-function-status');
   const select=kind==='failure'?failureReplayForDownload:kind==='replay'?checkedReplayForDownload:checkedFunctionForDownload;
   const file=select(current);if(!file)return;
   const replay=file.packet;
   const owner=current.sessionId,revision=current.snapshot.revision;
   try{
    const rows=replay?replay.files:[file];
    const matches=await Promise.all(rows.map(async row=>{
     const digest=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.content));
     return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')===row.sha256;
    }));
    if(pageLeaving||busy||inspection||cloudBusy||current?.sessionId!==owner||current?.snapshot?.revision!==revision||!select(current))return;
    if(matches.some(match=>!match))throw Error('source-hash-mismatch');
    const bytes=new TextEncoder().encode(replay?JSON.stringify(replay,null,2)+'\n':file.content),fileName=file.fileName;
    downloadLocalFile(bytes,replay?'application/json;charset=utf-8':'text/javascript;charset=utf-8',fileName);
    status.textContent='Requested '+fileName+'. Its bytes match the checked '+(replay?'source and contract hashes.':'source hash.');
   }catch(error){
    if(current?.sessionId===owner&&current?.snapshot?.revision===revision)status.textContent=error?.message==='source-hash-mismatch'?'Source or contract bytes did not match the checked hash. No download was requested.':'Download unavailable. Open the preview to copy the contents.';
   }
  }
  el('download-checked-function').addEventListener('click',()=>downloadFunction('source'));
  el('download-function-replay').addEventListener('click',()=>downloadFunction('replay'));
  el('download-failure-replay').addEventListener('click',()=>downloadFunction('failure'));
  el('view-record').addEventListener('click',()=>{
   if(busy||inspection||cloudBusy)return;
   try{
    el('record-json').textContent=JSON.stringify(currentRecord(),null,2)+'\n';
    el('record-preview').hidden=false;el('record-preview').open=true;
    el('export-status').textContent='Showing the run record. Source contents and connection tokens are excluded.';
   }catch{el('export-status').textContent='Run record unavailable. Open a run and try again.';}
  });
  el('export').addEventListener('click',()=>{
   try{
    const record=currentRecord(),url=global.URL.createObjectURL(new global.Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='pit-crew-'+record.sample+'-evidence.json';link.click();
    global.setTimeout(()=>global.URL.revokeObjectURL(url),1000);el('export-status').textContent='Requested the evidence download. Use View record JSON if the file does not appear.';
   }catch{el('export-status').textContent='Evidence export unavailable. Open a run and try again.';}
  });
  global.addEventListener?.('pagehide',()=>{pageLeaving=true;browserProbeEpoch++;browserDownload?.abort();stopLive();stopFunctionDraft();void liveClient?.dispose();void cloudClient?.dispose();void draftClient?.dispose();});
  // The back-forward cache restores the old DOM after pagehide has released the
  // verifier and model sessions. Open a fresh workbench before accepting actions.
  if(hosted)global.addEventListener?.('pageshow',event=>{
   if(pageLeaving&&event.persisted)global.location.reload();
  });

  const replayInput=el('restore-replay-input'),replayPicker=el('restore-replay-file'),replayStatus=el('restore-replay-status');
  const maxFileBytes=80000;
  async function readIntakeFile(file,{maxBytes=maxFileBytes,preserveBOM=false}={}){
   if(file.size<1||file.size>maxBytes)throw Error('invalid-intake-file-size');
   const bytes=await file.arrayBuffer();
   if(bytes.byteLength<1||bytes.byteLength>maxBytes)throw Error('invalid-intake-file-size');
   return new TextDecoder('utf-8',{fatal:true,ignoreBOM:preserveBOM}).decode(bytes);
  }
  const comparePanel=el('compare-replay-panel'),compareButton=el('compare-replays'),compareStatus=el('compare-replay-status');
  const repeatButton=el('repeat-replay');
  const comparisonEvidence=el('comparison-evidence');
  const comparisonDownload=el('download-comparison-summary'),comparisonDownloadStatus=el('comparison-summary-status');
  const comparedFailure=el('comparison-failure'),comparedFailureStatus=el('compared-failure-status');
  const compareExample=el('compare-replay-example');
  const comparisonInputs=[el('comparison-baseline-file'),el('comparison-candidate-file')];
  let comparisonSummary=null,comparisonFailureReplay=null;
  function clearComparison(){
   comparisonSummary=null;
   comparisonFailureReplay=null;
   comparisonDownload.hidden=true;
   comparisonDownload.textContent='Download comparison summary';
   comparisonDownloadStatus.textContent='';
   comparedFailure.hidden=true;
   comparedFailureStatus.textContent='';
   el('compare-replay-changes').replaceChildren();
   comparisonEvidence.replaceChildren();
  }
  comparisonDownload.addEventListener('click',()=>{
   if(!comparisonSummary||comparisonBusy||pageLeaving)return;
   try{
    downloadLocalFile(JSON.stringify(comparisonSummary,null,2)+'\n','application/json;charset=utf-8','pit-crew-comparison.json');
    comparisonDownloadStatus.textContent='Requested the comparison summary download.';
   }catch{comparisonDownloadStatus.textContent='The summary could not be downloaded. Try again.';}
  });
  el('download-compared-failure').addEventListener('click',()=>{
   if(!comparisonFailureReplay||comparisonBusy||pageLeaving)return;
   try{
    downloadLocalFile(JSON.stringify(comparisonFailureReplay,null,2)+'\n','application/json;charset=utf-8','candidate-failure.replay.json');
    comparedFailureStatus.textContent='Requested the candidate failure replay download.';
   }catch{comparedFailureStatus.textContent='The replay could not be downloaded. Try again.';}
  });
  el('load-compared-failure').addEventListener('click',async()=>{
   const packet=comparisonFailureReplay;
   if(!packet||busy||inspection||cloudBusy||pageLeaving||!token)return;
   const before=intakeFields.map(input=>input.value);
   comparedFailureStatus.textContent='Checking the candidate replay before loading it…';
   const result=await request('/api/function/replay',{packet});
   if(pageLeaving||comparisonFailureReplay!==packet)return;
   if(!result?.replay){
    comparedFailureStatus.textContent='Could not load the candidate replay. Your form is unchanged.';
    return;
   }
   if(intakeFields.some((input,index)=>input.value!==before[index])){
    comparedFailureStatus.textContent='Your form changed during validation and was kept. Load again to replace it.';
    return;
   }
   const restored=result.replay.contextRestored;
   comparedFailureStatus.textContent='Candidate loaded into the repair form.';
   fillReplayIntake(result.replay,restored
    ?'Candidate source and fixed examples loaded. Open my function to start an unchecked repair.'
    :'Candidate source and fixed examples loaded. Enter Required behavior, then open an unchecked repair.');
  });
  function updateComparisonControls(){
   compareButton.disabled=comparisonBusy||!token||!comparisonInputs.every(input=>input.files?.[0]);
   repeatButton.disabled=comparisonBusy||!token||!comparisonInputs[0].files?.[0];
   compareExample.disabled=comparisonBusy||!token;
  }
  for(const input of comparisonInputs)input.addEventListener('change',()=>{
   compareStatus.textContent='';
   clearComparison();
   updateComparisonControls();
  });
  async function runComparison(mode){
   if(!hosted||busy||inspection||cloudBusy||comparisonBusy||!token)return;
   const example=mode==='example',repeat=mode==='repeat';
   const files=comparisonInputs.map(input=>input.files?.[0]);
   if(!example&&(!files[0]||(!repeat&&!files[1])))return;
   if(example){
    el('function-intake').open=true;comparePanel.open=true;
    comparePanel.scrollIntoView?.({block:'start'});
   }
   comparisonBusy=true;busy=true;
   if(current)render(current);
   comparisonInputs.forEach(input=>{input.disabled=true;});updateComparisonControls();
   clearComparison();
   compareStatus.textContent=repeat?'Running the same saved examples twice in separate workers…':
    'Validating the files and running fresh checks in separate workers…';
   compareStatus.focus?.({preventScroll:true});
   const sourceCandidate=!example&&!repeat&&/\.(?:js|cjs)$/i.test(files[1].name??'');
   try{
    let body={example:'pagination'};
    if(repeat)body={repeat:JSON.parse(await readIntakeFile(files[0]))};
    else if(!example){
     const [baseline,candidate]=await Promise.all([
      readIntakeFile(files[0]).then(JSON.parse),
      sourceCandidate?readIntakeFile(files[1],{maxBytes:6000,preserveBOM:true}):readIntakeFile(files[1]).then(JSON.parse)
     ]);
     body=sourceCandidate?{baseline,source:candidate}:{baseline,candidate};
    }
    if(pageLeaving)return;
    const response=await transport('/api/function/compare-replays',{method:'POST',credentials:'same-origin',
     headers:{'Content-Type':'application/json','X-Pitcrew-Token':token},body:JSON.stringify(body)});
    const result=await response.json();
    if(pageLeaving)return;
    if(!response.ok){compareStatus.textContent=result.error;return;}
    if(repeat){
     const {passingPerRun,total,changedVerdicts,changedFailures}=result.repeat;
     const counts=passingPerRun.map(passed=>passed+'/'+total).join(' then ');
     const labels=ids=>ids.map(id=>result.checkLabels[id]??id).join(', ');
     const changed=changedVerdicts.length||changedFailures.length;
     compareStatus.textContent=counts+' passed. '+(changed?'Identical source and inputs produced different evidence.':'The observed results matched in both fresh runs.');
     if(changedVerdicts.length)el('compare-replay-changes').append(node('li','Pass or fail changed: '+labels(changedVerdicts),'comparison-regressed'));
     if(changedFailures.length)el('compare-replay-changes').append(node('li','Still failing, result changed: '+labels(changedFailures),'comparison-regressed'));
     comparisonSummary={schema:'local-pit-crew/browser-repeat-summary/v1',boundary:'browser-worker-quickjs',...result.repeat,modelCalls:0};
     comparisonDownload.textContent='Download repeat summary';
     comparisonDownload.hidden=false;
     return;
    }
    const {beforeWorkspaceHash,afterWorkspaceHash,beforePassed,afterPassed,total,repaired,regressed}=result.comparison;
    const sameScore=beforePassed===afterPassed&&(repaired.length||regressed.length);
    const changedFailures=result.observations.filter(({baseline,candidate})=>!baseline.ok&&!candidate.ok).map(({id})=>id);
    const summary=sameScore?'Same score, different failures. ':changedFailures.length&&beforePassed===afterPassed?'Same score, changed results. ':'';
    compareStatus.textContent=summary+beforePassed+'/'+total+' baseline → '+afterPassed+'/'+total+' candidate. Same contract, fresh local checks.';
    const labels=ids=>ids.map(id=>result.checkLabels?.[id]??id).join(', ')||'none';
    el('compare-replay-changes').append(node('li','Repaired: '+labels(repaired),'comparison-repaired'),
     node('li','Regressed: '+labels(regressed),regressed.length?'comparison-regressed':''));
    if(changedFailures.length)el('compare-replay-changes').append(node('li','Still failing, result changed: '+labels(changedFailures)));
    for(const {id,args,expected,baseline,candidate} of result.observations){
     const detail=node('details');
     const change=baseline.ok?'Regressed':candidate.ok?'Repaired':'Still failing, result changed';
     detail.append(node('summary',change+' · '+(result.checkLabels[id]??id)),
      node('p','Input arguments'),node('pre',args),node('p','Expected return'),node('pre',expected));
     for(const [name,observation] of [['Baseline',baseline],['Candidate',candidate]]){
      const outcome=observation.status==='returned'?observation.actualReturn:
       observation.status==='threw'?'The function threw.':'The return could not be represented as JSON.';
      detail.append(node('p',name+(observation.inputPreserved?' · Input preserved':' · Input preservation failed')),node('pre',outcome));
      if(!observation.inputPreserved)detail.append(node('p',name+' arguments after the call'),
       node('pre',observation.argumentsAfter??'The arguments could not be represented as JSON.'));
     }
     comparisonEvidence.append(detail);
    }
    comparisonSummary={schema:'local-pit-crew/browser-comparison-summary/v1',boundary:'browser-worker-quickjs',
     beforeWorkspaceHash,afterWorkspaceHash,beforePassed,afterPassed,total,repaired,regressed,changedFailures,modelCalls:0};
    comparisonDownload.hidden=false;
    comparisonFailureReplay=result.failureReplay;
    comparedFailure.hidden=!comparisonFailureReplay;
   }catch{if(!pageLeaving)compareStatus.textContent=repeat?'Could not read the replay. Choose a valid UTF-8 replay file up to 80,000 bytes.':sourceCandidate?
    'Could not read these files. Use a valid UTF-8 baseline replay and a UTF-8 JavaScript file up to 6,000 bytes.':
    'Could not read these replays. Use valid UTF-8 replay files up to 80,000 bytes each.';}
   finally{
    comparisonBusy=false;busy=false;
    if(current&&!pageLeaving)render(current);
    comparisonInputs.forEach(input=>{input.disabled=false;});updateComparisonControls();
   }
  }
  compareButton.addEventListener('click',()=>runComparison('compare'));
  repeatButton.addEventListener('click',()=>runComparison('repeat'));
  compareExample.addEventListener('click',()=>runComparison('example'));
  let replayRead=0;
  replayInput.addEventListener('input',()=>{
   replayRead++;
   replayStatus.textContent='Choose Load replay into form to validate the JSON and file hashes.';
  });
  replayPicker.addEventListener('change',async()=>{
   const file=replayPicker.files?.[0];
   if(!file)return;
   const read=++replayRead;
   const before=replayInput.value;
   // Reset the picker so the same file can be selected again after an edit.
   replayPicker.value='';
   replayStatus.textContent='Reading the replay file…';
   try{
    const text=await readIntakeFile(file);
    if(pageLeaving||read!==replayRead||replayInput.value!==before)return;
    replayInput.value=text;
    replayStatus.textContent='File read. Choose Load replay into form to validate the file hashes and replace the intake draft.';
   }catch{
    if(!pageLeaving&&read===replayRead)replayStatus.textContent='Could not read this replay. Choose a UTF-8 JSON file up to 80,000 bytes.';
   }
  });
  el('restore-function-replay').addEventListener('click',async()=>{
   if(busy||inspection||cloudBusy||!token)return;
   const read=++replayRead,text=replayInput.value;
   let packet;try{if(new TextEncoder().encode(text).length>maxFileBytes)throw Error('oversized');packet=JSON.parse(text);}catch{replayStatus.textContent='Choose or paste one replay JSON file, up to 80,000 UTF-8 bytes.';return;}
   const before=intakeFields.map(input=>input.value);
   const result=await request('/api/function/replay',{packet});
   if(pageLeaving||read!==replayRead)return;
   if(!result?.replay){el('restore-replay-status').textContent='Replay case could not be loaded. Check its format and file hashes. Your draft is unchanged.';return;}
   if(replayInput.value!==text||intakeFields.some((input,index)=>input.value!==before[index])){replayStatus.textContent='Your draft changed during validation, so it was kept. Load again if you want to replace it.';return;}
   replayStatus.textContent=result.replay.contextRestored?'Loaded the saved source, requirements and examples into the form. Review them, then Open my function and run fresh checks. Your active run is unchanged.':'Loaded the saved source and examples. This older replay has no saved requirements; enter Required behavior before opening. Your active run is unchanged.';
   fillReplayIntake(result.replay,'A saved pass result is not imported. Open this function to start a new unchecked run.');
  });
  async function extendCheckedFunction(example){
   if(busy||inspection||cloudBusy||!checkedFunctionForDownload(current)||current.checkedFunction.checkedExamples>=8)return;
   const parent=current;
   const result=await openFunction(null,{sessionId:parent.sessionId,revision:parent.snapshot.revision,example});
   if(result?.openedFunctionSessionId&&current?.sessionId===result.openedFunctionSessionId){
    if(guidedRun?.sessionId===parent.sessionId)guidedRun.sessionId=current.sessionId;
    render(current);
   }
   return result;
  }
  el('extend-function').addEventListener('click',async()=>{
   if(el('extend-function').disabled)return;
   let args,expected;try{args=JSON.parse(el('challenge-args').value);expected=JSON.parse(el('challenge-expected').value);}catch{el('challenge-status').textContent='Enter valid JSON for the arguments array and expected return.';return;}
   const result=await extendCheckedFunction({label:el('challenge-label').value,args,expected});
   if(result?.error)el('challenge-status').textContent='The example could not be added. Check its label, JSON limits and the current checked run.';
   else if(result?.openedFunctionSessionId&&current?.sessionId===result.openedFunctionSessionId){
    for(const id of ['challenge-label','challenge-args','challenge-expected'])el(id).value='';
    el('next-action').focus?.();
   }
  });
  const intakeNames=['title','instructions','export','source','cases'];
  const intakeFields=intakeNames.map(name=>el('function-'+name));
  function fillReplayIntake({spec,contextRestored},message){
   const values=[spec.title,spec.instructions,spec.exportName,spec.source,JSON.stringify(spec.cases,null,2)];
   intakeFields.forEach((input,index)=>{input.value=values[index];});
   el('function-intake').open=true;
   functionIntakeStatus(message);
   el(contextRestored?'function-title':'function-instructions').focus?.();
  }
  const intakeDraftSchema='local-pit-crew/intake-draft/v1';
  const draftFile=el('intake-draft-file'),loadDraft=el('load-intake-draft'),draftFileStatus=el('intake-draft-file-status');
  el('download-intake-draft').addEventListener('click',()=>{
   const fields=Object.fromEntries(intakeNames.map((name,index)=>[name,intakeFields[index].value]));
   const bytes=new TextEncoder().encode(JSON.stringify({schema:intakeDraftSchema,fields},null,2)+'\n');
   if(bytes.length>maxFileBytes){draftFileStatus.textContent='This draft is over 80,000 UTF-8 bytes. Shorten it before saving.';return;}
   try{
    downloadLocalFile(bytes,'application/json;charset=utf-8','local-pit-crew.draft.json');
    draftFileStatus.textContent='Requested local-pit-crew.draft.json. It contains your current form values.';
   }catch{draftFileStatus.textContent='The browser could not download the draft. Your form is still open.';}
  });
  let draftFileRevision=0;
  draftFile.addEventListener('change',()=>{
   draftFileRevision++;loadDraft.disabled=!draftFile.files?.[0];draftFileStatus.textContent='';
  });
  loadDraft.addEventListener('click',async()=>{
   const file=draftFile.files?.[0];if(loadDraft.disabled||!file||pageLeaving)return;
   const revision=++draftFileRevision,before=intakeFields.map(input=>input.value);
   loadDraft.disabled=true;draftFileStatus.textContent='Reading the draft file…';
   try{
    const draft=JSON.parse(await readIntakeFile(file)),fields=draft?.fields;
    if(!draft||Object.keys(draft).length!==2||draft.schema!==intakeDraftSchema||!fields||Object.keys(fields).length!==intakeNames.length||
     !intakeNames.every(name=>Object.hasOwn(fields,name)&&typeof fields[name]==='string'))throw Error('invalid-draft-format');
    if(pageLeaving||revision!==draftFileRevision)return;
    if(intakeFields.some((input,index)=>input.value!==before[index])){
     draftFileStatus.textContent='The form changed while the file was read. Choose Load draft again to replace it.';return;
    }
    for(const [index,name] of intakeNames.entries())intakeFields[index].value=fields[name];
    functionIntakeStatus('Draft restored. Review the form before opening a run.');
    draftFileStatus.textContent='Loaded the draft into the form.';
   }catch{
    if(!pageLeaving&&revision===draftFileRevision)draftFileStatus.textContent='Choose a Local Pit Crew draft JSON file up to 80,000 UTF-8 bytes.';
   }finally{
    if(!pageLeaving&&revision===draftFileRevision)loadDraft.disabled=false;
   }
  });
  function functionIntakeStatus(message,{error=false,field=null}={}){
   const status=el('function-status');
   status.textContent=message;status.className='muted'+(error?' intake-error':'');
   for(const input of intakeFields)input.setAttribute?.('aria-invalid',String(input===field));
   field?.focus?.();
  }
  function readFunctionIntake(){
   const [title,instructions,name,source,examples]=intakeFields;
   for(const [field,message] of [[title,'Enter a repair title.'],[instructions,'Describe the required behavior.'],[name,'Enter the function’s CommonJS export name.'],[source,'Paste the current function source.']]){
    if(!field.value.trim()){functionIntakeStatus(message,{error:true,field});return null;}
   }
   const reportExamples=message=>functionIntakeStatus(message,{error:true,field:examples});
   let cases;try{cases=JSON.parse(examples.value);}catch{reportExamples('Use valid JSON for the counterexamples.');return null;}
   if(!Array.isArray(cases)||!cases.length){reportExamples('Provide a JSON array with at least one example.');return null;}
   if(cases.length>8){reportExamples('Use at most eight examples per function.');return null;}
   for(const [index,example] of cases.entries()){
    if(!example||Object.keys(example).length!==3||!['label','args','expected'].every(key=>Object.hasOwn(example,key))){
     reportExamples('Example '+(index+1)+' needs exactly three fields: label, args and expected.');return null;
    }
    if(typeof example.label!=='string'||!example.label.trim()){
     reportExamples('Give example '+(index+1)+' a nonempty text label.');return null;
    }
    if(!Array.isArray(example.args)){
     reportExamples('Example '+(index+1)+' needs an args array. Use [] for a call with no arguments.');return null;
    }
   }
   return{schema:'local-pit-crew/function-task/v1',title:title.value,instructions:instructions.value,exportName:name.value,source:source.value,cases};
  }
  async function openFunction(spec=null,challenge=null){
   if(busy||inspection||!functionCapability?.available)return;
   const fromIntake=!spec&&!challenge;
   if(fromIntake){
    spec=readFunctionIntake();if(!spec)return;
   }
   stopLive();const admission=startAdmissionId;activeStartAdmissionId=admission;
   const attempt=sequence+1;
   const result=await request(challenge?'/api/function/extend':'/api/function/open',challenge?{...challenge,startAdmissionId:admission}:{startAdmissionId:admission,spec},cancelStaleStart);
   if(fromIntake&&sequence!==attempt)return result;
   if(result)activeStartAdmissionId=null;
   if(fromIntake&&(!result||result.error)){
    if(current)render(current);
    functionIntakeStatus(result?.error??'Could not open this function. Try again.',{error:true});
   }else if(result?.error&&current){
    render(current);el('status').textContent=result.error;el('status').className='status error';
   }
   if(!result?.error&&result?.state?.mode==='function-contract'&&result.openedFunctionSessionId===result.state.sessionId){
    if(!Array.from(el('sample').options).some(o=>o.value==='json-function-v1')){const option=node('option','Your function');option.value='json-function-v1';el('sample').append(option);}
    el('sample').value='json-function-v1';el('function-replacement').value='';render(current);
    functionIntakeStatus('Function opened. Reopen this form to start another contract.');el('function-intake').open=false;el('test').focus?.();
   }
   return result;
  }
  el('open-function').addEventListener('click',()=>openFunction());
  el('bring-function').addEventListener('click',event=>{
   event?.preventDefault?.();el('function-intake').open=true;el('function-intake').scrollIntoView?.({block:'start',behavior:'auto'});el('function-title').focus?.({preventScroll:true});
  });
  async function runWalkthrough(walkthrough,{startWithDraft=false,focusModelReview=false}={}){
   if(busy||inspection||!functionCapability?.available)return;
   const source=startWithDraft?walkthrough.firstPatch:walkthrough.spec.source;
   const opened=await openFunction({schema:'local-pit-crew/function-task/v1',...walkthrough.spec,source});
   if(!opened?.openedFunctionSessionId||opened.openedFunctionSessionId!==current?.sessionId||current?.mode!=='function-contract')return;
   guidedRun={sessionId:current.sessionId,walkthrough,startWithDraft,focusModelReview,needsBaselineInspection:true};
   return inspectWalkthroughBaseline();
  }
  async function runMissedShippingTest(){
   const opened=await extendCheckedFunction(shippingWalkthrough.challenge);
   if(!opened?.openedFunctionSessionId||opened.openedFunctionSessionId!==current?.sessionId||guidedRun?.sessionId!==current.sessionId)return;
   guidedRun.needsBaselineInspection=true;
   return inspectWalkthroughBaseline();
  }
  async function inspectWalkthroughBaseline(){
   const run=guidedRun;
   const owner={sessionId:current.sessionId};inspection=owner;
   const ownsRun=()=>inspection===owner&&current?.sessionId===owner.sessionId&&current.mode==='function-contract'&&!current.snapshot?.closed;
   let retry=false;
   try{
    const checked=await action('test',{},owner);
    if(!ownsRun())return;
    retry=checked?.state?.setupRetryPending===true;
    if(checked?.error||!checked?.state?.checks?.length)return;
    run.needsBaselineInspection=false;
    for(const path of ['src/function.js','contract.json']){
     const read=await action('read',{path},owner);if(!ownsRun()||read?.error||!read?.state)return;
    }
    el('source-evidence').open=true;
    const landing=el(run.focusModelReview?'advisor-panel':'active-run');
    landing.scrollIntoView?.({block:'start',behavior:run.focusModelReview?'instant':'auto'});
    if(!run.focusModelReview)el('failure-preview').scrollIntoView?.({block:'nearest',behavior:'auto'});
    landing.focus?.({preventScroll:true});
   }finally{
    if(inspection===owner){
     inspection=null;if(current)render(current);
     const focused=document.activeElement;
     if(retry&&(!focused||focused===document.body||focused===el('test')||focused===el('next-action'))){
      el('next-action').focus?.({preventScroll:true});
     }
    }
   }
  }
  el('try-function-example').addEventListener('click',()=>runWalkthrough(tagWalkthrough));
  el('try-hybrid-example').addEventListener('click',()=>runWalkthrough(tagWalkthrough,{focusModelReview:true}));
  el('try-shipping-example').addEventListener('click',()=>runWalkthrough(shippingWalkthrough));
  el('try-missed-test').addEventListener('click',()=>runWalkthrough(shippingWalkthrough,{startWithDraft:true}));
  el('fill-function-example').addEventListener('click',()=>{
   for(const [field,key]of [['title','title'],['instructions','instructions'],['export','exportName'],['source','source']])el('function-'+field).value=functionExample[key];
   el('function-cases').value=JSON.stringify(functionExample.cases,null,2);
   functionIntakeStatus('Filled an authored tag-normalization example. Edit it or open it to inspect its failure; no model call was made.');
  });
  el('sample').addEventListener('change',()=>{if(current)render(current);});
  el('load-function-example-patch').addEventListener('click',()=>{
   if(busy||inspection||cloudBusy||!guidedRun||current?.sessionId!==guidedRun.sessionId||!viewModel(current).canLoad)return;
   const {walkthrough}=guidedRun;
   const replacement=el('function-replacement');
   replacement.value=current.challengeParent?walkthrough.finalPatch:walkthrough.firstPatch;
   replacement.focus?.({preventScroll:true});
   replacement.scrollIntoView?.({block:'center',behavior:'auto'});
  });
  el('fill-tab-padding-challenge').addEventListener('click',()=>{
   if(busy||inspection||cloudBusy)return;
   const example=tabPaddingChallenge(current,checkedFunctionForDownload(current));
   if(example)fillChallengeExample(example,'This adds a tab to an omitted duplicate and carries over the original expected return. Keep that return only if tab padding should leave it unchanged.');
  });
  el('fill-shipping-challenge').addEventListener('click',()=>{
   if(busy||inspection||cloudBusy||guidedChallengeControl(current,checkedFunctionForDownload(current))!=='fill-shipping-challenge')return;
   fillChallengeExample(shippingWalkthrough.challenge,'This case checks the written safe-integer requirement. Review its expected return before starting.');
  });
  el('fill-repeat-example').addEventListener('click',()=>{
   if(el('fill-repeat-example').disabled||current?.sessionId!==repeatSession)return;
   const selected=el('repeat-example-case').value;
   const example=current.task.counterexamples.find(item=>item.id===selected);
   if(!example)return;
   const label=('Repeat · '+example.label).slice(0,80);
   fillChallengeExample({...example,label},'Review the expected return. The repeated call runs after the existing examples in the same interpreter.');
  });
  el('fill-numeric-boundary').addEventListener('click',()=>{
   if(el('fill-numeric-boundary').disabled||current?.sessionId!==boundarySession)return;
   const field=boundaryFields[el('numeric-boundary-field').value];if(!field)return;
   const args=JSON.parse(JSON.stringify(field.args)),parent=field.path.slice(0,-1).reduce((value,key)=>value[key],args);
   parent[field.path.at(-1)]=Number.MAX_SAFE_INTEGER+1;
   const existing=current.task.counterexamples.find(example=>JSON.stringify(example.args)===JSON.stringify(args));
   if(existing){el('challenge-status').textContent='These arguments are already in the current examples. Choose another number.';return;}
   fillChallengeExample({label:'Try the first unsafe integer',args},'Enter the return value you expect for these arguments. This test drafts input only, and no model was called.');
  });
  el('load').addEventListener('click',()=>current?.mode==='function-contract'?guidedAction('propose','load',{source:el('function-replacement').value}):action('load-authored'));
  el('load-trap').addEventListener('click',()=>action('load-authored-trap'));
  el('apply').addEventListener('click',()=>guidedAction('apply','apply'));
  el('test').addEventListener('click',()=>{
   if(!busy&&!inspection&&guidedRun?.needsBaselineInspection&&guidedRun.sessionId===current?.sessionId
    &&!current.proposal?.applied)return inspectWalkthroughBaseline();
   return guidedAction('test','test');
  });
  function inspectFirstFailure(){
   const summary=el('checks').querySelector?.('.fail summary');
   if(!summary)return;
   summary.parentElement.open=true;
   summary.focus({preventScroll:true});
   summary.scrollIntoView({block:'start'});
  }
  el('inspect-failed-example').addEventListener('click',inspectFirstFailure);
  el('failure-preview-open').addEventListener('click',inspectFirstFailure);
  el('finish').addEventListener('click',()=>action('finish'));
  el('cancel').addEventListener('click',()=>action('cancel'));
  request('/api/bootstrap').then(data=>{
   if(!data)return;token=data.sessionToken;
   for(const task of data.tasks??[]){const option=node('option',task.title);option.value=task.id;el('sample').append(option);}
   if(data.state?.task?.id)el('sample').value=data.state.task.id;
   el('sample').disabled=false;el('open').disabled=false;el('investigate').disabled=false;
   liveCapability=data.capabilities?.live??null;
   plannerCapability=data.capabilities?.planner??null;
   functionCapability=data.capabilities?.functionContract??null;
   comparePanel.hidden=!hosted||!functionCapability?.available;
   compareExample.hidden=comparePanel.hidden;
   updateComparisonControls();
   el('function-capability').textContent=functionCapability?.admissionKind==='browser-worker-quickjs'?(functionCapability.available?'Try your function in this tab. No companion installation or coding model is needed.':'This browser cannot run function checks. Workers and WebAssembly are required.'):functionCapability?.available?'Qualified function runner ready. No coding model is required for pasted patches.':'Requires the qualified local companion: npm run start:verified -- --manual --docker-socket /path/to/docker.sock';
   el('live-capability').textContent=liveCapability?.available?'Configured local preview is available. Browser/model, network and correctness still require verification.':'Configured local mode unavailable: '+(liveCapability?.missing?.join(', ')??'approved adapters and resources not configured')+'.';
   if(current)render(current);
   if(hosted&&!current?.snapshot&&!pageLeaving&&functionCapability?.available&&!el('function-intake').open){
    if(global.location?.hash==='#checkout-repair')return runWalkthrough(shippingWalkthrough);
    if(global.location?.hash==='#hybrid-review')return runWalkthrough(tagWalkthrough,{focusModelReview:true});
    if(global.location?.hash==='#missed-test')return runWalkthrough(shippingWalkthrough,{startWithDraft:true});
    if(global.location?.hash==='#same-score')return runComparison('example');
   }
   if(!hosted&&((liveCapability?.available&&liveCapability.plannerRequired!==false)||plannerCapability?.available)){
    loadFirebaseClients().then(()=>{
     if(current)render(current);
    })
     .catch(()=>{el('live-capability').textContent='Browser entry failed to load. Configured local mode stays unavailable.';});
   }
  });
 }
 if(document.readyState==='interactive'||document.readyState==='complete')mount();else document.addEventListener('DOMContentLoaded',mount);
})(typeof window==='undefined'?globalThis:window);
