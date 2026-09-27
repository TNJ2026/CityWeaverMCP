$ErrorActionPreference = 'Stop'
# Run the production replacement routine against an ECS double which invalidates
# buffers on structural changes. Signal tests use the installed game's helpers.
$roadSource = (Get-Content (Join-Path $PSScriptRoot '../../src/Roads/McpRoadToolSystem.cs') -Raw).Replace("`r`n", "`n")
$signalSource = (Get-Content (Join-Path $PSScriptRoot '../../src/Roads/McpTrafficSignalProgramSystem.cs') -Raw).Replace("`r`n", "`n")
function Slice([string]$source, [string]$from, [string]$to) {
    $begin = $source.IndexOf($from)
    if ($begin -lt 0) { throw "Missing source boundary: $from" }
    $end = $source.IndexOf($to, $begin)
    if ($end -lt 0) { throw "Missing source boundary: $to" }
    return $source.Substring($begin, $end - $begin)
}
$replacement = Slice $roadSource '        private int ReplaceRoadTreePrefabs(' '        private static float SignedLateralDistance('
$completion = Slice $roadSource '                            op.RoadTreeReplacementCount = ReplaceRoadTreePrefabs(' "                        }`n                        op.CreatedEdges"
$baseline = Slice $signalSource '                var greenBaseline = trafficLights;' '                if (EntityManager.HasBuffer<Game.Net.SubLane>(node))'
$laneUpdate = Slice $signalSource '                        TrafficLightSystem.UpdateLaneSignal(greenBaseline' '                        EntityManager.SetComponentData(lane, signal);'
$lightUpdate = Slice $signalSource '                        TrafficLightSystem.UpdateTrafficLightState(greenBaseline' '                        EntityManager.SetComponentData(light, state);'
$code = @"
using System;
using System.Collections.Generic;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Unity.Entities;
using Unity.Mathematics;
using Colossal.Mathematics;

