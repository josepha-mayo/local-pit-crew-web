'use strict';
// Loopback HTTP authorization stays separate from the authored workflow.
const crypto=require('node:crypto');
const {createReferenceWorkflow}=require('../src/reference-workflow.cjs');
const {getTasks,runAuthoredChecks}=require('../test/fixtures.cjs');
async function createReferenceApp({origin,executeChecks=runAuthoredChecks}={}){
 if(!(typeof origin==='string'||typeof origin==='function'))throw Error('Explicit local origin required');
 const originNow=()=>typeof origin==='function'?origin():origin;
 const workflow=await createReferenceWorkflow({definitions:getTasks(),executeChecks,contractChecks:runAuthoredChecks});
 const token=crypto.randomBytes(24).toString('base64url');
 const fail=(status,error)=>({status,body:{error}});
 async function dispatch({method,pathname,headers={},body}={}){
  const h=Object.create(null);for(const [key,value]of Object.entries(headers))h[key.toLowerCase()]=value;
  let expected;try{expected=new URL(originNow());}catch{return fail(503,'Local origin is not ready.');}
  if(expected.protocol!=='http:'||expected.hostname!=='127.0.0.1')return fail(503,'This reference service is loopback-only.');
  if(h.host!==expected.host)return fail(403,'Unexpected host.');
  if(method==='POST'){
   if(h.origin!==expected.origin||h['x-pitcrew-token']!==token)return fail(403,'Reference request authorization failed.');
   if(typeof h['content-type']!=='string'||!h['content-type'].toLowerCase().startsWith('application/json'))return fail(415,'JSON required.');
  }
  const result=await workflow.dispatch({method,pathname,body});
  if(method==='GET'&&pathname==='/api/bootstrap'&&result.status===200)result.body.sessionToken=token;
  return result;
 }
 return{dispatch};
}
module.exports={createReferenceApp};
