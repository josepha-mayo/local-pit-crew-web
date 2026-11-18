// Explicit browser-memory transport. It never intercepts fetch or sends HTTP requests.
export function createReferenceTransport({workflow,firebaseConfig=null,firebaseConfigured=!!firebaseConfig,functionWorkbench=false}={}){
 if(typeof workflow?.dispatch!=='function')throw Error('Authored workflow required');
 const token=crypto.randomUUID();
 return async function referenceRequest(path,options={}){
  if(!['/api/bootstrap','/api/state','/api/start','/api/action',...(functionWorkbench?['/api/function/open','/api/function/extend','/api/function/action','/api/function/replay','/api/function/compare-replays','/api/workbench/cancel-start']:[])].includes(path))throw Error('Unknown browser-memory route');
  const method=options.method??'GET';let body;
  if(method==='POST'){
   if(options.headers?.['X-Pitcrew-Token']!==token||options.headers?.['Content-Type']!=='application/json')throw Error('Invalid browser-memory request');
   const maxBytes=path==='/api/function/compare-replays'?160040:path==='/api/function/replay'?90000:20000;
   if(typeof options.body!=='string'||new TextEncoder().encode(options.body).byteLength>maxBytes)throw Error('Invalid browser-memory body');
   body=JSON.parse(options.body);
  }
  const result=await workflow.dispatch({method,pathname:path,body});
  const data=structuredClone(result.body);
  if(data.state)data.state.storage='browser-memory';
  if(path==='/api/bootstrap'&&method==='GET'){
   data.sessionToken=token;
   data.capabilities={live:{available:false,missing:['desktop companion']},planner:{available:firebaseConfigured,
    configReady:!!firebaseConfig,bundleReady:true,...(firebaseConfig?{firebaseConfig:structuredClone(firebaseConfig)}:{})},
    ...(functionWorkbench?{functionContract:structuredClone(workflow.functionCapability())}:{})};
  }
  return{ok:result.status>=200&&result.status<300,status:result.status,json:async()=>structuredClone(data)};
 };
}
