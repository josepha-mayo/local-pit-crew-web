# Static web demo

The repair bench runs authored drills and small user functions in a browser tab. Judges need no Node, Ollama or Docker installation to try them or review pasted repairs. The optional Firebase advisor and cloud reviewer use the same pinned SDK adapter as the companion. A companion is still required for actual local coding-model generation and Docker-qualified checks.

Build without Firebase to try the deterministic reference workflow:

```sh
npm ci --ignore-scripts --prefix local-pit-crew/web
npm run build:firebase
npm run build:web
npm run test:web
npm run preview:web
```

Open the numeric loopback URL printed by the preview. The preview checks the build manifest before serving the files. It has no task mutation HTTP endpoints: the UI calls an explicit in-memory transport in the tab. Reloading or leaving the page ends that tab's run. Back or Forward reopens a fresh bench when the browser restores a cached page. The original Node companion retains its loopback Host, Origin and session-token checks.

Vite and its transitive `picomatch` dependency are used during the build. The browser preview does not run Vite, and the app never passes user input to its build-time glob matcher. The current published `picomatch` release is affected by [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

Choose **Try a failing function** to open the supplied tag-normalization function, run its five fixed examples and read the current function and contract. The baseline passes three examples and exposes the other two failures. No patch is loaded and no model is called. **Bring my function** opens the import form, and trying the supplied example preserves any draft already in that form. The active workbench appears once a run has opened. Close stops the remaining inspection steps.

At narrower widths, **First failing example** shows the result near the start of the run. **Inspect input and result** moves focus to the full check, including its inputs, expected return and observed result.

If a function changes its arguments, the check shows the first differing input path and its before and after values. Expand **View full arguments** to inspect the whole change. For example, the checkout baseline puts a different quote ID at the first position.

**Try the checkout repair** opens a shipping quote selector that skips a free rate and sorts the caller’s input in place. Choose **Fill recorded Gemini patch**, review the diff, apply it and verify to go from 3/4 to 4/4. **Try a new counterexample** opens the challenge form and focuses **Fill the safe-integer counterexample**. Review the example, start the extended run and execute its baseline. The recorded patch fails at 4/5 because it accepts a price outside JavaScript’s safe integer range. **Fill reviewed safe-integer fix** supplies the one-line correction for review and a fresh 5/5 check. The recorded patch came from a real Firebase AI Logic request on the public examples. The walkthrough makes zero model calls and always reruns the source against the examples.

[Open the checkout failure directly](https://local-pit-crew.web.app/#checkout-repair) to start at the fresh 3/4 baseline. Opening the link runs the synthetic checks in the tab.

After a failing check, expand **Keep a reproducible bug report** under **The checks**. **Download failure replay** keeps the tested source, requirements and fixed examples together. A teammate can open the file with **Reopen a saved replay case** or run `npm run replay:function -- PATH.replay.json` to reproduce the result. The file contains the source and example values. The separate default evidence record contains hashes and results.

The landing page explains the three distinct roles before a run opens: optional on-device diagnosis, explicitly reviewed cloud patch requests and independent execution of the user's examples. It describes browser/model requirements and the limits of passing examples alongside the workflow. Reading that explanation does not initialize a model or send a cloud request.

Cloud previews show the task data first. The patch preview identifies fixed examples and observations. A second opinion identifies source evidence and failed check IDs, and a request for a new example identifies the checked function and its existing examples. The preview says when the Nano hypothesis is included. Expand the complete prompt to inspect the identical request that Send would transmit, including its model instructions.

To evaluate both modes on the [hosted demo](https://local-pit-crew.web.app/), open the failing function in supported desktop Chrome. Choose **Open model setup → Check on-device model**. Once it reports available, choose **Ask Nano about this failure**. When the check reports the model is unavailable or needs setup, the advice card explains what to do and leaves the cloud controls available. The advice card reports the SDK inference source. Choose **Review second opinion with Nano hypothesis** only if you want the cloud model to critique it. Inspect the full prompt, then send it and compare the two opinions against the fixed examples. The standard **Review cloud payload** leaves the local hypothesis out. The evidence export records whether the accepted second opinion included it. See the [model generation checks](firebase-setup.md#verify-the-installed-model-generation) for evidence beyond SDK-reported inference location.

After opening the tag example, **Fill authored first patch** puts an example replacement in the editor. Review, Apply and verify it to reach five passing examples. Under **Your checked function**, expand **Challenge with another example** and choose **Try tab padding on a duplicate**. The bench derives an editable test from an existing example where a duplicate was omitted. Review whether the expected return should stay the same, then start the extended run and verify again. The new example fails because the first patch trims spaces but leaves tabs. **Fill authored whitespace fix** supplies the second replacement for review. Apply and verify it to reach six passing examples with the same extended contract. The entire sequence runs without a model call, and the checked replay can rerun those six examples in CI.

With an open passing function run and space for one more example, **Look for a missed case** can also ask Gemini for a new test. **Review request for a new example** shows the exact checked function, requirements and existing examples before sending. If Gemini returns a valid new argument list, **Fill example for review** places the proposal in the editable challenge form. Check its expected return against your requirements, then start an extended run and execute the baseline locally. A proposal by itself leaves the passing run and its contract intact.

For a local boundary test, open **Challenge with another example → Try an integer boundary**. Choose a nonnegative integer from a passing example and fill the boundary arguments. The bench copies the original arguments, changes only that value to `9007199254740992`, and leaves the expected return blank for you to define. It makes no model request.

For keyboard use, the first Tab reaches **Skip to repair actions**. Enter moves focus to the entry actions. The next Tab reaches **Try the checkout repair**, which Enter activates. Opening the example moves focus to the active run. Continue with Tab through the next action, file reads and native detail controls. Enter expands or collapses a focused summary. The entry actions have a 44-pixel minimum height and focused controls scroll clear of the sticky guidance bar.

For the authored drills, expand **Practice with guided repair drills**, choose a drill and select **Inspect failure**. The bench opens its authored baseline, runs the public checks and reads the current source, then leaves the evidence open for inspection. It loads no correction and makes no model call. Nano advice, cloud payload review and the authored example patch remain separate choices. **Open reference** keeps the manual workflow available.

For the pagination drill, optionally choose **Load authored regression trap**, review it, apply it in memory and run its checks. The total remains 4/6: zero and empty-string checks are repaired while the previously passing null and undefined checks regress. The comparison panel identifies those changes against the previous checked source. **Load authored correction** then offers a separate diff and apply before the final 6/6 run. Finish remains blocked while any public check fails. The two-patch, three-check-run path stays within the existing controller limits, uses no AI, and appears in the source-free run record. Repeated reference checks are disabled until the source changes; reopening starts a fresh run.

For a Firebase-enabled build, use the public web configuration described in [Firebase setup](firebase-setup.md):

```sh
npm run build:web -- --config /absolute/path/to/browser.local.json
npm run preview:web
```

Only `firebaseConfig` is copied into `firebase-config.json`; there are no Admin credentials, CLI credentials or App Check development tokens in the static artifact. The build also creates the configured CSP and response headers. The hosted entry never enables App Check debug mode. Use a web provider whose allowed domains include the intended hosting domain, retain App Check enforcement and verify a genuine deployed request before presenting the hosted Firebase path as working.

Deploy the built `local-pit-crew/web/site-dist` directory with its response headers. For an already authorized Firebase Hosting project, the build includes a `firebase.json` whose public directory is the build directory itself:

```sh
firebase deploy --only hosting --project YOUR_PROJECT_ID --config local-pit-crew/web/site-dist/firebase.json
```

This build does not create projects, accept agreements, change billing or deploy automatically. The `_headers` file supports static hosts that recognize that convention. Other hosts must apply the same values from `hosting-headers.json`.

The reference checker still compiles only the immutable authored baseline, correction and optional regression-trap programs during the build. It creates fresh module state for each check run and refuses arbitrary program selectors. A separate function path accepts one bounded CommonJS export and fixed JSON examples. Candidate text enters only QuickJS inside a fresh fixed application worker, never the page's JavaScript evaluator. Expected answers stay outside the guest. Return data and input preservation are independently regraded against the exact source and contract. See [function limits and boundary differences](own-function.md).

The worker has bounded preparation/execution waits and an interpreter interrupt, allocation limit and stack limit. Stop terminates its owned worker; late observations cannot restore a closed or replaced run. Its record explicitly reports `browser-worker-quickjs` with qualification false. Browser checks do not claim the companion's kernel/Docker confinement, total browser memory limits, worker-exit confirmation or server attestation. The build allows same-origin workers and trusted WebAssembly compilation with `wasm-unsafe-eval`; JavaScript `unsafe-eval` remains forbidden. The pinned interpreter is one separate 503 kB asset, loaded only when a function check is requested, rather than duplicated in JavaScript bundles.

Fingerprinted startup files, the interpreter and workers receive long-lived immutable caching. The HTML references the build's exact startup files. Firebase Hosting, the `_headers` export and the local preview use the same explicit asset list and cache policy. HTML, the optional Firebase adapter and configuration, and the build manifest retain `no-store`. If the startup module cannot load after a deployment, **Reload the bench** fetches the current page and its files. The Content Security Policy permits the exact startup script by its SHA-256 digest. Each verification still creates and terminates its own worker. The preview serves the exact `application/wasm` MIME type, and its HTTP cache receives only published assets.

Opening the bench and running local checks leave the Firebase client unloaded. For offline diagnosis, open **Runtime & setup** and select **Check on-device model** while connected. When Chrome reports the model available, the bench loads the public Firebase configuration and client. Keep the tab open and select **Ask Nano about this failure** to run the diagnosis, including after disconnecting. The separate cloud clients use App Check when you approve a cloud request. If setup takes longer than Chrome's user activation window, the app asks for another click before starting Nano.

A literal-source citation can ground a model's hypothesis without making the hypothesis correct. Passing examples and browser-generated run records do not establish held-out correctness or model repair accuracy.

The static test suite compares every named program's outcomes against the Node runner, repeats state-sensitive cases, checks UTF-8 hash parity, exercises the complete authored workflow including the trap and correction, rejects arbitrary program selectors and checks the served artifact and headers. Real browser/Firebase testing remains a separate release check.
