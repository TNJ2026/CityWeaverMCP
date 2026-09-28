using System;
using System.Collections.Generic;
using System.Linq;
using Game.Common;
using Game.Pathfind;
using Game.Prefabs;
using Game.Routes;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CityWeaver
{
    // Use the same definitions and ApplyRoutesSystem as the player's route tool.
    // Never leave a permanent route behind merely to discover whether it can connect.
    public sealed partial class McpWorkRouteToolSystem : ToolBaseSystem
    {
        private WorkRouteOperation m_Operation;
        private Entity m_Definition, m_Preview;
        private EntityQuery m_Temps, m_Routes;
        private int m_Phase, m_Ticks, m_StableTicks;
        private string m_Signature;
        public override string toolID => "McpWorkRoute";
        public override PrefabBase GetPrefab() => m_Operation == null ? null : m_PrefabSystem.GetPrefab<PrefabBase>(m_Operation.Prefab);
        public override bool TrySetPrefab(PrefabBase prefab) => false;

        protected override void OnCreate()
        {
            base.OnCreate();
            m_Temps = GetEntityQuery(ComponentType.ReadOnly<Temp>(), ComponentType.Exclude<Deleted>());
            m_Routes = GetEntityQuery(ComponentType.ReadOnly<Temp>(), ComponentType.ReadOnly<Game.Routes.WorkRoute>(), ComponentType.ReadOnly<RouteWaypoint>(), ComponentType.Exclude<Deleted>());
        }
        public void Begin(WorkRouteOperation op)
        {
            if (m_Operation != null || !m_Temps.IsEmptyIgnoreFilter) throw new QueryException("TOOL_BUSY", "Another tool preview is active.");
            m_Operation = op; m_Phase = m_Ticks = m_StableTicks = 0; m_Signature = null;
            m_Definition = m_Preview = Entity.Null;
            applyMode = ApplyMode.Clear; m_ToolSystem.activeTool = this;
        }
        public void AbortForLoading()
        {
            if (m_Operation != null && !m_Operation.Terminal)
            { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "CITY_SESSION_CHANGED"; }
            Finish();
        }
        protected override void OnStopRunning()
        {
            if (m_Operation != null && !m_Operation.Terminal)
            { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "USER_CHANGED_TOOL"; }
            ClearDefinition(); m_Operation = null; applyMode = ApplyMode.Clear; base.OnStopRunning();
        }
        protected override JobHandle OnUpdate(JobHandle deps)
        {
            deps.Complete(); EntityManager.CompleteAllTrackedJobs();
            if (m_Operation == null) { applyMode = ApplyMode.Clear; return default; }
            try { Tick(); }
            catch (Exception e) { Mod.log.Error(e, "Native work route failed"); Fail("WORK_ROUTE_INTERNAL_ERROR"); }
            return default;
        }
        private bool SnapshotValid()
        {
            var op = m_Operation;
            if (!EntityManager.Exists(op.Owner) || EntityManager.HasComponent<Deleted>(op.Owner) ||
                !EntityManager.HasComponent<PrefabRef>(op.Owner) || EntityManager.GetComponentData<PrefabRef>(op.Owner).m_Prefab != op.OwnerPrefab) return false;
            for (int i = 0; i < op.Stops.Count; i++)
            {
                var stop = op.Stops[i];
                if (stop == Entity.Null) continue;
                if (!EntityManager.Exists(stop) || EntityManager.HasComponent<Deleted>(stop) ||
                    !EntityManager.HasComponent<Game.Objects.Transform>(stop) ||
                    math.distance(EntityManager.GetComponentData<Game.Objects.Transform>(stop).m_Position, op.Points[i]) > .25f) return false;
            }
            return true;
        }
        private void Tick()
        {
            var op = m_Operation; ++m_Ticks;
            if (!op.ApplyDispatched && (op.CancelRequested || DateTime.UtcNow >= op.Expires))
            { op.State = op.CancelRequested ? "cancelled" : "expired"; Finish(); return; }
            if (m_Phase == 0)
            {
                if (m_Ticks < 3) return;
                if (!SnapshotValid()) { Fail("WORK_ROUTE_TARGET_CHANGED"); return; }
                m_Definition = EntityManager.CreateEntity();
                EntityManager.AddComponentData(m_Definition, new CreationDefinition { m_Prefab = op.Prefab, m_Owner = op.Owner });
                var points = EntityManager.AddBuffer<WaypointDefinition>(m_Definition);
                for (int i = 0; i <= op.Points.Count; i++)
                { int j = i % op.Points.Count; points.Add(new WaypointDefinition(op.Points[j]) { m_Connection = op.Stops[j] }); }
                EntityManager.AddComponent<Updated>(m_Definition);
                op.State = "generating_preview"; applyMode = ApplyMode.None; m_Phase = 1; m_Ticks = 0; return;
            }
            if (m_Phase == 1) { ClearDefinition(); m_Phase = 2; m_Ticks = 0; return; }
            if (m_Phase == 2)
            {
                if (m_Ticks < 5) return;
                bool ready = ReadPreview(out var signature);
                m_StableTicks = signature == m_Signature ? m_StableTicks + 1 : 0; m_Signature = signature;
                if (!ready || m_StableTicks < 5 || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply())
                { if (m_Ticks >= 600) Fail("WORK_ROUTE_NATIVE_VALIDATION_FAILED"); return; }
                op.State = "preview_ready"; m_Phase = 3; m_Ticks = 0; return;
            }
            if (m_Phase == 3)
            {
                if (!op.CommitRequested) return;
                if (!SnapshotValid()) { Fail("WORK_ROUTE_TARGET_CHANGED"); return; }
                if (!ReadPreview(out var signature) || signature != m_Signature || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply())
                { Fail("PREVIEW_NO_LONGER_VALID"); return; }
                if (World.GetExistingSystemManaged<Game.Simulation.SimulationSystem>().selectedSpeed != 0) { Fail("CITY_MUST_BE_PAUSED"); return; }
                op.ApplyDispatched = true; op.State = "applying"; applyMode = ApplyMode.Apply; m_Phase = 4; m_Ticks = 0; return;
            }
            if (m_Phase == 4)
            {
                applyMode = ApplyMode.None;
                if (m_Ticks < 10) return;
                if (EntityManager.Exists(m_Preview) && !EntityManager.HasComponent<Temp>(m_Preview) && !EntityManager.HasComponent<Deleted>(m_Preview) &&
                    EntityManager.HasComponent<Owner>(m_Preview) && EntityManager.GetComponentData<Owner>(m_Preview).m_Owner == op.Owner)
                {
                    op.Result = m_Preview;
                    var evidence = WorkRouteConnectivity.Read(EntityManager, m_Preview, op.EntityId);
                    op.ConnectionDetails = evidence;
                    if ((bool)evidence["path_ready"]) { op.State = "completed"; Finish(); return; }
                }
                if (m_Ticks >= 180) Fail("WORK_ROUTE_PERMANENT_READBACK_FAILED");
            }
        }
        private bool ReadPreview(out string signature)
        {
            var op = m_Operation; op.Errors.Clear();
            using (var routes = m_Routes.ToEntityArray(Allocator.Temp))
                foreach (var route in routes)
                    if (EntityManager.HasComponent<Owner>(route) && EntityManager.GetComponentData<Owner>(route).m_Owner == op.Owner &&
                        EntityManager.GetComponentData<PrefabRef>(route).m_Prefab == op.Prefab &&
                        EntityManager.GetComponentData<Temp>(route).m_Original == Entity.Null) m_Preview = route;
            if (m_Preview == Entity.Null || !EntityManager.Exists(m_Preview))
            { signature = "missing"; return false; }
            op.ConnectionDetails = WorkRouteConnectivity.Read(EntityManager, m_Preview, op.EntityId);
            if (!(bool)op.ConnectionDetails["stops_ready"]) op.Errors.Add("WORK_ROUTE_STOP_LANE_MISSING");
            if (!(bool)op.ConnectionDetails["segments_ready"]) op.Errors.Add("WORK_ROUTE_SEGMENT_PATH_MISSING");
            if (!m_ErrorQuery.IsEmptyIgnoreFilter) op.Errors.Add("GAME_VALIDATION_ERROR");
            signature = m_Preview + ":" + op.ConnectionDetails.ToString(Newtonsoft.Json.Formatting.None);
            return (bool)op.ConnectionDetails["path_ready"] && op.Errors.Count == 0;
        }
        private void ClearDefinition() { if (EntityManager.Exists(m_Definition)) EntityManager.DestroyEntity(m_Definition); m_Definition = Entity.Null; }
        private void Fail(string reason)
        { if (m_Operation == null) return; m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "failed"; m_Operation.Error = reason; Finish(); }
        private void Finish() { ClearDefinition(); applyMode = ApplyMode.Clear; m_Operation = null; if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem; }
    }

    internal static class WorkRouteConnectivity
    {
        internal static JObject Read(EntityManager em, Entity route, Func<Entity, string> id)
        {
            var stops = new JArray(); var segments = new JArray(); bool stopsReady = true, segmentsReady = true;
            if (!em.HasBuffer<RouteWaypoint>(route) || !em.HasBuffer<RouteSegment>(route))
                return new JObject { ["stops_ready"] = false, ["segments_ready"] = false, ["path_ready"] = false };
            foreach (var entry in em.GetBuffer<RouteWaypoint>(route, true))
            {
                var wp = entry.m_Waypoint;
                var lane = em.HasComponent<RouteLane>(wp) ? em.GetComponentData<RouteLane>(wp) : default;
                bool ready = lane.m_StartLane != Entity.Null && lane.m_EndLane != Entity.Null && em.Exists(lane.m_StartLane) && em.Exists(lane.m_EndLane) &&
                    !em.HasComponent<Deleted>(lane.m_StartLane) && !em.HasComponent<Deleted>(lane.m_EndLane);
                if (em.HasComponent<Connected>(wp))
                { var stop = em.GetComponentData<Connected>(wp).m_Connected; ready &= stop != Entity.Null && em.Exists(stop) && !em.HasComponent<Deleted>(stop); }
                stopsReady &= ready;
                stops.Add(new JObject { ["waypoint_id"] = id(wp), ["stop_id"] = em.HasComponent<Connected>(wp) ? id(em.GetComponentData<Connected>(wp).m_Connected) : null,
                    ["start_lane_id"] = id(lane.m_StartLane), ["end_lane_id"] = id(lane.m_EndLane), ["ready"] = ready });
            }
            foreach (var entry in em.GetBuffer<RouteSegment>(route, true))
            {
                var segment = entry.m_Segment;
                int count = em.HasBuffer<PathElement>(segment) ? em.GetBuffer<PathElement>(segment, true).Length : 0;
                bool hasInfo = em.HasComponent<PathInformation>(segment);
                var info = hasInfo ? em.GetComponentData<PathInformation>(segment) : default;
                bool ready = hasInfo && WorkRoutePathValidation.Ready(count, info.m_Distance, (int)info.m_State);
                segmentsReady &= ready;
                segments.Add(new JObject { ["segment_id"] = id(segment), ["path_element_count"] = count, ["distance_m"] = hasInfo ? (float?)info.m_Distance : null,
                    ["path_flags"] = hasInfo ? info.m_State.ToString() : null, ["ready"] = ready });
            }
            stopsReady &= stops.Count >= 2; segmentsReady &= segments.Count == stops.Count;
            return new JObject { ["stops_ready"] = stopsReady, ["segments_ready"] = segmentsReady,
                ["path_ready"] = stopsReady && segmentsReady && em.HasComponent<Route>(route) && (em.GetComponentData<Route>(route).m_Flags & RouteFlags.Complete) != 0,
                ["waypoints"] = stops, ["segments"] = segments,
                ["vehicle_count"] = em.HasBuffer<RouteVehicle>(route) ? em.GetBuffer<RouteVehicle>(route, true).Length : 0 };
        }
    }
}
