import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('pending or failed transport paths never certify a preview', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'helicopter-airway-'));
  try {
    const files = [fileURLToPath(new URL('../../src/Transport/TransportPreviewPathRules.cs', import.meta.url))];
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>${files.map(p => `<Compile Include="${p}"/>`).join('')}</ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), String.raw`
using System; using CityWeaver;
class Program {
 static void Check(bool b,string message){if(!b)throw new Exception(message);}
 static void Main() {
  Check(TransportPreviewPathRules.Ready(12,5113.0146f,0,true,true),"completed native path accepted");
  Check(!TransportPreviewPathRules.Ready(0,-1,0,true,true),"observed empty incoming path rejected despite flags=0");
  Check(!TransportPreviewPathRules.Ready(12,5113,0,false,true),"stale lane binding rejected");
  Check(!TransportPreviewPathRules.Ready(12,5113,0,true,false),"old ready positions rejected");
  foreach(int flags in new[]{1,2,4,8,64,2048,4096,1|32})
   Check(!TransportPreviewPathRules.Ready(12,5113,flags,true,true),"incomplete or obsolete flags rejected");
  Check(TransportPreviewPathRules.Ready(12,5113,32,true,true),"updated result remains valid");
  foreach(float distance in new[]{-1f,float.NaN,float.PositiveInfinity})
   Check(!TransportPreviewPathRules.Ready(12,distance,0,true,true),"invalid distance rejected");
  Console.WriteLine("Helipad airway and asynchronous preview regression passed");
 }
}`);
    assert.match(execFileSync(process.env.CITYWEAVER_TEST_DOTNET || 'dotnet',
      ['run', '--project', path.join(dir, 'Test.csproj'), '-c', 'Release'],
      {encoding:'utf8', timeout:120000}), /Helipad airway and asynchronous preview regression passed/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
