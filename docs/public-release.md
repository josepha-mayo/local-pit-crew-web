# Public release checks

The contest requires a public repository with an open-source license and functional setup instructions. Keep the repository private until both the source tree and all retained history are ready to share.

Run `npm run audit:public -- --tree-only` to inspect the current tree. Run `npm run audit:public` to also check retained Git history for internal document paths. The audit flags private handoffs, local build outputs, common Firebase credential files, Google and GitHub credential patterns, and non-regular files. It prints paths without printing matched credential values. Run it against the exact clean checkout intended for publication.

Deleting internal documents in a new commit does not erase their older GitHub versions. Preserve a private backup, then either publish a clean snapshot into a new public repository, or deliberately rewrite the intended repository's history and remove obsolete refs with the owner's approval. Check pull-request refs, releases, archives and collaborator clones as applicable before exposing the repository. Do not force-push or change visibility as an incidental build step.

Before release, verify dependency licenses, the lockfile and build reproducibility, actual Firebase/App Check configuration, documented execution boundaries, secret scanning, CI, browser journeys and a working judge-facing app. Remove local configs, runtime logs, private evaluation tasks and model binaries from all published refs. Public Firebase client identifiers are not Admin credentials.

Run both runtime-only and complete dependency audits described in [Security scope and dependency checks](../SECURITY.md). CI gates the runtime graphs; that does not imply the complete build-tool graph has no advisories. Review the documented unresolved build-tool advisory and its reach before publishing, rather than presenting a runtime-only result as a clean full audit.

The demo should identify authored corrections as examples, show actual Firebase runtime use and distinguish public fixture checks from held-out results. Claims of benefit, privacy, offline behavior, isolation or production readiness need their own measured evidence.
