import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('route paint mask selects body paint while excluding transparent, dark and colored details',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-route-color-'));
 try{
  const sources=['VehicleRouteColorRules','ModelColorRules'].map(n=>fileURLToPath(new URL('../../src/Editor/'+n+'.cs',import.meta.url)));
  await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>${sources.map(s=>`<Compile Include="${s}"/>`).join('')}</ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),`using System;using CityWeaver;
class Program {
 static void Check(bool b){if(!b)throw new Exception("mask invariant failed");}
 static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Invalid paint configuration accepted");}
 static byte Mask(byte r,byte g,byte b,byte a=255)=>VehicleRouteColorRules.Weight(r,g,b,a,.45f,.12f,.08f);
 static void Main(){
  Check(VehicleRouteColorRules.Slots(new[]{5},6).SetEquals(new[]{5}));
  var selected=VehicleRouteColorRules.Slots(new[]{0,1,2,4,5},6);
  Check(VehicleRouteColorRules.NeutralSlots(new[]{4,5},selected,6).SetEquals(new[]{4,5}));
  Check(VehicleRouteColorRules.NeutralSlots(null,selected,6).Count==0);
  Reject(()=>VehicleRouteColorRules.NeutralSlots(new[]{3},selected,6));
  Reject(()=>VehicleRouteColorRules.NeutralSlots(new[]{4,4},selected,6));
  Check(VehicleRouteColorRules.Weight(190,190,170,255,.3f,.35f,.15f)>0);
  Check(VehicleRouteColorRules.Weight(10,10,10,255,.3f,.35f,.15f)==0);
  var uv=VehicleRouteColorRules.Rasterize(new[]{new[]{0f,0f,.5f,0f,0f,.5f}},8,8);
  Check(uv[0]==255);Check(uv[63]==0);Check(uv[7]==0);
  var reversed=VehicleRouteColorRules.Rasterize(new[]{new[]{0f,.5f,.5f,0f,0f,0f}},8,8);
  for(int i=0;i<uv.Length;i++)Check(uv[i]==reversed[i]);
  Reject(()=>VehicleRouteColorRules.Rasterize(new[]{new[]{0f,0f,2f,0f,0f,.5f}},8,8));
  Reject(()=>VehicleRouteColorRules.Rasterize(new[]{new[]{0f,float.NaN,.5f,0f,0f,.5f}},8,8));
  Reject(()=>VehicleRouteColorRules.Rasterize(new[]{new[]{0f,0f}},8,8));
  Check(VehicleRouteColorRules.PrepareSurface(true,true,0));
  Check(VehicleRouteColorRules.PrepareSurface(false,true,4));
  Check(!VehicleRouteColorRules.PrepareSurface(false,false,3)); // unselected glass is preserved
  Reject(()=>VehicleRouteColorRules.PrepareSurface(true,false,3));
  Reject(()=>VehicleRouteColorRules.Slots(new[]{5,5},6));Reject(()=>VehicleRouteColorRules.Slots(new[]{6},6));Reject(()=>VehicleRouteColorRules.Slots(new[]{-1},6));Reject(()=>VehicleRouteColorRules.Slots(Array.Empty<int>(),6));Reject(()=>VehicleRouteColorRules.Slots(null,6));
  Check(Mask(255,255,255)==255);Check(Mask(180,180,180)==255);
  Check(Mask(255,255,255,0)==0);Check(Mask(255,255,255,127)==0);Check(Mask(10,10,10)==0);
  Check(Mask(255,0,0)==0);Check(Mask(30,80,255)==0);Check(Mask(115,115,115)<Mask(125,125,125));Check(Mask(125,125,125)<255);
  Reject(()=>VehicleRouteColorRules.Weight(255,255,255,255,float.NaN,.12f,.08f));
  byte Paint(byte r,byte g,byte b,byte a=255)=>VehicleRouteColorRules.HueWeight(r,g,b,a,24,12,.3f,.45f,.15f);
  Check(Paint(200,104,40)==255);Check(Paint(150,78,30)==255);
  Check(Paint(255,255,255)==0);Check(Paint(150,150,150)==0);
  Check(Paint(255,0,0)==0);Check(Paint(255,220,0)==0);Check(Paint(20,80,180)==0);
  Check(Paint(40,20,8)==0);Check(Paint(200,104,40,0)==0);
  Check(VehicleRouteColorRules.HueWeight(255,0,4,255,0,10,.3f,.45f,0)==255); // hue wraps at red
  Reject(()=>VehicleRouteColorRules.HueWeight(200,100,40,255,float.NaN,12,.3f,.45f,.1f));
  Reject(()=>VehicleRouteColorRules.HueWeight(200,100,40,255,24,0,.3f,.45f,.1f));
  Check(VehicleRouteColorRules.Neutralize(40,200,255)==200);
  Check(VehicleRouteColorRules.Neutralize(40,200,0)==40);
  Check(VehicleRouteColorRules.Neutralize(40,200,128)>40&&VehicleRouteColorRules.Neutralize(40,200,128)<200);
  // A single immutable mask supports different per-vehicle colors without recoloring source pixels.
  byte source=180;float weight=Mask(source,source,source)/255f;
  Check(ModelColorRules.Blend(source,255,source/255f,weight)==180);
  Check(ModelColorRules.Blend(source,0,source/255f,weight)==0);
  Check(ModelColorRules.Blend(20,255,20/255f,Mask(20,20,20)/255f)==20);
  Console.WriteLine("Route paint invariants passed");
 }
}`);
  assert.match(execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000}),/Route paint invariants passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
