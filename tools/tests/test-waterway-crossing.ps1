$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot '../../src/Roads/McpRoadToolSystem.WaterwayCrossings.cs') -Raw
$begin = $source.IndexOf('    internal static class WaterwayCrossingRules')
if ($begin -lt 0) { throw 'Crossing rules source missing' }
$rules = $source.Substring($begin).TrimEnd()
$rules = $rules.Substring(0, $rules.LastIndexOf('}'))
$directory = Join-Path $PSScriptRoot '../../artifacts/waterway-crossing-tests'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
@"
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using Unity.Mathematics;
$rules
class Program {
    static JObject Crossing(float x, bool permanent = true) => new JObject {
        ["position"] = new JObject { ["x"] = x, ["y"] = 512, ["z"] = 790 },
        ["permanent"] = permanent,
        ["road_edge_ids"] = new JArray("road-a", "road-b"),
        ["waterway_edge_ids"] = new JArray("water-a", "water-b")
    };
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void Main() {
        // Live failed deck and lowered, accepted preview. These are geometry envelopes,
        // not a universal maximum bridge clearance or the road placement range.
        Check(WaterwayCrossingRules.AboveEnvelope(541.9453f,478.45f,-6.65f,40), "High-deck diagnosis missing");
        Check(!WaterwayCrossingRules.AboveEnvelope(511.9453f,478.45f,-6.65f,40), "Lowered deck incorrectly diagnosed");
        Check(!WaterwayCrossingRules.AboveEnvelope(float.NaN,478.45f,-6.65f,40), "Unknown height guessed");
        Check(!WaterwayCrossingRules.AboveEnvelope(100,50,-10,40), "Touching envelopes treated as separated");
        var expected = new JArray(Crossing(0,false));
        Check(WaterwayCrossingRules.Matches(expected,new JArray(Crossing(0))), "Permanent crossing rejected");
        var remapped = Crossing(0); remapped["road_edge_ids"] = new JArray("new-road-1","new-road-2");
        Check(WaterwayCrossingRules.Matches(expected,new JArray(remapped)), "Native ID remapping rejected");
        Check(!WaterwayCrossingRules.Matches(expected,new JArray()), "Missing crossing accepted");
        Check(!WaterwayCrossingRules.Matches(expected,new JArray(Crossing(0,false))), "Temporary crossing accepted");
        var disconnected = Crossing(0); disconnected["waterway_edge_ids"] = new JArray();
        Check(!WaterwayCrossingRules.Matches(expected,new JArray(disconnected)), "Road-only completion accepted");
        var deadEnd = Crossing(0); deadEnd["road_edge_ids"] = new JArray("road-a");
        Check(!WaterwayCrossingRules.Matches(expected,new JArray(deadEnd)), "Dead-end attachment treated as crossing");
        Check(!WaterwayCrossingRules.Matches(expected,new JArray(Crossing(2))), "Moved crossing accepted");
        Check(!WaterwayCrossingRules.Matches(new JArray(Crossing(0,false),Crossing(0.2f,false)),new JArray(Crossing(0),Crossing(20))), "One actual node matched twice");
        Console.WriteLine("PASS: 12 crossing height and permanent topology regressions");
    }
}
"@ | Set-Content -LiteralPath (Join-Path $directory 'Program.cs')
$math = [System.Security.SecurityElement]::Escape((Join-Path $env:CSII_MANAGEDPATH 'Unity.Mathematics.dll'))
$json = [System.Security.SecurityElement]::Escape((Join-Path $env:CSII_MANAGEDPATH 'Newtonsoft.Json.dll'))
@"
<Project Sdk="Microsoft.NET.Sdk">
 <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup>
 <ItemGroup>
  <Reference Include="Unity.Mathematics"><HintPath>$math</HintPath></Reference>
  <Reference Include="Newtonsoft.Json"><HintPath>$json</HintPath></Reference>
 </ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $directory 'WaterwayCrossingTests.csproj')
dotnet run --project (Join-Path $directory 'WaterwayCrossingTests.csproj') --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'Waterway crossing regression failed' }
