# Bring your own function

Use a real failing function and counterexamples you control. The web build runs small functions directly in a separate browser worker; no installation is needed to review pasted repairs. Both browser and companion keep the examples fixed while you review a replacement and compare every check. Browser execution is distinct from the companion's Docker qualification.

The action beside the run status follows the current step: run the baseline, choose a repair, review the proposed change, verify the applied replacement, and finish. Reviewing a change navigates to the diff; **Apply in memory** remains a separate click. Reviewing a cloud request navigates to its full prompt; **Send patch request to Google** remains a separate click.

To run the browser build locally, follow [web setup](web-demo.md). For the additional Docker-qualified companion boundary, use the following setup.

Install Node.js 24+, the project dependencies and a running Linux Docker daemon. Windows uses WSL (`Ubuntu-24.04` by default) with `/usr/bin/node` and Docker available there. From the repository root:

```sh
npm ci --ignore-scripts --prefix local-pit-crew/web
npm run start:verified -- --manual --docker-socket /var/run/docker.sock
```

Use your actual Linux Docker socket path. Setup builds the trusted runner and runs real Docker qualification before opening the numeric loopback URL. There is no skip switch, caller-supplied image or automatic model download. An Ollama daemon is not required for manual patches.

Choose **Bring my function** or expand **Bring your own function**. Enter a title, the intended behavior, the export name and complete CommonJS source. This example contains a bug: sorting also changes the caller's array.

```js
module.exports = { sortCopy: values => values.sort() };
```

Set the export name to `sortCopy` and provide examples as a JSON array:

```json
[
  {"label":"Sort without changing the input", "args":[["b","a"]], "expected":["a","b"]},
  {"label":"Keep empty arrays valid", "args":[[]], "expected":[]}
]
```

**Open my function**, then **Verify my counterexamples**. Read `src/function.js` and `contract.json` to inspect the evidence. Paste a replacement into **Proposed full function source**, choose **Review pasted patch**, inspect the exact before and after, then **Apply in memory**. For this example the replacement is:

```js
module.exports = { sortCopy: values => [...values].sort() };
```

Verify again. The comparison shows repaired and regressed check IDs, including a change that preserves the total pass count. Finish requires passing checks for the exact current source and contract. You can apply at most two patches and run three checks in one session; reopen to start a new contract. A pasted patch is explicitly labeled as user input and records zero model calls.

Each checked example can also be inspected directly. Failing examples expand to show the original arguments, expected return, observed return and, when changed, arguments after the call. A correct sorted result can still fail because it changed the caller's array. The bench distinguishes a different return, a thrown error, unsupported JSON output and input mutation; more than one condition can fail at once. Exception contents stay withheld. These details come from runtime observations, independently checked against the same source and contract, rather than a model's explanation. Applying another patch clears the old details until the changed source is checked.

For a validator that rejects bad input, give the example a `throws` field with the error’s own string `code`. An example takes exactly one outcome. Use `expected` for a JSON return and `throws` for an uppercase error code of up to 64 characters. The verifier checks that the code matches and that the call preserves its inputs. Diagnostic payloads report match status and omit observed exception contents. A reviewed model request can still include source code.

```js
exports.normalizeSlug = input => {
  const value = input?.slug;
  if (typeof value !== 'string' || !/^[a-z0-9-]+$/i.test(value.trim())) {
    throw Object.assign(new TypeError('Enter a project slug'), {code: 'INVALID_SLUG'});
  }
  return value.trim().toLowerCase();
};
```

```json
[
  {"label":"Normalize a valid slug","args":[{"slug":" Demo-1 "}],"expected":"demo-1"},
  {"label":"Reject a slash","args":[{"slug":"demo/1"}],"throws":"INVALID_SLUG"}
]
```

When extending a run or turning a probe into a test, use **Expect a thrown error code** to specify the required code. The replay and CI contract retain that assertion. [Runnable validator example](../examples/validation)

The function must be synchronous, accept bounded plain JSON data, and preserve the JSON-visible input arguments. There are up to eight examples, eight arguments per example, 6,000 UTF-8 source bytes and 5,000 contract bytes. Nested values have additional depth, size and type limits. Imports, promises, classes, cycles, accessors and non-JSON results are unsupported. A runner failure makes verification unavailable. Passing examples cover the fixed calls you supplied.

The contract is a read-only manifest file. Its hash and the source hash bind every accepted verdict. Expected answers stay in the trusted grader and are not passed to the candidate's QuickJS context. Public examples are visible to the developer and, when requested, the coding model and advisor. They are not held-out evaluation data.

