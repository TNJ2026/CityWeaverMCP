import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('floating placement retains prefab offset and clearance above the seabed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-floating-placement-'));
  try {
    const source = fileURLToPath(new URL('../../src/Buildings/FloatingPlacement.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using CityWeaver;
class Program {
  static int count;
  static void Near(float actual, float expected) {
    count++; if(Math.Abs(actual - expected) > .001f)
      throw new Exception("Case " + count + ": expected " + expected + ", got " + actual);
  }
  static void Main() {
    // Recorded manual tower: water surface plus 9.8 m; front-of-lot terrain reference.
    float height = FloatingPlacement.Height(559.81688f, 9.8f, 447.38535f);
    Near(height, 569.61688f);
    float elevation = FloatingPlacement.Elevation(height, 447.38535f);
    Near(elevation, 122.23153f);
    Near(height - elevation, 447.38535f);
    // Former MCP site: retain the deep seabed rather than targeting water-level terrain.
    height = FloatingPlacement.Height(560.2756f, 9.8f, 429.5779f);
    Near(height, 570.0756f);
    elevation = FloatingPlacement.Elevation(height, 429.5779f);
    Near(elevation, 140.4977f);
    Near(height - elevation, 429.5779f);
    Near(FloatingPlacement.Height(100, 0, 20), 100);
    Near(FloatingPlacement.Elevation(100, 20), 80);
    // Native clamping at a raised shoreline and support for negative asset offsets.
    Near(FloatingPlacement.Height(100, 5, 110), 110);
    Near(FloatingPlacement.Elevation(110, 110), 0);
    Near(FloatingPlacement.Elevation(100, 110), 0);
    Near(FloatingPlacement.Height(100, -5, 20), 95);
    Near(FloatingPlacement.Elevation(95, 20), 75);
    // Moving to another seabed depth must recompute clearance.
    Near(FloatingPlacement.Elevation(570.0756f, 470), 100.0756f);
    // Semi-submersible prefab has a distinct 14.7 m offset and 12-cell lot.
    height = FloatingPlacement.Height(559.8435f, 14.7f, 414f);
    Near(height, 574.5435f);
    elevation = FloatingPlacement.Elevation(height, 414f);
    Near(height - elevation, 414f);
    if (!FloatingPlacement.Matches(height, elevation, height, elevation)) throw new Exception("Valid semi-submersible rejected");
    if (FloatingPlacement.Matches(height, 0, height, elevation)) throw new Exception("Terrain-raising zero elevation accepted");
    if (FloatingPlacement.Matches(height - 4.9f, elevation, height, elevation)) throw new Exception("Tower offset accepted for semi-submersible");
    if (FloatingPlacement.Matches(float.NaN, elevation, height, elevation)) throw new Exception("NaN accepted");
    Console.WriteLine(count + " floating placement cases passed");
  }
}
`);
    const output = execFileSync('dotnet', ['run', '--project', path.join(dir, 'Test.csproj')], {encoding:'utf8', timeout:120000});
    assert.match(output, /16 floating placement cases passed/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
