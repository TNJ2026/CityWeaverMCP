$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot '../../src/Roads/RoadQueries.cs') -Raw
$begin = $source.IndexOf('        private static float ReadRoadElevation(')
$end = $source.IndexOf('        private static void ValidateRoadReplacementElevation(', $begin)
if ($begin -lt 0 -or $end -lt 0) { throw 'Elevation parser source boundary missing' }
$method = $source.Substring($begin, $end - $begin)
$directory = Join-Path $PSScriptRoot '../../artifacts/road-elevation-tests'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
@"
using System;
using Newtonsoft.Json.Linq;
using Unity.Mathematics;
class QueryException : Exception {
    public string Code;
    public QueryException(string code, string message) : base(message) { Code = code; }
}
class Program {
$method
    static void Reject(JToken value, bool attached, float min, float max, string expected) {
        try { ReadRoadElevation(new JObject { ["elevation_m"] = value }, "point", attached, min, max); }
        catch (QueryException e) { if (e.Code == expected) return; throw; }
        throw new Exception("Invalid elevation accepted: " + value);
    }
    static void Main() {
        // Live manual DrawBridge03: 0..40 placement range, 30..183m actual clearance.
        ValidateReplacementElevation(new float2(179.317f, 176.808f), 0, 40, t => 30 + 153 * 4 * t * (1-t), true);
        if (ReadRoadElevation(new JObject { ["elevation_m"] = 183 }, "point", false, 0, 40, true) != 183)
            throw new Exception("Native bridge valley clearance rejected");
        try { ReadRoadElevation(new JObject { ["elevation_m"] = double.NaN }, "point", false, 0, 40, true); throw new Exception("NaN bridge accepted"); }
        catch (QueryException e) { if (e.Code != "INVALID_ARGUMENT") throw; }
        try { ValidateReplacementElevation(new float2(30), 0, 40, t => float.NaN, true); throw new Exception("Missing bridge terrain accepted"); }
        catch (QueryException e) { if (e.Code != "TERRAIN_UNAVAILABLE") throw; }
        try { ReadRoadElevation(new JObject { ["elevation_m"] = 183 }, "point", true, 0, 40, true); throw new Exception("Attached bridge override accepted"); }
        catch (QueryException e) { if (e.Code != "INVALID_ENDPOINT") throw; }
        void RejectReplacement(float2 inherited, float min, float max, Func<float, float> clearance, string code) {
            try { ValidateReplacementElevation(inherited, min, max, clearance); }
            catch (QueryException e) { if (e.Code == code) return; throw; }
            throw new Exception("Invalid replacement elevation accepted");
        }
        ValidateReplacementElevation(new float2(12, 158), 0, 200, t => 12 + 146 * t);
        ValidateReplacementElevation(new float2(-50, 0), -50, 50, t => -50 + 50 * t);
        ValidateReplacementElevation(new float2(0, 40), 0, 40, t => 40 * t);
        ValidateReplacementElevation(new float2(0), 0, 40, t => -0.15f);
        RejectReplacement(new float2(12, 158), 0, 40, t => 12, "INVALID_ELEVATION");
        RejectReplacement(new float2(158, 12), 0, 40, t => 12, "INVALID_ELEVATION");
        // Ground endpoints and missing Elevation component must not hide the valley interior.
        RejectReplacement(new float2(0), 0, 40, t => 158 * 4 * t * (1 - t), "INVALID_ELEVATION");
        RejectReplacement(new float2(0), -50, 50, t => -80 * 4 * t * (1 - t), "INVALID_ELEVATION");
        RejectReplacement(new float2(0), 10, 200, t => 12, "INVALID_ELEVATION");
        RejectReplacement(new float2(float.NaN), 0, 200, t => 12, "INVALID_ELEVATION");
        RejectReplacement(new float2(0), 0, 200, t => float.NaN, "TERRAIN_UNAVAILABLE");
        RejectReplacement(new float2(0), 40, 0, t => 12, "INVALID_ELEVATION");
        foreach (float height in new[] { 0f, 50f, 146f, 200f })
            if (ReadRoadElevation(new JObject { ["elevation_m"] = height }, "point", false, 0, 200) != height)
                throw new Exception("Bridge height changed");
        if (ReadRoadElevation(new JObject { ["elevation_m"] = -50 }, "point", false, -50, 50) != -50)
            throw new Exception("Tunnel height rejected");
        Reject(200.01, false, 0, 200, "INVALID_ELEVATION");
        Reject(146, false, -50, 50, "INVALID_ELEVATION");
        Reject(-1, false, 0, 200, "INVALID_ELEVATION");
        Reject(146, true, 0, 200, "INVALID_ENDPOINT");
        Reject("146", false, 0, 200, "INVALID_ARGUMENT");
        Reject(double.NaN, false, 0, 200, "INVALID_ARGUMENT");
        Reject(double.PositiveInfinity, false, 0, 200, "INVALID_ARGUMENT");
        Reject(double.MaxValue, false, 0, 200, "INVALID_ARGUMENT");
        if (ReadRoadElevation(new JObject(), "point", true, 0, 200) != 0)
            throw new Exception("Attached endpoint default changed");
        Console.WriteLine("PASS: replacement endpoint/interior/native limits, terrain failures, bridge range, tunnel and numeric elevations");
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
"@ | Set-Content -LiteralPath (Join-Path $directory 'RoadElevationTests.csproj')
dotnet run --project (Join-Path $directory 'RoadElevationTests.csproj') --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'Road elevation regression failed' }
