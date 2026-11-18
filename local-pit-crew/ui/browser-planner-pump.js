(function(global){
 'use strict';
 // No auto-start, SDK import or network call. A prepared local client and explicit transport are required.
 const clone=x=>structuredClone(x);
 const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
 const bindingKeys=['sessionId','workerId','jobId','claimId','revision','snapshotHash'];
 function companionOrigin(value){
  let u;try{u=new URL(value);}catch{throw Error('invalid-companion-origin');}
  if(u.origin!==value||u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid-companion-origin');
  return u.origin;
 }
 async function readJSON(response,signal){
  if(!response?.headers||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error('handoff-response-type');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>24000)throw Error('handoff-response-size');
  const reader=response.body?.getReader?.();if(!reader)throw Error('handoff-response-stream-required');
  const chunks=[];let size=0;
  try{
   for(;;){
    if(signal.aborted)throw Error('handoff-cancelled');
    const item=await reader.read();if(item.done)break;
    if(!(item.value instanceof Uint8Array))throw Error('handoff-response-chunk');
    size+=item.value.byteLength;if(size>24000){await reader.cancel();throw Error('handoff-response-size');}
    chunks.push(item.value);
   }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }
 function createFetchPlannerTransport({companion,sessionId,workerId,authToken,fetchImpl,requestTimeoutMs=5000}={}){
  const base=companionOrigin(companion);
  if(typeof sessionId!=='string'||typeof workerId!=='string'||!sessionId||!workerId||
   typeof authToken!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(authToken)||typeof fetchImpl!=='function'||
   !Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>120000)throw Error('invalid-planner-transport');
  async function send(route,payload,{signal}={}){
   const own=new AbortController(),timer=setTimeout(()=>own.abort(),requestTimeoutMs);
   const abort=()=>own.abort();if(signal?.aborted)own.abort();else signal?.addEventListener('abort',abort,{once:true});
   try{
    const body=JSON.stringify(payload);if(new TextEncoder().encode(body).length>20000)throw Error('handoff-request-size');
    const response=await fetchImpl(base+route,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',
     headers:{'Content-Type':'application/json','X-Pitcrew-Token':authToken},body,signal:own.signal});
    const result=await readJSON(response,own.signal);
    if(!response.ok)throw Error('handoff-request-rejected');
    return result;
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  const bind=x=>Object.fromEntries(bindingKeys.map(k=>[k,x[k]]));
  return{sessionId,workerId,
   claim:options=>send('/api/planner/claim',{sessionId,workerId},options),
   status:(job,options)=>send('/api/planner/status',bind(job),options),
   submit:(job,outcome,options)=>send('/api/planner/result',{...bind(job),outcome},options)};
 }
 async function shaSnapshot(snapshot){
  const data=new TextEncoder().encode(JSON.stringify(snapshot));
  const result=await global.crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function delay(ms,signal){
  let timer,abort;
  return new Promise((resolve,reject)=>{
   const done=()=>{signal.removeEventListener('abort',abort);resolve();};
   timer=setTimeout(done,ms);
   abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('handoff-cancelled'));};
   if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
 }
 function createBrowserPlannerPump({client,transport,hashSnapshot=shaSnapshot,clock=Date.now,pollMs=250,onObservation=()=>{}}={}){
  if(!client||typeof client.decide!=='function'||typeof client.stop!=='function'||!transport||
   !['claim','status','submit'].every(k=>typeof transport[k]==='function')||typeof hashSnapshot!=='function'||typeof clock!=='function'||
   !Number.isSafeInteger(pollMs)||pollMs<50||pollMs>5000||typeof onObservation!=='function')throw Error('invalid-browser-planner-pump');
  let busy=false,closed=false,epoch=0,activeAbort=null;
  function stop(){closed=true;epoch++;activeAbort?.abort();try{client.stop();}catch{/* Caller owns adapter disposal. */}}
  async function runOne(){
   if(closed)return{status:'blocked',reason:'pump-closed'};
   if(busy)return{status:'blocked',reason:'pump-busy'};
   if(client.state?.prepared!==true)return{status:'blocked',reason:'local-client-not-prepared'};
   const mine=epoch,lifetime=new AbortController(),watchAbort=new AbortController();
   activeAbort=lifetime;busy=true;let expiry=null,job=null,watch=null,abortListener=null;
   const live=()=>mine===epoch&&!lifetime.signal.aborted&&!closed;
   const stopClient=()=>{try{client.stop();}catch{/* No raw adapter error is exposed. */}};
   const deactivate=()=>{stopClient();lifetime.abort();watchAbort.abort();};
   try{
    const claimed=await transport.claim({signal:lifetime.signal});if(!live())return{status:'discarded'};
    if(exact(claimed,['job'])&&claimed.job===null)return{status:'idle'};
    job=claimed?.job;
    const fields=['sessionId','workerId','jobId','claimId','revision','snapshotHash','expiresAt','snapshot'];
    if(!exact(job,fields)||job.sessionId!==transport.sessionId||job.workerId!==transport.workerId||
     typeof job.jobId!=='string'||typeof job.claimId!=='string'||!Number.isSafeInteger(job.revision)||
     !/^[a-f0-9]{64}$/.test(job.snapshotHash)||!Number.isSafeInteger(job.expiresAt)||job.expiresAt<=clock()||
     job.snapshot?.revision!==job.revision||job.snapshot?.closed!==false||
     new TextEncoder().encode(JSON.stringify(job.snapshot)).length>18000)throw Error('invalid-planner-job');
    const computed=await hashSnapshot(clone(job.snapshot));if(!live())return{status:'discarded'};
    if(computed!==job.snapshotHash)throw Error('planner-snapshot-hash-mismatch');
    const initial=await transport.status(job,{signal:lifetime.signal});
    if(!live()||initial?.active!==true||job.expiresAt<=clock()){deactivate();return{status:'discarded'};}
    expiry=setTimeout(deactivate,Math.max(0,job.expiresAt-clock()));
    const interrupted=new Promise((_,reject)=>{
     abortListener=()=>reject(Error('planner-interrupted'));
     if(lifetime.signal.aborted)abortListener();else lifetime.signal.addEventListener('abort',abortListener,{once:true});
    });
    watch=(async()=>{
     try{
      for(;;){
       await delay(pollMs,watchAbort.signal);
       const status=await transport.status(job,{signal:watchAbort.signal});
       if(status?.active!==true){deactivate();throw Error('planner-job-inactive');}
      }
     }catch(error){if(watchAbort.signal.aborted)return;throw error;}
    })();
    const result=await Promise.race([client.decide(clone(job.snapshot)),watch,interrupted]);
    watchAbort.abort();await watch;
    if(!live())return{status:'discarded'};
    const final=await transport.status(job,{signal:lifetime.signal});
    if(!live()||final?.active!==true){deactivate();return{status:'discarded'};}
    const diagnostics=['readiness-failed','generation-failed','operation-timeout','output-json','output-size','output-fields','output-revision','output-types','output-citations','output-grounding','output-arguments','output-action','output-unusable'];
    const reportedDecision=result?.status==='decision',decided=reportedDecision&&result.inferenceSource==='on_device';
    const observation={sessionId:job.sessionId,revision:job.revision,status:decided?'decision':'blocked',
     inferenceSource:decided&&result.inferenceSource==='on_device'?'on_device':null,
     diagnostic:decided?null:reportedDecision||result?.reason==='unexpected-inference-source-investigate-egress'?'unexpected-inference-source':
      diagnostics.includes(result?.diagnostic)?result.diagnostic:null};
    // Local UI metadata only. Never forward raw errors/source or expand the handoff protocol.
    // Notify before submit: the backend may close the owning session as soon as it receives a failure.
    try{onObservation(clone(observation));}catch{/* Observation cannot change the submitted result. */}
    const outcome=result?.status==='decision'?{status:'decision',decision:clone(result.decision),inferenceSource:result.inferenceSource}:
     {status:'blocked',reason:'planner-failed'};
    const accepted=await transport.submit(job,outcome,{signal:lifetime.signal});
    if(!live())return{status:'discarded'};
    if(accepted?.accepted!==true)throw Error('planner-result-not-accepted');
    return{status:'submitted',runtimeVerified:false};
   }catch{
    if(!live())return{status:'discarded'};
    // Report only a bounded category to the owning backend, never raw errors or source.
    if(job)try{await transport.submit(job,{status:'blocked',reason:'planner-failed'},{signal:lifetime.signal});}catch{/* Backend expiry also invalidates the job. */}
    stopClient();return{status:'blocked',reason:'browser-planner-failed'};
   }finally{
    clearTimeout(expiry);watchAbort.abort();
    if(abortListener)lifetime.signal.removeEventListener('abort',abortListener);
    lifetime.abort();if(activeAbort===lifetime)activeAbort=null;busy=false;
   }
  }
  return{runOne,stop,get state(){return{busy,closed,runtimeVerified:false};}};
 }
 const api={createFetchPlannerTransport,createBrowserPlannerPump};
 if(typeof module==='object'&&module.exports)module.exports=api;else global.LocalPitCrewBrowserPlanner=api;
})(typeof window==='undefined'?globalThis:window);
