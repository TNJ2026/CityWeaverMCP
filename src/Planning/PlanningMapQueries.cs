using System;
using Game.Buildings;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private struct PlanningBounds
        {
            public float MinX, MinZ, MaxX, MaxZ;
            public bool Contains(float3 p) => p.x >= MinX && p.x <= MaxX && p.z >= MinZ && p.z <= MaxZ;
            public bool Intersects(Colossal.Mathematics.Bezier4x3 curve)
            {
                var minX = math.min(math.min(curve.a.x, curve.b.x), math.min(curve.c.x, curve.d.x));
                var maxX = math.max(math.max(curve.a.x, curve.b.x), math.max(curve.c.x, curve.d.x));
                var minZ = math.min(math.min(curve.a.z, curve.b.z), math.min(curve.c.z, curve.d.z));
                var maxZ = math.max(math.max(curve.a.z, curve.b.z), math.max(curve.c.z, curve.d.z));
                return maxX >= MinX && minX <= MaxX && maxZ >= MinZ && minZ <= MaxZ;
            }
            public JObject Json() => new JObject { ["min_x"] = MinX, ["min_z"] = MinZ, ["max_x"] = MaxX, ["max_z"] = MaxZ };
        }

        private static float PlanningNumber(JObject value, string name, float fallback)
        {
            var token = value?[name];
            if (token == null) return fallback;
            if ((token.Type != JTokenType.Integer && token.Type != JTokenType.Float) ||
                !float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) ||
                !math.isfinite(number) || number < -7168 || number > 7168)
                throw new QueryException("INVALID_ARGUMENT", name + " must be a finite world coordinate from -7168 to 7168.");
            return number;
        }

        private static PlanningBounds ReadPlanningBounds(JObject args)
        {
            var value = args["bounds"] as JObject ?? throw new QueryException("INVALID_ARGUMENT", "bounds is required.");
            var bounds = new PlanningBounds {
                MinX = PlanningNumber(value, "min_x", -7168), MinZ = PlanningNumber(value, "min_z", -7168),
                MaxX = PlanningNumber(value, "max_x", 7168), MaxZ = PlanningNumber(value, "max_z", 7168)
            };
            if (bounds.MinX >= bounds.MaxX || bounds.MinZ >= bounds.MaxZ)
                throw new QueryException("INVALID_ARGUMENT", "bounds min values must be smaller than max values.");
            return bounds;
        }

        private static JObject PlanningCurve(Colossal.Mathematics.Bezier4x3 curve) => new JObject {
            ["a"] = PointJson(curve.a), ["b"] = PointJson(curve.b), ["c"] = PointJson(curve.c), ["d"] = PointJson(curve.d)
        };

        private static string PlanningElevation(EntityManager em, Entity edge, Colossal.Mathematics.Bezier4x3 curve)
        {
            if (em.HasComponent<Elevation>(edge)) {
                var value = em.GetComponentData<Elevation>(edge).m_Elevation;
                if (value.x <= -8 || value.y <= -8) return "underground";
                if (value.x >= 8 || value.y >= 8) return "elevated";
            }
            var average = (curve.a.y + curve.b.y + curve.c.y + curve.d.y) * .25f;
            return average < -8 ? "underground" : "surface";
        }

        private JObject GetPlanningMapSnapshot(JObject args, World world)
        {
            var bounds = ReadPlanningBounds(args);
            var maxFeatures = ComponentInspector.Int(args, "max_features_per_layer", 2000, 1, 5000);
            var includeRoads = (bool?)args["include_roads"] ?? true;
            var includeBuildings = (bool?)args["include_buildings"] ?? true;
            var includeTracks = (bool?)args["include_tracks"] ?? true;
            var includeUtilities = (bool?)args["include_utilities"] ?? true;
            var em = world.EntityManager;
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var roads = new JArray(); var buildings = new JArray(); var tracks = new JArray(); var utilities = new JArray();
            var roadTotal = 0; var buildingTotal = 0; var trackTotal = 0; var utilityTotal = 0;

            if (includeRoads)
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
            {
                var curve = em.GetComponentData<Curve>(entity).m_Bezier; if (!bounds.Intersects(curve)) continue; roadTotal++; if (roads.Count >= maxFeatures) continue;
                var prefabEntity = em.GetComponentData<PrefabRef>(entity).m_Prefab; prefabs.TryGetPrefab<PrefabBase>(prefabEntity, out var prefab);
                var width = em.HasComponent<NetGeometryData>(prefabEntity) ? em.GetComponentData<NetGeometryData>(prefabEntity).m_DefaultWidth : 8f;
                roads.Add(new JObject { ["id"] = EntityId(entity), ["prefab"] = prefab?.name, ["width_m"] = width,
                    ["curve"] = PlanningCurve(curve), ["elevation_class"] = PlanningElevation(em, entity, curve), ["status"] = "existing" });
            }

            if (includeTracks)
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
            {
                var prefabEntity = em.GetComponentData<PrefabRef>(entity).m_Prefab; if (!em.HasComponent<TrackData>(prefabEntity)) continue;
                var curve = em.GetComponentData<Curve>(entity).m_Bezier; if (!bounds.Intersects(curve)) continue; trackTotal++; if (tracks.Count >= maxFeatures) continue;
                prefabs.TryGetPrefab<PrefabBase>(prefabEntity, out var prefab); var data = em.GetComponentData<TrackData>(prefabEntity);
                var width = em.HasComponent<NetGeometryData>(prefabEntity) ? em.GetComponentData<NetGeometryData>(prefabEntity).m_DefaultWidth : 4f;
                tracks.Add(new JObject { ["id"] = EntityId(entity), ["prefab"] = prefab?.name, ["track_type"] = data.m_TrackType.ToString().ToLowerInvariant(),
                    ["width_m"] = width, ["curve"] = PlanningCurve(curve), ["elevation_class"] = PlanningElevation(em, entity, curve), ["status"] = "existing" });
            }

            if (includeUtilities)
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
            {
                var prefabEntity = em.GetComponentData<PrefabRef>(entity).m_Prefab; if (!IsUtilityPrefab(em, prefabEntity)) continue;
                var curve = em.GetComponentData<Curve>(entity).m_Bezier; if (!bounds.Intersects(curve)) continue; utilityTotal++; if (utilities.Count >= maxFeatures) continue;
                prefabs.TryGetPrefab<PrefabBase>(prefabEntity, out var prefab); var width = em.HasComponent<NetGeometryData>(prefabEntity) ? em.GetComponentData<NetGeometryData>(prefabEntity).m_DefaultWidth : 2f;
                utilities.Add(new JObject { ["id"] = EntityId(entity), ["prefab"] = prefab?.name, ["network_type"] = UtilityNetworkKind(em, prefabEntity),
                    ["width_m"] = width, ["curve"] = PlanningCurve(curve), ["elevation_class"] = PlanningElevation(em, entity, curve), ["status"] = "existing" });
            }

            if (includeBuildings)
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
            {
                var transform = em.GetComponentData<Game.Objects.Transform>(entity); if (!bounds.Contains(transform.m_Position)) continue; buildingTotal++; if (buildings.Count >= maxFeatures) continue;
                var prefabEntity = em.GetComponentData<PrefabRef>(entity).m_Prefab; prefabs.TryGetPrefab<PrefabBase>(prefabEntity, out var prefab);
                var size = em.HasComponent<ObjectGeometryData>(prefabEntity) ? em.GetComponentData<ObjectGeometryData>(prefabEntity).m_Size : new float3(8, 8, 8);
                var rotation = transform.m_Rotation.value; var degrees = math.degrees(math.atan2(2f * (rotation.w * rotation.y + rotation.x * rotation.z), 1f - 2f * (rotation.y * rotation.y + rotation.z * rotation.z)));
                var kind = em.HasComponent<ResidentialProperty>(entity) ? "residential" : em.HasComponent<CommercialProperty>(entity) ? "commercial" :
                    em.HasComponent<IndustrialProperty>(entity) ? "industrial" : em.HasComponent<OfficeProperty>(entity) ? "office" : "service";
                buildings.Add(new JObject { ["id"] = EntityId(entity), ["prefab"] = prefab?.name, ["kind"] = kind, ["position"] = PointJson(transform.m_Position),
                    ["rotation_degrees"] = degrees, ["size_m"] = new JObject { ["x"] = math.max(2, size.x), ["z"] = math.max(2, size.z) }, ["status"] = "existing" });
            }

            var truncated = roadTotal > roads.Count || buildingTotal > buildings.Count || trackTotal > tracks.Count || utilityTotal > utilities.Count;
            return new JObject {
                ["session_id"] = m_Session, ["captured_at_utc"] = DateTime.UtcNow.ToString("O"), ["bounds"] = bounds.Json(),
                ["roads"] = roads, ["buildings"] = buildings, ["tracks"] = tracks, ["utilities"] = utilities,
                ["counts"] = new JObject { ["roads"] = roadTotal, ["buildings"] = buildingTotal, ["tracks"] = trackTotal, ["utilities"] = utilityTotal },
                ["truncated"] = truncated, ["max_features_per_layer"] = maxFeatures,
                ["notes"] = "Read-only live geometry snapshot. Standalone utility networks are included; road-embedded utility capacity and exact transport route paths are not expanded."
            };
        }
    }
}
