using System;
using System.Collections.Generic;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CityWeaver
{
    // An ordinary ToolBaseSystem participates in the game's output/apply barriers.
    // No direct permanent road or money writes and no patch to the stock tool are needed.
    public sealed partial class McpRoadToolSystem : ToolBaseSystem
    {
        private RoadOperation m_Operation;
        private readonly List<Entity> m_Definitions = new List<Entity>();
        private int m_Phase, m_Ticks, m_StableTicks;
        private string m_LastSignature;
        private EntityQuery m_TempQuery, m_RoadQuery, m_WarningQuery;
        private readonly List<Entity> m_Candidates = new List<Entity>();
        // When a new road joins the middle of an existing road, the game splits that existing
        // edge and the two halves appear as brand-new preview edges carrying the *old* road's
        // prefab. They are legitimate and must be kept (dropping them would truncate the old
        // road), so they are accepted but accounted for separately from the requested road.
        private readonly List<Entity> m_SplitRemnants = new List<Entity>();
        public override string toolID => "McpRoad";
        public bool Busy => m_Operation != null;
        private bool IsDemolish => m_Operation.OperationType.EndsWith("demolish", StringComparison.Ordinal);
        private bool IsUpgrade => m_Operation.OperationType.EndsWith("upgrade", StringComparison.Ordinal);
        private bool IsReverse => m_Operation.OperationType.EndsWith("reverse", StringComparison.Ordinal);
        private bool IsElevation => m_Operation.OperationType == "terrain_elevation";
        private bool IsZoning => m_Operation.OperationType == "zoning";
        private bool IsRoadFeatures => m_Operation.OperationType == "road_features";
        private bool IsIntersectionControl => m_Operation.OperationType == "intersection_control";
        private bool IsIntersectionRoundabout => m_Operation.OperationType == "intersection_roundabout";
        private bool IsIntersectionRules => m_Operation.OperationType == "intersection_rules";
        private bool IsTransportTrack => m_Operation.TransactionKind == "transport_track";
        private bool IsUtilityNetwork => m_Operation.TransactionKind == "utility_network";
        private bool IsUtilityPrefab(Entity prefab) => EntityManager.Exists(prefab) &&
            (EntityManager.HasComponent<PowerLineData>(prefab) || EntityManager.HasComponent<PipelineData>(prefab));
        public override PrefabBase GetPrefab() => m_Operation == null ? null : m_PrefabSystem.GetPrefab<PrefabBase>(m_Operation.Prefab);
        public override bool TrySetPrefab(PrefabBase prefab) => false;
        protected override void OnCreate()
        {
            base.OnCreate();
            m_TempQuery = GetEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Temp>() }, None = new[] { ComponentType.ReadOnly<Deleted>() } });
            // This query intentionally includes every generated network edge. Road operations
            // filter by Road below; transport-track operations filter by prefab TrackData.
            m_RoadQuery = GetEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Temp>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<PrefabRef>() }, None = new[] { ComponentType.ReadOnly<Deleted>() } });
            m_WarningQuery = GetEntityQuery(ComponentType.ReadOnly<Warning>());
        }
        public void Begin(RoadOperation operation)
        {
            if (Busy) throw new QueryException("TOOL_BUSY", "Another road operation is active.");
            if (!m_TempQuery.IsEmptyIgnoreFilter) throw new QueryException("TOOL_BUSY", "Another tool preview is still present; return to the default selection tool and wait.");
            m_Operation = operation; m_Phase = 0; m_Ticks = 0; m_StableTicks = 0; m_LastSignature = null;
            m_Candidates.Clear(); m_SplitRemnants.Clear(); operation.SplitRemnantEdges.Clear();
            applyMode = ApplyMode.Clear;
            m_ToolSystem.activeTool = this;
            Mod.log.Info("Road preview queued: " + operation.Id + " prefab=" + operation.PrefabName);
        }
        public void AbortForLoading()
        {
            if (m_Operation != null && !m_Operation.Terminal)
            {
                m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled";
                m_Operation.Error = "CITY_SESSION_CHANGED";
            }
            DestroyDefinition();
            m_Operation = null; applyMode = ApplyMode.Clear;
            if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem;
        }
        protected override void OnStopRunning()
        {
            if (m_Operation != null)
            {
                if (!m_Operation.Terminal)
                {
                    m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled";
                    m_Operation.Error = "USER_CHANGED_TOOL";
                }
                DestroyDefinition(); m_Operation = null;
            }
            applyMode = ApplyMode.Clear;
            base.OnStopRunning();
        }
        protected override JobHandle OnUpdate(JobHandle inputDeps)
        {
            inputDeps.Complete();
            EntityManager.CompleteAllTrackedJobs();
            if (m_Operation == null) { applyMode = ApplyMode.Clear; return default; }
            try { Tick(); }
            catch (Exception e)
            {
                Mod.log.Error(e, "Road operation failed: " + m_Operation?.Id);
                if (m_Operation != null) Fail(m_Operation.ApplyDispatched ? "APPLY_OUTCOME_UNKNOWN" : "ROAD_INTERNAL_ERROR");
            }
            return default;
        }
        private void Tick()
        {
            var op = m_Operation;
            ++m_Ticks;
            if (!op.ApplyDispatched && (op.CancelRequested || DateTime.UtcNow >= op.Expires))
            {
                op.State = op.CancelRequested ? "cancelled" : "expired";
                Finish(); return;
            }
            if (m_Phase == 0)
            {
                applyMode = ApplyMode.Clear;
                if (m_Ticks < 3) return;
                if (!m_TempQuery.IsEmptyIgnoreFilter) { if (m_Ticks > 60) Fail("PREVIEW_CLEANUP_TIMEOUT"); return; }
                if (!EndpointsValid()) { Fail("ENDPOINT_CHANGED"); return; }
                CreateDefinition(); applyMode = ApplyMode.None; op.State = "generating_preview";
                m_Phase = 1; m_Ticks = 0; return;
            }
            if (m_Phase == 1)
            {
                // The modification pipeline has consumed this one-shot definition.
                DestroyDefinition(); applyMode = ApplyMode.None;
                m_Phase = 2; m_Ticks = 0; return;
            }
            if (m_Phase == 2)
            {
                applyMode = ApplyMode.None;
                if (m_Ticks < 5) return;
                if (!ReadPreview(out var signature)) { if (m_Ticks > 120) Fail("NO_GENERATED_ROAD"); return; }
                m_StableTicks = signature == m_LastSignature ? m_StableTicks + 1 : 0; m_LastSignature = signature;
                if (m_StableTicks < 3) return;
                if (op.Errors.Count > 0) { Fail("GAME_REJECTED_ROAD"); return; }
                if (op.ZoningAligned && op.PlannerStrategy != null && !PlannedZoningValid()) { Fail("ZONING_ALIGNMENT_INVALID"); return; }
                op.State = "preview_ready"; m_Phase = 3; m_Ticks = 0;
                Mod.log.Info("Road preview ready: " + op.Id + " cost=" + op.Cost + " edges=" + m_Candidates.Count + " split_remnants=" + m_SplitRemnants.Count);
                return;
            }
            if (m_Phase == 3)
            {
                applyMode = ApplyMode.None;
                if (!op.CommitRequested) return;
                if (!EndpointsValid()) { Fail("ENDPOINT_CHANGED"); return; }
                if (!ReadPreview(out var signature) || op.Errors.Count != 0) { Fail("PREVIEW_NO_LONGER_VALID"); return; }
                if (signature != m_LastSignature) { Fail("PREVIEW_CHANGED"); return; }
                if (op.ZoningAligned && op.PlannerStrategy != null && !PlannedZoningValid()) { Fail("ZONING_ALIGNMENT_INVALID"); return; }
                if (op.Cost > op.MaxCost) { Fail("COST_LIMIT"); return; }
                if (World.GetExistingSystemManaged<Game.Simulation.SimulationSystem>().selectedSpeed != 0) { Fail("CITY_MUST_BE_PAUSED"); return; }
                var city = World.GetExistingSystemManaged<Game.Simulation.CitySystem>().City;
                if (!EntityManager.HasComponent<Game.City.PlayerMoney>(city)) { Fail("CITY_MONEY_UNAVAILABLE"); return; }
                var money = EntityManager.GetComponentData<Game.City.PlayerMoney>(city);
                if (!money.m_Unlimited && money.money < op.Cost) { Fail("NOT_ENOUGH_MONEY"); return; }
                // Do not honor the game's developer ignoreErrors switch for MCP commits.
                if (!m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply()) { Fail("GAME_REJECTED_ROAD"); return; }
                op.ApplyDispatched = true; op.State = "applying";
                applyMode = ApplyMode.Apply; m_Phase = 4; m_Ticks = 0;
                Mod.log.Info("Road apply dispatched once: " + op.Id + " cost=" + op.Cost);
                return;
            }
            if (m_Phase == 4)
            {
                applyMode = ApplyMode.None;
                if (m_Ticks < 8) return;
                if (IsDemolish)
                {
                    foreach (var target in op.TargetEdges)
                        if (EntityManager.Exists(target) && !EntityManager.HasComponent<Deleted>(target)) { if (m_Ticks < 120) return; Fail("APPLY_OUTCOME_UNKNOWN"); return; }
                    op.CreatedEdges.Clear(); op.State = "completed";
                    Mod.log.Info("Road demolition completed: " + op.Id + " edges=" + op.TargetEdges.Count); Finish(); return;
                }
                if (IsReverse)
                {
                    var completedTargets = new List<Entity>();
                    bool Matches(Entity target, RoadSegmentPlan segment)
                    {
                        if (!EntityManager.Exists(target) || EntityManager.HasComponent<Deleted>(target) || EntityManager.HasComponent<Temp>(target) ||
                            !EntityManager.HasComponent<Edge>(target) || !EntityManager.HasComponent<Road>(target) || !EntityManager.HasComponent<PrefabRef>(target) ||
                            !EntityManager.HasComponent<Curve>(target) || EntityManager.GetComponentData<PrefabRef>(target).m_Prefab != segment.OriginalPrefab) return false;
                        var edge = EntityManager.GetComponentData<Edge>(target); var curve = EntityManager.GetComponentData<Curve>(target).m_Bezier;
                        return edge.m_Start == segment.StartTarget && edge.m_End == segment.EndTarget &&
                            math.distance(curve.a, segment.Start) < 0.1f && math.distance(curve.d, segment.End) < 0.1f;
                    }
                    foreach (var segment in op.Segments)
                    {
                        Entity result = Matches(segment.TargetEdge, segment) ? segment.TargetEdge : Entity.Null;
                        if (result == Entity.Null) foreach (var candidate in m_Candidates)
                            if (!completedTargets.Contains(candidate) && Matches(candidate, segment)) { result = candidate; break; }
                        if (result != Entity.Null) completedTargets.Add(result);
                    }
                    if (completedTargets.Count == op.Segments.Count) { op.CreatedEdges = completedTargets; op.State = "completed";
                        Mod.log.Info("Road reverse completed: " + op.Id + " result_edges=" + completedTargets.Count); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                if (IsUpgrade)
                {
                    var completedTargets = new List<Entity>(); bool pendingTarget = false;
                    foreach (var target in op.TargetEdges)
                    {
                        if (EntityManager.Exists(target) && !EntityManager.HasComponent<Deleted>(target) && !EntityManager.HasComponent<Temp>(target) &&
                            EntityManager.HasComponent<Edge>(target) && (IsUtilityNetwork ? IsUtilityPrefab(EntityManager.GetComponentData<PrefabRef>(target).m_Prefab) : EntityManager.HasComponent<Road>(target)) && EntityManager.HasComponent<PrefabRef>(target) &&
                            EntityManager.GetComponentData<PrefabRef>(target).m_Prefab == op.Prefab) completedTargets.Add(target);
                        else if (EntityManager.Exists(target) && !EntityManager.HasComponent<Deleted>(target)) pendingTarget = true;
                    }
                    foreach (var candidate in m_Candidates)
                        if (EntityManager.Exists(candidate) && !EntityManager.HasComponent<Deleted>(candidate) && !EntityManager.HasComponent<Temp>(candidate) &&
                            EntityManager.HasComponent<Edge>(candidate) && (IsUtilityNetwork ? IsUtilityPrefab(EntityManager.GetComponentData<PrefabRef>(candidate).m_Prefab) : EntityManager.HasComponent<Road>(candidate)) && EntityManager.HasComponent<PrefabRef>(candidate) &&
                            EntityManager.GetComponentData<PrefabRef>(candidate).m_Prefab == op.Prefab && !completedTargets.Contains(candidate)) completedTargets.Add(candidate);
                    if (!pendingTarget && completedTargets.Count > 0) { op.CreatedEdges = completedTargets; op.State = "completed";
                        Mod.log.Info("Road upgrade completed: " + op.Id + " result_edges=" + completedTargets.Count); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                if (IsElevation)
                {
                    var completedTargets = new List<Entity>();
                    bool nodesMatch = true;
                    foreach (var nodePlan in op.ElevatedNodes)
                        nodesMatch &= EntityManager.Exists(nodePlan.Node) && !EntityManager.HasComponent<Deleted>(nodePlan.Node) && !EntityManager.HasComponent<Temp>(nodePlan.Node) &&
                            EntityManager.HasComponent<Node>(nodePlan.Node) && math.distance(EntityManager.GetComponentData<Node>(nodePlan.Node).m_Position, nodePlan.Position) < 0.12f;
                    foreach (var segment in op.Segments)
                    {
                        var target = segment.TargetEdge;
                        if (!EntityManager.Exists(target) || EntityManager.HasComponent<Deleted>(target) || EntityManager.HasComponent<Temp>(target) || !EntityManager.HasComponent<Curve>(target)) continue;
                        var actual = EntityManager.GetComponentData<Curve>(target).m_Bezier;
                        if (math.distance(actual.a, segment.Curve.a) < 0.12f && math.distance(actual.b, segment.Curve.b) < 0.25f &&
                            math.distance(actual.c, segment.Curve.c) < 0.25f && math.distance(actual.d, segment.Curve.d) < 0.12f) completedTargets.Add(target);
                    }
                    if (nodesMatch && completedTargets.Count == op.Segments.Count) { op.CreatedEdges = completedTargets; op.State = "completed";
                        Mod.log.Info("Road terrain elevation completed: " + op.Id + " edges=" + completedTargets.Count); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                if (IsZoning || IsRoadFeatures)
                {
                    var completedTargets = new List<Entity>(); bool pendingTarget = false;
                    foreach (var segment in op.Segments)
                    {
                        var target = segment.TargetEdge;
                        var actual = EntityManager.Exists(target) && EntityManager.HasComponent<Upgraded>(target)
                            ? EntityManager.GetComponentData<Upgraded>(target).m_Flags : default(CompositionFlags);
                        var mask = IsRoadFeatures ? CompositionFlags.optionMask : new CompositionFlags(~(CompositionFlags.General)0u, ~(CompositionFlags.Side)0u, ~(CompositionFlags.Side)0u);
                        if (EntityManager.Exists(target) && !EntityManager.HasComponent<Deleted>(target) && !EntityManager.HasComponent<Temp>(target) && (actual & mask) == (segment.UpgradeFlags & mask))
                            completedTargets.Add(target);
                        else if (EntityManager.Exists(target) && !EntityManager.HasComponent<Deleted>(target)) pendingTarget = true;
                    }
                    foreach (var candidate in m_Candidates)
                    {
                        if (!EntityManager.Exists(candidate) || EntityManager.HasComponent<Deleted>(candidate) || EntityManager.HasComponent<Temp>(candidate) ||
                            !EntityManager.HasComponent<Edge>(candidate) || !EntityManager.HasComponent<Road>(candidate) || !EntityManager.HasComponent<Upgraded>(candidate)) continue;
                        var actual = EntityManager.GetComponentData<Upgraded>(candidate).m_Flags;
                        if (op.Segments.Exists(s => s.UpgradeFlags == actual) && !completedTargets.Contains(candidate)) completedTargets.Add(candidate);
                    }
                    if (!pendingTarget && completedTargets.Count > 0) { op.CreatedEdges = completedTargets; op.State = "completed";
                        Mod.log.Info((IsRoadFeatures ? "Road features" : "Road zoning") + " completed: " + op.Id + " edges=" + completedTargets.Count); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                if (IsIntersectionRules)
                {
                    var completedRules = new List<Entity>();
                    foreach (var target in op.TargetEdges)
                    {
                        if (!EntityManager.Exists(target) || EntityManager.HasComponent<Deleted>(target) || EntityManager.HasComponent<Temp>(target)) continue;
                        var flags = EntityManager.HasComponent<Upgraded>(target) ? EntityManager.GetComponentData<Upgraded>(target).m_Flags : default(CompositionFlags);
                        var side = op.RuleUsesLeftSide ? flags.m_Left : flags.m_Right;
                        bool RuleMatches(bool? allowed, CompositionFlags.Side bit) => !allowed.HasValue || allowed.Value == ((side & bit) == 0);
                        bool crosswalkMatches = !op.CrosswalkEnabled.HasValue || (op.CrosswalkEnabled.Value
                            ? (side & CompositionFlags.Side.RemoveCrosswalk) == 0
                            : (side & CompositionFlags.Side.RemoveCrosswalk) != 0);
                        if (RuleMatches(op.LeftTurnAllowed, CompositionFlags.Side.ForbidLeftTurn) &&
                            RuleMatches(op.RightTurnAllowed, CompositionFlags.Side.ForbidRightTurn) &&
                            RuleMatches(op.StraightAllowed, CompositionFlags.Side.ForbidStraight) && crosswalkMatches) completedRules.Add(target);
                    }
                    if (completedRules.Count == op.TargetEdges.Count) { op.CreatedEdges = completedRules; op.State = "completed";
                        Mod.log.Info("Intersection rules completed: " + op.Id + " edges=" + completedRules.Count); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                if (IsIntersectionRoundabout)
                {
                    var node = op.TargetNodes[0];
                    bool actual = EntityManager.Exists(node) && EntityManager.HasComponent<Roundabout>(node);
                    if (actual == op.RoundaboutEnabled.GetValueOrDefault()) { op.CreatedEdges.Clear(); op.State = "completed";
                        Mod.log.Info("Intersection roundabout completed: " + op.Id + " enabled=" + actual); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                if (IsIntersectionControl)
                {
                    var completedNodes = new List<Entity>();
                    foreach (var segment in op.Segments)
                    {
                        var node = segment.TargetNode;
                        var actual = EntityManager.Exists(node) && EntityManager.HasComponent<Upgraded>(node)
                            ? EntityManager.GetComponentData<Upgraded>(node).m_Flags : default(CompositionFlags);
                        var relevant = actual.m_General & (CompositionFlags.General.TrafficLights | CompositionFlags.General.RemoveTrafficLights | CompositionFlags.General.AllWayStop);
                        bool trafficLights = EntityManager.Exists(node) && EntityManager.HasComponent<TrafficLights>(node);
                        bool matches = op.ControlMode == "traffic_lights" ? trafficLights || (relevant & CompositionFlags.General.TrafficLights) != 0
                            : op.ControlMode == "all_way_stop" ? !trafficLights && (relevant & CompositionFlags.General.AllWayStop) != 0
                            : op.ControlMode == "uncontrolled" ? !trafficLights && (relevant & CompositionFlags.General.AllWayStop) == 0
                            : relevant == 0;
                        if (EntityManager.Exists(node) && !EntityManager.HasComponent<Deleted>(node) && !EntityManager.HasComponent<Temp>(node) && matches) completedNodes.Add(node);
                    }
                    if (completedNodes.Count == op.TargetNodes.Count) { op.CreatedEdges.Clear(); op.State = "completed";
                        Mod.log.Info("Intersection control completed: " + op.Id + " nodes=" + completedNodes.Count); Finish(); return; }
                    if (m_Ticks < 120) return;
                    Fail("APPLY_OUTCOME_UNKNOWN"); return;
                }
                int pending = 0; var completed = new List<Entity>();
                foreach (var e in m_Candidates)
                {
                    if (!EntityManager.Exists(e) || EntityManager.HasComponent<Deleted>(e)) continue;
                    if (EntityManager.HasComponent<Temp>(e)) { pending++; continue; }
                    if (EntityManager.HasComponent<Edge>(e) && (IsTransportTrack
                        ? EntityManager.HasComponent<TrackData>(EntityManager.GetComponentData<PrefabRef>(e).m_Prefab)
                        : IsUtilityNetwork ? IsUtilityPrefab(EntityManager.GetComponentData<PrefabRef>(e).m_Prefab)
                        : EntityManager.HasComponent<Road>(e))) completed.Add(e);
                }
                if (pending > 0 && m_Ticks < 120) return;
                op.CreatedEdges = completed;
                if (completed.Count == 0 || pending > 0 || completed.Count != m_Candidates.Count) { Fail("APPLY_OUTCOME_UNKNOWN"); return; }
                if (op.ZoningAligned && op.PlannerStrategy != null)
                {
                    if (!TryReadAppliedZoning(completed, out var orderly))
                    {
                        if (m_Ticks < 120) return;
                        Fail("ZONING_VALIDATION_TIMEOUT"); return;
                    }
                    if (!orderly) { Fail("ZONING_ALIGNMENT_FAILED"); return; }
                    op.ZoningValidation = "verified"; op.ZoningOrderly = true;
                }
                op.State = "completed";
                Mod.log.Info("Road completed: " + op.Id + " permanent_edges=" + completed.Count);
                Finish();
            }
        }
        private bool EndpointsValid()
        {
            var op = m_Operation;
            if (!IsDemolish && !IsZoning && !IsRoadFeatures && !IsIntersectionRules && !IsIntersectionControl && !IsIntersectionRoundabout && (!EntityManager.Exists(op.Prefab) || RoadOperation.IsLocked(EntityManager, op.Prefab))) return false;
            if (IsIntersectionControl || IsIntersectionRoundabout)
            {
                foreach (var node in op.TargetNodes)
                    if (!EntityManager.Exists(node) || EntityManager.HasComponent<Deleted>(node) || EntityManager.HasComponent<Temp>(node) || !EntityManager.HasComponent<Node>(node) || !EntityManager.HasComponent<ConnectedEdge>(node)) return false;
                return op.TargetNodes.Count > 0;
            }
            if (op.OperationType != "create")
            {
                foreach (var target in op.TargetEdges)
                    if (!EntityManager.Exists(target) || EntityManager.HasComponent<Deleted>(target) || EntityManager.HasComponent<Temp>(target) || !EntityManager.HasComponent<Edge>(target) ||
                        (!IsTransportTrack && !IsUtilityNetwork && !EntityManager.HasComponent<Road>(target)) ||
                        (IsTransportTrack && (!EntityManager.HasComponent<PrefabRef>(target) || !EntityManager.HasComponent<TrackData>(EntityManager.GetComponentData<PrefabRef>(target).m_Prefab)))) return false;
                    else if (IsUtilityNetwork && (!EntityManager.HasComponent<PrefabRef>(target) || !IsUtilityPrefab(EntityManager.GetComponentData<PrefabRef>(target).m_Prefab))) return false;
                return op.TargetEdges.Count > 0;
            }
            foreach (var segment in op.Segments)
            {
                if (segment.Prefab != Entity.Null && (!EntityManager.Exists(segment.Prefab) || RoadOperation.IsLocked(EntityManager, segment.Prefab))) return false;
                foreach (var endpoint in new[] { (segment.StartTarget, segment.Start, segment.StartSplit), (segment.EndTarget, segment.End, segment.EndSplit) })
                {
                    if (endpoint.Item1 == Entity.Null) continue;
                    if (!EntityManager.Exists(endpoint.Item1) || EntityManager.HasComponent<Deleted>(endpoint.Item1) || EntityManager.HasComponent<Temp>(endpoint.Item1)) return false;
                    float3 actual;
                    if (endpoint.Item3 > 0 && endpoint.Item3 < 1 && EntityManager.HasComponent<Edge>(endpoint.Item1) && EntityManager.HasComponent<Curve>(endpoint.Item1) &&
                        (EntityManager.HasComponent<Road>(endpoint.Item1) || IsTransportTrack && EntityManager.HasComponent<PrefabRef>(endpoint.Item1) && EntityManager.HasComponent<TrackData>(EntityManager.GetComponentData<PrefabRef>(endpoint.Item1).m_Prefab) || IsUtilityNetwork && EntityManager.HasComponent<PrefabRef>(endpoint.Item1) && IsUtilityPrefab(EntityManager.GetComponentData<PrefabRef>(endpoint.Item1).m_Prefab)))
                        actual = MathUtils.Position(EntityManager.GetComponentData<Curve>(endpoint.Item1).m_Bezier, endpoint.Item3);
                    else if (EntityManager.HasComponent<Node>(endpoint.Item1)) actual = EntityManager.GetComponentData<Node>(endpoint.Item1).m_Position;
                    else return false;
                    if (math.distance(actual, endpoint.Item2) > 0.1f) return false;
                }
            }
            return true;
        }
        private bool PlannedZoningValid()
        {
            var op = m_Operation;
            if (op.Segments.Count == 0 || op.PlannerGridSize <= 0 || math.abs(op.PlannerGridSize / 8f - math.round(op.PlannerGridSize / 8f)) > 0.001f) return false;
            foreach (var segment in op.Segments)
            {
                if (math.abs(segment.Start.x - segment.End.x) > 0.01f && math.abs(segment.Start.z - segment.End.z) > 0.01f) return false;
                if (segment.Role == "connection") continue;
                foreach (var value in new[] { segment.Start.x, segment.Start.z, segment.End.x, segment.End.z })
                    if (math.abs(value / op.PlannerGridSize - math.round(value / op.PlannerGridSize)) > 0.01f) return false;
            }
            return true;
        }
        private bool TryReadAppliedZoning(List<Entity> edges, out bool orderly)
        {
            var op = m_Operation; orderly = false;
            int blocks = 0, cellsTotal = 0, clear = 0, frontageClear = 0, blocked = 0, shared = 0, occupied = 0, redundant = 0;
            bool axisAligned = true, sizesMatch = true, lattice = true; float? phaseX = null, phaseZ = null;
            float Phase(float value)
            {
                var result = value - math.floor(value / 8f) * 8f;
                return result > 7.99f || result < 0.01f ? 0f : result;
            }
            bool SamePhase(float a, float b)
            {
                var delta = math.abs(a - b);
                return math.min(delta, 8f - delta) < 0.05f;
            }
            foreach (var edge in edges)
            {
                if (op.GridAutoConnect) { phaseX = null; phaseZ = null; }
                if (!EntityManager.Exists(edge) || !EntityManager.HasBuffer<Game.Zones.SubBlock>(edge)) return false;
                var subBlocks = EntityManager.GetBuffer<Game.Zones.SubBlock>(edge, true);
                if (subBlocks.Length == 0) return false;
                var seen = new HashSet<Entity>();
                for (int i = 0; i < subBlocks.Length; i++)
                {
                    var blockEntity = subBlocks[i].m_SubBlock;
                    if (!seen.Add(blockEntity)) continue;
                    if (!EntityManager.Exists(blockEntity) || EntityManager.HasComponent<Deleted>(blockEntity) ||
                        !EntityManager.HasComponent<Game.Zones.Block>(blockEntity) || !EntityManager.HasBuffer<Game.Zones.Cell>(blockEntity)) return false;
                    var block = EntityManager.GetComponentData<Game.Zones.Block>(blockEntity);
                    var cells = EntityManager.GetBuffer<Game.Zones.Cell>(blockEntity, true);
                    if (cells.Length == 0) return false;
                    blocks++;
                    axisAligned &= math.abs(math.abs(block.m_Direction.x) - 1f) < 0.001f && math.abs(block.m_Direction.y) < 0.001f ||
                        math.abs(math.abs(block.m_Direction.y) - 1f) < 0.001f && math.abs(block.m_Direction.x) < 0.001f;
                    sizesMatch &= block.m_Size.x > 0 && block.m_Size.y > 0 && cells.Length == block.m_Size.x * block.m_Size.y;
                    for (int cellIndex = 0; cellIndex < cells.Length; cellIndex++)
                    {
                        var flags = cells[cellIndex].m_State; cellsTotal++;
                        if ((flags & Game.Zones.CellFlags.Blocked) != 0) blocked++;
                        if ((flags & Game.Zones.CellFlags.Shared) != 0) shared++;
                        if ((flags & Game.Zones.CellFlags.Occupied) != 0) occupied++;
                        if ((flags & Game.Zones.CellFlags.Redundant) != 0) redundant++;
                        var isClear = (flags & (Game.Zones.CellFlags.Blocked | Game.Zones.CellFlags.Shared | Game.Zones.CellFlags.Occupied | Game.Zones.CellFlags.Redundant)) == 0;
                        if (isClear) { clear++; if ((flags & Game.Zones.CellFlags.Roadside) != 0) frontageClear++; }
                        if (block.m_Size.x <= 0) { lattice = false; continue; }
                        var position = Game.Zones.ZoneUtils.GetCellPosition(block, new int2(cellIndex % block.m_Size.x, cellIndex / block.m_Size.x));
                        var px = Phase(position.x); var pz = Phase(position.z);
                        if (!phaseX.HasValue) { phaseX = px; phaseZ = pz; }
                        else if (!SamePhase(phaseX.Value, px) || !SamePhase(phaseZ.Value, pz)) lattice = false;
                    }
                }
            }
            op.ZoningBlockCount = blocks; op.ZoningCellCount = cellsTotal; op.ZoningClearCellCount = clear; op.ZoningFrontageClearCellCount = frontageClear;
            op.ZoningBlockedCellCount = blocked; op.ZoningSharedCellCount = shared; op.ZoningOccupiedCellCount = occupied; op.ZoningRedundantCellCount = redundant;
            op.ZoningOrderly = blocks > 0 && cellsTotal > 0 && axisAligned && sizesMatch && lattice;
            orderly = op.ZoningOrderly.Value;
            return true;
        }
        private bool ReadPreview(out string signature)
        {
            var op = m_Operation; op.Errors.Clear(); op.Cost = 0; m_Candidates.Clear(); m_SplitRemnants.Clear();
            var targetPreviews = new HashSet<Entity>(); int generatedPreviewCount = 0;
            if (!m_ErrorQuery.IsEmptyIgnoreFilter) op.Errors.Add("GAME_VALIDATION_ERROR");
            if (!m_WarningQuery.IsEmptyIgnoreFilter) op.Errors.Add("GAME_VALIDATION_WARNING");
            using (var all = m_TempQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (var e in all)
                {
                    var temp = EntityManager.GetComponentData<Temp>(e);
                    if ((temp.m_Flags & TempFlags.Cancel) == 0) generatedPreviewCount++;
                    if (op.OperationType != "create" && (op.TargetEdges.Contains(temp.m_Original) || op.TargetNodes.Contains(temp.m_Original)) &&
                        (IsDemolish ? (temp.m_Flags & TempFlags.Delete) != 0 : (temp.m_Flags & TempFlags.Delete) == 0)) targetPreviews.Add(temp.m_Original);
                    if ((temp.m_Flags & TempFlags.Cancel) == 0) op.Cost += temp.m_Cost;
                    if (temp.m_Original != Entity.Null && EntityManager.HasComponent<Game.Buildings.Building>(temp.m_Original) && (temp.m_Flags & (TempFlags.Delete | TempFlags.Replace)) != 0)
                        op.Errors.Add("WOULD_REMOVE_BUILDING");
                    if (EntityManager.HasComponent<Game.Buildings.Building>(e)) op.Errors.Add("UNEXPECTED_BUILDING_PREVIEW");
                }
            }
            using (var roads = m_RoadQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (var e in roads)
                {
                    var temp = EntityManager.GetComponentData<Temp>(e);
                    var generatedPrefab = EntityManager.GetComponentData<PrefabRef>(e).m_Prefab;
                    if (IsTransportTrack)
                    {
                        if (!EntityManager.HasComponent<TrackData>(generatedPrefab)) continue;
                        if (IsDemolish)
                        {
                            if (op.TargetEdges.Contains(temp.m_Original) && (temp.m_Flags & TempFlags.Delete) != 0) m_Candidates.Add(e);
                        }
                        else if (op.OperationType == "create" && temp.m_Original == Entity.Null && (temp.m_Flags & (TempFlags.Delete | TempFlags.Cancel)) == 0)
                        {
                            if (generatedPrefab != op.Prefab) op.Errors.Add("UNEXPECTED_TRACK_PREVIEW"); else m_Candidates.Add(e);
                        }
                        continue;
                    }
                    if (IsUtilityNetwork)
                    {
                        if (!IsUtilityPrefab(generatedPrefab)) continue;
                        if (IsDemolish)
                        {
                            if (op.TargetEdges.Contains(temp.m_Original) && (temp.m_Flags & TempFlags.Delete) != 0) m_Candidates.Add(e);
                        }
                        else if (IsUpgrade)
                        {
                            if (op.TargetEdges.Contains(temp.m_Original) && (temp.m_Flags & (TempFlags.Delete | TempFlags.Cancel)) == 0)
                            { if (generatedPrefab != op.Prefab) op.Errors.Add("UNEXPECTED_UTILITY_PREVIEW"); else m_Candidates.Add(e); }
                        }
                        else if (op.OperationType == "create" && temp.m_Original == Entity.Null && (temp.m_Flags & (TempFlags.Delete | TempFlags.Cancel)) == 0)
                        { if (generatedPrefab != op.Prefab) op.Errors.Add("UNEXPECTED_UTILITY_PREVIEW"); else m_Candidates.Add(e); }
                        continue;
                    }
                    if (!EntityManager.HasComponent<Road>(e)) continue;
                    if (IsUpgrade || IsReverse || IsElevation || IsZoning || IsRoadFeatures || IsIntersectionRules)
                    {
                        if (!op.TargetEdges.Contains(temp.m_Original) || (temp.m_Flags & (TempFlags.Delete | TempFlags.Cancel)) != 0) continue;
                        var expectedPrefab = op.Prefab;
                        if (IsReverse || IsElevation || IsZoning || IsRoadFeatures || IsIntersectionRules)
                        {
                            var plan = op.Segments.Find(s => s.TargetEdge == temp.m_Original);
                            expectedPrefab = plan == null ? Entity.Null : plan.OriginalPrefab;
                        }
                        if (EntityManager.GetComponentData<PrefabRef>(e).m_Prefab != expectedPrefab) { op.Errors.Add("UNEXPECTED_ROAD_PREVIEW"); continue; }
                        m_Candidates.Add(e); continue;
                    }
                    if (op.OperationType != "create" || temp.m_Original != Entity.Null || (temp.m_Flags & (TempFlags.Delete | TempFlags.Cancel)) != 0) continue;
                    if (!ExpectedRoadPrefab(generatedPrefab))
                    {
                        if (!IsSplitRemnantOfExistingRoad(e, generatedPrefab)) { op.Errors.Add("UNEXPECTED_ROAD_PREVIEW"); continue; }
                        m_SplitRemnants.Add(e); continue;
                    }
                    m_Candidates.Add(e);
                }
            }
            m_Candidates.Sort((a, b) => a.Index.CompareTo(b.Index));
            m_SplitRemnants.Sort((a, b) => a.Index.CompareTo(b.Index));
            op.SplitRemnantEdges = new List<Entity>(m_SplitRemnants);
            signature = op.Cost + ":" + targetPreviews.Count + ":" + string.Join(",", m_Candidates.ConvertAll(e => e.Index + ":" + e.Version))
                + ":" + string.Join(",", m_SplitRemnants.ConvertAll(e => e.Index + ":" + e.Version)) + ":" + op.Errors.ToString(Newtonsoft.Json.Formatting.None);
            // Adjacent changes can be coalesced and lose a one-to-one Temp/original mapping in the
            // native network preview. This tool starts from an empty Temp set, rejects all game
            // errors and building removals, and verifies every permanent target after Apply.
            return IsDemolish || IsUpgrade || IsReverse || IsElevation || IsZoning || IsRoadFeatures || IsIntersectionRules || IsIntersectionControl || IsIntersectionRoundabout ? generatedPreviewCount > 0 : m_Candidates.Count > 0;
        }
        private bool ExpectedRoadPrefab(Entity prefab)
        {
            if (prefab == m_Operation.Prefab) return true;
            foreach (var segment in m_Operation.Segments)
            {
                if (segment.Prefab != Entity.Null && prefab == segment.Prefab) return true;
                foreach (var target in new[] { segment.StartTarget, segment.EndTarget })
                    if (target != Entity.Null && EntityManager.Exists(target) && EntityManager.HasComponent<Edge>(target) && EntityManager.HasComponent<PrefabRef>(target) && EntityManager.GetComponentData<PrefabRef>(target).m_Prefab == prefab)
                        return true;
            }
            return false;
        }
        // A new road that joins the middle of an older, different-prefab road makes the game split
        // that older edge at a freshly inserted node. Both halves come back as new preview edges
        // whose prefab is the OLD road's prefab, so ExpectedRoadPrefab rejects them even though the
        // game itself raised no error. Such edges are legitimate and must be kept: dropping them
        // would truncate the road the caller joined.
        //
        // A split always yields exactly the two halves of one edge, so a split remnant is always
        // node-adjacent to a sibling preview edge carrying the very same prefab. A genuinely wrong
        // prefab cannot satisfy that, because the operation only ever generates its own prefab.
        private bool IsSplitRemnantOfExistingRoad(Entity edge, Entity prefab)
        {
            if (!EntityManager.Exists(edge) || !EntityManager.HasComponent<Edge>(edge)) return false;
            var endpoints = EntityManager.GetComponentData<Edge>(edge);
            if (endpoints.m_Start == Entity.Null && endpoints.m_End == Entity.Null) return false;
            using (var roads = m_RoadQuery.ToEntityArray(Allocator.Temp))
            {
                for (int i = 0; i < roads.Length; i++)
                {
                    var other = roads[i];
                    if (other == edge || !EntityManager.HasComponent<PrefabRef>(other) || !EntityManager.HasComponent<Edge>(other)) continue;
                    if (EntityManager.GetComponentData<PrefabRef>(other).m_Prefab != prefab) continue;
                    var sibling = EntityManager.GetComponentData<Edge>(other);
                    if (SharesAnyNode(endpoints, sibling)) return true;
                }
            }
            return false;
        }
        private static bool SharesAnyNode(Edge a, Edge b) =>
            (a.m_Start != Entity.Null && (a.m_Start == b.m_Start || a.m_Start == b.m_End)) ||
            (a.m_End != Entity.Null && (a.m_End == b.m_Start || a.m_End == b.m_End));
        private void CreateDefinition()
        {
            var op = m_Operation; m_Definitions.Clear();
            if (IsElevation)
            {
                for (int i = 0; i < op.ElevatedNodes.Count; i++)
                {
                    var plan = op.ElevatedNodes[i]; var definition = EntityManager.CreateEntity(); m_Definitions.Add(definition);
                    EntityManager.AddComponentData(definition, new CreationDefinition { m_Original = plan.Node, m_Prefab = plan.Prefab,
                        m_Flags = CreationFlags.SubElevation, m_RandomSeed = 1 + ((op.Id.GetHashCode() + i) & 0x3fffffff) });
                    var startPos = new CoursePos { m_Entity = plan.Node, m_Position = plan.Position, m_Elevation = new float2(plan.Elevation),
                        m_CourseDelta = 0, m_ParentMesh = -1 };
                    var endPos = startPos; endPos.m_CourseDelta = 1;
                    EntityManager.AddComponentData(definition, new NetCourse { m_Curve = new Bezier4x3(plan.Position, plan.Position, plan.Position, plan.Position),
                        m_StartPosition = startPos, m_EndPosition = endPos, m_Length = 0, m_Elevation = new float2(plan.Elevation), m_FixedIndex = -1 });
                    EntityManager.AddComponent<Updated>(definition);
                }
            }
            if (IsIntersectionControl || IsIntersectionRoundabout)
            {
                for (int i = 0; i < op.Segments.Count; i++)
                {
                    var segment = op.Segments[i]; var position = segment.Start;
                    var definition = EntityManager.CreateEntity(); m_Definitions.Add(definition);
                    EntityManager.AddComponentData(definition, new CreationDefinition { m_Original = segment.TargetNode, m_Prefab = segment.OriginalPrefab,
                        m_Flags = CreationFlags.Align | CreationFlags.SubElevation | CreationFlags.Upgrade | CreationFlags.Parent,
                        m_RandomSeed = 1 + ((op.Id.GetHashCode() + i) & 0x3fffffff) });
                    EntityManager.AddComponentData(definition, new Upgraded { m_Flags = segment.UpgradeFlags });
                    EntityManager.AddComponentData(definition, new NetCourse { m_Curve = segment.Curve,
                        m_StartPosition = new CoursePos { m_Entity = segment.TargetNode, m_Position = position, m_Elevation = new float2(0), m_CourseDelta = 0, m_ParentMesh = -1, m_Flags = CoursePosFlags.IsFirst },
                        m_EndPosition = new CoursePos { m_Entity = segment.TargetNode, m_Position = position, m_Elevation = new float2(0), m_CourseDelta = 1, m_ParentMesh = -1, m_Flags = CoursePosFlags.IsLast },
                        m_Length = 0, m_Elevation = new float2(0), m_FixedIndex = -1 });
                    EntityManager.AddComponent<Updated>(definition);
                }
                return;
            }
            if (op.OperationType != "create")
            {
                for (int i = 0; i < op.Segments.Count; i++)
                {
                    var segment = op.Segments[i]; var curve = segment.Curve;
                    CoursePos ExistingPoint(float3 p, Entity node, float elevation, bool first) => new CoursePos {
                        m_Entity = node, m_Position = p, m_Rotation = NetUtils.GetNodeRotation(first ? MathUtils.StartTangent(curve) : MathUtils.EndTangent(curve)),
                        m_Elevation = new float2(elevation), m_CourseDelta = first ? 0 : 1, m_ParentMesh = -1,
                        m_Flags = first ? CoursePosFlags.IsFirst : CoursePosFlags.IsLast };
                    var definition = EntityManager.CreateEntity(); m_Definitions.Add(definition);
                    var flags = CreationFlags.Align | CreationFlags.SubElevation;
                    if (IsDemolish) flags |= CreationFlags.Delete;
                    if (IsReverse) flags |= CreationFlags.Invert;
                    if (IsZoning || IsRoadFeatures || IsIntersectionRules) flags |= CreationFlags.Upgrade | CreationFlags.Parent;
                    EntityManager.AddComponentData(definition, new CreationDefinition { m_Original = segment.TargetEdge, m_Prefab = IsDemolish || IsReverse || IsZoning || IsRoadFeatures || IsIntersectionRules ? segment.OriginalPrefab : op.Prefab, m_Flags = flags,
                        m_RandomSeed = 1 + ((op.Id.GetHashCode() + i) & 0x3fffffff) });
                    if (IsZoning || IsRoadFeatures || IsIntersectionRules) EntityManager.AddComponentData(definition, new Upgraded { m_Flags = segment.UpgradeFlags });
                    EntityManager.AddComponentData(definition, new NetCourse { m_Curve = curve,
                        m_StartPosition = ExistingPoint(segment.Start, segment.StartTarget, segment.StartElevation, true),
                        m_EndPosition = ExistingPoint(segment.End, segment.EndTarget, segment.EndElevation, false),
                        m_Length = MathUtils.Length(curve), m_Elevation = new float2(0), m_FixedIndex = -1 });
                    EntityManager.AddComponent<Updated>(definition);
                }
                return;
            }
            for (int i = 0; i < op.Segments.Count; i++)
            {
                var segment = op.Segments[i]; var curve = segment.Curve;
                CoursePos Point(float3 p, Entity target, float split, float elevation, bool first) => new CoursePos {
                    m_Entity = target, m_Position = p, m_Rotation = NetUtils.GetNodeRotation(first ? MathUtils.StartTangent(curve) : MathUtils.EndTangent(curve)),
                    m_Elevation = new float2(elevation), m_CourseDelta = first ? 0 : 1, m_ParentMesh = -1, m_SplitPosition = split,
                    m_Flags = (first ? CoursePosFlags.IsFirst : CoursePosFlags.IsLast) | CoursePosFlags.IsLeft | CoursePosFlags.IsRight |
                        (elevation >= 8 ? CoursePosFlags.ForceElevatedNode | CoursePosFlags.ForceElevatedEdge : 0) };
                var definition = EntityManager.CreateEntity(); m_Definitions.Add(definition);
                EntityManager.AddComponentData(definition, new CreationDefinition { m_Prefab = segment.Prefab != Entity.Null ? segment.Prefab : op.Prefab, m_Flags = CreationFlags.SubElevation, m_RandomSeed = 1 + ((op.Id.GetHashCode() + i) & 0x3fffffff) });
                EntityManager.AddComponentData(definition, new NetCourse { m_Curve = curve,
                    m_StartPosition = Point(segment.Start, segment.StartTarget, segment.StartSplit, segment.StartElevation, true),
                    m_EndPosition = Point(segment.End, segment.EndTarget, segment.EndSplit, segment.EndElevation, false),
                    m_Length = MathUtils.Length(curve), m_Elevation = new float2(0), m_FixedIndex = -1 });
                EntityManager.AddComponent<Updated>(definition);
            }
        }
        private void DestroyDefinition()
        {
            foreach (var definition in m_Definitions) if (definition != Entity.Null && EntityManager.Exists(definition)) EntityManager.DestroyEntity(definition);
            m_Definitions.Clear();
        }
        private void Fail(string reason)
        {
            m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "failed"; m_Operation.Error = reason;
            Mod.log.Warn("Road operation " + m_Operation.Id + ": " + reason);
            Finish();
        }
        private void Finish()
        {
            DestroyDefinition(); applyMode = ApplyMode.Clear; m_Operation = null;
            if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem;
        }
    }
}
