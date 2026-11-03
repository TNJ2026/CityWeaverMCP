import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('vehicle doors follow boarding side, stay closed while moving, freeze paused, and reach exact endpoints',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-doors-'));
 try{
 const source=fileURLToPath(new URL('../../src/Editor/VehicleDoorRules.cs',import.meta.url));
 const obj=fileURLToPath(new URL('../../src/Editor/ObjMeshRules.cs',import.meta.url));
 const skin=fileURLToPath(new URL('../../src/Editor/RigidSkinRules.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/><Compile Include="${obj}"/><Compile Include="${skin}"/></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using System.Linq;using CityWeaver;
 class Program{
 static void Check(bool x){if(!x)throw new Exception("assertion failed");}
 static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Invalid input accepted");}
 static void Main(){
 Check(VehicleDoorRules.Open(true,false,true,0));Check(!VehicleDoorRules.Open(true,true,false,0));Check(VehicleDoorRules.Open(false,true,false,0));
 Check(!VehicleDoorRules.Open(true,false,true,.2f));Check(!VehicleDoorRules.Open(true,false,true,-2));Check(!VehicleDoorRules.Open(true,false,true,float.NaN));
 Check(!VehicleDoorRules.Open(true,false,false,0));Check(VehicleDoorRules.Step(.5f,true,0,1)==.5f);
 Check(VehicleDoorRules.Step(.5f,true,.1f,1)>.5f);Check(VehicleDoorRules.Step(.5f,false,.1f,1)<.5f);
 float p=0;for(int i=0;i<120;i++)p=VehicleDoorRules.Step(p,true,1f/60,1);Check(p==1);for(int i=0;i<120;i++)p=VehicleDoorRules.Step(p,false,1f/60,1);Check(p==0);
 Reject(()=>VehicleDoorRules.Step(0,true,.1f,0));Reject(()=>VehicleDoorRules.Step(float.NaN,true,.1f,1));Reject(()=>VehicleDoorRules.Step(0,true,float.PositiveInfinity,1));
 var parts=ObjMeshRules.Parse(new[]{"v 0 0 0","v 1 0 0","v 0 1 0","g Body","f 1 2 3","g Wheel","f 1 2 3"});
 Check(parts.Count==1);Check(parts[0].Groups.SequenceEqual(new[]{"Body","Body","Body","Wheel","Wheel","Wheel"}));
 // GPU skin stream can be interleaved and has no Unity bindposes/weights arrays.
 var skin=new byte[40];skin[8]=0;skin[24]=8;RigidSkinRules.Validate(skin,16,8,2,9);
 skin[24]=9;Reject(()=>RigidSkinRules.Validate(skin,16,8,2,9));skin[24]=0;skin[27]=128;Reject(()=>RigidSkinRules.Validate(skin,16,8,2,9));
 Reject(()=>RigidSkinRules.Validate(new byte[3],4,0,1,9));Reject(()=>RigidSkinRules.Validate(new byte[16],8,6,2,9));
 Reject(()=>RigidSkinRules.Validate(new byte[4],4,0,1,0));Reject(()=>RigidSkinRules.Validate(new byte[4],int.MaxValue,0,3,9));
 RigidSkinRules.Validate(new byte[]{255,0,0,0},4,0,1,256);
 Console.WriteLine("Door and rigid group rules passed");
 }}
 `);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});assert.match(result,/Door and rigid group rules passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
