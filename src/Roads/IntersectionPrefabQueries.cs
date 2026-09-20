using System;
using System.Collections.Generic;
using System.Linq;
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
        private Entity[] IntersectionPrefabs(EntityManager em)
        {
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<AssetStampData>(), ComponentType.ReadOnly<Game.Prefabs.SubNet>(), ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) return entities.ToArray();
        }

        private JObject IntersectionPrefabInfo(Entity entity, World world)
        {
            var em = world.EntityManager;
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var prefab = prefabs.GetPrefab<AssetStampPrefab>(entity);
            var nets = em.GetBuffer<Game.Prefabs.SubNet>(entity, true);
            var names = new HashSet<string>(); var supported = nets.Length > 0; int roads = 0;
            var min = new float3(float.MaxValue); var max = new float3(float.MinValue);
            foreach (var net in nets)
            {
                if (em.HasComponent<RoadData>(net.m_Prefab)) roads++; else supported = false;
                if (prefabs.TryGetPrefab<PrefabBase>(net.m_Prefab, out var road)) names.Add(road.name);
                foreach (var p in new[] { net.m_Curve.a, net.m_Curve.b, net.m_Curve.c, net.m_Curve.d }) { min = math.min(min, p); max = math.max(max, p); }
            }
            return new JObject {
                ["name"] = prefab.name, ["prefab_entity_id"] = EntityId(entity),
                ["locked"] = RoadOperation.IsLocked(em, entity), ["supported"] = supported,
                ["unsupported_reason"] = supported ? null : "Only stamps whose top-level networks are all roads are supported.",
                ["road_count"] = roads, ["network_count"] = nets.Length,
                ["road_prefabs"] = new JArray(names.OrderBy(n => n, StringComparer.Ordinal)),
                ["base_construction_cost"] = prefab.m_ConstructionCost,
                ["local_curve_bounds"] = nets.Length == 0 ? null : new JObject { ["min"] = PointJson(min), ["max"] = PointJson(max) },
                ["notes"] = "Native AssetStamp from the intersection menu. Local curve bounds exclude road widths and decorations; native preview decides collisions, terrain and actual cost. Placement does not automatically connect surrounding roads."
            };
        }

        private JObject ListIntersectionPrefabs(JObject args, World world)
        {
            var search = (string)args["search"] ?? "";
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 10000), limit = ComponentInspector.Int(args, "limit", 50, 1, 100);
            var rows = new List<JObject>();
            foreach (var e in IntersectionPrefabs(world.EntityManager))
            {
                var row = IntersectionPrefabInfo(e, world);
                if ((int)row["road_count"] > 0 && ((string)row["name"]).IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0) rows.Add(row);
            }
            rows = rows.OrderBy(r => (string)r["name"], StringComparer.Ordinal).ToList();
            return new JObject { ["total"] = rows.Count, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : JValue.CreateNull(), ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }

        private JObject PreviewIntersectionPrefab(JObject args, World world)
        {
            var key = RequestKey(args);
            var fingerprint = new JObject { ["kind"] = "intersection_prefab", ["intersection_prefab"] = args["intersection_prefab"]?.DeepClone(),
                ["position"] = args["position"]?.DeepClone(), ["rotation_degrees"] = args["rotation_degrees"]?.DeepClone() }.ToString(Formatting.None);
            if (m_RoadRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_RoadOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another placement.");
                return old.Json();
            }
            if (m_RoadOperations.Count >= 4096) throw new QueryException("ROAD_OPERATION_LIMIT", "This city session has reached 4096 road operations; reload the city to reset the journal.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause before previewing an intersection prefab.");
            var tool = RoadTool(world);
            if (tool.Busy || !(world.GetExistingSystemManaged<ToolSystem>().activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Return to the default selection tool first.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            Entity prefab = Entity.Null; var name = (string)args["intersection_prefab"];
            foreach (var e in IntersectionPrefabs(em)) if (prefabs.GetPrefab<AssetStampPrefab>(e).name == name) { prefab = e; break; }
            if (prefab == Entity.Null) throw new QueryException("UNKNOWN_INTERSECTION_PREFAB", "Use an exact name from list_intersection_prefabs.");
            if (RoadOperation.IsLocked(em, prefab)) throw new QueryException("ROAD_LOCKED", "This intersection is not unlocked.");
            if (!(bool)IntersectionPrefabInfo(prefab, world)["supported"]) throw new QueryException("UNSUPPORTED_INTERSECTION_PREFAB", "This asset includes unsupported non-road networks.");
            if (!(args["position"] is JObject point)) throw new QueryException("INVALID_ARGUMENT", "position requires x and z.");
            var position = new float3(ReadCoordinate(point, "position", "x"), 0, ReadCoordinate(point, "position", "z"));
            var angle = BuildingNumber(args, "rotation_degrees", 0, -360, 360);
            var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            position.y = TerrainUtils.SampleHeight(ref heights, position);
            var op = new RoadOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, Prefab = prefab, PrefabName = name,
                CurveMode = "intersection_prefab", TransactionKind = "native_asset_stamp", Start = position, End = position, StampRotationDegrees = angle };
            foreach (var net in em.GetBuffer<Game.Prefabs.SubNet>(prefab, true)) op.StampRoadPrefabs.Add(net.m_Prefab);
            tool.Begin(op); m_RoadOperations.Add(op.Id, op); m_RoadRequestIds.Add(key, op.Id);
            // Use the road-operation JSON so an intersection stamp also reports its
            // prefab name, placement position, rotation and connection points.
            return op.Json();
        }
    }
}
