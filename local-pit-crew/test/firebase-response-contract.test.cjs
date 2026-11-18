'use strict';
// Raw Firebase result-shape controls with fake delegates only. No SDK/native model/network.
const test=require('node:test'),assert=require('node:assert/strict');
const {LocalDecisionClient}=require('../src/firebase-local-client.cjs');
const decision={revision:1,action:'test',path:'',artifactId:'',evidenceIds:[],objective:'',reasonEvidenceIds:[]};
async function run(make){
 let calls=0;
 const client=new LocalDecisionClient({onlyOnDevice:'only_on_device',onDeviceSource:'on_device',
  languageModel:()=>({async availability(){return'available';}}),
  createModel:()=>({async initializeDeviceModel(){},async generateContent(){calls++;return make();}})});
 assert.equal((await client.prepare()).status,'prepared');
 const result=await client.decide({revision:1,evidence:[],events:[]});
 const state=client.state;client.stop();return{result,state,calls};
}
const text=()=>JSON.stringify(decision);
test('Firebase response contract: canonical nested on-device receipt works without top-level field',async()=>{
 const r=await run(()=>({response:{inferenceSource:'on_device',text}}));
 assert.equal(r.result.status,'decision');assert.equal(r.result.inferenceSource,'on_device');assert.equal(r.calls,1);
 assert.deepEqual(r.result.decision,decision);
});
test('Firebase response contract: old top-level-only receipt blocks after delegate call',async()=>{
 const r=await run(()=>({inferenceSource:'on_device',response:{text}}));
 assert.equal(r.result.status,'blocked');assert.match(r.result.reason,/unexpected inference source/);
 assert.equal(r.calls,1,'post-call check is not evidence of prevented egress');assert.equal(r.state.prepared,false);
});
test('Firebase response contract: missing nested receipt blocks without undefined equality',async()=>{
 for(const make of [()=>({response:{text}}),()=>({}),()=>null]){
  const r=await run(make);assert.equal(r.result.status,'blocked');assert.equal(r.calls,1);assert.equal(r.state.prepared,false);
 }
});
test('Firebase response contract: nested cloud cannot be spoofed by top-level on-device',async()=>{
 const r=await run(()=>({inferenceSource:'on_device',response:{inferenceSource:'in_cloud',text}}));
 assert.equal(r.result.status,'blocked');assert.equal(r.state.prepared,false);assert.equal(r.calls,1);
});
test('Firebase response contract: contradictory top-level/cloud declaration also fails closed',async()=>{
 const r=await run(()=>({inferenceSource:'in_cloud',response:{inferenceSource:'on_device',text}}));
 assert.equal(r.result.status,'blocked');assert.equal(r.state.prepared,false);assert.equal(r.calls,1);
});
test('Firebase response contract: nested cloud without other fields blocks; no source implies identity or privacy proof',async()=>{
 const r=await run(()=>({response:{inferenceSource:'in_cloud',text}}));
 assert.equal(r.result.status,'blocked');assert.equal(r.calls,1);
});
