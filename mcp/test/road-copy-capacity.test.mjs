import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {MAX_REQUEST_BYTES,MAX_RESPONSE_BYTES,MAX_COPY_EXPLICIT_EDGES,MAX_COPY_AREA_EDGES} from '../capacity-limits.mjs';

test('native capacity accepts the 460-road district and enforces enlarged boundaries consistently',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-copy-capacity-'));
 try {
  const limits=fileURLToPath(new URL('../../src/Roads/RoadCopyLimits.cs',import.meta.url));
  const bridge=fileURLToPath(new URL('../../src/Core/BridgeLimits.cs',import.meta.url));
  await writeFile(path.join(dir,'Test.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${limits}"/><Compile Include="${bridge}"/></ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),`using System;using CityWeaver;
class Program {
 static void Check(bool ok){if(!ok)throw new Exception("Invalid road-copy capacity boundary");}
 static void Main(){
  foreach(int n in new[]{1,128,400,460,1024})Check(RoadCopyLimits.ValidExplicitCount(n));
  foreach(int n in new[]{-1,0,1025})Check(!RoadCopyLimits.ValidExplicitCount(n));
  foreach(int n in new[]{1,400,460,1024,2048})Check(RoadCopyLimits.ValidAreaCount(n));
  foreach(int n in new[]{-1,0,2049})Check(!RoadCopyLimits.ValidAreaCount(n));
  Console.WriteLine(RoadCopyLimits.MaxExplicitEdges+","+RoadCopyLimits.MaxAreaEdges+","+BridgeLimits.MaxRequestBytes+","+BridgeLimits.MaxResponseBytes);
 }
}`);
  const output=execFileSync('dotnet',['run','--project',path.join(dir,'Test.csproj')],{encoding:'utf8',timeout:120000});
  assert.equal(output.trim().split(/\r?\n/).at(-1),[MAX_COPY_EXPLICIT_EDGES,MAX_COPY_AREA_EDGES,MAX_REQUEST_BYTES,MAX_RESPONSE_BYTES].join(','));
 }finally{await rm(dir,{recursive:true,force:true});}
});
