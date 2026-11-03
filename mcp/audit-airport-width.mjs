import fs from 'node:fs';import {execFileSync} from 'node:child_process';
function q(n,a){const r=JSON.parse(execFileSync(process.execPath,['mcp/query.mjs',n,JSON.stringify(a)],{encoding:'utf8',maxBuffer:16e6}));if(!r.ok)throw Error(JSON.stringify(r));return r;}
const version=process.argv[2]??'13659';
const source=JSON.parse(fs.readFileSync('artifacts/heliport-width-world-'+version+'.json'));
const defs=JSON.parse(fs.readFileSync('artifacts/heliport-width-components-'+version+'.json')).prefab.data.components['Game.Prefabs.SubNet'].items;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function local(v,t){const p={x:v.x-t.m_Position.x,y:v.y-t.m_Position.y,z:v.z-t.m_Position.z};const r=t.m_Rotation.value??t.m_Rotation;const x=-r.x,y=-r.y,z=-r.z,w=r.w;const tx=2*(y*p.z-z*p.y),ty=2*(z*p.x-x*p.z),tz=2*(x*p.y-y*p.x);return{x:p.x+w*tx+y*tz-z*ty,y:p.y+w*ty+z*tx-x*tz,z:p.z+w*tz+x*ty-y*tx};}
const results=[];
for(const root of source.roots){
 const components=root.data.components,t=components['Game.Objects.Transform'].fields,edges=[];
 for(const n of components['Game.Net.SubNet'].items){
  const raw=q('get_entity_components',{entity_id:n.m_SubNet,components:['Game.Net.Curve','Game.Prefabs.PrefabRef'],buffer_limit:1});
  const c=raw.data.components['Game.Net.Curve'];if(!c.present)continue;
  const curve=c.fields.m_Bezier,a=local(curve.a,t),d=local(curve.d,t),prefab=raw.data.components['Game.Prefabs.PrefabRef'].fields.m_Prefab;
  const matches=defs.filter(n=>n.m_Prefab===prefab).map(n=>Math.min(Math.max(dist(a,n.m_Curve.a),dist(d,n.m_Curve.d)),Math.max(dist(a,n.m_Curve.d),dist(d,n.m_Curve.a))));
  edges.push({id:n.m_SubNet,a,d,error:Math.min(...matches),raw});
 }
 results.push({root:root.data.entity_id,edges});
}
fs.writeFileSync('artifacts/heliport-width-path-audit-'+version+'.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({root:r.root,edges:r.edges.length,mismatches:r.edges.filter(e=>e.error>.1).map(({raw,...e})=>e)}))));
