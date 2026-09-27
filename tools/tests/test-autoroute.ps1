$ErrorActionPreference = 'Stop'
# Compile the production search/simplification code with synthetic terrain and
# water. No game process or duplicated implementation of A* is needed.
$source = Get-Content (Join-Path $PSScriptRoot '../../src/Roads/RoadQueries.cs') -Raw
function Slice([string]$from, [string]$to) {
    $begin = $source.IndexOf($from)
    $end = $source.IndexOf($to, $begin)
    if ($begin -lt 0 -or $end -lt 0) { throw "Planner source boundary missing: $from" }
    return $source.Substring($begin, $end - $begin)
}
$corridor = Slice '            bool SegmentCorridorClear(' '            if (WaterAt(start.Position.xz)'
$planner = Slice '            var startCell = Cell(start.Position.xz);' '            // Keep the A* waypoints, but replace'
$collapse = Slice '            void ValidateRouteTurns()' '            if (route.Count > 33)'
$curveCheck = Slice '            bool CurveCorridorClear(' '            var plannedCurves ='
$mathAssembly = Join-Path $env:CSII_MANAGEDPATH 'Unity.Mathematics.dll'
$colossalAssembly = Join-Path $env:CSII_MANAGEDPATH 'Colossal.Mathematics.dll'
$code = @"
using System;
using System.Collections.Generic;
using System.Linq;
using Unity.Mathematics;
using Colossal.Mathematics;
using CityWeaver;
public class QueryException : Exception {
    public QueryException(string code, string message) : base(code + ": " + message) {}
}
public static class AutorouteRegression {
    class Endpoint { public float3 Position; }
    class Geometry { public float m_DefaultWidth = 16; }
    static List<float3> Collapse(params float3[] points) {
        var route = points.ToList();
        float gridSize = 24;
        bool ClearLine(float3 a, float3 b) => math.distance(a.xz, b.xz) <= 248;
$collapse
        return route;
    }
    static bool CurveClear(Bezier4x3 candidate, Func<float2, bool> obstacle = null) {
        float gridSize = 24;
        var geometry = new Geometry();
        bool Blocked(float2 p) => obstacle != null && obstacle(p);
        bool WaterAt(float2 p) => false;
$curveCheck
        return CurveCorridorClear(candidate);
    }
    static float3 Point(float x, float z) => new float3(x, 0, z);
    static List<float3> Plan(float2 destination, bool zoningAlignment, Func<float2, bool> waterTest) {
        var start = new Endpoint { Position = new float3(0, 0, 0) };
        var end = new Endpoint { Position = new float3(destination.x, 0, destination.y) };
        float gridSize = 24, slopeLimit = .08f;
        string strategy = "balanced";
        var min = math.min(start.Position.xz, end.Position.xz) - 192f;
        var max = math.max(start.Position.xz, end.Position.xz) + 192f;
        if (zoningAlignment) { min = math.floor(min / gridSize) * gridSize; max = math.ceil(max / gridSize) * gridSize; }
        int columns = (int)math.ceil((max.x - min.x) / gridSize) + 1;
        int rows = (int)math.ceil((max.y - min.y) / gridSize) + 1;
        int total = columns * rows;
        float directDistance = math.distance(start.Position.xz, end.Position.xz);
        int Index(int x, int y) => x + y * columns;
        float2 GridPoint(int index) => min + new float2(index % columns, index / columns) * gridSize;
        int Cell(float2 p) {
            var c = (int2)math.round((p - min) / gridSize);
            c = math.clamp(c, 0, new int2(columns - 1, rows - 1)); return Index(c.x, c.y);
        }
        bool Blocked(float2 p) => false;
        bool WaterAt(float2 p) => waterTest(p);
        bool Wet(int index) => WaterAt(GridPoint(index));
        float Height(int index) => 0;
$corridor
$planner
        return route;
    }
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void VerifyDry(List<float3> route, Func<float2, bool> wet) {
        for (int i = 1; i < route.Count; i++) {
            Check(math.distance(route[i-1].xz, route[i].xz) >= 16, "Short segment");
            for (int j = 0; j <= 1000; j++)
                Check(!wet(math.lerp(route[i-1].xz, route[i].xz, j / 1000f)), "Route crosses water");
        }
    }
    public static void Main() {
        var reversal = new[] { Point(0,0), Point(48,48), Point(-48,144), Point(96,288), Point(120,288), Point(144,264) };
        Check(Collapse(reversal).SequenceEqual(reversal), "Collapse introduced an entry reversal");
        var reversed = reversal.Reverse().ToArray();
        Check(Collapse(reversed).SequenceEqual(reversed), "Collapse introduced an exit reversal");
        var safe = Collapse(Point(0,0), Point(48,48), Point(72,48), Point(120,0));
        Check(safe.Count == 2, "Safe switchback was not simplified");
        Console.WriteLine("PASS: switchback collapse preserves entry/exit turns and accepts safe chords");
        var tight = new Bezier4x3(Point(0,0), Point(32f/3,0), Point(27.2297216f,-2.3851392f), Point(32,0));
        Check(!CurveClear(tight), "Tight endpoint bend accepted");
        Check(!CurveClear(new Bezier4x3(tight.d, tight.c, tight.b, tight.a)), "Tight start bend accepted");
        var cusp = new Bezier4x3(Point(0,0), Point(0,0), Point(64,0), Point(96,0));
        Check(!CurveClear(cusp), "Degenerate endpoint accepted");
        var broad = new Bezier4x3(Point(0,0), Point(55.2285f,0), Point(100,44.7715f), Point(100,100));
        Check(CurveClear(broad), "Broad curve rejected");
        var line = new Bezier4x3(Point(0,0), Point(32,0), Point(64,0), Point(96,0));
        Check(CurveClear(line), "Straight curve rejected");
        Check(!CurveClear(line, p => p.x >= 96), "Endpoint obstacle missed");
        Console.WriteLine("PASS: curvature covers both endpoints, rejects cusps, and accepts broad/straight curves");
        var shortTail = Plan(new float2(85, 5), false, p => false);
        Check(shortTail.Count == 2, "Off-grid tail was not merged");
        VerifyDry(shortTail, p => false);
        Console.WriteLine("PASS: off-grid endpoint produces one valid segment");
        foreach (float stripStart in new[] { 8f, 32f, 80f }) {
            Func<float2, bool> wet = p => p.x > stripStart && p.x < stripStart + 8 && math.abs(p.y) < 48;
            var route = Plan(new float2(96, 0), true, wet);
            VerifyDry(route, wet);
            Check(route.Any(p => math.abs(p.z) >= 48), "No water detour");
            Console.WriteLine("PASS: dry detour around strip at x=" + stripStart);
        }
        bool rejected = false;
        try { Plan(new float2(96, 0), true, p => p.x > 32 && p.x < 40); }
        catch (QueryException e) { rejected = e.Message.StartsWith("NO_AUTOROUTE:"); }
        Check(rejected, "Impassable water barrier accepted");
        Console.WriteLine("PASS: impassable water barrier rejected");
        var straight = Plan(new float2(240, 0), true, p => false);
        Check(straight.Count == 2, "Aligned straight route regressed");
        Console.WriteLine("PASS: aligned straight route unchanged");
    }
}
"@
$testDirectory = Join-Path $PSScriptRoot '../../artifacts/autoroute-tests'
New-Item -ItemType Directory -Force -Path $testDirectory | Out-Null
Set-Content -LiteralPath (Join-Path $testDirectory 'Program.cs') -Value $code
$escapedAssembly = [System.Security.SecurityElement]::Escape($mathAssembly)
$escapedColossal = [System.Security.SecurityElement]::Escape($colossalAssembly)
$radiusSource = [System.Security.SecurityElement]::Escape((Join-Path $PSScriptRoot '../../src/Transport/TrackCurveGeometry.cs'))
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><Reference Include="Unity.Mathematics"><HintPath>$escapedAssembly</HintPath></Reference></ItemGroup>
  <ItemGroup><Reference Include="Colossal.Mathematics"><HintPath>$escapedColossal</HintPath></Reference></ItemGroup>
  <ItemGroup><Compile Include="$radiusSource" Link="TrackCurveGeometry.cs" /></ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $testDirectory 'AutorouteTests.csproj')
dotnet run --project (Join-Path $testDirectory 'AutorouteTests.csproj') --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'Autoroute regression tests failed' }
