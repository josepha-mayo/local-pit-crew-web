'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {staticCachePolicy}=require('../src/static-cache-policy.cjs');
async function start({port=0}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid preview port');
 const root=path.resolve(__dirname,'../web/site-dist');
 const manifestBytes=fs.readFileSync(path.join(root,'build-manifest.json'));
 const manifest=JSON.parse(manifestBytes);
 if(manifest.schema!=='local-pit-crew/static-reference-build/v1'||manifest.appCheckDebug!==false)throw Error('Unknown static build');
 const files=new Map();
 for(const [name,expected]of Object.entries(manifest.files)){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name)||name==='.'||name==='..')throw Error('Invalid static build path');
  const bytes=fs.readFileSync(path.join(root,name));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Static build changed; rebuild before previewing');
  files.set('/'+name,bytes);
 }
 // The manifest cannot list its own digest. Serve the exact already-parsed
 // public bytes, matching Hosting without broadening the filesystem mapping.
 files.set('/build-manifest.json',manifestBytes);
 const headers=JSON.parse(fs.readFileSync(path.join(root,'hosting-headers.json'),'utf8'));
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.txt':'text/plain','.wasm':'application/wasm','.jpg':'image/jpeg'};
 const server=http.createServer((req,res)=>{
  if(req.headers.host!=='127.0.0.1:'+server.address().port){res.writeHead(403);res.end();return;}
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  const name=pathname==='/'?'/index.html':pathname,bytes=files.get(name);
  if(!['GET','HEAD'].includes(req.method)||!bytes||['/_headers','/firebase.json','/hosting-headers.json'].includes(name)){res.writeHead(404);res.end();return;}
  const mime=types[path.extname(name)]??'application/octet-stream';
  const contentType=mime.startsWith('text/')||mime==='application/json'?mime+'; charset=utf-8':mime;
  res.writeHead(200,{...headers,'Cache-Control':staticCachePolicy(name.slice(1)),'Content-Type':contentType});
  res.end(req.method==='HEAD'?undefined:bytes);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return server;
}
if(require.main===module){
 const argv=process.argv.slice(2);
 if(argv.length&&(argv.length!==2||argv[0]!=='--port'||!/^\d+$/.test(argv[1])))throw Error('usage: npm run preview:web -- [--port PORT]');
 start({port:argv.length?Number(argv[1]):0}).then(server=>{
  console.log('Static reference preview: http://127.0.0.1:'+server.address().port+'/');
  const close=()=>{server.closeAllConnections();server.close();};process.once('SIGINT',close);process.once('SIGTERM',close);
 }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={start};
