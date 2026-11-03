import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('vehicle rig validation rejects cyclic/ambiguous bones, mismatched donor sets and invalid skin weights',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-vehicle-'));
 try{
 const source=fileURLToPath(new URL('../../src/Editor/VehicleModelRules.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using System.Linq;using CityWeaver;
 class Program{
 static void Check(bool x){if(!x)throw new Exception("assert failed");}
 static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Invalid rig accepted");}
 static void Main(){
 Check(!VehicleModelRules.MatchesName(null,""));Check(!VehicleModelRules.MatchesName("", ""));Check(!VehicleModelRules.MatchesName("   ",""));Check(VehicleModelRules.MatchesName("Car08","car"));Check(VehicleModelRules.MatchesName("TrainOilCar01",null));Check(!VehicleModelRules.MatchesName("Car08","ship"));
 VehicleModelRules.Hierarchy(new[]{"body","front_wheel","rear_wheel"},new[]{-1,0,0});
 VehicleModelRules.Hierarchy(new[]{"child","root"},new[]{1,-1});
 VehicleModelRules.Hierarchy(Array.Empty<string>(),Array.Empty<int>());
 Reject(()=>VehicleModelRules.Hierarchy(new[]{"a","b"},new[]{1,0}));
 Reject(()=>VehicleModelRules.Hierarchy(new[]{"a","b","c"},new[]{1,2,1}));
 Reject(()=>VehicleModelRules.Hierarchy(new[]{"a","a"},new[]{-1,0}));
 Reject(()=>VehicleModelRules.Hierarchy(new[]{"a"},new[]{2}));
 Reject(()=>VehicleModelRules.Hierarchy(new[]{"a"},new[]{-2}));
 Reject(()=>VehicleModelRules.Hierarchy(new[]{"a"},Array.Empty<int>()));
 Check(VehicleModelRules.Match(new[]{"rear","front","root"},new[]{"root","rear","front"}).SequenceEqual(new[]{1,2,0}));
 Reject(()=>VehicleModelRules.Match(new[]{"rear"},new[]{"front"}));
 Reject(()=>VehicleModelRules.Match(new[]{"rear"},new[]{"rear","root"}));
 Reject(()=>VehicleModelRules.Match(new[]{"rear","rear"},new[]{"rear","front"}));
 VehicleModelRules.Weight(1,0,1);VehicleModelRules.Weight(0,255,0);
 Reject(()=>VehicleModelRules.Weight(1,1,1));Reject(()=>VehicleModelRules.Weight(.5f,-1,2));Reject(()=>VehicleModelRules.Weight(float.NaN,0,1));Reject(()=>VehicleModelRules.Weight(-.1f,0,1));Reject(()=>VehicleModelRules.Weight(1.1f,0,1));
 Reject(()=>VehicleModelRules.Finite(float.PositiveInfinity,0,1,"scale"));
 Console.WriteLine("Vehicle model rules passed");
 }}
 `);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});assert.match(result,/Vehicle model rules passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
