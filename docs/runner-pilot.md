# Confined JavaScript runner pilot

The raw probe is an executable experiment and does not issue app admission. An explicit trusted setup can build and qualify its Docker wrapper before enabling pagination, settings isolation and JSON function public checks in the app. Pagination accepts exactly `src/list.js` and the unchanged catalog adapter. Settings isolation accepts exactly `src/config.js` and its unchanged defaults module. The function profile accepts exactly `src/function.js` and a validated, read-only `contract.json`; see [function setup and limits](own-function.md). All other file sets and suites are rejected.

The settings runner observes actual cross-call behavior and primitive results inside QuickJS. It captures its scenario functions before loading candidate code, keeps expected values in the outside grader, and uses a new guest context for every candidate. This detects mutation of shared defaults and aliased retry objects; no returned success flag can replace those observations. The private-input observation matrix currently supports only pagination.

The function profile captures a pristine data observer before candidate initialization. Only JSON invocation arguments enter the guest. Bounded return data and arguments after the call are serialized using captured intrinsics; expected values remain in the outside grader. A correct return with changed inputs fails its example. A normal function exception fails that example without exposing the error text; interpreter, worker or resource failure makes verification unavailable. The function and immutable contract hashes bind every public verdict. Examples are developer-provided public feedback, not held-out grading.

```sh
npm ci --ignore-scripts --prefix local-pit-crew/runner
npm run test:runner
npm run probe:local-patch -- --smoke-record /absolute/path/to/ollama-smoke.json
```

The probe command reads a supplied smoke record, validates its bounded exact edit, and runs both the baseline and candidate. It makes no new inference request. The record's provenance is supplied evidence, not independently attested model identity. The report identifies wrapper and interpreter/WASM hashes, actual typed observations, public check results, cleanup and remaining qualification gaps.

## Implemented boundary

Each probe creates a fresh Node worker and QuickJS/WASM instance. Candidate strings are compiled only inside QuickJS. No guest-to-Node function bridge, stdout, network, filesystem or process API is installed. The only supplied CommonJS import resolves the immutable adapter inside the guest realm. The host holds the actual exported function handle, invokes it and reads bounded primitive observations. Expected values remain outside the guest. A captured intrinsic checks own-property presence even if the candidate poisons global prototypes. No guest object is dumped, stringified or coerced in Node.

The fixed policy requests an 8 MiB QuickJS allocation limit, a 256 KiB interpreter stack limit, an elapsed-time interrupt after 250 ms of interpreter setup/execution, and an outside 2-second worker watchdog. The interrupt is cooperative and is not metered OS CPU time. Worker V8 heap/stack limits do not bound total process or WASM memory. Cancellation terminates the exact owned worker. The parent waits for its exit before returning an observation. Concurrent probes are refused rather than accumulated in an unbounded queue.

The parent prepares only the pinned interpreter's immutable WebAssembly module before creating the candidate worker. The worker instantiates fresh memory, runtime and context for every candidate; it does not share mutable guest state. Input is captured before this preparation wait, and cancellation is checked again before creating a worker. The two-second worker budget is unchanged. In Docker, trusted preparation also remains inside the unchanged five-second PID 1 deadline and kernel limits.

Six complete, typed observations are required for public check results. Syntax errors, exceptions, interpreter limits, worker failure, protocol problems and cleanup uncertainty do not become six fabricated failed checks or Nano repair feedback. Error strings and conversion hooks from the guest are never grading authority. Zero, negative zero, empty text, null, undefined and own-property presence remain distinct.

The primitive codec captures pristine JSON parsing and stringifying functions before candidate loading. Only primitive strings use that codec; arbitrary objects and conversion hooks are never serialized. This preserves embedded NULs and unpaired UTF-16 surrogates in both directions and distinguishes null from objects. A NUL-prefixed string cannot impersonate an empty string in a public check. The codec is included in the runner source fingerprints and curated Docker build.

## What the tests establish

The tests actually execute QuickJS. They reproduce the authored baseline/correction, exercise the closed capability surface, verify the HTTP canary remains untouched, and test intrinsic poisoning, inherited properties, negative zero, cyclic values, conversion hooks, loops, getters, proxies, allocation floods, recursion, forbidden imports, oversized observations, cancellation and restart after failure.

This does not establish resistance to an interpreter vulnerability, OS process/VM confinement, hard total-memory/swap/PID/CPU limits, or a fully isolated native job lifecycle after controller-process failure. Those remain production qualification requirements. No production admission capability is issued from a hash, a passing test, a callback or this report. Public fixture success also does not establish held-out correctness or a Nano benefit.

