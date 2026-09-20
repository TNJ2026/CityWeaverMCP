using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Game.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;
using NetCarLane = Game.Net.CarLane;
using NetParkingLane = Game.Net.ParkingLane;
using NetSubLane = Game.Net.SubLane;

namespace CityWeaver
{
    public sealed class RoadDirectChange
    {
        public Entity Entity;
        public Entity OwnerEdge;
        public string Kind;
        public bool HasCar, HasParking, HasName;
        public NetCarLane BeforeCar, AfterCar;
        public NetParkingLane BeforeParking, AfterParking;
        public string BeforeName, AfterName;

        public RoadDirectChange Reverse() => new RoadDirectChange {
            Entity = Entity, OwnerEdge = OwnerEdge, Kind = Kind, HasCar = HasCar, HasParking = HasParking, HasName = HasName,
            BeforeCar = AfterCar, AfterCar = BeforeCar, BeforeParking = AfterParking, AfterParking = BeforeParking,
            BeforeName = AfterName, AfterName = BeforeName
        };

        public JObject Json(RoadOperation operation)
        {
            var value = new JObject { ["entity_id"] = operation.EntityId(Entity), ["owner_edge_id"] = operation.EntityId(OwnerEdge), ["kind"] = Kind };
            if (HasCar)
            {
                value["before"] = CarJson(BeforeCar); value["after"] = CarJson(AfterCar);
            }
            else if (HasParking)
            {
                value["before"] = ParkingJson(BeforeParking); value["after"] = ParkingJson(AfterParking);
            }
            else if (HasName)
            {
                value["before"] = BeforeName == null ? JValue.CreateNull() : new JValue(BeforeName);
                value["after"] = AfterName == null ? JValue.CreateNull() : new JValue(AfterName);
            }
            return value;
        }

        private static JObject CarJson(NetCarLane lane) => new JObject {
            ["speed_limit_kph"] = lane.m_SpeedLimit * 3.6f,
            ["default_speed_limit_kph"] = lane.m_DefaultSpeedLimit * 3.6f,
            ["public_transport_only"] = (lane.m_Flags & CarLaneFlags.PublicOnly) != 0,
            ["left_turn"] = (lane.m_Flags & (CarLaneFlags.TurnLeft | CarLaneFlags.GentleTurnLeft)) != 0,
            ["right_turn"] = (lane.m_Flags & (CarLaneFlags.TurnRight | CarLaneFlags.GentleTurnRight)) != 0,
            ["straight"] = (lane.m_Flags & CarLaneFlags.Forward) != 0,
            ["flags"] = lane.m_Flags.ToString()
        };
        private static JObject ParkingJson(NetParkingLane lane) => new JObject {
            ["allowed"] = (lane.m_Flags & ParkingLaneFlags.ParkingDisabled) == 0,
            ["fee"] = lane.m_ParkingFee,
            ["free_space_m"] = lane.m_FreeSpace,
            ["flags"] = lane.m_Flags.ToString()
        };
    }

    public sealed partial class GameQueryService
    {
        private static JObject RoadPrefabTraits(string name, Entity prefab, EntityManager em)
        {
            var lower = name.ToLowerInvariant(); var structure = "standard";
            if (em.HasComponent<BridgeData>(prefab) || lower.Contains("bridge")) structure = "bridge";
            else if (lower.Contains("quay") || lower.Contains("harbor")) structure = "quay";
            else if (lower.Contains("retaining")) structure = "retaining_wall";
            else if (lower.Contains("tunnel")) structure = "tunnel";
            int laneCount = 0;
            for (int lanes = 1; lanes <= 12; lanes++) if (lower.Contains(lanes + " lane") || lower.Contains(lanes + "-lane")) { laneCount = lanes; break; }
            return new JObject { ["structure_type"] = structure, ["advertised_lane_count"] = laneCount == 0 ? JValue.CreateNull() : new JValue(laneCount),
                ["includes_parking"] = lower.Contains("parking"), ["public_transport_road"] = lower.Contains("bus") || lower.Contains("tram"),
                ["bridge_prefab"] = em.HasComponent<BridgeData>(prefab), ["quay_or_retaining_profile"] = structure == "quay" || structure == "retaining_wall" };
        }

        private static bool IsPermanentRoad(EntityManager em, Entity entity) => em.Exists(entity) && em.HasComponent<Edge>(entity) &&
            em.HasComponent<Road>(entity) && em.HasComponent<PrefabRef>(entity) && !em.HasComponent<Deleted>(entity) && !em.HasComponent<Temp>(entity);

