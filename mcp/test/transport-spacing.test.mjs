import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
test('vehicle policy stays inside native vehicle count plateaus',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-transport-spacing-'));
 try{
 const sources=[fileURLToPath(new URL('../../src/Transport/TransportVehicleCountRules.cs',import.meta.url))];
 await writeFile(path.join(dir,'Test.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>'+sources.map(s=>'<Compile Include="'+s+'"/>').join('')+'</ItemGroup></Project>');
 await writeFile(path.join(dir,'Program.cs'),`using System; using CityWeaver;
class Program {
 static void Check(bool v){if(!v)throw new Exception("Rule assertion failed");}
 static void Main(){
  // Native float math, including banker rounding at count transitions.
  foreach(float duration in new[]{135.586426f,150f,225f,301.17f,1000f})
  {
   Func<float,int> count=a=>Math.Max(1,(int)MathF.Round(duration/(150f/(a/100f))));
   for(int n=count(50);n<=count(200);n++){
    float a=TransportVehicleCountRules.Select(50,200,n,count);
    Check(count(a)==n); Check(a>=50&&a<=200);
   }
  }
  Func<float,int> threshold=a=>a<165.94581f?1:2;
  float robust=TransportVehicleCountRules.Select(50,200,2,threshold);
  Check(robust>170&&threshold(robust-.01f)==2);
  Func<float,int> descending=a=>a<100?3:a<150?2:1;
  Check(descending(TransportVehicleCountRules.Select(50,200,2,descending))==2);
  Check(TransportVehicleCountRules.Select(50,200,1,a=>1)==125);
  bool rejected=false;try{TransportVehicleCountRules.Select(50,200,2,a=>a<100?1:3);}catch(InvalidOperationException){rejected=true;}Check(rejected);
  Console.WriteLine("Transport spacing rules passed");
 }
}`);
 assert.match(execFileSync(process.env.CITYWEAVER_TEST_DOTNET||'dotnet',['run','--project',path.join(dir,'Test.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000}),/Transport spacing rules passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
