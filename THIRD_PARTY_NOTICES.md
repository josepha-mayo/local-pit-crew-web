# Third-party notices

The bundled browser asset contains Firebase JavaScript SDK components, licensed under Apache-2.0 by Google LLC and contributors. Both browser builds explicitly preserve upstream license comments during minification. Those copyright/license notices are part of the distribution; the static build also includes the full license texts in `LICENSES.txt`. Source: https://github.com/firebase/firebase-js-sdk . Exact dependency versions and integrity values are in `local-pit-crew/web/package-lock.json`.

Vite and its build dependencies are development tools. Their individual licenses are included in their installed packages; the lockfile identifies the build dependency graph. Source: https://github.com/vitejs/vite .

Ollama and any locally downloaded coding model are separate installations and are not distributed in this repository. Review the chosen model's own license before its use or redistribution.

The optional runner uses quickjs-emscripten and the QuickJS interpreter, licensed under MIT. Exact package and WASM dependency versions are in `local-pit-crew/runner/package-lock.json`; installed packages include their license texts. Source: https://github.com/justjake/quickjs-emscripten .

The static reference bench uses @noble/hashes 2.4.0 for synchronous SHA-256 source hashes in the browser. It is licensed under MIT, copyright (c) 2022 Paul Miller (https://paulmillr.com). Its full license is included in the built site's `LICENSES.txt`. Source: https://github.com/paulmillr/noble-hashes .
