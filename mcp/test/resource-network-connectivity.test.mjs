import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('resource connectivity follows manual local connections and rejects isolated pipes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-resource-network-'));
  try {
    const source = fileURLToPath(new URL('../../src/Services/ResourceNetworkConnectivity.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using System.Collections.Generic; using CityWeaver;
class Program {
 static int count;
 static void Check(bool value) { count++; if(!value) throw new Exception("Failed case " + count); }
 static void Main() {
  // Observed manual topology: platform port -> pipe A -> junction -> pipe B
  // -> local node -> pier edge -> pier terminal. Nodes need not be shared.
  var graph = new Dictionary<int,int[]> {
   [1]=new[]{2}, [2]=new[]{1,3}, [3]=new[]{2,4}, [4]=new[]{3,5},
   [5]=new[]{4,6}, [6]=new[]{5,7}, [7]=new[]{6},
   [8]=new[]{9}, [9]=new[]{8}
  };
  var pipes = new HashSet<int>{2,4};
  bool Valid(int n) => graph.ContainsKey(n);
  IEnumerable<int> Next(int n) => graph[n];
  Check(ResourceNetworkConnectivity.Reaches(1,pipes,Valid,Next));
  Check(ResourceNetworkConnectivity.Reaches(7,pipes,Valid,Next));
  Check(!ResourceNetworkConnectivity.Reaches(8,pipes,Valid,Next));
  Check(!ResourceNetworkConnectivity.Reaches(0,pipes,Valid,Next));
  Check(!ResourceNetworkConnectivity.Reaches(7,pipes,n=>Valid(n)&&n!=5,Next));
  Check(!ResourceNetworkConnectivity.Reaches(7,pipes,Valid,Next,2));
  Check(!ResourceNetworkConnectivity.Reaches(1,new HashSet<int>(),Valid,Next));
  Check(ResourceNetworkConnectivity.Reaches(2,pipes,Valid,Next));
  Console.WriteLine(count + " connectivity cases passed");
 }
}`);
    const output = execFileSync('dotnet', ['run', '--project', path.join(dir, 'Test.csproj')], {encoding:'utf8', timeout:120000});
    assert.match(output, /8 connectivity cases passed/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
