'use strict';
// Explicit experiment using an existing model-output record. No new model call or host code execution.
const fs = require('node:fs');
const {getTasks} = require('../local-pit-crew/test/fixtures.cjs');
const {parseCoderResponse} = require('../local-pit-crew/src/coder-response.cjs');
const {runCandidateProbe} = require('../local-pit-crew/runner/probe.cjs');
const {runnerIdentity} = require('../local-pit-crew/runner/identity.cjs');
const {hash} = require('../local-pit-crew/runner/policy.cjs');
async function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--smoke-record') throw Error('usage: node scripts/probe-local-patch.cjs --smoke-record RECORD.json');
  const stat = fs.statSync(argv[1]); if (!stat.isFile() || stat.size > 128000) throw Error('invalid-smoke-record-size');
  const bytes = fs.readFileSync(argv[1]); const record = JSON.parse(bytes.toString('utf8'));
  if (record.schema !== 'local-pit-crew/local-coder-smoke/v1' || record.sample !== 'pagination-zero' || record.result !== 'proposal') throw Error('unsupported-smoke-record');
  const task = getTasks().find(t => t.id === 'pagination-zero');
  const evidence = Object.entries(task.files).map(([path, content]) => ({path, content, sha256: hash(content)}));
  const patch = parseCoderResponse(JSON.stringify({edits: record.proposal?.edits}), {evidence, writable: task.writable});
  const files = {...task.files};
  for (const edit of patch.edits) {
    const before = files[edit.path], at = before.indexOf(edit.find);
    if (hash(before) !== edit.beforeSha256 || at < 0 || before.indexOf(edit.find, at + 1) !== -1) throw Error('invalid-exact-patch');
    files[edit.path] = before.slice(0, at) + edit.replace + before.slice(at + edit.find.length);
  }
  const baseline = await runCandidateProbe({suiteId: task.id, files: task.files});
  const candidate = await runCandidateProbe({suiteId: task.id, files});
  const result = {schema: 'local-pit-crew/runner-pilot-evidence/v1', generatedAt: new Date().toISOString(),
    sample: task.id, candidateProvenance: 'supplied-local-coder-smoke-record', suppliedRecordSha256: hash(bytes),
    candidateSourceSha256: hash(files['src/list.js']), runner: runnerIdentity(), baseline, candidate,
    heldOutCorrectness: false, nanoBenefitMeasured: false, productionReady: false};
  console.log(JSON.stringify(result, null, 2));
  if (baseline.status !== 'observed' || candidate.status !== 'observed') process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {main};
