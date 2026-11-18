// Shared, explicit cloud transport. Factories supply the fixed request/response
// contracts; construction and preview perform no SDK initialization or inference.
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max;
export const CLOUD_MODEL='gemini-3.5-flash-lite';
function failureDiagnostic(error,phase,aborted){
 if(aborted||error?.name==='AbortError')return'cloud-wait-ended';
 if(phase==='receipt')return'cloud-source-unconfirmed';
 if(phase==='output')return'cloud-response-rejected';
 if(error?.code==='api-not-enabled')return'cloud-service-not-enabled';
 if(typeof error?.code==='string'&&error.code.startsWith('appCheck/'))return'cloud-attestation-failed';
 // Firebase AI 3.1.0 attaches HTTP status here. Never parse or return its
 // message, URL, response body, status text or provider error details.
 if(error?.code==='fetch-error'){
  const status=error.customErrorData?.status;
  if(status===429)return'cloud-rate-limited';
  if(status===401)return'cloud-unauthenticated';
  if(status===403)return'cloud-access-denied';
  if(status===404)return'cloud-model-unavailable';
  if(status===400)return'cloud-request-rejected';
  if([500,502,503,504].includes(status))return'cloud-service-unavailable';
 }
 return'cloud-request-failed';
}
export function createFirebaseCloudSessionCore({sdk,config,environment=globalThis,purpose,responseSchema,maxOutputTokens,maxResponseBytes,prepare,decode}={}){
 const names=['initializeApp','deleteApp','getApps','initializeAppCheck','ReCaptchaEnterpriseProvider','getAI','GoogleAIBackend','getGenerativeModel'];
 if(!sdk||sdk.SDK_VERSION!=='13.3.0'||!names.every(k=>typeof sdk[k]==='function')||sdk.InferenceMode?.ONLY_IN_CLOUD!=='only_in_cloud'||sdk.InferenceSource?.IN_CLOUD!=='in_cloud')throw Error('unsupported-firebase-dependencies');
 if(!['review','function-draft'].includes(purpose)||typeof prepare!=='function'||typeof decode!=='function'||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>2048||!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>20000)throw Error('invalid-cloud-contract');
 if(!exact(config,['firebase','appCheckSiteKey','appName'])||!exact(config.firebase,['apiKey','projectId','appId'])||!Object.values(config.firebase).every(v=>text(v,300))||!text(config.appCheckSiteKey,300)||!text(config.appName,80)||!/^[A-Za-z0-9_-]+$/.test(config.appName))throw Error('invalid-explicit-public-firebase-config');
 const d=Object.fromEntries(names.map(k=>[k,sdk[k]])),cfg=structuredClone(config),schema=structuredClone(responseSchema);
 let app=null,appCheckReady=false,model=null,modelSchema=null,review=null,pending=null,disposed=false,epoch=0,calls=0;
 const browser=()=>environment.window===environment&&environment.isSecureContext===true&&!!environment.document;
 function preview(snapshot,hint=null){
  if(disposed||pending)throw Error('cloud-'+purpose+'-unavailable');review=null;
  const prepared=prepare(snapshot,hint);
  if(!Number.isSafeInteger(prepared.revision)||prepared.revision<0||typeof prepared.prompt!=='string'||new TextEncoder().encode(prepared.prompt).length>24000)throw Error('cloud-payload-too-large');
  const {payloadJson}=prepared;
  if(payloadJson!==undefined&&(typeof payloadJson!=='string'||!prepared.prompt.endsWith(payloadJson)))throw Error('invalid-preview-payload');
  const visible=Object.freeze({model:CLOUD_MODEL,revision:prepared.revision,prompt:prepared.prompt,
   ...(payloadJson===undefined?{}:{payloadJson})});
  review={visible,context:prepared.context,schema:prepared.responseSchema??schema};return visible;
 }
 function initialize(requestSchema){
  if(model&&modelSchema===requestSchema){if(typeof model.generateContent!=='function'||(model.chromeAdapter&&model.chromeAdapter.mode!=='only_in_cloud'))throw Error('unknown-cloud-model-shape');return model;}
  const name=cfg.appName+'-cloud-'+purpose;
  if(!app){if(d.getApps().some(existing=>existing.name===name))throw Error('app-name-already-used');app=d.initializeApp(structuredClone(cfg.firebase),name);}
  if(!appCheckReady){d.initializeAppCheck(app,{provider:new d.ReCaptchaEnterpriseProvider(cfg.appCheckSiteKey),isTokenAutoRefreshEnabled:false});appCheckReady=true;}
  const ai=d.getAI(app,{backend:new d.GoogleAIBackend()});
  const candidate=d.getGenerativeModel(ai,{mode:'only_in_cloud',inCloudParams:{model:CLOUD_MODEL,generationConfig:{maxOutputTokens,responseMimeType:'application/json',responseJsonSchema:structuredClone(requestSchema)}}},{timeout:60000});
  if(typeof candidate?.generateContent!=='function'||(candidate.chromeAdapter&&candidate.chromeAdapter.mode!=='only_in_cloud'))throw Error('unknown-cloud-model-shape');
  model=candidate;modelSchema=requestSchema;return model;
 }
 function waitForResult(value,signal){
  return new Promise((resolve,reject)=>{
   let settled=false;const cleanup=()=>signal.removeEventListener('abort',abort);
   const abort=()=>{if(settled)return;settled=true;cleanup();reject(Error('cloud-wait-ended'));};signal.addEventListener('abort',abort,{once:true});
   Promise.resolve(value).then(result=>{if(settled)return;settled=true;cleanup();resolve(result);},error=>{if(settled)return;settled=true;cleanup();reject(error);});
   if(signal.aborted)abort();
  });
 }
 async function send(approvedReview){
  if(disposed||pending||!review||approvedReview!==review.visible)return{status:'blocked',reason:'review-current-payload-first'};
  if(!browser()||environment.navigator?.userActivation?.isActive!==true)return{status:'blocked',reason:'secure-browser-gesture-required'};
  if(calls>=5)return{status:'blocked',reason:'cloud-call-budget'};
  const owned=review;review=null;const controller=new AbortController(),mine=epoch;pending=controller;
  const timer=setTimeout(()=>controller.abort(),60000);
  let phase='initialize';
  try{
   const raw=initialize(owned.schema);if(disposed||epoch!==mine||controller.signal.aborted)return{status:'discarded'};calls++;
   phase='request';
   const result=await waitForResult(raw.generateContent(owned.visible.prompt,{signal:controller.signal}),controller.signal);
   if(disposed||epoch!==mine)return{status:'discarded'};
   phase='receipt';
   if(result?.response?.inferenceSource!=='in_cloud'||(Object.hasOwn(result,'inferenceSource')&&result.inferenceSource!=='in_cloud'))throw Error('unexpected-inference-source');
   phase='output';
   const output=result.response.text();if(typeof output!=='string'||new TextEncoder().encode(output).length>maxResponseBytes)throw Error('invalid-cloud-response-size');
   return structuredClone(decode(JSON.parse(output),owned.context,owned.visible));
  }catch(error){
   if(disposed||epoch!==mine)return{status:'discarded'};
   return{status:'blocked',reason:controller.signal.aborted?'cloud-wait-ended':'cloud-'+purpose+'-failed',diagnostic:failureDiagnostic(error,phase,controller.signal.aborted)};
  }finally{clearTimeout(timer);if(pending===controller)pending=null;}
 }
 function stop(){epoch++;review=null;pending?.abort();}
 async function dispose(){if(disposed)return;disposed=true;stop();const owned=app;app=null;model=null;if(owned)try{await d.deleteApp(owned);}catch{/* Never expose raw provider or configuration errors. */}}
 return{preview,send,stop,dispose,get state(){return{busy:!!pending,calls,model:CLOUD_MODEL,sdkInitialized:!!app,disposed,runtimeVerified:false};}};
}
