import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('paint selector protects dark and saturated pixels; tint preserves shading and unmasked bytes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-color-'));
 try{
 const source=fileURLToPath(new URL('../../src/Editor/ModelColorRules.cs',import.meta.url));
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),`using System;using System.Linq;using CityWeaver;
 class Program{
 static void Check(bool x){if(!x)throw new Exception("assertion failed");}
 static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Invalid input accepted");}
 static void Main(){
 Check(ModelColorRules.Hex("#B7dDb0").SequenceEqual(new byte[]{183,221,176}));
 foreach(var s in new[]{"green","#123","#GG0000","#12345678"," 123456",null})Reject(()=>ModelColorRules.Hex(s));
 foreach(float n in new[]{float.NaN,float.PositiveInfinity,-0.1f,1.1f})Reject(()=>ModelColorRules.Unit(n));
 Check(ModelColorRules.Neutral(0,0,0,0.45f,0.12f,0.08f)==0);
 Check(ModelColorRules.Neutral(50,50,50,0.45f,0.12f,0.08f)==0);
 Check(ModelColorRules.Neutral(255,50,0,0.45f,0.12f,0.08f)==0);
 Check(ModelColorRules.Neutral(220,220,220,0.45f,0.12f,0.08f)==1);
 float feather=ModelColorRules.Neutral(125,125,125,0.45f,0.12f,0.08f);Check(feather>0&&feather<1);
 Check(ModelColorRules.Blend(220,183,1,1)==183);
 Check(ModelColorRules.Blend(220,183,0.5f,1)==92);
 for(int i=0;i<256;i++)Check(ModelColorRules.Blend((byte)i,183,0.5f,0)==i);
 Check(ModelColorRules.Blend(200,100,1,0.5f)==150);
 Console.WriteLine("Paint rules passed");
 }}
 `);
 const result=execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});assert.match(result,/Paint rules passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
