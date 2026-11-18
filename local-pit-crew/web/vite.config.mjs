// Reproducible browser-only library build. Source maps stay out of the served app.
import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),
 cacheDir:fileURLToPath(new URL('./.vite-cache',import.meta.url)),
 resolve:{conditions:['browser','import','default']},
 build:{
  rolldownOptions:{output:{comments:{legal:true}}},
  lib:{entry:fileURLToPath(new URL('./firebase-planner.mjs',import.meta.url)),formats:['es'],fileName:()=> 'firebase-planner.mjs'},
  outDir:fileURLToPath(new URL('./dist',import.meta.url)),emptyOutDir:false,sourcemap:false
 }
 // Vite8 commonjsOptions is documented as a no-op; no reliance on it.
});
