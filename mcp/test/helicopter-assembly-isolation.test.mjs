import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('MCP binary owns generic persistence and has no helicopter assembly or removed road dependency',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-independent-assembly-'));
 try{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  await writeFile(path.join(dir,'Audit.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>');
  await writeFile(path.join(dir,'Program.cs'),`
using System;using System.IO;using System.Linq;using System.Reflection.Metadata;using System.Reflection.PortableExecutable;
class Program{
 static void Check(bool x,string message){if(!x)throw new Exception(message);}
 static void Main(string[] args){
  using var stream=File.OpenRead(Path.Combine(args[0],"artifacts/staged/CityWeaverMCP/CityWeaverMCP.dll"));using var pe=new PEReader(stream);var m=pe.GetMetadataReader();
  var references=m.AssemblyReferences.Select(h=>m.GetString(m.GetAssemblyReference(h).Name)).ToHashSet();
  Check(!references.Contains("CityWeaver")&&!references.Contains("PassengerHelicopters"),"Helicopter runtime remains a binary dependency");
  var types=m.TypeDefinitions.Where(h=>m.GetTypeDefinition(h).GetDeclaringType().IsNil).ToDictionary(h=>m.GetString(m.GetTypeDefinition(h).Namespace)+"."+m.GetString(m.GetTypeDefinition(h).Name));
  foreach(var name in new[]{"McpSavedRoadSpeed","McpVehicleDoorProperties","McpVehicleModelSaveData","McpVehicleModelPersistenceSystem","McpVehicleDoorSystem","McpVehicleRouteReferenceSystem","SavedRoadSpeedSystem","ObjRigidRig","QueryException"})Check(types.ContainsKey("CityWeaver."+name),"Missing owned generic type: "+name);
  foreach(var name in new[]{"SavedRoadSpeed","VehicleDoorProperties","VehicleModelSaveData","VehicleModelPersistenceSystem","PassengerHelicopterSystem","TwelveLaneRoadSystem","TwentyFourLaneRoadSystem","SixLaneRingRoadSystem","EightLaneHighwaySystem","CustomRoadSpeedSystem","RoadSpeedMarkingSystem","DividedRoadSectionRules","NativeRoadFont","NativeRoadFontRules","RoadSpeedMarkingRules","RoadMarkingMaterialProfile"})Check(!types.ContainsKey("CityWeaver."+name),"Legacy/unused type remains: "+name);
  var methods=m.GetTypeDefinition(types["CityWeaver.GameQueryService"]).GetMethods().Select(h=>m.GetString(m.GetMethodDefinition(h).Name)).ToHashSet();
  foreach(var name in new[]{"ListVehicleModels","GetVehicleModel","PreviewVehicleReplacement","ApplyVehicleReplacement","ReadVehicleOperation","RestoreVehicleReplacement","CancelVehicleReplacement","GetPassengerHelicopterStatus","PreviewPassengerHelicopterLine"})Check(methods.Contains(name),"Generic/optional API removed: "+name);
  Check(m.ManifestResources.Count==0,"Unexpected bundled model/icon resource");
  Console.WriteLine("Independent MCP assembly audit passed");
 }
}`);
  assert.match(execFileSync('dotnet',['run','--project',path.join(dir,'Audit.csproj'),'-c','Release','--',root],{encoding:'utf8',timeout:120000}),/Independent MCP assembly audit passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