To request a cloud replacement, choose **Review cloud patch request** after a failed baseline. The app reads any missing current function or contract evidence locally, verifies those source hashes, and displays the complete prompt. When a current Nano hypothesis is available, **Review request with Nano hypothesis** prepares a prompt that also includes that hypothesis. The regular preview keeps the hypothesis on the device. Both previews prepare text locally. **Send patch request to Google** shares the displayed function, fixed examples, observations and any explicitly included hypothesis with `gemini-3.5-flash-lite` through Firebase AI Logic using cloud-only mode.

A returned draft changes no source and consumes no controller proposal slot until you choose **Review proposed diff**. You can reject it with **Close patch request**. Selecting its diff binds the proposed bytes to the original function and contract; the server treats its Firebase origin as browser-reported, not an independent attestation. Inspect the diff, Apply, verify and finish through the same fixed contract as a pasted repair. Closing the request or changing the run revokes the old approval and discards late results. Requests already sent may continue at the provider. There are five explicit cloud draft requests per tab and two proposal slots per function run; no automatic retry or model fallback occurs.

The run record separates local coder, cloud draft and cloud review invocation counts. A cloud draft contributes to both code-generation and cloud-request totals; `modelCallsTotal` counts that SDK invocation once. These are client observations, not billing or network-traffic attestations. Provider explanations and source contents remain outside the default record.

For optional Nano diagnosis and cloud review, pass `--config /absolute/path/to/browser.local.json` using the browser-only configuration in [Firebase setup](firebase-setup.md). After a failing check, read the relevant files and choose **Ask Nano about this failure**. The on-device diagnosis receives the current read source, public results and failed examples: original arguments, expected and actual returns, result status and observed input changes. Thrown errors have no return value, and their contents remain withheld. Only current failed cases enter this additional context; applying a patch or starting another check clears the old observations. Oversized context is refused before inference. Cloud review separately requires previewing and explicitly sending the complete displayed prompt. Model setup and App Check can contact Google; no offline or network-locality guarantee is implied. Exact required Nano identity and model repair benefit remain separate verification gates.

With the full verified coder launcher, an opened function also becomes selectable for **Use local coder**. That starts from the imported original source and fixed contract. A generated patch still requires review, Apply and independent verification. The manual flow and actual model output must be reported separately.

After the current function passes every fixed example, **Your checked function** shows the exact source under **View checked source**. **Download checked function** requests a file such as `sortCopy.checked.js`, including after Finish. Before requesting it, the browser hashes the actual UTF-8 bytes and requires them to match the checked source manifest; changing or closing the run during hashing discards the old download. A failed or pending verification offers no checked-source artifact. Applying another replacement clears it until the changed source passes. An unapplied proposal does not change the source that was checked.

To probe a passing repair, expand **Challenge with another example**. Supply a label, an array of call arguments and the expected JSON return, then choose **Start extended check**. This forks a separate run with the exact checked source and all existing examples unchanged, followed by your new example. It works after Finish too. The original contract is never edited; the new run inherits no verdict, model output or check budget. Run **Verify my counterexamples** again, inspect any newly exposed failure and review a replacement before Apply. Every example in the extended contract must pass before Finish. You supply the expected answer; the app does not certify its correctness or automatically treat a model suggestion as an expected answer.

Use **Repeat a passing input** to catch state left behind by an earlier call. For example, a tag deduplicator that keeps its `Set` outside the exported function can pass a call with `["Ops"]` and another with `["Billing"]` before returning an empty list when `["Ops"]` comes back. Pick the earlier example, choose **Fill repeated call**, and verify the extended contract. When a passing call and a failing call use the same arguments and expected return, the workbench shows both positions. The browser and Node replay run the saved examples in order inside one fresh interpreter per run.

At most eight examples fit in one contract, so a run already using all eight cannot be extended. A stale, failed or pending run cannot supply a checked parent. The default record includes only the previous source/contract hashes and example count as app-reported lineage; it excludes the added label, arguments and expected value. These hashes describe the source at the fork, even if a later reviewed patch changes the child source. They are not signatures or independent attestation of the previous result.

**Download replay case** separately requests `sortCopy.replay.json`, containing the exact source, read-only contract, title and required behavior together. **View replay JSON** shows those same bytes for inspection or manual saving. This explicit file includes source, requirements, labels, arguments and expected values; the default evidence export continues to exclude them. The browser checks both file hashes before requesting the download. A replay packet carries no saved verdict, provider credentials or model-generated explanation.

To reopen it in the web app, expand **Bring your own function**, then **Reopen a saved replay case**. Choose the replay file or paste the saved JSON. File selection reads up to 80,000 UTF-8 bytes into the text field. Choose **Load replay into form** to validate the format, bounds and source and contract hashes. The web build performs this validation locally, without executing the function or calling a model. Loading replaces the intake draft and preserves the active run. If you edit the draft while validation is pending, the late response leaves those edits intact. Review the form, choose **Open my function**, then run fresh checks.

