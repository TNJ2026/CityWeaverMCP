import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('editor configuration rejects unsafe numeric values and colliding cyclic seasons', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-editor-config-'));
  try {
    const source=fileURLToPath(new URL('../../src/Editor/EditorConfigurationRules.cs',import.meta.url));
    await writeFile(path.join(dir,'Test.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir,'Program.cs'),`using System; using CityWeaver;
class Program {
  static void Check(bool ok,string message) { if(!ok) throw new Exception(message); }
  static void Main() {
    foreach(var pair in EditorConfigurationRules.Fields) {
      var r=pair.Value;
      Check(r.Accept(r.Min) && r.Accept(r.Max), "Legal endpoints rejected: "+pair.Key);
      foreach(var v in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity,r.Min-1,r.Max+1})
        Check(!r.Accept(v), "Unsafe input accepted: "+pair.Key);
    }
    Check(!EditorConfigurationRules.Fields.ContainsKey("climate.m_DefaultWeather"),"Unbounded prefab mutation exposed");
    Check(!EditorConfigurationRules.Fields.ContainsKey("terrain_render.m_RockDiffuse"),"Arbitrary texture import exposed");
    Check(EditorConfigurationRules.Fields["season.m_TempNightDay"].Components==2,"Night/day vector changed");
    Check(EditorConfigurationRules.Fields["water_render.m_WaterColor"].Components==4,"RGBA vector changed");
    Check(EditorConfigurationRules.Fields["water_render.m_SeaWindAffectWavesDirection"].Boolean,"Boolean schema lost");
    Check(!EditorConfigurationRules.Fields["climate.m_RandomSeed"].Accept(1.5),"Fractional seed accepted");
    Check(EditorConfigurationRules.ValidSeasonStarts(new[]{0.75,0.0,0.5,0.25}),"Unsorted valid year rejected");
    foreach(var times in new[]{ new double[0],new[]{0.0},new[]{0.0,0.0},new[]{0.0,0.00001},new[]{0.0,0.99999},new[]{0.0,1.0},new[]{0.0,double.NaN},new[]{-0.1,0.5}})
      Check(!EditorConfigurationRules.ValidSeasonStarts(times),"Degenerate or overlapping seasons accepted");
    Check(EditorConfigurationRules.ValidSeasonStarts(new[]{0.0,0.25}),"Two-season climate rejected");
    Console.WriteLine("configuration bounds and cyclic season constraints verified");
  }
}`);
    assert.match(execFileSync('dotnet',['run','--project',path.join(dir,'Test.csproj')],{encoding:'utf8',timeout:120000}),/configuration bounds and cyclic season constraints verified/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
