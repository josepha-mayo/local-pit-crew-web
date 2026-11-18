// Browser build adapter for the controller's synchronous source hashes.
import {sha256} from '@noble/hashes/sha2.js';
const encoder=new TextEncoder();
export const randomUUID=()=>globalThis.crypto.randomUUID();
export function createHash(algorithm){
 if(algorithm!=='sha256')throw Error('Unsupported reference hash');
 const state=sha256.create();
 return{update(value){if(typeof value!=='string')throw Error('Expected source text');state.update(encoder.encode(value));return this;},
  digest(encoding){if(encoding!=='hex')throw Error('Expected hex source hash');return Array.from(state.digest(),b=>b.toString(16).padStart(2,'0')).join('');}};
}
export default{createHash,randomUUID};
