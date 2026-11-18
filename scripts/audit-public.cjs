'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),treeOnly=process.argv.includes('--tree-only');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
const privatePath=file=>/(?:^|\/)(?:START_HERE_LOCAL_CODEX\.md|BACKUP_MANIFEST\.json|(?:[^/]*handoff[^/]*\.md)|[^/]*baseline-\d{8}\.json)$/i.test(file)||
 /(?:^|\/)(?:private|handoffs|outputs|work|\.firebase|compile-check-\d{8}|compile-response-\d{8})\//i.test(file)||
 /(?:^|\/)(?:\.firebaserc|[^/]*firebase-adminsdk[^/]*\.json|[^/]*service[-_]account[^/]*\.json)$/i.test(file)||
 /(?:\.local\.(?:json|md)|firebase-planner-previous-\d{8}\.mjs)$/.test(file)||/(?:^|\/)\.env(?:$|\.(?!example$))/.test(file);
const secrets=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{60,}/,
 /AIza[A-Za-z0-9_-]{35}/,/ya29\.[A-Za-z0-9_-]{45,}/,/1\/\/[A-Za-z0-9_-]{40,}/,/GOCSPX-[A-Za-z0-9_-]{22,}/,
 /FIREBASE_APPCHECK_DEBUG_TOKEN\s*[:=]\s*['"][a-f0-9-]{36}['"]/i];
const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))];
const issues=[];
for(const file of files){
 const local=path.join(root,file),info=fs.lstatSync(local,{throwIfNoEntry:false});
 if(!info)continue;
 if(privatePath(file))issues.push('Internal/local material in tree: '+file);
 if(!info.isFile()){issues.push('Review non-regular file: '+file);continue;}
 if(info.size>2*1024*1024){issues.push('Review large file: '+file);continue;}
 const bytes=fs.readFileSync(local);
 if(secrets.some(pattern=>pattern.test(bytes.toString('utf8'))))issues.push('Possible credential in '+file+' (value withheld)');
}
if(!treeOnly){
 const history=[...new Set(git(['log','--all','--format=','--name-only']).split(/\r?\n/).filter(privatePath))];
 if(history.length)issues.push('Retained history contains '+history.length+' internal/local material paths. Keep private until a clean publication history is approved.');
}
for(const issue of issues)console.error(issue);
console.log(issues.length?'Public release audit: blocked.':'Public release audit: checked '+files.length+' paths'+(treeOnly?' in current tree.':' and retained path history.'));
process.exitCode=issues.length?1:0;
