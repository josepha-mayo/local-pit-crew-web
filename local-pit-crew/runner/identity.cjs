'use strict';
const fs = require('node:fs'), path = require('node:path');
const {POLICY, hash} = require('./policy.cjs');
function runnerIdentity() {
  const source = Object.fromEntries(['worker.cjs', 'matrix-worker.cjs','matrix-policy.cjs','function-contract.cjs','function-guest.cjs','function-worker.cjs','function-executor.cjs','primitive-codec.cjs','compiled-wasm.cjs','probe.cjs', 'policy.cjs', 'identity.cjs', 'package-lock.json']
    .map(name => [name, hash(fs.readFileSync(path.join(__dirname, name)))]));
  const engine = Object.fromEntries(['quickjs-emscripten', 'quickjs-emscripten-core',
    '@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-wasmfile-release-sync/ffi',
    '@jitl/quickjs-wasmfile-release-sync/emscripten-module', '@jitl/quickjs-wasmfile-release-sync/wasm']
    .map(name => [name, hash(fs.readFileSync(require.resolve(name)))]));
  return {policy: POLICY, node: process.version, platform: process.platform, architecture: process.arch, source, engine,
    productionAdmitted: false, osProcessIsolationQualified: false, totalProcessMemoryBoundQualified: false};
}
module.exports = {runnerIdentity};
