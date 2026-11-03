import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('composition light configuration rejects missing layers, duplicates and invalid RGB without changing input',async t=>{
 const managed=process.env.CSII_MANAGEDPATH;
 if(!managed){t.skip('Installed game assemblies required');return;}
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-composition-lights-'));
 try{
 const source=fileURLToPath(new URL('../../src/Editor/ModelCompositionLightRules.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/><Reference Include="Newtonsoft.Json"><HintPath>${managed}/Newtonsoft.Json.dll</HintPath></Reference></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using Newtonsoft.Json.Linq;using CityWeaver;
 class Program{
 static JArray Input()=>JArray.Parse("[{mesh_index:1,layer_id:1,color:[0.6,1,0.18],intensity:0.36,luminance:1,always_on:true}]");
 static void Reject(Action action){try{action();}catch(ArgumentException){return;}throw new Exception("Invalid light configuration accepted");}
 static void Main(){var layers=new[]{new int[0],new[]{1,2}};var valid=Input();var before=valid.ToString();
 ModelCompositionLightRules.Validate(valid,layers);if(valid.ToString()!=before)throw new Exception("Validation mutated input");
 var duplicate=Input();duplicate.Add(duplicate[0].DeepClone());Reject(()=>ModelCompositionLightRules.Validate(duplicate,layers));
 foreach(var field in new[]{"mesh_index","layer_id"}){var p=Input();p[0][field]=99;Reject(()=>ModelCompositionLightRules.Validate(p,layers));}
 foreach(double value in new[]{-1d,1.01d,double.NaN,double.PositiveInfinity}){var p=Input();p[0]["color"][0]=value;Reject(()=>ModelCompositionLightRules.Validate(p,layers));}
 foreach(var field in new[]{"intensity","luminance"}){var p=Input();p[0][field]=10001;Reject(()=>ModelCompositionLightRules.Validate(p,layers));}
 var unknown=Input();unknown[0]["purpose"]="Vehicle";Reject(()=>ModelCompositionLightRules.Validate(unknown,layers));
 var malformed=Input();malformed[0]["always_on"]="yes";Reject(()=>ModelCompositionLightRules.Validate(malformed,layers));
 var missing=Input();((JObject)missing[0]).Remove("color");Reject(()=>ModelCompositionLightRules.Validate(missing,layers));
 Reject(()=>ModelCompositionLightRules.Validate(Input(),new[]{new int[0],new[]{1,1}}));
 Console.WriteLine("Light configuration boundaries passed");}}
 `);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});
 assert.match(result,/Light configuration boundaries passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('composition serializes actual Unity vectors and quaternions without recursive swizzles',async t=>{
 const managed=process.env.CSII_MANAGEDPATH;
 if(!managed){t.skip('Installed game assemblies required');return;}
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-composition-json-'));
 try{
 const source=fileURLToPath(new URL('../../src/Editor/ModelCompositionJson.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/><Reference Include="Newtonsoft.Json"><HintPath>${managed}/Newtonsoft.Json.dll</HintPath></Reference><Reference Include="Unity.Mathematics"><HintPath>${managed}/Unity.Mathematics.dll</HintPath></Reference></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using Newtonsoft.Json;using Newtonsoft.Json.Linq;using Unity.Mathematics;using CityWeaver;
 class Program{static void Check(bool x){if(!x)throw new Exception("Composition transform serialization changed");}
 static void Main(){var p=new float3(-12.5f,0,47.25f);var q=new quaternion(.1f,.2f,.3f,.9f);
 var position=ModelCompositionJson.Position(p);var rotation=ModelCompositionJson.Rotation(q);
 Check(position.Count==3&&rotation.Count==4);Check((float)position[0]==p.x&&(float)position[2]==p.z);
 Check((float)rotation[0]==q.value.x&&(float)rotation[3]==q.value.w);
 var row=new JObject{["position"]=position,["rotation"]=rotation};var baseline=row.ToString(Formatting.None);
 var parsed=JObject.Parse(baseline);Check(((JArray)parsed["position"]).Count==3&&((JArray)parsed["rotation"]).Count==4);
 for(int i=0;i<3;i++)Check((float)parsed["position"][i]==(float)position[i]);
 for(int i=0;i<4;i++)Check((float)parsed["rotation"][i]==(float)rotation[i]);Check(!baseline.Contains("xxxx"));
 Check(ModelCompositionJson.Position(new float3(-12.5f,1,47.25f)).ToString(Formatting.None)!=position.ToString(Formatting.None));
 Check(ModelCompositionJson.Rotation(quaternion.identity).ToString(Formatting.None)!=rotation.ToString(Formatting.None));
 Console.WriteLine("Unity composition JSON passed");}}`);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});
 assert.match(result,/Unity composition JSON passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('composition rejects duplicate sources, oversized native batch groups and inferred LOD chains',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-composition-'));
 try{
 const source=fileURLToPath(new URL('../../src/Editor/ModelCompositionRules.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using System.Linq;using CityWeaver;
 class Program{static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Unsafe composition accepted");}
 static void Main(){ModelCompositionRules.Sources(new[]{"ModuleA","ModuleB","ModuleC"});
 foreach(int count in new[]{8,8,1})ModelCompositionRules.Render(count,0);
 Reject(()=>ModelCompositionRules.Render(17,0));Reject(()=>ModelCompositionRules.Render(8,1));Reject(()=>ModelCompositionRules.Render(0,0));
 Reject(()=>ModelCompositionRules.Sources(new[]{"A","A"}));Reject(()=>ModelCompositionRules.Sources(new[]{"A"}));
 Reject(()=>ModelCompositionRules.Sources(new[]{"A"," "}));Reject(()=>ModelCompositionRules.Sources(Enumerable.Range(0,17).Select(i=>"M"+i).ToArray()));
 Console.WriteLine("Composition boundaries passed");}}`);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});
 assert.match(result,/Composition boundaries passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
