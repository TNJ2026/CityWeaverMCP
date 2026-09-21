using System;
using System.Collections.Generic;
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
        private static bool PierPathwayPrefab(EntityManager em, Entity prefab)
        {
            return prefab != Entity.Null && em.Exists(prefab) && em.HasComponent<PathwayData>(prefab) &&
                em.HasComponent<NetData>(prefab) && em.HasComponent<NetGeometryData>(prefab) &&
                em.HasComponent<PlaceableNetData>(prefab) && em.GetComponentData<PlaceableNetData>(prefab).m_MinWaterElevation > 0;
        }

        private bool IsPermanentPierPathway(EntityManager em, Entity edge)
        {
            return em.Exists(edge) && em.HasComponent<Edge>(edge) && em.HasComponent<Curve>(edge) &&
                em.HasComponent<PrefabRef>(edge) && !em.HasComponent<Deleted>(edge) && !em.HasComponent<Temp>(edge) &&
                PierPathwayPrefab(em, em.GetComponentData<PrefabRef>(edge).m_Prefab);
        }

        private Entity ResolvePierPathwayPrefab(string wanted, World world)
        {
            var em = world.EntityManager;
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PathwayData>(), ComponentType.ReadOnly<PlaceableNetData>(), ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
                foreach (var entity in entities)
                    if (PierPathwayPrefab(em, entity) && prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) &&
                        string.Equals(prefab.name, wanted, StringComparison.OrdinalIgnoreCase)) return entity;
            throw new QueryException("PIER_PATHWAY_PREFAB_NOT_FOUND", "Use an exact name from list_pier_pathway_prefabs.");
        }

        private JObject ListPierPathwayPrefabs(JObject args, World world)
        {
            var em = world.EntityManager;
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            string search = ((string)args["search"] ?? "").Trim();
            bool unlockedOnly = (bool?)args["unlocked_only"] ?? true;
            var rows = new List<JObject>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PathwayData>(), ComponentType.ReadOnly<PlaceableNetData>(), ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
                foreach (var entity in entities)
                {
                    if (!PierPathwayPrefab(em, entity) || !prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) ||
                        search.Length > 0 && prefab.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    bool locked = RoadOperation.IsLocked(em, entity);
                    if (unlockedOnly && locked) continue;
                    var geometry = em.GetComponentData<NetGeometryData>(entity);
                    var place = em.GetComponentData<PlaceableNetData>(entity);
                    rows.Add(new JObject {
                        ["name"] = prefab.name, ["locked"] = locked, ["width_m"] = geometry.m_DefaultWidth,
                        ["minimum_water_elevation_m"] = place.m_MinWaterElevation,
                        ["max_slope"] = geometry.m_MaxSlopeSteepness,
                        ["edge_length_m"] = new JObject { ["min"] = geometry.m_EdgeLengthRange.min, ["max"] = geometry.m_EdgeLengthRange.max },
                        ["construction_cost_per_m"] = place.m_DefaultConstructionCost,
                        ["placement_flags"] = place.m_PlacementFlags.ToString()
                    });
                }
            return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows.OrderBy(x => (string)x["name"])) };
        }

        private JObject PierPathwayRow(Entity edge, World world)
        {
            var em = world.EntityManager;
            var prefabEntity = em.GetComponentData<PrefabRef>(edge).m_Prefab;
            world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(prefabEntity, out var prefab);
            var endpoints = em.GetComponentData<Edge>(edge);
            var curve = em.GetComponentData<Curve>(edge);
            var format = new RoadOperation { Session = m_Session };
            return new JObject {
                ["pathway_edge_id"] = format.EntityId(edge), ["prefab"] = prefab?.name,
                ["length_m"] = curve.m_Length, ["start"] = PointJson(curve.m_Bezier.a), ["end"] = PointJson(curve.m_Bezier.d),
                ["start_node_id"] = format.EntityId(endpoints.m_Start), ["end_node_id"] = format.EntityId(endpoints.m_End),
                ["start_control_point"] = em.HasComponent<LocalConnect>(endpoints.m_Start),
                ["end_control_point"] = em.HasComponent<LocalConnect>(endpoints.m_End),
                ["owned_by"] = em.HasComponent<Owner>(edge) ? format.EntityId(em.GetComponentData<Owner>(edge).m_Owner) : null
            };
        }

        private JObject ListPierPathways(JObject args, World world)
        {
            var em = world.EntityManager;
            var rows = new List<JObject>();
            var near = args["near"] as JObject;
            float2 center = near == null ? default : new float2(BuildingNumber(near, "x", 0, -7168, 7168), BuildingNumber(near, "z", 0, -7168, 7168));
            float radius = near == null ? 0 : BuildingNumber(args, "radius_m", 1000, 16, 3000);
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var edges = query.ToEntityArray(Allocator.Temp))
                foreach (var edge in edges)
                {
                    if (!IsPermanentPierPathway(em, edge)) continue;
                    var curve = em.GetComponentData<Curve>(edge).m_Bezier;
                    if (near != null && MathUtils.Distance(curve.xz, center, out _) > radius) continue;
                    rows.Add(PierPathwayRow(edge, world));
                }
            return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows) };
        }

        private RoadEndpoint PierPathwayNode(string nodeId, World world)
        {
            var em = world.EntityManager;
            var node = ParseEntity(nodeId, em);
            if (!em.HasComponent<Node>(node) || !em.HasBuffer<ConnectedEdge>(node) || em.HasComponent<Deleted>(node) || em.HasComponent<Temp>(node))
                throw new QueryException("INVALID_PIER_CONTROL_POINT", "The endpoint must be a permanent pier pathway node.");
            var connected = em.GetBuffer<ConnectedEdge>(node, true);
            bool valid = false;
            for (int i = 0; i < connected.Length; i++)
                if (IsPermanentPierPathway(em, connected[i].m_Edge)) { valid = true; break; }
            if (!valid) throw new QueryException("INVALID_PIER_CONTROL_POINT", "The node is not connected to a pier pathway.");
            var position = em.GetComponentData<Node>(node).m_Position;
            float elevation = em.HasComponent<Elevation>(node) ? em.GetComponentData<Elevation>(node).m_Elevation.x : 0;
            return new RoadEndpoint { Position = position, Target = node, Elevation = elevation };
        }

        private JObject PierPathwayOperationJson(RoadOperation op)
        {
            var row = op.Json();
            row["pathway_prefab"] = op.PrefabName;
            row["created_pathway_ids"] = row["created_road_ids"]?.DeepClone() ?? new JArray();
            row["note"] = "Only completed plus permanent pathway and endpoint readback confirms a connected pier extension.";
            return row;
        }

        private JObject PreviewPierPathway(JObject args, World world)
        {
            string key = RequestKey(args);
            string fingerprint = new JObject { ["kind"] = "pier_pathway", ["args"] = args.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var existingId))
            {
                var existing = m_RoadOperations[existingId];
                if (existing.TransactionKind != "pier_pathway" || existing.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id belongs to another operation.");
                return PierPathwayOperationJson(existing);
            }
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a pier extension.");
            if (m_RoadOperations.Count >= 4096) throw new QueryException("ROAD_OPERATION_LIMIT", "The road and pier operation journal is full for this city session.");
            var tool = RoadTool(world);
            if (tool.Busy || !(world.GetExistingSystemManaged<ToolSystem>().activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish another preview and return to the default tool.");
            var em = world.EntityManager;
            var prefab = ResolvePierPathwayPrefab((string)args["pathway_prefab"], world);
            if (RoadOperation.IsLocked(em, prefab)) throw new QueryException("PIER_PATHWAY_LOCKED", "The selected pier pathway prefab is locked.");
            var start = PierPathwayNode((string)args["start_node_id"], world);
            if (!em.HasComponent<Owner>(start.Target))
                throw new QueryException("PIER_OWNER_NOT_FOUND", "The control node must belong to a permanent pier building.");
            var owner = em.GetComponentData<Owner>(start.Target).m_Owner;
            if (!em.Exists(owner) || em.HasComponent<Deleted>(owner) || em.HasComponent<Temp>(owner) ||
                !em.HasComponent<Game.Buildings.Building>(owner) || !em.HasComponent<Game.Objects.Transform>(owner) ||
                !em.HasComponent<PrefabRef>(owner))
                throw new QueryException("PIER_OWNER_NOT_FOUND", "The pier owner is not a permanent building with a transform.");
            var ownerTransform = em.GetComponentData<Game.Objects.Transform>(owner);
            if (!em.HasComponent<LocalConnect>(start.Target) && em.GetBuffer<ConnectedEdge>(start.Target, true).Length != 1)
                throw new QueryException("INVALID_PIER_CONTROL_POINT", "Extend from a pier control point or a free pathway endpoint, not an intersection.");
            if ((args["end"] == null) == (args["end_node_id"] == null))
                throw new QueryException("INVALID_ARGUMENT", "Provide exactly one of end or end_node_id.");
            RoadEndpoint end;
            if (args["end_node_id"] != null)
            {
                end = PierPathwayNode((string)args["end_node_id"], world);
                if (end.Target == start.Target) throw new QueryException("INVALID_ENDPOINT", "The two pathway endpoints must differ.");
                if (!em.HasComponent<Owner>(end.Target) || em.GetComponentData<Owner>(end.Target).m_Owner != owner)
                    throw new QueryException("PIER_OWNER_MISMATCH", "Both pier nodes must belong to the same building.");
            }
            else
            {
                if (!(args["end"] is JObject target)) throw new QueryException("INVALID_ARGUMENT", "end requires x and z when end_node_id is omitted.");
                end = new RoadEndpoint { Position = new float3(BuildingNumber(target, "x", 0, -7168, 7168), start.Position.y,
                    BuildingNumber(target, "z", 0, -7168, 7168)), Elevation = start.Elevation };
            }
            var curve = NetUtils.StraightCurve(start.Position, end.Position);
            float length = MathUtils.Length(curve);
            var geometry = em.GetComponentData<NetGeometryData>(prefab);
            if (length < math.max(16, geometry.m_EdgeLengthRange.min) || length > math.min(512, geometry.m_EdgeLengthRange.max))
                throw new QueryException("INVALID_PIER_LENGTH", "A pier extension must be 16..512 metres and within the prefab segment range.");
            float slope = math.abs(end.Position.y - start.Position.y) / length;
            if (geometry.m_MaxSlopeSteepness > 0 && slope > geometry.m_MaxSlopeSteepness)
                throw new QueryException("STEEP_PIER_PATHWAY", "The pier extension exceeds the prefab slope limit.");
            var operation = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint,
                TransactionKind = "pier_pathway", OperationType = "create", Prefab = prefab, PrefabName = (string)args["pathway_prefab"],
                PierOwner = owner, PierOwnerPrefab = em.GetComponentData<PrefabRef>(owner).m_Prefab,
                PierOwnerPosition = ownerTransform.m_Position, PierOwnerRotation = ownerTransform.m_Rotation,
                Start = start.Position, End = end.Position, StartNode = start.Target, EndNode = end.Target, Curve = curve, CurveMode = "straight",
                StartElevation = start.Elevation, EndElevation = end.Elevation };
            operation.Segments.Add(new RoadSegmentPlan { Start = start.Position, End = end.Position,
                StartTarget = start.Target, EndTarget = end.Target, StartElevation = start.Elevation,
                EndElevation = end.Elevation, Curve = curve });
            tool.Begin(operation);
            m_RoadOperations.Add(operation.Id, operation);
            m_RoadRequestIds.Add(key, operation.Id);
            return PierPathwayOperationJson(operation);
        }

        private RoadOperation PierPathwayOperation(JObject args)
        {
            var operation = RoadOperationById(args);
            if (operation.TransactionKind != "pier_pathway") throw new QueryException("PIER_PATHWAY_OPERATION_NOT_FOUND", "operation_id is not a pier pathway operation.");
            return operation;
        }

        private JObject GetPierPathwayOperation(JObject args) => PierPathwayOperationJson(PierPathwayOperation(args));
        private JObject ApplyPierPathwayOperation(JObject args)
        {
            PierPathwayOperation(args);
            var result = CommitRoad(args);
            return PierPathwayOperationJson(m_RoadOperations[(string)result["operation_id"]]);
        }
        private JObject CancelPierPathwayPreview(JObject args)
        {
            var operation = PierPathwayOperation(args);
            CancelRoad(args);
            return PierPathwayOperationJson(operation);
        }
    }
}
