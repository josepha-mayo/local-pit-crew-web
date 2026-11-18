'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runObservationMatrix}=require('../probe.cjs');
const {validateMatrix}=require('../matrix-policy.cjs');
const {ADAPTER}=require('../policy.cjs');
const input=source=>({suiteId:'pagination-zero',files:{'src/list.js':source,'src/adapter.js':ADAPTER}});
const fixed="const {fetchPage}=require('./adapter');module.exports={list(cursor,limit=20){const p={limit};if(cursor!==null&&cursor!==undefined)p.cursor=cursor;return fetchPage(p);}};";
const cases=[
 {id:'matrix-false',cursor:{type:'boolean',value:false},limit:null,read:'cursor'},
 {id:'matrix-negative-zero',cursor:{type:'number',value:'0',negativeZero:true},limit:null,read:'cursor'},
 {id:'matrix-nan',cursor:{type:'number',value:'NaN',negativeZero:false},limit:null,read:'cursor'},
 {id:'matrix-infinity',cursor:{type:'number',value:'Infinity',negativeZero:false},limit:null,read:'cursor'},
 {id:'matrix-unicode',cursor:{type:'string',value:'続き✓'},limit:null,read:'cursor'},
 {id:'matrix-null',cursor:{type:'null'},limit:null,read:'hasCursor'},
 {id:'matrix-zero-limit',cursor:{type:'string',value:'next'},limit:{type:'number',value:'0',negativeZero:false},read:'limit'},
 {id:'matrix-nul-string',cursor:{type:'string',value:'a\0b'},limit:null,read:'cursor'},
 {id:'matrix-unpaired-surrogate',cursor:{type:'string',value:'\ud800z'},limit:null,read:'cursor'},
 {id:'matrix-null-limit',cursor:{type:'string',value:'next'},limit:{type:'null'},read:'limit'}
];
test('independent real-VM matrix observes unseen values without receiving expected answers',async()=>{
 const result=await runObservationMatrix(input(fixed),cases);assert.equal(result.status,'observed');
 assert.equal(result.cleanupConfirmed,true);assert.equal(Object.hasOwn(result,'checks'),false);
 for(const [i,fact]of result.observations.entries()){
  if(cases[i].read==='hasCursor')assert.equal(fact.present,false);
  else assert.deepEqual(fact.value,cases[i].read==='limit'?cases[i].limit:cases[i].cursor);
 }
 assert.equal(result.productionAdmitted,false);
});

test('matrix primitive codec keeps its pristine JSON functions after guest mutation',async()=>{
 const source="JSON.parse=()=> 'forged';JSON.stringify=()=> '\"forged\"';String.prototype.toJSON=()=>{throw Error('guest hook');};"+fixed;
 const selected=cases.slice(7),result=await runObservationMatrix(input(source),selected);
 assert.equal(result.status,'observed');assert.equal(result.cleanupConfirmed,true);
 assert.deepEqual(result.observations.map(x=>x.value),selected.map(x=>x.read==='limit'?x.limit:x.cursor));
});
test('matrix instructions reject executable/answer fields, oversized values, sparse arrays and accessors',async()=>{
 let calls=0;const getter={...cases[0]};Object.defineProperty(getter,'cursor',{get(){calls++;return{type:'undefined'};}});
 const sparse=Array(2);sparse[0]=cases[0];
 for(const value of [[{...cases[0],expected:true}],Array(25).fill(cases[0]),[{...cases[0],cursor:{type:'string',value:'x'.repeat(129)}}],sparse,[getter],
  [{...cases[0],cursor:{type:'number',value:'not-a-number',negativeZero:false}}]])assert.throws(()=>validateMatrix(value));
 assert.equal(calls,0);
});
test('matrix keeps poisoned own-property checks, object conversion hooks and resource failures non-authoritative',async()=>{
 const poisoned=await runObservationMatrix(input("Object.prototype.hasOwnProperty=()=>false;Function.prototype.call=()=>false;module.exports={list(cursor){return {cursor};}};"),[cases[5]]);
 assert.equal(poisoned.status,'observed');assert.equal(poisoned.observations[0].present,true);
 const cyclic=await runObservationMatrix(input("const x={};x.self=x;x.toJSON=()=>{while(true){}};x.toString=()=>{while(true){}};module.exports={list(){return {cursor:x};}};"),[cases[0]]);
 assert.equal(cyclic.status,'observed');assert.deepEqual(cyclic.observations[0].value,{type:'object'});
 for(const source of ['while(true){}','module.exports={list(){return {get cursor(){while(true){}}};}};',"require('node:fs');"]){
  const result=await runObservationMatrix(input(source),[cases[0]]);assert.notEqual(result.status,'observed');assert.equal(Object.hasOwn(result,'checks'),false);assert.equal(result.cleanupConfirmed,true);
 }
});
