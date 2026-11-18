'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {inputs,hash}=require('../src/firebase-bundle.cjs');
const root=path.join(__dirname,'..'),web=path.join(root,'web');
const built=spawnSync(process.execPath,[path.join(web,'node_modules/vite/bin/vite.js'),'build','--config','vite.config.mjs'],{cwd:web,stdio:'inherit',env:process.env});
if(built.status!==0)process.exit(built.status??1);
const bytes=fs.readFileSync(path.join(web,'dist/firebase-planner.mjs'));
if(/(?:^|\n)\s*import\s/.test(bytes.toString('utf8')))throw Error('Browser bundle contains external imports.');
const manifest={schema:'local-pit-crew/firebase-bundle/v1',firebase:'13.3.0',ai:'3.1.0',sha256:hash(bytes),
 inputs:Object.fromEntries(inputs.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]))};
fs.writeFileSync(path.join(root,'ui/public/firebase-planner.mjs'),bytes);
fs.writeFileSync(path.join(root,'ui/public/firebase-bundle.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Firebase browser asset and source manifest updated:',manifest.sha256);
