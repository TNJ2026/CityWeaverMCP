import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('OBJ export preserves attributes, reverses handedness and maintains independent multi-part indices',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-export-'));
 try{
 const importer=fileURLToPath(new URL('../../src/Editor/ObjMeshRules.cs',import.meta.url));
 const source=fileURLToPath(new URL('../../src/Editor/ModelObjWriter.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/><Compile Include="${importer}"/></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using System.IO;using System.Globalization;using System.Linq;using CityWeaver;
 class Program{
 static void Check(bool x){if(!x)throw new Exception("OBJ assertion failed");}
 static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Invalid mesh accepted");}
 static void Main(){
 CultureInfo.CurrentCulture=new CultureInfo("de-DE");
 var p=new[]{new[]{0f,0f,2.5f},new[]{1f,0f,2.5f},new[]{0f,1f,2.5f}};
 var uv=new[]{new[]{0f,0f},new[]{1f,0f},new[]{0f,1f}};
 var n=new[]{new[]{0f,0f,1f},new[]{0f,0f,1f},new[]{0f,0f,1f}};
 var empty=new float[0][];var indices=new[]{0,1,2};var output=new StringWriter();var w=new ModelObjWriter(output);
 w.Part(p,uv,n,indices,"part_000");w.Part(p,empty,empty,indices,"part_001");w.Part(p,empty,n,indices,"part_002");w.Part(p,uv,empty,indices,"part_003");
 string text=output.ToString();Check(text.Contains("v 0 0 -2.5"));Check(text.Contains("vn 0 0 -1"));
 Check(text.Contains("f 1/1/1 3/3/3 2/2/2"));Check(text.Contains("f 4 6 5"));Check(text.Contains("f 7//4 9//6 8//5"));Check(text.Contains("f 10/4 12/6 11/5"));Check(text.Contains("usemtl part_003"));
 var roundtrip=ObjMeshRules.Parse(text.Split((char)10));Check(roundtrip.Count==4);Check(roundtrip.All(part=>part.Positions.Count==9));Check(roundtrip[0].Positions[2]==2.5f);Check(roundtrip[0].Normals[2]==1f);
 Reject(()=>w.Part(p,uv,n,new[]{0,1,3},"bad"));Reject(()=>w.Part(p,uv,n,new[]{0,1},"bad"));Reject(()=>w.Part(p,new[]{uv[0]},n,indices,"bad"));
 var bad=new[]{new[]{float.NaN,0f,0f},p[1],p[2]};Reject(()=>w.Part(bad,uv,n,indices,"bad"));
 Console.WriteLine("OBJ export checks passed");
 }}
 `);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});
 assert.match(result,/OBJ export checks passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
