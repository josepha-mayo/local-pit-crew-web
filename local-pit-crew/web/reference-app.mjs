import workflowModule from '../src/reference-workflow.cjs';
import catalogModule from '../src/reference-catalog.cjs';
import {runAuthoredBrowserChecks} from 'virtual:authored-reference-programs';
import {createReferenceTransport} from './reference-transport.mjs';
import {referenceAssert} from './reference-assert.mjs';
import {createBrowserFunctionVerifier} from './function-verifier.mjs';
import {createBrowserFunctionWorkbench} from './function-workbench.mjs';
import {bindOfflineCopy} from './offline-client.mjs';
const {getTasks}=catalogModule.createCatalog(referenceAssert);
export {runAuthoredBrowserChecks};
export async function createBrowserReferenceApp(firebaseConfig=null,{firebaseConfigured=!!firebaseConfig,cancelInterpreterPreload}={}){
 const reference=await workflowModule.createReferenceWorkflow({definitions:getTasks(),executeChecks:runAuthoredBrowserChecks});
 const verifier=createBrowserFunctionVerifier(globalThis,undefined,cancelInterpreterPreload);
 const workflow=createBrowserFunctionWorkbench({reference,verifier});
 globalThis.addEventListener?.('pagehide',()=>workflow.close(),{once:true});
 return createReferenceTransport({workflow,firebaseConfig,firebaseConfigured,functionWorkbench:true});
}
export async function startBrowserReferenceApp({cancelInterpreterPreload}={}){
 const firebaseConfigured=document.querySelector('meta[name="local-pit-crew-firebase"]')?.content==='configured';
 const appPath=document.querySelector('meta[name="local-pit-crew-app"]')?.content;
 if(!/^\/app-[a-f0-9]{16}\.js$/.test(appPath))throw Error('Missing built app entry');
 globalThis.LocalPitCrewReferenceRequest=await createBrowserReferenceApp(null,{firebaseConfigured,cancelInterpreterPreload});
 // Keep the shared browser entry unwrapped: its CommonJS export branch is for
 // Node tests only and must not be selected by a bundler-generated module shim.
 await import(/* @vite-ignore */ appPath);
 bindOfflineCopy();
}
