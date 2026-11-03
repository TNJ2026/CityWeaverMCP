import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('vehicle replacement preserves route eligibility through apply, restore and repeated replacements',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-route-reference-'));
 try{
  const source=fileURLToPath(new URL('../../src/Editor/VehicleRouteReferenceRules.cs',import.meta.url));
  await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/></ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),`using System;using CityWeaver;
class Program {
 static void Check(bool b){if(!b)throw new Exception("route invariant failed");}
 static void Main(){
  var original=(16714,1);var replacement=(335290,17);var restored=(335290,18);var unrelated=(16714,2);
  var p=original;var s=(0,0);
  Check(VehicleRouteReferenceRules.Remap(ref p,ref s,original,replacement)==1);
  Check(p==replacement&&s==(0,0)); // native route matching now accepts the updated vehicle
  Check(VehicleRouteReferenceRules.Remap(ref p,ref s,original,replacement)==0); // idempotent
  Check(VehicleRouteReferenceRules.Remap(ref p,ref s,replacement,restored)==1&&p==restored);
  Check(VehicleRouteReferenceRules.Remap(ref p,ref s,restored,(900,1))==1&&p==(900,1));
  p=unrelated;s=original;Check(VehicleRouteReferenceRules.Remap(ref p,ref s,original,replacement)==1&&p==unrelated&&s==replacement);
  p=original;s=original;Check(VehicleRouteReferenceRules.Remap(ref p,ref s,original,replacement)==2&&p==replacement&&s==replacement);
  p=unrelated;s=(0,0);Check(VehicleRouteReferenceRules.Remap(ref p,ref s,original,replacement)==0&&p==unrelated&&s==(0,0));
  // A user choosing another model between apply and restore must keep their choice.
  p=unrelated;s=unrelated;Check(VehicleRouteReferenceRules.Remap(ref p,ref s,replacement,restored)==0&&p==unrelated&&s==unrelated);
  foreach(var pair in new[]{((0,0),replacement),(original,(0,0)),(original,original)}){
   bool rejected=false;try{VehicleRouteReferenceRules.Remap(ref p,ref s,pair.Item1,pair.Item2);}catch(ArgumentException){rejected=true;}Check(rejected&&p==unrelated&&s==unrelated);
  }
  Console.WriteLine("Route identity invariants passed");
 }
}`);
  assert.match(execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000}),/Route identity invariants passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