        private JObject InspectRoadLanes(JObject args, World world)
        {
            var em = world.EntityManager;
            var edgeIds = args["edge_ids"] as JArray;
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var result = new JArray();
            foreach (var token in edgeIds)
            {
                var edge = ParseEntity((string)token, em);
                if (!IsPermanentRoad(em, edge)) throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                var lanes = new JArray(); int carCount = 0, parkingCount = 0, usableParkingCount = 0, publicOnly = 0, bottlenecks = 0, bicycleCount = 0, dedicatedBicycleCount = 0;
                if (em.HasBuffer<NetSubLane>(edge))
                {
                    var buffer = em.GetBuffer<NetSubLane>(edge, true);
                    for (int i = 0; i < buffer.Length; i++)
                    {
                        var lane = buffer[i].m_SubLane;
                        if (!em.Exists(lane) || em.HasComponent<Deleted>(lane)) continue;
                        var row = new JObject { ["lane_id"] = EntityId(lane), ["buffer_index"] = i, ["path_methods"] = buffer[i].m_PathMethods.ToString() };
                        var methods = buffer[i].m_PathMethods;
                        var bicycleAllowed = (methods & Game.Pathfind.PathMethod.Bicycle) != 0;
                        if (em.HasComponent<NetCarLane>(lane) && (em.GetComponentData<NetCarLane>(lane).m_Flags & (CarLaneFlags.ForbidBicycles | CarLaneFlags.Forbidden)) != 0) bicycleAllowed = false;
                        var dedicatedBicycle = bicycleAllowed && (methods & (Game.Pathfind.PathMethod.Road | Game.Pathfind.PathMethod.Pedestrian | Game.Pathfind.PathMethod.Parking)) == 0;
                        if (bicycleAllowed) bicycleCount++;
                        if (dedicatedBicycle) dedicatedBicycleCount++;
                        row["bicycle_allowed"] = bicycleAllowed;
                        row["dedicated_bicycle_lane"] = dedicatedBicycle;
                        if (em.HasComponent<NetCarLane>(lane))
                        {
                            var car = em.GetComponentData<NetCarLane>(lane); carCount++;
                            if ((car.m_Flags & CarLaneFlags.PublicOnly) != 0) publicOnly++;
                            row["type"] = "car"; row["speed_limit_kph"] = car.m_SpeedLimit * 3.6f;
                            row["default_speed_limit_kph"] = car.m_DefaultSpeedLimit * 3.6f;
                            row["public_transport_only"] = (car.m_Flags & CarLaneFlags.PublicOnly) != 0;
                            row["left_turn"] = (car.m_Flags & (CarLaneFlags.TurnLeft | CarLaneFlags.GentleTurnLeft)) != 0;
                            row["right_turn"] = (car.m_Flags & (CarLaneFlags.TurnRight | CarLaneFlags.GentleTurnRight)) != 0;
                            row["straight"] = (car.m_Flags & CarLaneFlags.Forward) != 0;
                            row["flow_offset"] = car.m_FlowOffset; row["flags"] = car.m_Flags.ToString();
                        }
                        else if (em.HasComponent<NetParkingLane>(lane))
                        {
                            var parking = em.GetComponentData<NetParkingLane>(lane); parkingCount++;
                            var virtualLane = (parking.m_Flags & ParkingLaneFlags.VirtualLane) != 0;
                            if (!virtualLane && (parking.m_Flags & ParkingLaneFlags.ParkingDisabled) == 0) usableParkingCount++;
                            row["type"] = "parking"; row["allowed"] = (parking.m_Flags & ParkingLaneFlags.ParkingDisabled) == 0;
                            row["virtual"] = virtualLane; row["usable"] = !virtualLane && (parking.m_Flags & ParkingLaneFlags.ParkingDisabled) == 0;
                            row["fee"] = parking.m_ParkingFee; row["free_space_m"] = parking.m_FreeSpace; row["flags"] = parking.m_Flags.ToString();
                        }
                        else row["type"] = "other";
                        if (em.HasComponent<Bottleneck>(lane)) { var b = em.GetComponentData<Bottleneck>(lane); bottlenecks++; row["bottleneck_timer"] = b.m_Timer; }
                        if (em.HasComponent<LaneFlow>(lane))
                        {
                            var flow = em.GetComponentData<LaneFlow>(lane); row["flow_duration"] = new JArray(flow.m_Duration.x, flow.m_Duration.y, flow.m_Duration.z, flow.m_Duration.w);
                            row["flow_distance"] = new JArray(flow.m_Distance.x, flow.m_Distance.y, flow.m_Distance.z, flow.m_Distance.w);
                        }
                        lanes.Add(row);
                    }
                }
                var prefab = em.GetComponentData<PrefabRef>(edge).m_Prefab;
                var upgrades = em.HasComponent<Upgraded>(edge) ? em.GetComponentData<Upgraded>(edge).m_Flags : default(CompositionFlags);
                result.Add(new JObject { ["edge_id"] = EntityId(edge), ["prefab_entity_id"] = EntityId(prefab), ["car_lane_count"] = carCount,
                    ["left_bicycle_lane"] = (upgrades.m_Left & CompositionFlags.Side.SecondaryLane) != 0,
                    ["right_bicycle_lane"] = (upgrades.m_Right & CompositionFlags.Side.SecondaryLane) != 0,
                    ["bicycle_allowed_lane_count"] = bicycleCount, ["dedicated_bicycle_lane_count"] = dedicatedBicycleCount,
                    ["parking_lane_count"] = parkingCount, ["usable_parking_lane_count"] = usableParkingCount,
                    ["public_transport_only_lane_count"] = publicOnly, ["bottleneck_lane_count"] = bottlenecks, ["lanes"] = lanes });
            }
            return new JObject { ["items"] = result };
        }

