# Local coder preview

The coder-only preview runs the real installed model without loading Nano first. It supports a bounded patch proposal and explicit in-memory Apply. Verify and Finish stay closed because a generated-code runner has not been qualified. This mode does not establish the Firebase requirement by itself; use the separate Firebase advisor for that part of the product.

Install [Ollama from its official source](https://docs.ollama.com/windows), set `OLLAMA_NO_CLOUD=1` for its daemon, and explicitly download the model you choose. The workbench never pulls a model automatically. A numeric loopback daemon address alone does not prove inference is local. The adapter also rejects remote metadata and requires an affirmative cloud-disabled status response.

Save this configuration at an ignored path such as `coder.local.json`:

```json
{
  "ollama": {
    "model": "qwen2.5-coder:3b",
    "endpoint": "http://127.0.0.1:11434",
    "contextTokens": 4096,
    "maxOutputTokens": 1024,
    "keepAliveSeconds": 30,
    "requestTimeoutMs": 120000,
    "providerTimeoutMs": 120000
  }
}
```

Pin `expectedVersion` and `expectedDigest` after inspecting your actual daemon and selected model metadata. The adapter pins that metadata in its profile and rechecks it before and after inference. It does not infer a universal hardware recommendation from a model name or a single trial.

The default response mode is `"literal-edits"`: the model returns hashes and exact find/replace strings. To try complete-file proposals, add `"responseMode": "file-contents"` to `ollama`. That mode asks for `{ "files": [{ "path": "src/example.js", "content": "complete corrected file" }] }`. The app binds each returned file, unchanged, to the hash and full contents of the captured source snapshot, then uses the same patch validator, preview and explicit Apply action. It accepts only existing writable, nonempty source files within the patch byte limits. It does not repair syntax or invent missing code. The mode has a separate profile policy pin; compare its actual results separately from literal-edit trials. Choosing a response format does not establish better task success.

```sh
npm run start:coder -- --config /absolute/path/to/coder.local.json
```

Open the printed loopback URL, choose a drill and **Use local coder**. **Generate local patch** sends the original task and current fixture evidence to the configured local engine. Review the actual returned edit before applying it. No user repository or generated program is executed.

For a real, explicit smoke check without opening the UI:

```sh
npm run smoke:ollama -- --model qwen2.5-coder:3b
```

The report identifies the selected profile, elapsed generation time, proposal, sampled daemon observation and unverified claims. It never executes the proposal or reports a task as passed. Its timing is a single smoke observation, not a benchmark or a model ranking.

## Verify generated patches

For the full in-memory workflow, supply the full `workbench.local.json` configuration described in [Firebase setup](firebase-setup.md) and a trusted local Linux Docker socket. The setup builds the fixed runner image and runs real kernel/lifecycle qualification before opening the web app. Allow several minutes for setup. Image construction downloads pinned public dependencies; the generated-code jobs have no network.

```sh
npm run start:verified -- --config /absolute/path/to/workbench.local.json --docker-socket /var/run/docker.sock
```

For verified repairs without Firebase, use the Ollama-only `coder.local.json` shown above and append `--coder-only`:

```sh
npm run start:verified -- --config /absolute/path/to/coder.local.json --docker-socket /var/run/docker.sock --coder-only
```

This mode uses deterministic orchestration and requires no Firebase project, App Check provider or Nano preparation. A browser without the native Prompt API can open the local coder. The same trusted build and runtime qualification still run before generated-code verification becomes available. It accepts no caller-supplied qualification receipt, image or bypass flag. A full Firebase configuration also remains valid with `--coder-only`, preserving optional reference-mode opinions. Omit `--coder-only` and supply the full configuration to use Nano repair planning after a generated patch genuinely fails a public check.

One recorded development run used `qwen2.5-coder:7b`, Q4_K_M, Ollama 0.40.16, `file-contents`, a 4096-token context and 1024-token output limit. Its first generated settings patch moved 2/5 to 5/5 public checks and completed Finish. The model digest was `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`. This is a known public drill, not a hardware recommendation, held-out result or measured Nano benefit. Download models explicitly and pin metadata from the daemon you actually use.

On Windows, Docker must be available inside an installed WSL distro, with Node available at `/usr/bin/node` (22 or newer for the sidecar). The Windows companion and browser stay native. Use the socket path inside that distro:

```powershell
npm run start:verified -- --config C:\path\to\workbench.local.json --docker-socket /var/run/docker.sock --wsl-distro Ubuntu-24.04
```

The normal Docker daemon/socket and its permissions are prerequisites; the launcher does not install Docker, start a service or upgrade billing. Development App Check can be enabled explicitly with `--app-check-debug`; an optional `--port` preserves a stable loopback origin and its browser token. Keep development tokens private and out of deployments.

Run `npm run start:verified -- --help` for the supported options without contacting Ollama or Docker. Startup reports which stage failed: command options, configuration, coding-engine preflight, verifier setup or loopback serving. Follow the guidance for that stage; a verifier failure keeps generated-code admission closed. Raw configuration, model-server responses and provider errors are excluded from these messages. The fixed verifier's bounded build/self-test output remains available separately when its build or qualification fails.

Choose **Keep a zero cursor** or **Stop settings leaking**, prepare Nano if using the hybrid mode, then **Use local coder**. Run the baseline, generate a real local patch, inspect the diff, apply it and choose **Verify current source**. The issuer enables these two drills only after building and qualifying their runner. A completed, exact set of current public checks unlocks Finish. The asynchronous search drill remains outside generated-code admission. Interpreter/worker/container limits, exceptions and protocol/cleanup failures remain unavailable outcomes, not invented failed-check feedback for Nano.

The generated candidate runs in QuickJS inside a fresh, resource-limited Linux container. The settings checks exercise multiple calls in one guest context to observe shared defaults, returned-object mutation, retry-object identity, zero retries and explicit timeouts. Each candidate gets a fresh context. Its defaults module is fixed; only the configuration function can be patched. The browser receives no Docker access. These checks do not establish general repository support, model correctness on unseen tasks, Nano benefit or overall production readiness.

After an accepted public verification, the next coder request includes the current workspace hash and each public check's ID and pass/fail result. Both the deterministic and Nano-assisted modes receive this same feedback. Applying another patch clears the feedback until that source is verified. Held-out cases, expected answers and final grades are excluded. This protocol changes the coder profile pin; earlier trials remain separate from measurements using this version.

Both modes also retain the full current task-file context. Nano's source citations explain its advice without removing imported dependencies from the coder request. Each file appears once with its current contents and hash, even after repeated reads; editable paths remain restricted to the task's original writable list.

The full hybrid workbench uses source-line repair advice. Nano receives numbered current sources and lines, then selects a source/line and supplies the suspected cause and change to try. The app binds that selection to the exact captured line, evidence ID and failed revision; it does not invent a semantic correction. The five reply fields are `needsMoreEvidence`, `sourceNumber`, `lineNumber`, `cause` and `change`. Invalid, blank, stale or oversized selections are rejected. Nano is invoked after an applied generated patch fails public checks and does not choose routine workflow actions. The standalone advisor and default adapter preparation retain the separate verbatim-quotation format; measurements from the two formats must remain separate.

The bench shows bounded browser-planner failure categories, such as a source quotation mismatch or a generation failure. These categories also appear in the run record. Raw provider errors, source text and connection tokens are excluded. A failed planner stops the owning run; it does not trigger a retry or a cloud fallback. Each new patch proposal requires its own review, even after an earlier proposal was applied.
