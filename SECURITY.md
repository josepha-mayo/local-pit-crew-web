# Security scope and dependency checks

Local Pit Crew executes bounded JavaScript functions in a QuickJS interpreter. The browser worker boundary is separate from the companion's Docker qualification. Passing examples, a model suggestion and a browser-generated record are not security certification or proof of general correctness. See [function limits](docs/own-function.md) and [the architecture](docs/architecture.md).

## Dependency checks

CI audits the web runtime and the function runner on Windows and Linux. Registry failures and reported runtime vulnerabilities fail those steps; there is no ignored exit code or advisory exemption. Run the same checks locally:

```sh
npm audit --omit=dev --prefix local-pit-crew/web
npm audit --omit=dev --prefix local-pit-crew/runner
```

Also inspect the complete build dependency graph before a release:

```sh
npm audit --prefix local-pit-crew/web
npm audit --prefix local-pit-crew/runner
```

These are registry advisory checks at the time they run, not guarantees that every vulnerability is known. They do not replace source review, interpreter confinement tests, browser verification or checking the deployed files.

## Unresolved build-tool advisory

Reviewed November 17, 2026: the full web dependency audit reports [GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), a denial-of-service issue involving repeated extglob patterns in `picomatch` through 4.0.7. The advisory currently lists no patched release. Our pinned graph reaches `picomatch@4.0.7` through `vite@8.3.8`, including `tinyglobby` and `fdir`; npm reports those four affected package entries for this chain.

This dependency is used during developer/CI builds. The hosted app serves the compiled static files, and its preview server serves that build without starting Vite. User function source and examples enter the bounded interpreter at runtime; the app does not forward them into Vite or accept user-supplied build glob patterns. The committed build configurations use repository-controlled inputs. This reach analysis narrows exposure; it does not fix the vulnerable dependency or make the complete audit pass.

Keep build inputs trusted and do not expose a Vite development server to app users. Track the upstream advisory and review a patched release when available. Do not apply npm's suggested major downgrade or a blanket version override solely to clear the report. A dependency change needs reproducible Firebase/browser builds and the existing execution-boundary checks. The runtime-only audits currently report no known vulnerabilities; the full web audit remains nonzero because of this unresolved build-tool chain.

## Credentials and reports

Keep Admin credentials, CLI credentials, App Check development tokens and private function data out of public reports and repository history. Public Firebase client identifiers do not provide server authorization; retain App Check enforcement, website/API restrictions and reviewed service quotas. See [Firebase setup](docs/firebase-setup.md) and [public release checks](docs/public-release.md).

When reporting a suspected issue, describe the affected version, the execution boundary and the smallest reproducible input using synthetic data. Share sensitive details with the maintainer privately before publishing them. Do not include working credentials or another person's code or examples.