        private JObject PreviewRoadPolicies(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["operation_type"] = "road_policies", ["edge_ids"] = args["edge_ids"]?.DeepClone(), ["lane_ids"] = args["lane_ids"]?.DeepClone(),
                ["road_name"] = args["road_name"]?.DeepClone(), ["speed_limit_kph"] = args["speed_limit_kph"]?.DeepClone(), ["parking_allowed"] = args["parking_allowed"]?.DeepClone(),
                ["parking_fee"] = args["parking_fee"]?.DeepClone(), ["public_transport_only"] = args["public_transport_only"]?.DeepClone(),
                ["left_turn"] = args["left_turn"]?.DeepClone(), ["right_turn"] = args["right_turn"]?.DeepClone(), ["straight"] = args["straight"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId)) { var old = m_RoadOperations[oldId]; if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another operation."); return old.Json(); }
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing road or lane policies.");
            if (args["parking_allowed"] != null || args["parking_fee"] != null)
                throw new QueryException("PARKING_POLICY_SCOPE", "Use preview_road_parking for persistent roadside parking. Parking fees are native district policies and cannot be scoped to one road lane.");
            string[] changeFields = { "road_name", "speed_limit_kph", "public_transport_only", "left_turn", "right_turn", "straight" };
            if (changeFields.All(field => args[field] == null)) throw new QueryException("INVALID_ARGUMENT", "Set at least one road or lane policy.");
            float? speed = null; if (args["speed_limit_kph"] != null) { speed = (float)args["speed_limit_kph"]; if (!math.isfinite(speed.Value) || speed < 5 || speed > 500) throw new QueryException("INVALID_ARGUMENT", "speed_limit_kph must be 5..500."); }
            var em = world.EntityManager; var edges = new List<Entity>(); var laneFilter = new HashSet<Entity>();
            if (args["lane_ids"] is JArray laneIds) foreach (var token in laneIds) laneFilter.Add(ParseEntity((string)token, em));
            if (!(args["edge_ids"] is JArray edgeIds) || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "road_policies", CurveMode = "existing", TransactionKind = "direct_atomic" };
            var nameSystem = world.GetExistingSystemManaged<NameSystem>(); var seenLanes = new HashSet<Entity>(); bool changed = false;
            foreach (var token in edgeIds)
            {
                var edge = ParseEntity((string)token, em); if (!IsPermanentRoad(em, edge)) throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                if (edges.Contains(edge)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates."); edges.Add(edge); operation.TargetEdges.Add(edge);
                if (args["road_name"] != null)
                {
                    var nameTarget = em.HasComponent<Aggregated>(edge) ? em.GetComponentData<Aggregated>(edge).m_Aggregate : edge;
                    nameSystem.TryGetCustomName(nameTarget, out var before); var after = (string)args["road_name"]; if (string.IsNullOrWhiteSpace(after)) after = null;
                    if (before != after) { operation.DirectChanges.Add(new RoadDirectChange { Entity = nameTarget, OwnerEdge = edge, Kind = "name", HasName = true, BeforeName = before, AfterName = after }); changed = true; }
                }
                if (!em.HasBuffer<NetSubLane>(edge)) continue;
                var lanes = em.GetBuffer<NetSubLane>(edge, true);
                for (int i = 0; i < lanes.Length; i++)
                {
                    var lane = lanes[i].m_SubLane; if (!seenLanes.Add(lane) || (laneFilter.Count > 0 && !laneFilter.Contains(lane))) continue;
                    if (em.HasComponent<NetCarLane>(lane) && (speed.HasValue || args["public_transport_only"] != null || args["left_turn"] != null || args["right_turn"] != null || args["straight"] != null))
                    {
                        var before = em.GetComponentData<NetCarLane>(lane); var after = before;
                        if (speed.HasValue) after.m_SpeedLimit = after.m_DefaultSpeedLimit = speed.Value / 3.6f;
                        void Flag(JToken value, CarLaneFlags flag) { if (value == null) return; if ((bool)value) after.m_Flags |= flag; else after.m_Flags &= ~flag; }
                        Flag(args["public_transport_only"], CarLaneFlags.PublicOnly); Flag(args["left_turn"], CarLaneFlags.TurnLeft); Flag(args["right_turn"], CarLaneFlags.TurnRight); Flag(args["straight"], CarLaneFlags.Forward);
                        if (!before.Equals(after)) { operation.DirectChanges.Add(new RoadDirectChange { Entity = lane, OwnerEdge = edge, Kind = "car_lane", HasCar = true, BeforeCar = before, AfterCar = after }); changed = true; }
                    }
                }
            }
            if (laneFilter.Count > 0 && seenLanes.Count(laneFilter.Contains) != laneFilter.Count) throw new QueryException("LANE_NOT_ON_SELECTED_ROAD", "Every lane_id must belong to one of the selected road edges.");
            if (!changed) throw new QueryException("NO_CHANGE", "The selected roads and lanes already have the requested values, or no matching lane type exists.");
            if (operation.DirectChanges.Count > 512) throw new QueryException("TOO_MANY_CHANGES", "One atomic road-policy transaction may change at most 512 road or lane records.");
            operation.TargetEdge = edges[0]; operation.State = "preview_ready"; operation.Cost = 0;
            m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id); return operation.Json();
        }