New replay files use version 2 to preserve the original title and requirements. Version 1 files remain accepted by the current browser and CLI. Since older files contain only source and examples, loading one clears **Required behavior** and asks you to enter it before opening. The reopened contract is generated from the loaded examples; custom whitespace or equivalent object formatting in an externally edited packet may produce a new contract hash. Its fresh checks bind the newly generated source and contract. Packet hashes are not signatures and do not authenticate who wrote the requirements or examples.

To reproduce the case after closing the tab, install the pinned runner dependency once and run it from the repository root:

```sh
npm ci --ignore-scripts --prefix local-pit-crew/runner
npm run replay:function -- /path/to/sortCopy.replay.json
```

The command validates the bounded packet and its source and contract hashes before executing anything, then runs fresh QuickJS checks in a Node worker. Candidate source is never loaded as a Node module. It makes no Firebase or model request and does not write your project files. Exit codes are `0` for every fixed example passing, `1` for observed mismatches and `2` for an invalid packet or unavailable verification. The result names this Node worker boundary explicitly; it is not qualified Docker isolation. Hashes detect changed bytes relative to the packet, not who authored it. Passing still covers only the supplied fixed examples.

Use **Download failure replay** to capture a failing baseline, then **Download replay case** after checking the repair against the same examples.

To check later edits without exporting a new replay, pass your current function file and the saved examples to CI.

```sh
npm run replay:function -- baseline.replay.json --source src/my-function.js --junit replay-results.xml
```

The replay still has to pass its original hash validation. The runner then uses its existing contract and checks the source file you supplied, reporting that file's SHA-256 and the unchanged contract hash. The file must be UTF-8 and fit the same 6,000-byte limit. It must expose the same synchronous CommonJS export and run without imports. The normal exit codes apply, and `--source` and `--against` are mutually exclusive.

On the hosted bench, open **Bring my function → Compare a function revision**. Select a baseline replay and either your current standalone CommonJS file (`.js` or `.cjs`, up to 6,000 UTF-8 bytes) or a second replay with the same contract. Both versions run the baseline’s fixed examples in separate workers in your tab. The bench reports changed results and preserves your active run. **Download comparison summary** saves version hashes, counts, and changed check IDs. Source, labels, inputs and return values stay out of that file. **Run a same-score example** demonstrates a pagination patch that repairs the zero-cursor case and regresses the null-cursor case.

If the candidate fails any example, **Download candidate failure replay** saves its checked source with the baseline’s contract and any saved requirements. Reopen that file for a fresh repair run or rerun it in CI. The replay contains the candidate code and example values, so share it with people who should see them.

To keep working in the same tab, choose **Load candidate for repair**. The bench verifies the replay hashes and fills the repair form with the candidate source, requirements and examples. Choose **Open my function** after reviewing the form, then verify the new run.

After comparing versions, choose **Probe boundary inputs** to run up to eight new examples. It changes one top-level string, number or boolean argument at a time and skips input arrays already in the saved contract. Both versions receive the same sequence in fresh workers. The result shows differences in return values, thrown errors or changes to inputs.

Choose **Use this input for a test** beside a difference. Enter the expected JSON return from your requirements, then **Load candidate with this test**. This fills the repair form with the candidate and adds the new example after the saved examples. Open and check the candidate afresh, then download its replay for CI or verify a repair. The combined contract still supports up to eight examples.

For a CI comparison, run the command below.

```sh
npm run replay:function -- baseline.replay.json --against repaired.replay.json
```

To compare directly with a working JavaScript file and write the candidate's JUnit report, use:

```sh
npm run replay:function -- baseline.replay.json --compare-source src/my-function.js --junit replay-results.xml
```

Both versions run the baseline's fixed contract. The `--source` mode runs only the working file. Use one of `--against`, `--compare-source`, or `--source` per invocation.

Comparison requires different source. When comparing two replays, both packets must pass validation and contain byte-identical contracts. Each version runs in its own worker. The JSON shows which fixed check IDs improved or regressed, even when the passing totals match. The `changedFailures` list reports cases that failed in both versions but changed their return, execution outcome, or arguments after the call. It contains check IDs only. The exit code follows the candidate result when both runs are available. An invalid comparison or unavailable run returns `2` with no comparison verdict. With `--junit`, a successful comparison writes the candidate's fresh checks.

### Check the current function in CI

Open **Run these examples in CI** and select **Download test contract** on the failed or corrected run. The download contains the export name, example labels, input arguments, and expected returns. Review those values before committing. The failed and corrected runs export the same contract when verified against the same examples.

With the pinned QuickJS runner installed, run the contract against the current file.

```sh
npm run replay:function -- --contract function.contract.json --source src/my-function.js
```

