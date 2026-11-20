// Authored factory only. SDK is supplied by the real entry or fake tests; no imports/init at module load.
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const text=(x,max=300)=>typeof x==='string'&&x.length>0&&x.length<=max;
export function createFirebasePlannerCore({sdk,localClientModule,config,environment=globalThis}={}){
 const names=['initializeApp','deleteApp','getApps','getAI','GoogleAIBackend','getGenerativeModel'];
 if(!sdk||sdk.SDK_VERSION!=='13.3.0'||!names.every(k=>typeof sdk[k]==='function')||
  sdk.InferenceMode?.ONLY_ON_DEVICE!=='only_on_device'||sdk.InferenceSource?.ON_DEVICE!=='on_device'||
  typeof localClientModule?.LocalDecisionClient!=='function'||!localClientModule.createOptions)throw Error('unsupported-firebase-dependencies');
 if(!exact(config,['firebase','appCheckSiteKey','appName'])||!exact(config.firebase,['apiKey','projectId','appId'])||
  !Object.values(config.firebase).every(x=>text(x))||!text(config.appCheckSiteKey)||!text(config.appName,80)||!/^[A-Za-z0-9_-]+$/.test(config.appName))throw Error('invalid-explicit-public-firebase-config');
 const d=Object.fromEntries(names.map(k=>[k,sdk[k]])),cfg=structuredClone(config),options=structuredClone(localClientModule.createOptions);
 const Client=localClientModule.LocalDecisionClient;
 let app=null,ai=null,client=null,native=null,busy=false,disposed=false,epoch=0;
 const waits=new Set();
 function bounded(operation){
  const owner=new AbortController(),mine=epoch;let expired=false;
  waits.add(owner);
  const released=new Promise(resolve=>owner.signal.addEventListener('abort',()=>resolve(expired?
   {status:'blocked',reason:'native-operation-timeout',diagnostic:'operation-timeout'}:{status:'discarded'}),{once:true}));
  const timer=setTimeout(()=>{if(waits.has(owner)&&epoch===mine){expired=true;stop();}},90000);
  // Invoke synchronously so preparation observes the original browser gesture.
  // Promise.race also consumes an abort-ignoring delegate's eventual rejection.
  return Promise.race([operation(),released]).finally(()=>{clearTimeout(timer);waits.delete(owner);});
 }
 const browser=gesture=>{
  if(environment.window!==environment||environment.isSecureContext!==true||!environment.document)throw Error('real-secure-browser-required');
  if(gesture&&environment.navigator?.userActivation?.isActive!==true)throw Error('user-gesture-required');
  const api=environment.LanguageModel;
  if(!api||typeof api.availability!=='function'||typeof api.create!=='function')throw Error('native-language-model-required');
  if(native&&native!==api)throw Error('native-language-model-changed');
  return api;
 };
 const factoryGuard=()=>{
  browser(false);
  // Version-specific internal shape guard, NOT a stable public API or no-egress proof.
  if(!ai||typeof ai.chromeAdapterFactory!=='function')throw Error('firebase-browser-adapter-required');
 };
 function createModel(params){
  factoryGuard();
  if(params.mode!=='only_on_device')throw Error('local-only-mode-required');
  const raw=d.getGenerativeModel(ai,params),adapter=raw?.chromeAdapter;
  if(!adapter||adapter.mode!=='only_on_device'||adapter.languageModelProvider!==native||typeof adapter.createSession!=='function'||
   typeof raw.initializeDeviceModel!=='function'||typeof raw.generateContent!=='function')throw Error('unsupported-native-session-lifecycle');
  const createSession=adapter.createSession.bind(adapter),owned=new WeakSet(),released=new WeakSet();let disposed=false;
  function destroy(session){
   if(!session||!owned.has(session)||released.has(session))return;
   released.add(session);
   try{session.destroy();}catch{/* Disposal must not expose raw native errors or reopen work. */}
   if(adapter.oldSession===session)adapter.oldSession=null;
  }
  // Pinned AI 3.1.0 creates a session for each request and retains it as oldSession.
  // An abort-ignoring create may finish after Close; destroy it before prompt().
  const ownedCreate=async()=>{
   if(disposed)throw Error('native-model-released');
   const session=await createSession();
   if(!session||typeof session.destroy!=='function')throw Error('unsupported-native-session');
   owned.add(session);
   if(disposed){destroy(session);throw Error('native-model-released');}
   return session;
  };
  adapter.createSession=ownedCreate;
  function guard(){
   factoryGuard();
   if(disposed||raw.chromeAdapter!==adapter||adapter.createSession!==ownedCreate||adapter.mode!=='only_on_device'||adapter.languageModelProvider!==native||
    typeof raw.initializeDeviceModel!=='function'||typeof raw.generateContent!=='function')throw Error('unknown-or-nonlocal-firebase-model-shape');
  }
  guard();
  // Raw SDK model remains private; no countTokens/chat/cloud-capable method is exposed.
  return{
   async initializeDeviceModel(){guard();await raw.initializeDeviceModel();guard();},
   async generateContent(prompt){guard();const result=await raw.generateContent(prompt);return result;},
   dispose(){if(disposed)return;disposed=true;destroy(adapter.oldSession);}
  };
 }
 async function cleanupOwnedApp(){
  const owned=app;app=null;ai=null;native=null;client=null;
  if(owned)try{await d.deleteApp(owned);}catch{/* No raw project/provider errors are copied to caller state. */}
 }
 async function prepareFromUserGesture({repairAdviceOnly=false,repairAdviceFormat='verbatim-quote'}={}){
  if(typeof repairAdviceOnly!=='boolean'||!['verbatim-quote','source-line'].includes(repairAdviceFormat)||
   (!repairAdviceOnly&&repairAdviceFormat!=='verbatim-quote'))return{status:'blocked',reason:'invalid-preparation-mode'};
  if(disposed)return{status:'blocked',reason:'adapter-disposed'};
  if(busy||client?.state.busy)return{status:'blocked',reason:'adapter-busy'};
  let provider;
  try{provider=browser(true);}catch{return{status:'blocked',reason:'secure-browser-gesture-native-api-required'};}
  busy=true;const mine=epoch;
  try{
   // Reject unavailable/downloading/downloadable before Firebase initialization.
   if(await provider.availability(structuredClone(options))!=='available')return{status:'blocked',reason:'local-model-not-already-available'};
   if(mine!==epoch||disposed)return{status:'discarded'};
   if(!client){
    native=provider;
    if(d.getApps().some(existing=>existing.name===cfg.appName))throw Error('app-name-already-used');
    app=d.initializeApp(structuredClone(cfg.firebase),cfg.appName);
    // This app has only a guarded on-device model. Cloud review and drafting
    // use their own Firebase apps and attest before sending a prompt.
    ai=d.getAI(app,{backend:new d.GoogleAIBackend()});
    factoryGuard();
    client=new Client({languageModel:()=>environment.LanguageModel,createModel,onlyOnDevice:'only_on_device',onDeviceSource:'on_device'});
   }
   const result=await client.prepare({repairAdviceOnly,repairAdviceFormat});
   if(mine!==epoch||disposed)return{status:'discarded'};
   if(result.status!=='prepared'){client.stop();return{status:'blocked',reason:'local-initialization-failed'};}
   return{status:'prepared',runtimeVerified:false};
  }catch{
   if(mine!==epoch||disposed)return{status:'discarded'};
   client?.stop();await cleanupOwnedApp();
   return{status:'blocked',reason:'firebase-local-initialization-failed'};
  }finally{if(mine===epoch)busy=false;}
 }
 async function decide(snapshot){
  const owner=client,mine=epoch;
  const stale=()=>disposed||mine!==epoch||client!==owner;
  if(owner?.state.busy)return{status:'blocked',reason:'adapter-busy'};
  if(disposed||busy||!owner?.state.prepared)return{status:'blocked',reason:'local-client-not-prepared'};
  try{
   factoryGuard();
   const result=await owner.decide(snapshot);
   if(stale())return{status:'discarded'};
   if(result.status==='decision')return structuredClone(result);
   if(result.status==='discarded')return{status:'discarded'};
   owner.stop();
   const diagnostics=['readiness-failed','generation-failed','output-json','output-size','output-fields','output-revision','output-types','output-citations','output-grounding','output-arguments','output-action','output-unusable'];
   return{status:'blocked',reason:result.reason?.startsWith('unexpected inference source')?'unexpected-inference-source-investigate-egress':'local-decision-failed',
    ...(diagnostics.includes(result.diagnostic)?{diagnostic:result.diagnostic}:{})};
  }catch{
   if(stale())return{status:'discarded'};
   owner.stop();return{status:'blocked',reason:'local-adapter-failed'};
  }
 }
 function stop(){epoch++;busy=false;for(const wait of waits)wait.abort();client?.stop();}
 async function dispose(){if(disposed)return{status:'disposed'};disposed=true;stop();await cleanupOwnedApp();return{status:'disposed'};}
 return{prepareFromUserGesture:options=>bounded(()=>prepareFromUserGesture(options)),decide:snapshot=>bounded(()=>decide(snapshot)),stop,dispose,
  get state(){return{prepared:client?.state.prepared??false,busy:busy||(client?.state.busy??false),calls:client?.state.calls??0,
   sdkInitialized:!!app,disposed,runtimeVerified:false,expectedFirebaseVersion:'13.3.0',expectedAiVersion:'3.1.0'};}};
}