        private void ApplyDirectOperation(RoadOperation operation, World world)
        {
            var em = world.EntityManager; em.CompleteAllTrackedJobs(); var names = world.GetExistingSystemManaged<NameSystem>(); var applied = new List<RoadDirectChange>();
            bool MatchesBefore(RoadDirectChange change)
            {
                if (!em.Exists(change.Entity)) return false;
                if (change.HasCar) return em.HasComponent<NetCarLane>(change.Entity) && em.GetComponentData<NetCarLane>(change.Entity).Equals(change.BeforeCar);
                if (change.HasParking) return em.HasComponent<NetParkingLane>(change.Entity) && em.GetComponentData<NetParkingLane>(change.Entity).Equals(change.BeforeParking);
                if (change.HasName) { names.TryGetCustomName(change.Entity, out var value); return value == change.BeforeName; }
                return false;
            }
            if (operation.DirectChanges.Any(change => !MatchesBefore(change))) throw new QueryException("TRANSACTION_CONFLICT", "A target changed after preview; nothing was applied.");
            try
            {
                foreach (var change in operation.DirectChanges)
                {
                    if (change.HasCar) { em.SetComponentData(change.Entity, change.AfterCar); if (!em.HasComponent<PathfindUpdated>(change.Entity)) em.AddComponent<PathfindUpdated>(change.Entity); }
                    else if (change.HasParking) { em.SetComponentData(change.Entity, change.AfterParking); if (!em.HasComponent<PathfindUpdated>(change.Entity)) em.AddComponent<PathfindUpdated>(change.Entity); }
                    else if (change.HasName) names.SetCustomName(change.Entity, change.AfterName);
                    applied.Add(change);
                }
            }
            catch
            {
                for (int i = applied.Count - 1; i >= 0; i--) { var change = applied[i]; if (!em.Exists(change.Entity)) continue;
                    if (change.HasCar) em.SetComponentData(change.Entity, change.BeforeCar); else if (change.HasParking) em.SetComponentData(change.Entity, change.BeforeParking); else if (change.HasName) names.SetCustomName(change.Entity, change.BeforeName); }
                throw;
            }
            operation.ApplyDispatched = true; operation.CommitRequested = true; operation.CreatedEdges = operation.TargetEdges.ToList(); operation.State = "completed";
        }

