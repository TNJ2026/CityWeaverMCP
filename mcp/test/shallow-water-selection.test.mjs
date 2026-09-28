import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('production water selection preserves deep water and brush boundaries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-water-selection-'));
  try {
    const source = fileURLToPath(new URL('../../src/Environment/ShallowWaterSelection.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using CityWeaver;
class Program { static int count; static void Check(bool value) { count++; if(!value) throw new Exception("Failed case " + count); }
static void Main() {
Check(ShallowWaterSelection.Eligible(.3f,.3f));
Check(!ShallowWaterSelection.Eligible(.301f,.3f));
Check(ShallowWaterSelection.Eligible(.1f,.3f));
Check(!ShallowWaterSelection.Eligible(0,.3f));
Check(!ShallowWaterSelection.Eligible(-1,.3f));
Check(!ShallowWaterSelection.Eligible(float.NaN,.3f));
Check(!ShallowWaterSelection.Eligible(float.PositiveInfinity,.3f));
Check(!ShallowWaterSelection.Eligible(.001f,.3f));
Check(ShallowWaterSelection.WithinSegment(0,0,0,0,0,0,100,7));
Check(!ShallowWaterSelection.WithinSegment(49,0,0,0,0,0,100,7));
Check(!ShallowWaterSelection.WithinSegment(0,0,0,0,0,0,8,7));
Check(ShallowWaterSelection.WithinSegment(50,40,0,0,100,0,100,7));
Check(!ShallowWaterSelection.WithinSegment(50,46,0,0,100,0,100,7));
Check(!ShallowWaterSelection.WithinSegment(150,0,0,0,100,0,100,7));
Check(ShallowWaterSelection.WithinSegment(-200,-200,-250,-250,-150,-150,100,7));
Console.WriteLine(count + " selection cases passed"); }}
`);
    const output = execFileSync('dotnet', ['run', '--project', path.join(dir, 'Test.csproj')], {encoding:'utf8', timeout:120000});
    assert.match(output, /15 selection cases passed/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
