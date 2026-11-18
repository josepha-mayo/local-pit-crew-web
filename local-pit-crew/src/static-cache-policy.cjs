'use strict';
// Only build-fingerprinted startup, interpreter and worker files use this policy.
const IMMUTABLE_CACHE='public, max-age=31536000, immutable';
function staticCachePolicy(name){
 return typeof name==='string'&&(/^(?:(?:app|browser-planner-pump)-[a-f0-9]{16}\.js|style-[a-f0-9]{16}\.css|reference-app-[a-f0-9]{16}\.mjs)$/.test(name)||
  /^function-[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:mjs|wasm)$/.test(name))?IMMUTABLE_CACHE:'no-store';
}
module.exports={staticCachePolicy,IMMUTABLE_CACHE};
