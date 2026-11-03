import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('road speed matches native sign labels rather than doubled simulation values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-speed-'));
  try {
    const source = fileURLToPath(new URL('../../src/Roads/RoadSpeedUnits.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using CityWeaver;
class Program {
  static void Near(float a,float b) { if(Math.Abs(a-b)>.001f) throw new Exception($"{a} != {b}"); }
  static void Main() {
    // Live native EU LaneMarkings Speed80: TrafficSignData=160.
    Near(RoadSpeedUnits.FromPrefab(160),80);
    Near(RoadSpeedUnits.FromLane(160f/3.6f),80);
    Near(RoadSpeedUnits.ToPrefab(160),320);
    Near(RoadSpeedUnits.ToPrefab(200),400);
    foreach(float kph in new float[]{5,30,40,60,80,100,120,150,160,180,200,500}) {
      Near(RoadSpeedUnits.FromLane(RoadSpeedUnits.ToLane(kph)),kph);
      Near(RoadSpeedUnits.FromPrefab(RoadSpeedUnits.ToPrefab(kph)),kph);
      Near(RoadSpeedUnits.ToLane(kph)*3.6f,RoadSpeedUnits.ToPrefab(kph));
    }
    Console.WriteLine("native road speed labels verified");
  }
}`);
    assert.match(execFileSync('dotnet', ['run','--project',path.join(dir,'Test.csproj')], {encoding:'utf8',timeout:120000}), /native road speed labels verified/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
