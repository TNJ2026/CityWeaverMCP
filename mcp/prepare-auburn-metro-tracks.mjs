import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';import {readFile,writeFile} from 'node:fs/promises';
const all=JSON.parse(await readFile('artifacts/auburn-metro-permanent.json','utf8'));const [s1,s2,s3,s4]=all.map(x=>x.tracks[0]);
const p=(x,z)=>({x,z});const add=(a,b,k)=>p(a.x+b.x*k,a.z+b.z*k);const mix=(a,b,t)=>p(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
const routes=[{id:'S1-S2',a:s1.end,an:s1.end_node_id,d:s2.start,dn:s2.start_node_id,b:p(-30,400.25),c:p(270,224.25)},
{id:'S2-S3',a:s2.end,an:s2.end_node_id,d:s3.end,dn:s3.end_node_id,b:p(2800,224.25),c:add(s3.end,p(-.382683,.923880),900)},
{id:'S3-S4',a:s3.start,an:s3.start_node_id,d:s4.end,dn:s4.end_node_id,b:add(s3.start,p(.382683,-.923880),550),c:p(5575.999,2009.75)}];
const depot=all[4].tracks.find(t=>t.end_node_id.endsWith(':697883:23'));
const v=p(-.382683,.923880),endRamp=add(depot.end,v,75),center=add(endRamp,p(.923880,.382683),220);let depotCurves=[{a:depot.end,b:add(depot.end,v,25),c:add(depot.end,v,50),d:endRamp}];
function arc(center,R,aa,bb){let k=4/3*Math.tan((bb-aa)/4)*R,a=add(center,p(Math.cos(aa),Math.sin(aa)),R),d=add(center,p(Math.cos(bb),Math.sin(bb)),R);return {a,b:add(a,p(-Math.sin(aa),Math.cos(aa)),k),c:add(d,p(Math.sin(bb),-Math.cos(bb)),k),d}}
for(let i=0;i<2;i++)depotCurves.push(arc(center,220,(-157.5-i*56.25)*Math.PI/180,(-157.5-(i+1)*56.25)*Math.PI/180));
let last=depotCurves.at(-1).d;const radius2=(last.z-s4.start.z)/2,center2=p(last.x,last.z-radius2);for(let i=0;i<2;i++)depotCurves.push(arc(center2,radius2,(90-i*90)*Math.PI/180,(90-(i+1)*90)*Math.PI/180));last=depotCurves.at(-1).d;
depotCurves.push({a:last,b:mix(last,s4.start,1/3),c:mix(last,s4.start,2/3),d:s4.start});
routes.push({id:'depot-S4',a:depot.end,an:depot.end_node_id,d:s4.start,dn:s4.start_node_id,sourceCurves:depotCurves,portal:true,revision:'north-dry-v4'});
function at(c,t){let ab=mix(c.a,c.b,t),bc=mix(c.b,c.c,t),cd=mix(c.c,c.d,t);return mix(mix(ab,bc,t),mix(bc,cd,t),t)}
function length(c){let n=0,last=c.a;for(let i=1;i<=100;i++){let v=at(c,i/100);n+=Math.hypot(v.x-last.x,v.z-last.z);last=v}return n}
function radius(c){let m=Infinity;for(let i=0;i<=512;i++){let t=i/512,u=1-t,dx=3*(u*u*(c.b.x-c.a.x)+2*u*t*(c.c.x-c.b.x)+t*t*(c.d.x-c.c.x)),dz=3*(u*u*(c.b.z-c.a.z)+2*u*t*(c.c.z-c.b.z)+t*t*(c.d.z-c.c.z)),ddx=6*(u*(c.c.x-2*c.b.x+c.a.x)+t*(c.d.x-2*c.c.x+c.b.x)),ddz=6*(u*(c.c.z-2*c.b.z+c.a.z)+t*(c.d.z-2*c.c.z+c.b.z));m=Math.min(m,Math.hypot(dx,dz)**3/Math.max(1e-12,Math.abs(dx*ddz-dz*ddx)))}return m}
function split(c){let ab=mix(c.a,c.b,.5),bc=mix(c.b,c.c,.5),cd=mix(c.c,c.d,.5),abc=mix(ab,bc,.5),bcd=mix(bc,cd,.5),mid=mix(abc,bcd,.5);return [{a:c.a,b:ab,c:abc,d:mid},{a:mid,b:bcd,c:cd,d:c.d}]}
const c=new Client({name:'metro-geometry',version:'1'});async function call(name,args){let r=await c.callTool({name,arguments:args});if(!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data}
try{await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
for(let r of routes){r.radius=Math.min(...(r.sourceCurves??[r]).map(radius));r.length=(r.sourceCurves??[r]).reduce((n,c)=>n+length(c),0);r.segments=[];function walk(v){if(length(v)>140){split(v).forEach(walk)}else r.segments.push(v)}(r.sourceCurves??[r]).forEach(walk);let samples=[];for(let [i,s] of r.segments.entries())for(let j=0;j<=8;j++)samples.push({...at(s,j/8),i,t:j/8});r.samples=[];for(let i=0;i<samples.length;i+=80){let chunk=samples.slice(i,i+80),v=await call('sample_terrain',{points:chunk.map(({x,z})=>({x,z}))});r.samples.push(...v.items.map((v,j)=>({...chunk[j],terrain:v})));}console.log(JSON.stringify({id:r.id,length:r.length,radius:r.radius,segments:r.segments.length,sample:r.samples[0]}));}
await writeFile('artifacts/auburn-metro-track-geometry.json',JSON.stringify(routes,null,2));
}finally{await c.close()}

