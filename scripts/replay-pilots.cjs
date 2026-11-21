'use strict';

const assert = require('node:assert/strict');
const {trials} = require('../examples/repair-pilots.json');
const {TASK_SCHEMA, createFunctionTask} = require('../local-pit-crew/runner/function-contract.cjs');
const {createFunctionReplay} = require('../local-pit-crew/src/function-replay.cjs');
const {replay} = require('./replay-function.cjs');

async function main() {
  const table = [
    '| Trial | Source | Shown to Gemini | Reserved |',
    '| --- | --- | ---: | ---: |',
  ];
  const failures = [];
  for (const {id, title, instructions, exportName, suites, versions} of trials) {
    const context = {title, instructions};
    for (const version of versions) {
      const scores = [];
      for (const suiteName of ['shown', 'reserved']) {
        const {cases, sha256} = suites[suiteName];
        const task = createFunctionTask({schema: TASK_SCHEMA, ...context, exportName, source: version.source, cases});
        const packet = createFunctionReplay(task.files, context);
        const identity = id + ' / ' + version.name + ' / ' + suiteName;
        assert.equal(packet.files[0].sha256, version.sourceSha256, identity + ' source changed');
        assert.equal(packet.files[1].sha256, sha256, identity + ' contract changed');
        const result = await replay(JSON.stringify(packet));
        assert.equal(result.status, 'checked', identity + ' verification unavailable');
        assert.equal(result.modelCalls, 0, identity + ' unexpectedly called a model');
        assert.equal(result.total, cases.length, identity + ' case count changed');
        const failedIds = result.checks.filter(check => !check.ok).map(check => check.id);
        assert.deepEqual(failedIds, version.failed[suiteName], identity + ' results changed');
        scores.push(result.passed + '/' + result.total);
        if (suiteName === 'reserved' && version.name === 'Gemini draft') {
          for (const [index, check] of result.checks.entries()) {
            if (!check.ok) failures.push('- ' + id + ' · ' + check.id + ' · ' + cases[index].label);
          }
        }
      }
      table.push('| ' + [id, version.name, ...scores].join(' | ') + ' |');
    }
  }
  console.log([...table, '', 'Observed failures in the reserved cases for the Gemini drafts', '',
    ...failures, '', 'Fresh Node QuickJS workers · zero model calls'].join('\n'));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