        private JObject PreviewRoadUndo(JObject args, World world)
        {
            var sourceId = (string)args["source_operation_id"] ?? "";
            if (!m_RoadOperations.TryGetValue(sourceId, out var source) || source.Session != m_Session) throw new QueryException("ROAD_OPERATION_NOT_FOUND", "Unknown source operation in this city session.");
            if (source.State != "completed") throw new QueryException("UNDO_SOURCE_NOT_COMPLETED", "Only a completed operation can be undone.");
            if (source.CurveMode == "intersection_prefab") throw new QueryException("UNDO_NOT_AVAILABLE", "An intersection stamp may include decorations and terrain changes; road-only undo cannot restore the whole asset. Inspect and remove intended roads explicitly.");
            var key = RequestKey(args); var fingerprint = "undo:" + sourceId;
            if (m_RoadRequestIds.TryGetValue(key, out var oldId)) { var old = m_RoadOperations[oldId]; if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another operation."); return old.Json(); }
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before undoing road policies.");
            if (source.OperationType == "create")
            {
                if (source.CreatedEdges.Count == 0) throw new QueryException("UNDO_TARGET_MISSING", "The source operation has no permanent created roads to remove.");
                if (source.TargetEdges.Count > 0 || source.Segments.Any(segment => segment.StartSplit > 0 && segment.StartSplit < 1 || segment.EndSplit > 0 && segment.EndSplit < 1))
                    throw new QueryException("UNDO_NOT_AVAILABLE", "Automatic creation undo is only safe for standalone roads and node-to-node attachments. This operation split existing road edges; demolish the intended created roads explicitly.");
                var inverse = new JObject { ["request_id"] = key, ["edge_ids"] = new JArray(source.CreatedEdges.Select(EntityId)) };
                PreviewRoadBatchDemolition(inverse, world); var native = m_RoadOperations[m_RoadRequestIds[key]];
                native.Fingerprint = fingerprint; native.UndoOf = sourceId; native.TransactionKind = "native_atomic_undo_create"; return native.Json();
            }
            if (source.OperationType == "reverse" || source.OperationType == "batch_reverse")
            {
                if (source.CreatedEdges.Count == 0) throw new QueryException("UNDO_TARGET_MISSING", "The reversed road result is unavailable.");
                var inverse = new JObject { ["request_id"] = key, ["edge_ids"] = new JArray(source.CreatedEdges.Select(EntityId)) };
                PreviewRoadReverse(inverse, world, true); var native = m_RoadOperations[m_RoadRequestIds[key]];
                native.Fingerprint = fingerprint; native.UndoOf = sourceId; native.TransactionKind = "native_atomic_undo_reverse"; return native.Json();
            }
            if (source.OperationType == "upgrade" || source.OperationType == "batch_upgrade")
            {
                if (source.CreatedEdges.Count == 0) throw new QueryException("UNDO_TARGET_MISSING", "The upgraded road result is unavailable.");
                var originals = source.Segments.Select(segment => segment.OriginalPrefabName).Distinct().ToList();
                if (originals.Count != 1) throw new QueryException("UNDO_NOT_AVAILABLE", "Exact upgrade undo requires every source edge to have used the same original road prefab.");
                var inverse = new JObject { ["request_id"] = key, ["edge_ids"] = new JArray(source.CreatedEdges.Select(EntityId)), ["road_prefab"] = originals[0] };
                PreviewRoadBatchUpgrade(inverse, world); var native = m_RoadOperations[m_RoadRequestIds[key]];
                native.Fingerprint = fingerprint; native.UndoOf = sourceId; native.TransactionKind = "native_atomic_undo_upgrade"; return native.Json();
            }
            if (source.OperationType == "demolish" || source.OperationType == "batch_demolish")
            {
                var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); var em = world.EntityManager;
                if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
                var rebuildOperation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "create", CurveMode = "undo_demolition", UndoOf = sourceId, TransactionKind = "native_atomic_undo_demolition" };
                foreach (var saved in source.Segments)
                {
                    var startTarget = em.Exists(saved.StartTarget) && em.HasComponent<Node>(saved.StartTarget) && !em.HasComponent<Deleted>(saved.StartTarget) ? saved.StartTarget : Entity.Null;
                    var endTarget = em.Exists(saved.EndTarget) && em.HasComponent<Node>(saved.EndTarget) && !em.HasComponent<Deleted>(saved.EndTarget) ? saved.EndTarget : Entity.Null;
                    rebuildOperation.Segments.Add(new RoadSegmentPlan { Prefab = saved.OriginalPrefab, PrefabName = saved.OriginalPrefabName, Role = "undo_demolition",
                        Start = saved.Start, End = saved.End, StartTarget = startTarget, EndTarget = endTarget, StartElevation = saved.StartElevation, EndElevation = saved.EndElevation, Curve = saved.Curve });
                }
                if (rebuildOperation.Segments.Count == 0) throw new QueryException("UNDO_SNAPSHOT_MISSING", "The demolition snapshot contains no road geometry.");
                var first = rebuildOperation.Segments[0]; var last = rebuildOperation.Segments[rebuildOperation.Segments.Count - 1]; rebuildOperation.Prefab = first.Prefab; rebuildOperation.PrefabName = first.PrefabName;
                rebuildOperation.Start = first.Start; rebuildOperation.End = last.End; rebuildOperation.StartNode = first.StartTarget; rebuildOperation.EndNode = last.EndTarget; rebuildOperation.StartElevation = first.StartElevation; rebuildOperation.EndElevation = last.EndElevation; rebuildOperation.Curve = first.Curve;
                tool.Begin(rebuildOperation); m_RoadOperations.Add(rebuildOperation.Id, rebuildOperation); m_RoadRequestIds.Add(key, rebuildOperation.Id); return rebuildOperation.Json();
            }
            if (source.DirectChanges.Count == 0) throw new QueryException("UNDO_NOT_AVAILABLE", "Exact undo is unavailable for this operation type or mixed-prefab upgrade.");
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "road_policies", CurveMode = "existing", TransactionKind = "direct_atomic_undo", UndoOf = sourceId,
                State = "preview_ready", TargetEdge = source.TargetEdge };
            operation.TargetEdges.AddRange(source.TargetEdges); operation.DirectChanges.AddRange(source.DirectChanges.Select(change => change.Reverse()));
            m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id); return operation.Json();
        }

        private JObject PreviewRoadParking(JObject args, World world)
        {
            var key = RequestKey(args); var style = (string)args["style"];
            if (style != "none" && style != "parallel" && style != "angled") throw new QueryException("INVALID_ARGUMENT", "style must be none, parallel or angled.");
            var fingerprint = new JObject { ["operation_type"] = "road_parking", ["edge_ids"] = args["edge_ids"]?.DeepClone(), ["style"] = style }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId)) { var old = m_RoadOperations[oldId]; if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another operation."); return old.Json(); }
            var edgeIds = args["edge_ids"] as JArray;
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 road edge IDs.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var targets = new HashSet<string>();
            const string parallelSuffix = " - Double Sided Parking"; const string angledSuffix = " - Double Sided Parking Angled";
            foreach (var token in edgeIds)
            {
                var edge = ParseEntity((string)token, em); if (!IsPermanentRoad(em, edge)) throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                var prefab = em.GetComponentData<PrefabRef>(edge).m_Prefab;
                if (!prefabs.TryGetPrefab<PrefabBase>(prefab, out var value)) throw new QueryException("PREFAB_UNAVAILABLE", "A road prefab is unavailable.");
                var baseName = value.name.EndsWith(angledSuffix, StringComparison.Ordinal) ? value.name.Substring(0, value.name.Length - angledSuffix.Length) :
                    value.name.EndsWith(parallelSuffix, StringComparison.Ordinal) ? value.name.Substring(0, value.name.Length - parallelSuffix.Length) : value.name;
                targets.Add(style == "none" ? baseName : baseName + (style == "angled" ? angledSuffix : parallelSuffix));
            }
            if (targets.Count != 1) throw new QueryException("MIXED_ROAD_FAMILIES", "One parking operation may contain only roads that resolve to the same parking prefab; split different road families into separate requests.");
            var target = targets.Single();
            var inverse = new JObject { ["request_id"] = key, ["edge_ids"] = edgeIds.DeepClone(), ["road_prefab"] = target };
            PreviewRoadBatchUpgrade(inverse, world); var operation = m_RoadOperations[m_RoadRequestIds[key]];
            operation.Fingerprint = fingerprint; operation.TransactionKind = "native_atomic_parking_prefab"; return operation.Json();
        }

        private JObject AnalyzeRoadTraffic(JObject args, World world)
        {
            var em = world.EntityManager; var edgeIds = args["edge_ids"] as JArray; int limit = args["limit"] == null ? 20 : (int)args["limit"];
            var targets = new List<Entity>();
            if (edgeIds != null) foreach (var token in edgeIds) targets.Add(ParseEntity((string)token, em));
            else using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) targets.AddRange(entities.ToArray());
            var rows = new List<JObject>();
            foreach (var edge in targets.Distinct())
            {
                if (!IsPermanentRoad(em, edge)) continue; var road = em.GetComponentData<Road>(edge); int car = 0, bottleneck = 0, maxFlowOffset = 0;
                if (em.HasBuffer<NetSubLane>(edge)) { var lanes = em.GetBuffer<NetSubLane>(edge, true); for (int i = 0; i < lanes.Length; i++) { var lane = lanes[i].m_SubLane;
                    if (em.HasComponent<NetCarLane>(lane)) { car++; maxFlowOffset = math.max(maxFlowOffset, em.GetComponentData<NetCarLane>(lane).m_FlowOffset); }
                    if (em.HasComponent<Bottleneck>(lane) && em.GetComponentData<Bottleneck>(lane).m_Timer >= 20) bottleneck++; } }
                var duration = math.csum(road.m_TrafficFlowDuration0 + road.m_TrafficFlowDuration1); var distance = math.csum(road.m_TrafficFlowDistance0 + road.m_TrafficFlowDistance1);
                var sampledSpeed = duration > 0.001f ? distance / duration : 0; var score = bottleneck * 1000 + maxFlowOffset * 2 + math.min(255, duration * 10);
                var action = bottleneck > 0 || maxFlowOffset >= 160 ? "upgrade_or_parallel_relief" : maxFlowOffset >= 80 ? "monitor_or_optimize_intersection" : "keep";
                rows.Add(new JObject { ["edge_id"] = EntityId(edge), ["car_lane_count"] = car, ["active_bottleneck_lanes"] = bottleneck, ["max_flow_offset"] = maxFlowOffset,
                    ["sampled_distance_per_duration"] = sampledSpeed, ["priority_score"] = score, ["recommended_action"] = action });
            }
            rows = rows.OrderByDescending(row => (double)row["priority_score"]).Take(math.clamp(limit, 1, 100)).ToList();
            var flowSystem = world.GetExistingSystemManaged<TrafficFlowSystem>(); flowSystem?.RefreshCityTrafficAverages();
            return new JObject { ["city_average_traffic_flow"] = flowSystem?.cityAverageTrafficFlow, ["city_average_traffic_volume"] = flowSystem?.cityAverageTrafficVolume,
                ["items"] = new JArray(rows), ["planning_rule"] = "Bottleneck markers dominate, followed by per-lane flow offset and accumulated road duration. Use the returned edge IDs with preview_road_batch_upgrade or preview_road_parallel." };
        }

        private JObject PreviewRoadInterchange(JObject args, World world)
        {
            var key = RequestKey(args); var fingerprint = new JObject { ["operation_type"] = "interchange", ["main_edge_id"] = args["main_edge_id"]?.DeepClone(),
                ["cross_edge_id"] = args["cross_edge_id"]?.DeepClone(), ["ramp_road_prefab"] = args["ramp_road_prefab"]?.DeepClone(), ["ramp_distance_m"] = args["ramp_distance_m"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId)) { var old = m_RoadOperations[oldId]; if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another operation."); return old.Json(); }
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before planning an interchange.");
            var tool = RoadTool(world); var tools = world.GetExistingSystemManaged<Game.Tools.ToolSystem>(); if (tool.Busy || !(tools.activeTool is Game.Tools.DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var em = world.EntityManager; var main = ParseEntity((string)args["main_edge_id"], em); var cross = ParseEntity((string)args["cross_edge_id"], em);
            if (main == cross || !IsPermanentRoad(em, main) || !IsPermanentRoad(em, cross)) throw new QueryException("INVALID_ROAD_EDGE", "main_edge_id and cross_edge_id must be two different permanent road edges.");
            var rampDistance = args["ramp_distance_m"] == null ? 64f : (float)args["ramp_distance_m"]; if (!math.isfinite(rampDistance) || rampDistance < 32 || rampDistance > 160) throw new QueryException("INVALID_ARGUMENT", "ramp_distance_m must be 32..160.");
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity rampPrefab = Entity.Null; var rampName = (string)args["ramp_road_prefab"];
            foreach (var entity in RoadPrefabs(em)) if (prefabs.TryGetPrefab<PrefabBase>(entity, out var value) && value is RoadPrefab && value.name == rampName) { rampPrefab = entity; break; }
            if (rampPrefab == Entity.Null) throw new QueryException("UNKNOWN_ROAD_PREFAB", "Use an exact unlocked ramp road from list_road_prefabs.");
            if (RoadOperation.IsLocked(em, rampPrefab)) throw new QueryException("ROAD_LOCKED", "The selected ramp road is locked.");
            var a = em.GetComponentData<Curve>(main).m_Bezier; var b = em.GetComponentData<Curve>(cross).m_Bezier; float bestA = 0, bestB = 0, bestDistance = float.MaxValue;
            for (int i = 4; i <= 60; i++) for (int j = 4; j <= 60; j++) { var ta = i / 64f; var tb = j / 64f; var distance = math.distancesq(Colossal.Mathematics.MathUtils.Position(a, ta).xz, Colossal.Mathematics.MathUtils.Position(b, tb).xz); if (distance < bestDistance) { bestDistance = distance; bestA = ta; bestB = tb; } }
            if (math.sqrt(bestDistance) > 16) throw new QueryException("ROADS_DO_NOT_CROSS", "The selected roads do not cross within 16 metres in plan view.");
            var vertical = math.abs(Colossal.Mathematics.MathUtils.Position(a, bestA).y - Colossal.Mathematics.MathUtils.Position(b, bestB).y); if (vertical < 4) throw new QueryException("GRADE_SEPARATION_REQUIRED", "Automatic ramps require two grade-separated roads; use intersection controls for an at-grade crossing.");
            var da = math.min(0.22f, rampDistance / math.max(1f, em.GetComponentData<Curve>(main).m_Length)); var db = math.min(0.22f, rampDistance / math.max(1f, em.GetComponentData<Curve>(cross).m_Length));
            if (bestA - da < 0.02f || bestA + da > 0.98f || bestB - db < 0.02f || bestB + db > 0.98f) throw new QueryException("INSUFFICIENT_APPROACH_LENGTH", "The crossing is too close to an edge endpoint for four ramps.");
            float3 Position(Bezier4x3 curve, float t) => Colossal.Mathematics.MathUtils.Position(curve, t);
            float3 Tangent(Bezier4x3 curve, float t) { var p0 = Position(curve, math.max(0, t - 0.01f)); var p1 = Position(curve, math.min(1, t + 0.01f)); return math.normalizesafe(p1 - p0, new float3(1, 0, 0)); }
            var endpointsA = new[] { bestA - da, bestA + da }; var endpointsB = new[] { bestB - db, bestB + db };
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OperationType = "create", CurveMode = "interchange", Prefab = rampPrefab, PrefabName = rampName, TransactionKind = "native_atomic" };
            foreach (var ta in endpointsA) foreach (var tb in endpointsB)
            {
                var start = Position(a, ta); var end = Position(b, tb); var length = math.distance(start, end); if (length < 16 || length > 256) throw new QueryException("INVALID_RAMP_LENGTH", "A generated ramp is outside the native 16..256 metre segment range.");
                var tangentA = Tangent(a, ta) * (ta < bestA ? -1 : 1); var tangentB = Tangent(b, tb) * (tb < bestB ? -1 : 1);
                var handle = math.max(length * 0.33f, math.min(120f, rampDistance)); Bezier4x3 curve = default; QueryException slopeError = null;
                for (; handle <= math.min(120f, rampDistance * 1.75f) + 0.01f; handle += 8f)
                {
                    curve = new Bezier4x3(start, start + tangentA * handle, end + tangentB * handle, end);
                    try { ValidateRoadCurve(curve, 0, 0, rampPrefab, em); slopeError = null; break; }
                    catch (QueryException error) when (error.Code == "STEEP_SLOPE") { slopeError = error; }
                }
                if (slopeError != null) throw new QueryException("RAMP_GRADE_UNAVAILABLE", "The grade separation is too high for this ramp prefab and available approach geometry. Increase ramp_distance_m or choose a steeper ramp road.");
                operation.Segments.Add(new RoadSegmentPlan { Prefab = rampPrefab, PrefabName = rampName, Role = "interchange_ramp", Start = start, End = end,
                    StartTarget = main, EndTarget = cross, StartSplit = ta, EndSplit = tb, Curve = curve });
            }
            operation.TargetEdges.Add(main); operation.TargetEdges.Add(cross); operation.Start = operation.Segments[0].Start; operation.End = operation.Segments[operation.Segments.Count - 1].End; operation.Curve = operation.Segments[0].Curve;
            tool.Begin(operation); m_RoadOperations.Add(operation.Id, operation); m_RoadRequestIds.Add(key, operation.Id); return operation.Json();
        }
    }
}
