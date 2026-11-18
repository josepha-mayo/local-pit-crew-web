// Real browser SDK entry. Not imported/executed by authored reference tests.
// Bundling/serving this entry and running it require separately approved runtime resources.
import {initializeApp,deleteApp,getApps,SDK_VERSION} from 'firebase/app';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'firebase/app-check';
import {getAI,GoogleAIBackend,getGenerativeModel,InferenceMode,InferenceSource} from 'firebase/ai';
import localClientModule from '../src/firebase-local-client.cjs';
import {createFirebasePlannerCore} from './firebase-planner-core.mjs';
import {createFirebaseCloudReviewerCore} from './firebase-cloud-review-core.mjs';
import {createFirebaseFunctionDrafterCore} from './firebase-function-draft-core.mjs';
export function createFirebaseFunctionDrafter(config){
 return createFirebaseFunctionDrafterCore({
  sdk:{initializeApp,deleteApp,getApps,SDK_VERSION,initializeAppCheck,ReCaptchaEnterpriseProvider,
   getAI,GoogleAIBackend,getGenerativeModel,InferenceMode,InferenceSource},config,environment:globalThis
 });
}
export function createFirebaseCloudReviewer(config){
 return createFirebaseCloudReviewerCore({
  sdk:{initializeApp,deleteApp,getApps,SDK_VERSION,initializeAppCheck,ReCaptchaEnterpriseProvider,
   getAI,GoogleAIBackend,getGenerativeModel,InferenceMode,InferenceSource},config,environment:globalThis
 });
}
export function createFirebasePlanner(config){
 return createFirebasePlannerCore({
  sdk:{initializeApp,deleteApp,getApps,SDK_VERSION,initializeAppCheck,ReCaptchaEnterpriseProvider,
   getAI,GoogleAIBackend,getGenerativeModel,InferenceMode,InferenceSource},
  localClientModule,config,environment:globalThis
 });
}