Choose **Set up GitHub Actions** next to the contract download to generate a workflow for the path to your standalone CommonJS function. Save the contract at the repository root and the workflow under `.github/workflows/`. You can also write the workflow by hand, as below, and choose a different contract path. The workflows pin the verifier and use read-only repository permissions. A failed example or unavailable verification fails the job. To enforce the check before merging, require the job on the target branch.

**Pin the reviewed contract** is on by default. The generated workflow checks the SHA-256 of the exact downloaded file before running the function. For example, the recorded checkout draft would pass four checks if someone removed the unsafe-integer case. With the pin, that edited contract stops the workflow before the draft runs. Keep the downloaded bytes, including line endings. When you intentionally change the examples, review them and download a fresh contract and workflow together. Turn the option off for repositories that update their test contracts independently.

```yaml
name: Check reviewed examples
on: [pull_request, push]
permissions:
  contents: read
jobs:
  fixed-examples:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - uses: josepha-mayo/local-pit-crew-web@2a151de6d666d65dbd52eceafcab5e8b3135bd7e
        with:
          contract: tests/function.contract.json
          source: src/my-function.js
```

For a hand-written workflow, set the optional `contract-sha256` input to the reviewed file’s lowercase SHA-256. Pass the same value through `--contract-sha256` when running the CLI directly. Logs identify the fixed case IDs and hashes after a run. The CLI also supports `--junit replay-results.xml` and repeats through `--runs 2` to `--runs 5`.

### Repeat checks in fresh workers

For a replay that may depend on the clock or randomness, choose **Run the same replay twice** after selecting the baseline file in the browser. In CI, pass `--runs 2` through `--runs 5` to check the same source in fresh workers. The report gives each run’s passing total and the IDs whose verdict or failing observation changed. A fixed example must pass in every completed run for the repeated CLI check to pass. The result describes the runs actually observed. The summary and JUnit output omit source, input values, and observed returns.

```sh
npm run replay:function -- baseline.replay.json --runs 3 --junit replay-results.xml
```

For CI, optionally write a JUnit XML report alongside the normal JSON result:

```sh
npm run replay:function -- /path/to/sortCopy.replay.json --junit replay-results.xml
```

Use a new report path in an existing directory. An existing file, including the input replay itself, is never overwritten. A report write failure returns `2` and does not print a successful JSON result. Publish the report with your CI system's JUnit reader; for example, [Jenkins documents a JUnit XML publisher](https://plugins.jenkins.io/junit/). No CI service is contacted by this command.

For an observed verdict, each fixed check ID becomes a test case; observed mismatches become failures. The contract hash namespaces test classes so different contracts do not merge their `case-01` results. Source and contract hashes, the execution boundary and the zero model-call count are report properties. An invalid packet or unavailable execution produces one verification error instead of inventing pass/fail results for examples. A runtime-unavailable result still returns `2`; the report does not turn it into a candidate failure. Argument/option errors and an unwritable destination may prevent report creation, so preserve the process exit status and do not configure CI to ignore missing reports.

The XML excludes source, requirements, labels, input arguments, expected and observed values, raw errors and local filenames. It contains no claimed execution timing and no imported browser verdict. It reports the same bounded Node-worker execution as the JSON result, with Docker qualification false and untested correctness unknown. Generating the report performs no additional execution or model call.

Function source, labels, requirements, expected values and observed values are excluded from the default run record; it exports source hashes, fixed check IDs, results and provenance, including which execution boundary was used. The separate JavaScript download intentionally contains the function source. Browser source and contracts stay in tab memory until replacement or reload; reload starts fresh. Companion state remains in process memory while retained, and reload can recover its active session. The tool does not overwrite your project files; source downloads are explicitly requested by you.

Before opening a run, **Save or reopen an intake draft** lets you download the form values as `local-pit-crew.draft.json`, including incomplete JavaScript and example text. Select the file and choose **Load draft into form** to replace your intake fields. The draft file contains source and examples. Loading it restores the form only. Open the restored function and run checks when the draft is ready.

Browser checks use the same guest observer and executor as the companion: an 8 MiB interpreter allocation limit, 256 KiB interpreter stack limit and 250 ms cooperative elapsed-time interrupt. A fresh worker has a separate 30-second preparation deadline and two-second execution deadline. Cancellation requests termination of that exact worker. These limits do not impose kernel memory, CPU or process limits on the browser, and the browser API supplies no worker-exit receipt. The app labels this boundary `browser-worker-quickjs` with Docker qualification false.

If the browser verifier fails to start before receiving candidate code, **Retry verification** is available once per run. The current source, reviewed patch and contract stay in place, and the unstarted check slot is restored. A second setup failure, an execution failure or an uncertain termination closes the run without reporting example results. The companion remains available for the separately qualified Docker boundary.
