import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{execFileSync}from'node:child_process';import{pathToFileURL}from'node:url';

export function checkedPath(root,file,texture=true){
 root=path.resolve(root);file=path.resolve(file);const rel=path.relative(root,file);
 if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||(texture&&path.extname(file).toLowerCase()!=='.texture'))throw Error('File outside intended texture directory');
 for(let p=file;;p=path.dirname(p)){const st=fs.lstatSync(p);if(st.isSymbolicLink())throw Error('Linked/junction paths are unsupported');if(p.toLowerCase()===root.toLowerCase())break;}
 if(!fs.lstatSync(file).isFile())throw Error('Expected regular file');return file;
}
export async function hashFile(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file,{highWaterMark:4*1024*1024}))h.update(chunk);return h.digest('hex');}
export async function deduplicateGroup(root,group,record=()=>{},guard=()=>{}){
 const canonical=checkedPath(root,group.files[0]),expected=group.sha256;
 guard();if(await hashFile(canonical)!==expected)throw Error('Canonical content changed since audit');const base=fs.statSync(canonical);
 let linked=0,reclaimedBytes=0;
 for(const candidate of group.files.slice(1)){
  guard();const target=checkedPath(root,candidate),before=fs.statSync(target);
  if(before.dev!==base.dev)throw Error('Hard links require the same volume');
  if(before.ino===base.ino)continue;
  const targetCid=checkedPath(root,target+'.cid',false),canonicalCid=checkedPath(root,canonical+'.cid',false),cid=fs.readFileSync(targetCid),sourceCid=fs.readFileSync(canonicalCid);
  if(before.size!==base.size||await hashFile(target)!==expected)throw Error('Duplicate content changed since audit');
  const now=fs.statSync(target);if(now.ino!==before.ino||now.size!==before.size||now.mtimeMs!==before.mtimeMs)throw Error('Target changed during verification');
  if(fs.statSync(canonical).nlink>=1000)throw Error('Conservative NTFS hard-link limit reached');
  const temp=target+'.cw-link-'+crypto.randomUUID();
  // Link first, then atomically replace the verified duplicate. No data gap,
  // no changed .cid, and no arbitrary asset deletion or reference rewriting.
  record({phase:'before',canonical,target,sha256:expected,bytes:before.size,cidSha256:crypto.createHash('sha256').update(cid).digest('hex')});
  fs.linkSync(canonical,temp);
  try{
   guard();fs.renameSync(temp,target);
  }catch(error){if(fs.existsSync(temp))fs.unlinkSync(temp);throw error;}
  const after=fs.statSync(target);
  if(after.ino!==base.ino||after.dev!==base.dev||!fs.readFileSync(targetCid).equals(cid)||!fs.readFileSync(canonicalCid).equals(sourceCid))throw Error('Hard-link or asset identity verification failed');
  linked++;if(before.nlink===1)reclaimedBytes+=before.size;
  record({phase:'after',canonical,target,sha256:expected,bytes:before.size});
 }
 return{linked,reclaimedBytes};
}
function gameClosed(){execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if (Get-Process Cities2 -ErrorAction SilentlyContinue) { exit 42 }; exit 0"],{stdio:'pipe'});}
async function main(){
 const inventory=JSON.parse(fs.readFileSync('artifacts/imported-storage-inventory.json')),report=JSON.parse(fs.readFileSync('artifacts/imported-storage-duplicates.json')).report;
 const intended='C:/Users/sc/AppData/LocalLow/Colossal Order/Cities Skylines II/ImportedData/CityWeaver',root=path.resolve(inventory.report.target);
 if(root.toLowerCase()!==path.resolve(intended).toLowerCase())throw Error('Unexpected cleanup root');
 for(const group of report.duplicates)for(const file of group.files)checkedPath(root,file);
 const summary={root,duplicateGroups:report.duplicates.length,potentialBytes:report.redundantBytes,mode:process.argv.includes('--apply')?'apply':'plan'};
 if(summary.mode==='plan'){fs.writeFileSync('artifacts/route-texture-dedup-plan.json',JSON.stringify({summary,groups:report.duplicates},null,2));console.log(JSON.stringify(summary));return;}
 gameClosed();const journal='artifacts/route-texture-dedup-journal.jsonl';let checks=0,linked=0,reclaimedBytes=0;
 // Recheck every 20 files as well as before each group. The real write pass
 // always rehashes file contents; a stale inventory cannot authorize a link.
 const guard=()=>{if(checks++%20===0)gameClosed();};
 for(const group of report.duplicates){gameClosed();const r=await deduplicateGroup(root,group,item=>fs.appendFileSync(journal,JSON.stringify({...item,at:new Date().toISOString()})+'\n'),guard);linked+=r.linked;reclaimedBytes+=r.reclaimedBytes;console.log(JSON.stringify({linked,reclaimedGiB:reclaimedBytes/2**30}));}
 const result={...summary,linked,reclaimedBytes,at:new Date().toISOString(),journal};fs.writeFileSync('artifacts/route-texture-dedup-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
