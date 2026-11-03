import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('MCP defaults are empty and legacy imports preserve explicit choices and opt-outs',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-independent-defaults-'));
 try{
  const files=['Persistence/McpVehicleModelSaveData.cs','Editor/VehicleModelDefaults.cs'].map(p=>fileURLToPath(new URL('../../src/'+p,import.meta.url)));
  await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>${files.map(p=>`<Compile Include="${p}"/>`).join('')}<Reference Include="Newtonsoft.Json"><HintPath>${process.env.CSII_MANAGEDPATH}/Newtonsoft.Json.dll</HintPath></Reference></ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),`
using System;using System.Linq;using CityWeaver;using Newtonsoft.Json.Linq;
class Program{
 static void Check(bool x){if(!x)throw new Exception("Independent defaults assertion failed");}
 static JObject Config(string name)=>new JObject{["parts"]=new JArray(new JObject{["render_prefab"]=name})};
 static void Main(){
  Check(!VehicleModelDefaults.Load().Targets.Any());
  var legacy=new McpVehicleModelSaveData();legacy.Put("Bus01",Config("old-bus"));legacy.Put("Bus02",Config("old-second"));
  var own=new McpVehicleModelSaveData();own.Put("Bus01",Config("user-choice"));own.DisableDefault("Bus02");
  own.MergeDefaults(legacy);own.LegacyImported=true;
  var restored=McpVehicleModelSaveData.Decode(own.Encode());restored.MergeDefaults(legacy);
  Check(restored.LegacyImported&&restored.Targets.Single()=="Bus01");
  Check((string)restored.Get("Bus01")["parts"][0]["render_prefab"]=="user-choice");
  Check(!McpVehicleModelSaveData.Decode(new JObject{["version"]=1,["vehicles"]=new JArray()}.ToString()).LegacyImported);
  Console.WriteLine("Independent defaults and migration tombstones passed");
 }
}`);
  assert.match(execFileSync('dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000}),/Independent defaults and migration tombstones passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