class RoadOperation {
    public Entity LeftTreePrefab, RightTreePrefab, MedianTreePrefab;
    public int RoadTreeReplacementCount;
    public string State = "applying", Error;
    public List<Entity> CreatedEdges;
}
class CheckedBuffer<T> {
    readonly FakeEntities owner;
    readonly int generation;
    readonly List<T> values;
    public CheckedBuffer(FakeEntities owner, List<T> values) {
        this.owner = owner; this.values = values; generation = owner.Generation;
    }
    void Check() { if (generation != owner.Generation) throw new Exception("Buffer invalidated by structural change"); }
    public int Length { get { Check(); return values.Count; } }
    public T this[int index] { get { Check(); return values[index]; } }
}
class FakeEntities {
    public int Generation;
    readonly Dictionary<Entity, Dictionary<Type, object>> entities = new();
    public void Create(Entity entity) => entities[entity] = new();
    public bool Exists(Entity entity) => entities.ContainsKey(entity);
    public bool HasComponent<T>(Entity entity) => Exists(entity) && entities[entity].ContainsKey(typeof(T));
    public T GetComponentData<T>(Entity entity) => (T)entities[entity][typeof(T)];
    public void SetComponentData<T>(Entity entity, T value) => entities[entity][typeof(T)] = value;
    public void AddComponent<T>(Entity entity) { entities[entity][typeof(T)] = default(T); Generation++; }
    public bool HasBuffer<T>(Entity entity) => HasComponent<List<T>>(entity);
    public CheckedBuffer<T> GetBuffer<T>(Entity entity, bool readOnly) => new(this, GetComponentData<List<T>>(entity));
}
class Regression {
    readonly FakeEntities EntityManager = new();
    RoadOperation op;
    int m_Ticks;
    static Entity E(int index) => new Entity { Index = index, Version = 1 };
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    // Fixtures use lateral X coordinates on a straight road; geometry is unchanged.
    static float SignedLateralDistance(Bezier4x3 curve, float3 position) => position.x;
$replacement
    void Fail(string error) { op.State = "outcome_unknown"; op.Error = error; }
    void FinishTrees(List<Entity> completedTargets, int tick) {
        m_Ticks = tick;
$completion
        op.State = "completed";
    }
    Entity AddRoad(int id, params (int id, float side, int prefab)[] trees) {
        var road = E(id); EntityManager.Create(road);
        EntityManager.SetComponentData(road, new Curve());
        var objects = new List<Game.Objects.SubObject>();
        foreach (var tree in trees) {
            var entity = E(tree.id); EntityManager.Create(entity);
            EntityManager.SetComponentData(entity, new Game.Objects.Tree());
            EntityManager.SetComponentData(entity, new Game.Objects.Transform { m_Position = new float3(tree.side, 0, 0) });
            EntityManager.SetComponentData(entity, new PrefabRef(E(tree.prefab)));
            objects.Add(new Game.Objects.SubObject { m_SubObject = entity });
        }
        EntityManager.SetComponentData(road, objects); return road;
    }
    static void TestTrees() {
        var r = new Regression();
        r.op = new RoadOperation { LeftTreePrefab = E(90), RightTreePrefab = E(91) };
        var a = r.AddRoad(1, (10, 8, 80), (11, 9, 80), (12, -8, 80));
        var b = r.AddRoad(2, (20, 8, 80), (21, -8, 80));
        var edges = new List<Entity> { a, b };
        r.FinishTrees(edges, 8);
        Check(r.op.State == "applying", "Must wait for native processing before verification");
        Check(r.EntityManager.Generation == 5, "All five trees must be updated without invalid buffers");
        foreach (int id in new[] { 10, 11, 20 }) Check(r.EntityManager.GetComponentData<PrefabRef>(E(id)).m_Prefab == E(90), "Left tree mismatch");
        foreach (int id in new[] { 12, 21 }) Check(r.EntityManager.GetComponentData<PrefabRef>(E(id)).m_Prefab == E(91), "Right tree mismatch");
        r.FinishTrees(edges, 9);
        Check(r.op.State == "completed" && r.op.RoadTreeReplacementCount == 5, "Readback should complete");
        Console.WriteLine("PASS: multiple trees and roads survive structural changes and verify later");

        foreach (bool partial in new[] { false, true }) {
            r = new Regression(); r.op = new RoadOperation { LeftTreePrefab = E(90), RightTreePrefab = E(91) };
            a = partial ? r.AddRoad(1, (10, 8, 90), (11, -8, 91)) : r.AddRoad(1);
            b = partial ? r.AddRoad(2, (20, 8, 90)) : r.AddRoad(2);
            edges = new List<Entity> { a, b };
            r.FinishTrees(edges, 59); Check(r.op.State == "applying", "Missing trees must wait");
            r.FinishTrees(edges, 60);
            Check(r.op.State == "outcome_unknown" && r.op.Error == "ROAD_TREE_REPLACEMENT_INCOMPLETE", "Missing side/edge must not complete");
        }
        Console.WriteLine("PASS: zero trees and a missing side on one road time out without false success");
        r = new Regression(); r.op = new RoadOperation { MedianTreePrefab = E(92) };
        a = r.AddRoad(1, (10, 0, 92), (11, 8, 80));
        r.EntityManager.AddComponent<Temp>(E(10)); edges = new List<Entity> { a };
        r.FinishTrees(edges, 60); Check(r.op.State == "outcome_unknown", "Temporary tree must not count");
        Check(r.EntityManager.GetComponentData<PrefabRef>(E(11)).m_Prefab == E(80), "Unrequested side changed");
        Console.WriteLine("PASS: temporary trees excluded and unrequested side preserved");
    }
    static void Update(TrafficLights trafficLights, byte selectedGroup, ref LaneSignal signal, ref Game.Objects.TrafficLight state) {
$baseline
$laneUpdate
$lightUpdate
    }
    static void TestSignals() {
        // Reapply each output every frame, just as the production system does.
        var lights = new TrafficLights { m_CurrentSignalGroup = 1, m_NextSignalGroup = 2 };
        var lane = new LaneSignal { m_GroupMask = 1 };
        var light = new Game.Objects.TrafficLight { m_GroupMask0 = 1, m_GroupMask1 = 1 };
        lights.m_State = Game.Net.TrafficLightState.Ending;
        for (int frame = 0; frame < 32; frame++) {
            Update(lights, 1, ref lane, ref light);
            Check(lane.m_Signal == LaneSignalType.SafeStop, "Yellow lane interval collapsed at frame " + frame);
            Check((light.m_State & Game.Objects.TrafficLightState.Yellow) != 0, "Yellow light interval collapsed");
        }
        lights.m_State = Game.Net.TrafficLightState.Changing;
        for (int frame = 0; frame < 16; frame++) {
            Update(lights, 1, ref lane, ref light);
            Check(lane.m_Signal == LaneSignalType.Stop, "Outgoing lane not stopped during clearance");
            Check((light.m_State & Game.Objects.TrafficLightState.Red) != 0, "Missing clearance red");
        }
        lane.m_GroupMask = 2; light.m_GroupMask0 = 2;
        lights.m_State = Game.Net.TrafficLightState.Beginning; lights.m_CurrentSignalGroup = 0;
        for (int frame = 0; frame < 16; frame++) {
            Update(lights, 1, ref lane, ref light);
            Check(lane.m_Signal == LaneSignalType.Yield, "Incoming phase should yield before green");
        }
        lights.m_State = Game.Net.TrafficLightState.Ongoing; lights.m_CurrentSignalGroup = 2; lights.m_NextSignalGroup = 0;
        Update(lights, 2, ref lane, ref light);
        Check(lane.m_Signal == LaneSignalType.Go, "Next green missing");
        lights.m_State = Game.Net.TrafficLightState.Ending; lights.m_CurrentSignalGroup = 1; lights.m_NextSignalGroup = 2;
        lane.m_GroupMask = 3; light.m_GroupMask0 = 3;
        for (int frame = 0; frame < 32; frame++) {
            Update(lights, 1, ref lane, ref light);
            Check(lane.m_Signal == LaneSignalType.Go, "Shared group should remain green");
        }
        Console.WriteLine("PASS: full yellow/clearance/start intervals and shared green use native helpers");
    }
    public static void Main() { TestTrees(); TestSignals(); }
}
"@
$testDirectory = Join-Path $PSScriptRoot '../../artifacts/road-feature-tests'
New-Item -ItemType Directory -Force -Path $testDirectory | Out-Null
Set-Content -LiteralPath (Join-Path $testDirectory 'Program.cs') -Value $code
$references = @('Game', 'Unity.Entities', 'Unity.Mathematics', 'Unity.Collections', 'UnityEngine.CoreModule', 'Colossal.Mathematics', 'Colossal.Core') | ForEach-Object {
    $assembly = [System.Security.SecurityElement]::Escape((Join-Path $env:CSII_MANAGEDPATH ($_ + '.dll')))
    '<Reference Include="' + $_ + '"><HintPath>' + $assembly + '</HintPath></Reference>'
}
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>$($references -join "`n")</ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $testDirectory 'RoadFeatureTests.csproj')
dotnet run --project (Join-Path $testDirectory 'RoadFeatureTests.csproj') --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'Road feature regression tests failed' }
