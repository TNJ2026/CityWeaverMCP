using System;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private static bool IsRoadStopPrefab(EntityManager em, Entity p) =>
            em.HasComponent<TransportStopData>(p) && em.HasComponent<PlaceableObjectData>(p) &&
            !em.HasComponent<BuildingData>(p) && !em.HasComponent<ServiceUpgradeData>(p) &&
            (em.GetComponentData<TransportStopData>(p).m_TransportType == TransportType.Bus ||
             em.GetComponentData<TransportStopData>(p).m_TransportType == TransportType.Tram) &&
            (em.GetComponentData<PlaceableObjectData>(p).m_Flags & Game.Objects.PlacementFlags.RoadEdge) != 0;

        private Entity RoadStopPrefab(string name, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
                if (IsRoadStopPrefab(em, e) && ps.TryGetPrefab<PrefabBase>(e, out var p) &&
                    p is StaticObjectPrefab && string.Equals(p.name, name, StringComparison.OrdinalIgnoreCase)) return e;
            throw new QueryException("ROAD_STOP_PREFAB_NOT_FOUND", "Use an exact prefab from list_road_stop_prefabs.");
        }

        private JObject ListRoadStopPrefabs(JObject args, World world)
        {
            var rows = new JArray(); var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            string search = (string)args["search"] ?? "";
            string type = (string)args["transport_type"] ?? "all";
            if (type != "all" && type != "Bus" && type != "Tram") throw new QueryException("INVALID_ARGUMENT", "transport_type must be all, Bus or Tram.");
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
            {
                if (!IsRoadStopPrefab(em, e) || !ps.TryGetPrefab<PrefabBase>(e, out var p) || !(p is StaticObjectPrefab) ||
                    p.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue;
                bool locked = RoadOperation.IsLocked(em, e);
                if (((bool?)args["unlocked_only"] ?? true) && locked) continue;
                var place = em.GetComponentData<PlaceableObjectData>(e);
                var stop = em.GetComponentData<TransportStopData>(e);
                if (type != "all" && stop.m_TransportType.ToString() != type) continue;
                rows.Add(new JObject { ["name"] = p.name, ["locked"] = locked,
                    ["transport_type"] = stop.m_TransportType.ToString(), ["passenger"] = stop.m_PassengerTransport,
                    ["requires_tram_track"] = stop.m_TransportType == TransportType.Tram,
                    ["construction_cost"] = place.m_ConstructionCost, ["placement_flags"] = place.m_Flags.ToString() });
            }
            return new JObject { ["total"] = rows.Count, ["items"] = rows };
        }

        private Entity RoadStopEdge(JObject args, World world)
        {
            var em = world.EntityManager; var e = ParseEntity((string)args["road_edge_id"], em);
            if (!em.Exists(e) || !em.HasComponent<Road>(e) || !em.HasComponent<Edge>(e) ||
                !em.HasComponent<Curve>(e) || !em.HasComponent<PrefabRef>(e) || em.HasComponent<Deleted>(e) || em.HasComponent<Temp>(e))
                throw new QueryException("NOT_A_ROAD_EDGE", "road_edge_id must identify a permanent road.");
            return e;
        }

        // Inspect instantiated lanes: optional road upgrades are not reliably represented by the road prefab alone.
        internal static bool RoadStopNetworkCompatible(EntityManager em, Entity prefab, Entity road)
        {
            if (!em.Exists(prefab) || !em.HasComponent<TransportStopData>(prefab)) return false;
            var type = em.GetComponentData<TransportStopData>(prefab).m_TransportType;
            if (type == TransportType.Bus) return true;
            if (type != TransportType.Tram || !em.Exists(road) || !em.HasBuffer<Game.Net.SubLane>(road)) return false;
            var lanes = em.GetBuffer<Game.Net.SubLane>(road, true);
            for (int i = 0; i < lanes.Length; i++)
            {
                var lane = lanes[i].m_SubLane;
                if (!em.Exists(lane) || em.HasComponent<Deleted>(lane) || em.HasComponent<Temp>(lane) ||
                    !em.HasComponent<Game.Net.TrackLane>(lane) || !em.HasComponent<PrefabRef>(lane)) continue;
                var lanePrefab = em.GetComponentData<PrefabRef>(lane).m_Prefab;
                if (em.HasComponent<TrackLaneData>(lanePrefab) &&
                    (em.GetComponentData<TrackLaneData>(lanePrefab).m_TrackTypes & TrackTypes.Tram) != 0) return true;
            }
            return false;
        }

        // Deterministic input: the caller selects a road, side and curve fraction, never an arbitrary world snap parent.
        private JObject PlanRoadStopSite(JObject args, World world)
        {
            var em = world.EntityManager; var prefab = RoadStopPrefab((string)args["stop_prefab"], world);
            if (RoadOperation.IsLocked(em, prefab)) throw new QueryException("ROAD_STOP_LOCKED", "The stop prefab is locked.");
            var edge = RoadStopEdge(args, world); var curve = em.GetComponentData<Curve>(edge);
            if (!RoadStopNetworkCompatible(em, prefab, edge)) throw new QueryException("TRAM_TRACK_REQUIRED", "A roadside tram stop requires a permanent tram track lane on the selected road. Build or upgrade the road first.");
            float t = BuildingNumber(args, "edge_parameter", .5f, .05f, .95f);
            string side = (string)args["road_side"];
            if (side != "left" && side != "right") throw new QueryException("INVALID_ARGUMENT", "road_side must be left or right relative to road curve direction.");
            var center = MathUtils.Position(curve.m_Bezier, t);
            var tangent = math.normalizesafe(MathUtils.Tangent(curve.m_Bezier, t).xz);
            if (math.lengthsq(tangent) < .5f) throw new QueryException("ROAD_GEOMETRY_UNAVAILABLE", "Road tangent is degenerate.");
            var normal = new float2(-tangent.y, tangent.x) * (side == "left" ? 1 : -1);
            float clearance = math.min(t, 1 - t) * curve.m_Length;
            float halfLength = em.HasComponent<ObjectGeometryData>(prefab) ? em.GetComponentData<ObjectGeometryData>(prefab).m_Size.x * .5f : 4;
            if (clearance < math.max(8, halfLength + 2)) throw new QueryException("ROAD_STOP_TOO_CLOSE_TO_JUNCTION", "Select a point farther from the road endpoints.");
            var position = SnapRoadStopToSidewalk(em, prefab, edge, center, normal, out var facing);
            float angle = math.degrees(math.atan2(facing.x, facing.y));
            return new JObject { ["stop_prefab"] = args["stop_prefab"], ["road_edge_id"] = EntityId(edge),
                ["transport_type"] = em.GetComponentData<TransportStopData>(prefab).m_TransportType.ToString(),
                ["road_side"] = side, ["edge_parameter"] = t,
                ["position"] = PointJson(position), ["rotation_degrees"] = angle,
                ["endpoint_clearance_m"] = math.min(t, 1 - t) * curve.m_Length,
                ["note"] = "Candidate only. Native preview decides road, lane and object compatibility." };
        }

        // Mirrors ObjectToolSystem.SnapSegmentAreas using the live (possibly upgraded)
        // road composition. Prefab width does not describe its actual buildable sidewalk.
        private static float3 SnapRoadStopToSidewalk(EntityManager em, Entity prefab, Entity road,
            float3 center, float2 outward, out float2 facing)
        {
            if (!em.HasComponent<EdgeGeometry>(road) || !em.HasComponent<Composition>(road) ||
                !em.HasComponent<ObjectGeometryData>(prefab))
                throw new QueryException("ROAD_GEOMETRY_UNAVAILABLE", "Live road and stop geometry are required.");
            var compositionEntity = em.GetComponentData<Composition>(road).m_Edge;
            if (!em.HasComponent<NetCompositionData>(compositionEntity) || !em.HasBuffer<NetCompositionArea>(compositionEntity))
                throw new QueryException("ROAD_GEOMETRY_UNAVAILABLE", "Live sidewalk composition is unavailable.");
            var composition = em.GetComponentData<NetCompositionData>(compositionEntity);
            if (!math.isfinite(composition.m_Width) || composition.m_Width <= 0)
                throw new QueryException("ROAD_GEOMETRY_UNAVAILABLE", "Live road width is invalid.");
            var geometry = em.GetComponentData<ObjectGeometryData>(prefab);
            bool standing = (geometry.m_Flags & Game.Objects.GeometryFlags.Standing) != 0;
            float radius = standing ? geometry.m_LegSize.z * .5f + geometry.m_LegOffset.y : geometry.m_Size.z * .5f;
            if (standing && geometry.m_LegSize.y <= composition.m_HeightRange.max)
                radius = math.max(radius, geometry.m_Size.z * .5f);
            var edgeGeometry = em.GetComponentData<EdgeGeometry>(road);
            var areas = em.GetBuffer<NetCompositionArea>(compositionEntity, true);
            float bestDistance = float.MaxValue;
            float3 best = default;
            facing = default;
            foreach (var segment in new[] { edgeGeometry.m_Start, edgeGeometry.m_End })
            {
                for (int i = 0; i < areas.Length; i++)
                {
                    var area = areas[i];
                    // This API places roadside stops, never a stop in the central median.
                    if ((area.m_Flags & NetAreaFlags.Buildable) == 0 ||
                        (area.m_Flags & NetAreaFlags.Median) != 0 || radius >= area.m_Width * .51f) continue;
                    var areaCurve = MathUtils.Lerp(segment.m_Left, segment.m_Right, area.m_Position.x / composition.m_Width + .5f);
                    MathUtils.Distance(areaCurve.xz, center.xz, out float fraction);
                    var position = MathUtils.Position(areaCurve, fraction);
                    if (math.dot(position.xz - center.xz, outward) <= .01f) continue;
                    var direction = math.normalizesafe(MathUtils.Tangent(areaCurve, fraction).xz);
                    direction = (area.m_Flags & NetAreaFlags.Invert) != 0 ? MathUtils.Right(direction) : MathUtils.Left(direction);
                    if (math.lengthsq(direction) < .5f) continue;
                    var snapCurve = MathUtils.Lerp(segment.m_Left, segment.m_Right, area.m_SnapPosition.x / composition.m_Width + .5f);
                    var snapPosition = MathUtils.Position(snapCurve, fraction);
                    float maxOffset = math.max(0, math.min(area.m_Width * .5f,
                        math.abs(area.m_SnapPosition.x - area.m_Position.x) + area.m_SnapWidth * .5f) - radius);
                    // Aim at the native snap centre, without a mouse-dependent lateral offset.
                    position.xz += MathUtils.ClampLength(snapPosition.xz - position.xz, maxOffset);
                    position.y += area.m_Position.y;
                    float distance = math.distancesq(center.xz, position.xz);
                    if (!math.all(math.isfinite(position)) || distance >= bestDistance) continue;
                    bestDistance = distance;
                    best = position;
                    facing = direction;
                }
            }
            if (bestDistance == float.MaxValue)
                throw new QueryException("ROAD_STOP_NO_BUILDABLE_SIDEWALK", "The selected road side has no buildable sidewalk wide enough for this stop.");
            return best;
        }

        private JObject PreviewRoadStopPlacement(JObject args, World world)
        {
            var key = RequestKey(args); var fingerprint = new JObject { ["kind"] = "road_stop", ["args"] = args.DeepClone() }.ToString(Formatting.None);
            if (m_BuildingRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_BuildingOperations[oldId];
                if (!old.RoadStopPlacement || old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id belongs to another operation.");
                return RoadStopJson(old);
            }
            if (m_BuildingOperations.Count >= 4096) throw new QueryException("BUILDING_OPERATION_LIMIT", "Reload the city to reset the operation journal.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause before previewing stops.");
            var tool = BuildingTool(world);
            if (tool.Busy || !(world.GetExistingSystemManaged<ToolSystem>().activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Select the default tool first.");
            var site = PlanRoadStopSite(args, world); var position = (JObject)site["position"];
            float angle = (float)site["rotation_degrees"];
            var op = new BuildingOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint,
                Type = "place", RoadStopPlacement = true, PrefabName = (string)args["stop_prefab"],
                RoadStopTransportType = (string)site["transport_type"],
                Prefab = RoadStopPrefab((string)args["stop_prefab"], world), ParentRoad = RoadStopEdge(args, world),
                Position = new float3((float)position["x"], (float)position["y"], (float)position["z"]),
                RotationDegrees = angle, Rotation = quaternion.RotateY(math.radians(angle)) };
            tool.Begin(op); m_BuildingOperations.Add(op.Id, op); m_BuildingRequestIds.Add(key, op.Id);
            return RoadStopJson(op);
        }

        private BuildingOperation RoadStopOperation(JObject args)
        {
            var op = BuildingOperationById(args);
            if (!op.RoadStopPlacement) throw new QueryException("ROAD_STOP_OPERATION_NOT_FOUND", "Not a road-stop operation.");
            return op;
        }
        private JObject RoadStopJson(BuildingOperation op)
        {
            var row = op.Json(); row["stop_prefab"] = op.PrefabName;
            row["transport_type"] = op.RoadStopTransportType;
            row["result_stop_ids"] = new JArray(op.ResultEntities.Select(op.EntityId));
            row["note"] = "Only completed confirms a permanent road-bound stop. Routes must be updated separately.";
            return row;
        }
        private JObject GetRoadStopOperation(JObject args) => RoadStopJson(RoadStopOperation(args));
        private JObject ApplyRoadStopOperation(JObject args, World world)
        {
            var op = RoadStopOperation(args);
            if (op.CommitRequestId == null)
            {
                if (op.Cost > ComponentInspector.Int(args, "max_cost", 0, 0, 1000000000)) throw new QueryException("COST_LIMIT", "Preview cost exceeds max_cost.");
                if (op.Errors.Count > 0 || op.Warnings.Count > 0) throw new QueryException("ROAD_STOP_VALIDATION_FAILED", "Resolve native errors and warnings first.");
            }
            ApplyBuildingOperation(args, world); return RoadStopJson(op);
        }
        private JObject CancelRoadStopPreview(JObject args)
        {
            var op = RoadStopOperation(args); CancelBuildingOperation(args); return RoadStopJson(op);
        }
    }
}
