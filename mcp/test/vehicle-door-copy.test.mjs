import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('door metadata deep copy and bus boarding-side selection preserve independent door control',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-door-copy-'));
 try{
  const sources=['McpVehicleDoorProperties','VehicleDoorRules'].map(n=>fileURLToPath(new URL(n==='McpVehicleDoorProperties'?'../../src/Persistence/McpVehicleDoorProperties.cs':'../../src/Editor/'+n+'.cs',import.meta.url)));
  await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>${sources.map(s=>`<Compile Include="${s}"/>`).join('')}</ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),`using System;using System.Collections.Generic;using CityWeaver;
namespace Unity.Entities{public struct ComponentType{}}
namespace Game.Prefabs{public abstract class ComponentBase{public abstract void GetArchetypeComponents(HashSet<Unity.Entities.ComponentType> c);public abstract void GetPrefabComponents(HashSet<Unity.Entities.ComponentType> c);}}
class Program{
 static void Check(bool b){if(!b)throw new Exception("Door regression failed");}
 static void Main(){
  var source=new[]{new McpVehicleDoorProperties.Door{bone="front",right=true,angle=80,duration=1},new McpVehicleDoorProperties.Door{bone="rear",right=true,angle=-80,duration=1}};
  var clone=McpVehicleDoorProperties.CopyDoors(source);Check(clone.Length==2&&!ReferenceEquals(source,clone)&&!ReferenceEquals(source[0],clone[0]));
  Check(clone[0].bone=="front"&&clone[0].right&&clone[0].angle==80&&clone[1].angle==-80&&clone[1].duration==1);
  clone[0].angle=60;clone[0].bone="changed";Check(source[0].angle==80&&source[0].bone=="front");
  Check(McpVehicleDoorProperties.CopyDoors(null).Length==0);Check(McpVehicleDoorProperties.CopyDoors(Array.Empty<McpVehicleDoorProperties.Door>()).Length==0);
  bool rejected=false;try{McpVehicleDoorProperties.CopyDoors(new McpVehicleDoorProperties.Door[]{null});}catch(ArgumentException){rejected=true;}Check(rejected);
  Check(VehicleDoorRules.BoardingSide(false,false,true,2)==0); // arriving is not boarding
  Check(VehicleDoorRules.BoardingSide(true,false,true,float.NaN)==1);
  Check(VehicleDoorRules.BoardingSide(true,true,false,2)==-1); // explicit side wins
  Check(VehicleDoorRules.BoardingSide(true,false,false,2)==1);Check(VehicleDoorRules.BoardingSide(true,false,false,-2)==-1);
  Check(VehicleDoorRules.BoardingSide(true,false,false,float.NaN)==0);Check(VehicleDoorRules.BoardingSide(true,false,false,0)==0);Check(VehicleDoorRules.BoardingSide(true,true,true,2)==0);
  int side=VehicleDoorRules.BoardingSide(true,false,false,2);Check(VehicleDoorRules.Open(true,side<0,side>0,0));Check(!VehicleDoorRules.Open(false,side<0,side>0,0));
  Check(!VehicleDoorRules.Open(true,false,true,.2f));
  float progress=0;for(int i=0;i<60;i++)progress=VehicleDoorRules.Step(progress,true,1f/60,1);Check(progress>.999f);
  for(int i=0;i<60;i++)progress=VehicleDoorRules.Step(progress,false,1f/60,1);Check(progress<.001f);
  Console.WriteLine("Door copy and bus signal invariants passed");
 }
}`);
  assert.match(execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000}),/Door copy and bus signal invariants passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