## Docker boundary experiment

`local-pit-crew/runner/Dockerfile` adds an outer Linux container boundary with a pinned Node base image and lockfile. The host transport accepts only a trusted, root-owned local Unix socket and an immutable image ID. It creates a fresh container without host mounts or a network, with a read-only root, private PID/cgroup/IPC namespaces, default seccomp, no new privileges, a 192 MiB memory limit, zero additional swap, one CPU quota, 32 tasks and a bounded temporary filesystem. It never exposes the Docker API to the browser or candidate.

A fixed PID 1 uses only SETUID/SETGID to launch the job as UID/GID 10001 with no effective or permitted capabilities. PID 1 does not parse candidate input or output and has its own five-second deadline. Its different UID prevents an unprivileged native child from stopping the watchdog. Exiting PID 1 terminates the PID namespace, including orphaned and stopped descendants. Candidate JavaScript still runs inside QuickJS; a trusted qualification mode separately exercises native-child faults to test the outer boundary.

The outside transport grades typed observations independently, checks the actual container configuration, monitors exit, limits output, and confirms removal of the exact owned container. Cleanup uncertainty quarantines that transport instead of admitting another job. Docker control requests have separate startup deadlines; those are not the five-second in-container execution limit.

The transport attaches stdin and output before starting the container. A slow Docker start response therefore cannot withhold input while the independent watchdog is already running. A real-engine regression holds that response for 6.5 seconds and still requires the correct candidate's observed checks and confirmed cleanup; the five-second watchdog and all resource limits stay unchanged. This follows the attach-before-start ordering used by the [Docker CLI](https://github.com/docker/cli/blob/master/cli/command/container/start.go).

Run the optional real-engine suite from Linux/WSL with Node 24 and Docker, after building the image yourself:

```sh
docker build --tag local-pit-crew-runner:local local-pit-crew/runner
export PITCREW_DOCKER_SOCKET=/var/run/docker.sock
export PITCREW_DOCKER_IMAGE="$(docker image inspect local-pit-crew-runner:local --format '{{.Id}}')"
npm run test:runner:docker
```

Use an efficient copy-on-write Docker storage driver. A VFS-based development daemon incurred startup/cleanup timeouts on the test machine. The integration suite exercises real baseline/correction behavior, guest attacks, an outside host-file sentinel, a positively tested network canary, CPU/memory/PID faults, stopped children, cancellation, competing requests, and controller SIGKILL followed by independent namespace cleanup. It makes no inference requests and uses no paid service.

The raw probe remains separate from app admission. The verified launcher builds its own curated image and runs this suite before the private issuer recognizes that exact registration. It accepts no caller-provided image, proof file, callback or skip-qualification flag. Passing the suite is evidence for the tested image/kernel/configuration, not proof against every kernel/interpreter vulnerability, qualification of another image, held-out correctness, or an improvement from Nano.

If image construction or qualification fails, the operator console retains at most 48 kB of output from the curated build or fixed self-tests. Windows forwards this setup diagnostic before admission. Candidate runs, provider output and connection configuration are excluded from this log path; the browser still receives a bounded unavailable outcome.

`npm run test:runner:admission` additionally tests the real issuer, rejects copied/proxied registrations, and drives the ordinary app controller through baseline → authored delegate proposal → apply → isolated verification → finish. The delegate is explicit test data, not model inference. CI runs this real-Docker suite on Linux alongside the separate Windows/Linux core and interpreter checks.

## Independent final observations

Before collecting model results, run an authored correct control against the complete final-input matrix and compare its observations with an independent oracle. A correct control must pass every case. Preserve original records if an observation defect is discovered after selection. Replaying unchanged selected sources through a repaired observer is a labeled diagnostic, not a new frozen confirmation experiment; do not silently replace the original result.

The experimental matrix runner uses a separate QuickJS harness for bounded primitive cursor/limit inputs. Its instructions contain no expected answers or executable grading code. It returns typed facts for an outside evaluator, including false, negative zero, NaN and Unicode. The evaluator can retain unseen cases and expectations privately, select a final workspace using public feedback only, and then grade that exact workspace without returning final-grade feedback to the coding agent.

Matrix instructions are not accepted by the app's public-verdict protocol or trusted registration. They do not mint admission, supply public check booleans or establish model benefit. The same container resource/lifecycle policy applies; adversarial and real-engine tests exercise this observation path separately. Evaluation inputs, budgets, selection policy, schedule and source fingerprints must be frozen before inference, and all attempts and unavailable outcomes must be retained.
