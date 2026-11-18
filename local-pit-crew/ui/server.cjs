'use strict';
// Manual local launcher only. Requiring this module does not open a socket.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {verifyFirebaseBundle}=require('../src/firebase-bundle.cjs');
const {createWorkbenchApp}=require('./workbench-bridge.cjs');
const assets=new Map([
 ['/',['index.html','text/html; charset=utf-8']],
 ['/app.js',['app.js','text/javascript; charset=utf-8']],
 ['/style.css',['style.css','text/css; charset=utf-8']],
 ['/browser-planner-pump.js',['../browser-planner-pump.js','text/javascript; charset=utf-8']],
 ['/firebase-planner.mjs',['firebase-planner.mjs','text/javascript; charset=utf-8']]
]);
const securityHeaders={
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
 'Cross-Origin-Resource-Policy':'same-origin'
};
function assetFor(pathname){return assets.get(pathname)??null;}
function createHandler({app,origin,contentSecurityPolicy,developmentAppCheck=false,firebaseRequests=false}){
 if(contentSecurityPolicy!==undefined&&(typeof contentSecurityPolicy!=='string'||!contentSecurityPolicy||/[\r\n]/.test(contentSecurityPolicy)))throw Error('Invalid explicit content policy');
 if(typeof developmentAppCheck!=='boolean')throw Error('Invalid development App Check option');
 if(developmentAppCheck){const url=new URL(origin());if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Development App Check requires numeric loopback');}
 return async(req,res)=>{
  for(const [name,value]of Object.entries(securityHeaders))res.setHeader(name,value);
  // Referrer-restricted Firebase browser keys need the page origin. Cross-origin
  // requests receive only that origin, rather than a local path or query string.
  if(firebaseRequests)res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(contentSecurityPolicy!==undefined)res.setHeader('Content-Security-Policy',contentSecurityPolicy);
  const base=origin();let url;
  try{url=new URL(req.url,base);}catch{res.writeHead(400);res.end('Invalid URL');return;}
  if(req.headers.host!==new URL(base).host){res.writeHead(403);res.end('Unexpected host');return;}
  if(developmentAppCheck&&req.method==='GET'&&url.pathname==='/app-check-development.js'){
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});
   res.end("if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw Error('Development App Check requires loopback');self.FIREBASE_APPCHECK_DEBUG_TOKEN=true;\n");return;
  }
  const asset=req.method==='GET'?assetFor(url.pathname):null;
  if(asset){
   try{
    let data=await fs.readFile(path.join(__dirname,'public',asset[0]));
    if(developmentAppCheck&&url.pathname==='/')data=Buffer.from(data.toString('utf8').replace('<head>','<head><script src="/app-check-development.js"></script>'));
    res.writeHead(200,{'Content-Type':asset[1]});res.end(data);
   }
   catch{res.writeHead(500);res.end('Reference asset unavailable');}
   return;
  }
  let body;
  if(req.method==='POST'){
   let size=0;const chunks=[],maxBytes=url.pathname==='/api/function/replay'?90000:url.pathname==='/api/planner/result'||url.pathname==='/api/function/open'||url.pathname==='/api/function/action'?20000:8192;
   try{
    for await(const chunk of req){size+=chunk.length;if(size>maxBytes){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }catch{res.writeHead(400);res.end('Invalid JSON');return;}
  }
  const result=await app.dispatch({method:req.method,pathname:url.pathname,headers:req.headers,body});
  res.writeHead(result.status,{'Content-Type':'application/json; charset=utf-8',...(result.headers??{})});res.end(JSON.stringify(result.body));
 };
}
async function start({live=null,functionVerifier=null,firebaseConfig=null,contentSecurityPolicy=live?.contentSecurityPolicy,developmentAppCheck=false,port=0}={}){
 if(!Number.isSafeInteger(port)||(port!==0&&(port<1024||port>65535)))throw Error('Invalid loopback port');
 let server;
 const origin=()=>{const address=server?.address();return address&&typeof address==='object'?'http://127.0.0.1:'+address.port:'http://127.0.0.1:0';};
 const browserBundleAvailable=await verifyFirebaseBundle();
 const app=await createWorkbenchApp({origin,live,functionVerifier,firebaseConfig,browserBundleAvailable});
 server=http.createServer(createHandler({app,origin,contentSecurityPolicy,developmentAppCheck,firebaseRequests:!!(firebaseConfig??live?.firebaseConfig)}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 console.log(live?'Configured local workbench source. Runtime and model results remain unverified.':functionVerifier?'Manual function workbench. Qualified public checks; no coding model running.':'Authored reference UI only. No AI or local model is running.');
 console.log(origin());
 if(developmentAppCheck)console.log('Development App Check enabled on loopback only. Keep the browser-generated debug token private; never publish or deploy this mode.');
 return server;
}
if(require.main===module)start().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={createHandler,assetFor,securityHeaders,start};
