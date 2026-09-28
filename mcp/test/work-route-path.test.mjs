import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('work route readiness rejects empty, failed and pending native paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-work-route-'));
  try {
    const source = fileURLToPath(new URL('../../src/Transport/WorkRoutePathValidation.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using CityWeaver;
class Program {
  static void Main() {
    if (WorkRoutePathValidation.Ready(0, -1, 0)) throw new Exception("Observed disconnected oil route accepted");
    if (WorkRoutePathValidation.Ready(0, 100, 0)) throw new Exception("Empty path accepted");
    foreach (int flag in new[]{1,2,4,8,64,3,34})
      if (WorkRoutePathValidation.Ready(25, 5257, flag)) throw new Exception("Unready flags accepted: " + flag);
    foreach (float distance in new[]{-1f,float.NaN,float.PositiveInfinity})
      if (WorkRoutePathValidation.Ready(25, distance, 0)) throw new Exception("Invalid distance accepted");
    if (!WorkRoutePathValidation.Ready(25, 5257, 0)) throw new Exception("Valid native path rejected");
    if (!WorkRoutePathValidation.Ready(25, 5257, 32)) throw new Exception("Updated native path rejected");
    if (!WorkRoutePathValidation.HeightAllowed(true, 577.8435f, 559.8435f, true)) throw new Exception("Native semi-submersible deck stop rejected");
    if (WorkRoutePathValidation.HeightAllowed(true, 577.8435f, 559.8435f, false)) throw new Exception("Free elevated waypoint accepted");
    if (WorkRoutePathValidation.HeightAllowed(false, 577.8435f, 559.8435f, true)) throw new Exception("Dry native stop accepted");
    if (WorkRoutePathValidation.HeightAllowed(true, float.NaN, 559.8435f, true)) throw new Exception("Invalid native stop accepted");
    if (!WorkRoutePathValidation.HeightAllowed(true, 567f, 559f, false)) throw new Exception("Water waypoint at limit rejected");
    Console.WriteLine("19 path readiness cases passed");
  }
}`);
    const output = execFileSync('dotnet', ['run', '--project', path.join(dir, 'Test.csproj')], {encoding:'utf8', timeout:120000});
    assert.match(output, /19 path readiness cases passed/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
