import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('automatic resource pipeline height follows terrain and prefab range', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-pipe-height-'));
  try {
    const source = fileURLToPath(new URL('../../src/Services/UtilityPlacementHeight.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using CityWeaver;
class Program {
  static int count;
  static void Near(float actual, float expected) {
    count++; if(Math.Abs(actual - expected) > .001f) throw new Exception("Case " + count);
  }
  static void Main() {
    float depth = UtilityPlacementHeight.DefaultElevation(-50, -10);
    Near(depth, -10);
    // Recorded seabed stays the reference; the 569 m floating port is not ground.
    float height = UtilityPlacementHeight.UndergroundHeight(434.337f, depth);
    Near(height, 424.337f);
    Near(height - depth, 434.337f);
    Near(UtilityPlacementHeight.DefaultElevation(-30, -15), -15);
    Near(UtilityPlacementHeight.DefaultElevation(-50, 50), 0);
    Near(UtilityPlacementHeight.DefaultElevation(5, 20), 5);
    Near(UtilityPlacementHeight.DefaultElevation(-10, -10), -10);
    Near(UtilityPlacementHeight.UndergroundHeight(450, -25), 425);
    Near(UtilityPlacementHeight.NeedsLocalConnection(true, true, false) ? 1 : 0, 1);
    Near(UtilityPlacementHeight.NeedsLocalConnection(true, true, true) ? 1 : 0, 0);
    Near(UtilityPlacementHeight.NeedsLocalConnection(true, false, false) ? 1 : 0, 0);
    Near(UtilityPlacementHeight.NeedsLocalConnection(false, true, false) ? 1 : 0, 0);
    Near(UtilityPlacementHeight.EndpointHeightMatches(424.337f, 569.3246f) ? 1 : 0, 0);
    Near(UtilityPlacementHeight.EndpointHeightMatches(424.337f, 424.337f) ? 1 : 0, 1);
    Near(UtilityPlacementHeight.EndpointHeightMatches(424.337f, float.NaN) ? 1 : 0, 0);
    Console.WriteLine(count + " pipe height cases passed");
  }
}`);
    const output = execFileSync('dotnet', ['run', '--project', path.join(dir, 'Test.csproj')], {encoding:'utf8', timeout:120000});
    assert.match(output, /15 pipe height cases passed/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
