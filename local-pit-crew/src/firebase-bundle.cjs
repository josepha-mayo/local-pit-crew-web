'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const inputs=Object.freeze(['web/firebase-planner.mjs','web/firebase-planner-core.mjs','web/firebase-cloud-review-core.mjs','web/firebase-cloud-session-core.mjs','web/firebase-function-draft-core.mjs','web/reference-crypto.mjs','runner/function-contract.cjs','src/firebase-local-client.cjs','web/package-lock.json','web/vite.config.mjs','scripts/build-firebase.cjs']);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function verifyFirebaseBundle(){
 try{
  const manifest=JSON.parse(await fs.readFile(path.join(root,'ui/public/firebase-bundle.json'),'utf8'));
  if(manifest.schema!=='local-pit-crew/firebase-bundle/v1'||manifest.firebase!=='13.3.0'||manifest.ai!=='3.1.0'||
   !manifest.inputs||Object.keys(manifest.inputs).length!==inputs.length)return false;
  for(const file of inputs)if(hash(await fs.readFile(path.join(root,file)))!==manifest.inputs[file])return false;
  return hash(await fs.readFile(path.join(root,'ui/public/firebase-planner.mjs')))===manifest.sha256;
 }catch{return false;}
}
module.exports={inputs,hash,verifyFirebaseBundle};
