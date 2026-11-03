import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{checkedPath,deduplicateGroup,hashFile}from'../../tools/deduplicate-route-textures.mjs';
test('dedup atomically shares identical texture bytes while retaining paths and distinct asset IDs; rejects stale/outside data',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cw-link-test-'));
 try{
  const a=path.join(root,'a.Texture'),b=path.join(root,'b.Texture'),c=path.join(root,'changed.Texture');
  for(const p of[a,b,c]){fs.writeFileSync(p,Buffer.alloc(16384,37));fs.writeFileSync(p+'.cid',path.basename(p));}
  const hash=await hashFile(a),cid=fs.readFileSync(b+'.cid'),original=fs.statSync(b).ino;
  assert.notEqual(fs.statSync(a).ino,original);const r=await deduplicateGroup(root,{sha256:hash,files:[a,b]});assert.equal(r.linked,1);assert.equal(r.reclaimedBytes,16384);
  assert.equal(fs.statSync(a).ino,fs.statSync(b).ino);assert.equal(await hashFile(b),hash);assert(fs.readFileSync(b+'.cid').equals(cid));assert.notDeepEqual(fs.readFileSync(a+'.cid'),cid);
  assert.equal((await deduplicateGroup(root,{sha256:hash,files:[a,b]})).linked,0);
  fs.writeFileSync(c,'changed');await assert.rejects(deduplicateGroup(root,{sha256:hash,files:[a,c]}));assert.equal(fs.readFileSync(c,'utf8'),'changed');
  assert.throws(()=>checkedPath(root,path.join(root,'..','outside.Texture')));assert.throws(()=>checkedPath(root,b+'.cid'));
  const blocked=path.join(root,'blocked.Texture');fs.writeFileSync(blocked,Buffer.alloc(16384,37));fs.writeFileSync(blocked+'.cid','blocked');
  await assert.rejects(deduplicateGroup(root,{sha256:hash,files:[a,blocked]},()=>{},()=>{throw Error('game running');}));assert.notEqual(fs.statSync(blocked).ino,fs.statSync(a).ino);
  assert.equal(fs.readdirSync(root).filter(n=>n.includes('.cw-link-')).length,0);
 }finally{const absolute=path.resolve(root);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(absolute,{recursive:true,force:true});}
});
