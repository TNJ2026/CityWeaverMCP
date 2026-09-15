using System;
using System.Collections.Generic;
using System.Linq;
using Game.Areas;
using Game.Buildings;
using Game.Common;
using Game.Economy;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed class BuildingAreaOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, CommitRequestId, Fingerprint, Type, State = "queued", Error, PrefabName;
        public Entity Owner, OwnerPrefab, Prefab, Target, Result;
        public long Cost, MaxCost;
        public readonly List<float3> Points = new List<float3>();
        public readonly List<float3> OriginalPoints = new List<float3>();
        public JObject AreaInfo = new JObject();
        public bool CommitRequested, CancelRequested, ApplyDispatched;
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public JArray Errors = new JArray(), Warnings = new JArray();
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired" || State == "outcome_unknown";
        public string EntityId(Entity entity) => entity == Entity.Null ? null : Session + ":" + entity.Index + ":" + entity.Version;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["session_id"] = Session, ["request_id"] = RequestId, ["state"] = State,
            ["operation_type"] = Type, ["building_id"] = EntityId(Owner), ["area_prefab"] = PrefabName,
            ["target_area_id"] = EntityId(Target), ["result_area_id"] = EntityId(Result),
            ["point_count"] = Points.Count, ["surface_area_m2"] = Points.Count >= 3 ? GameQueryService.PolygonArea(Points) : 0,
            ["boundary"] = new JArray(Points.Select(GameQueryService.PointJson)), ["cost"] = Cost, ["max_cost"] = CommitRequestId == null ? null : new JValue(MaxCost),
            ["area_info"] = AreaInfo.DeepClone(),
            ["errors"] = Errors.DeepClone(), ["warnings"] = Warnings.DeepClone(), ["error"] = Error,
            ["can_commit"] = State == "preview_ready", ["expires_at_utc"] = Expires.ToString("O")
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, BuildingAreaOperation> m_BuildingAreaOperations = new Dictionary<string, BuildingAreaOperation>();
        private readonly Dictionary<string, string> m_BuildingAreaRequestIds = new Dictionary<string, string>();

        private void ResetBuildingAreaOperations()
        {
            var world = World.DefaultGameObjectInjectionWorld;
            if (world != null && world.IsCreated) world.GetExistingSystemManaged<McpBuildingAreaToolSystem>()?.AbortForLoading();
            m_BuildingAreaOperations.Clear();
            m_BuildingAreaRequestIds.Clear();
        }

        private static bool PermanentBuildingAreaOwner(EntityManager em, Entity entity) => em.Exists(entity) && em.HasComponent<Building>(entity) && em.HasComponent<PrefabRef>(entity) && em.HasBuffer<Game.Areas.SubArea>(entity) && !em.HasComponent<Temp>(entity) && !em.HasComponent<Deleted>(entity);
        internal static bool PermanentBuildingArea(EntityManager em, Entity entity) => em.Exists(entity) && em.HasComponent<Area>(entity) && em.HasComponent<Owner>(entity) && em.HasComponent<PrefabRef>(entity) && em.HasBuffer<Game.Areas.Node>(entity) && !em.HasComponent<Temp>(entity) && !em.HasComponent<Deleted>(entity);

        private Entity ResolveBuildingAreaOwner(string id, World world)
        {
            var entity = ParseEntity(id, world.EntityManager);
            if (!PermanentBuildingAreaOwner(world.EntityManager, entity)) throw new QueryException("BUILDING_AREA_OWNER_NOT_FOUND", "building_id must identify a permanent top-level building that supports attached areas in this city session.");
            return entity;
        }

        private Entity ResolveBuildingArea(string id, World world)
        {
            var entity = ParseEntity(id, world.EntityManager);
            if (!PermanentBuildingArea(world.EntityManager, entity)) throw new QueryException("BUILDING_AREA_NOT_FOUND", "area_id must identify a permanent building-owned area in this city session.");
            var owner = world.EntityManager.GetComponentData<Owner>(entity).m_Owner;
            if (!PermanentBuildingAreaOwner(world.EntityManager, owner)) throw new QueryException("BUILDING_AREA_NOT_FOUND", "area_id is not owned by a permanent building.");
            return entity;
        }

        internal static List<float3> ReadBuildingAreaPoints(EntityManager em, Entity entity)
        {
            var result = new List<float3>();
            var buffer = em.GetBuffer<Game.Areas.Node>(entity, true);
            for (int i = 0; i < buffer.Length; i++) result.Add(buffer[i].m_Position);
            return result;
        }

        private List<float3> ParseBuildingAreaBoundary(JArray input)
        {
            if (input == null) throw new QueryException("INVALID_ARGUMENT", "boundary is required.");
            var points = new List<float3>();
            foreach (var token in input)
            {
                if (!(token is JObject point) || point["x"] == null || point["z"] == null) throw new QueryException("INVALID_ARGUMENT", "Every boundary point requires x and z.");
                points.Add(new float3((float)point["x"], (float?)point["y"] ?? 0, (float)point["z"]));
            }
            if (points.Count > 3 && math.distance(points[0].xz, points[points.Count - 1].xz) < .01f) points.RemoveAt(points.Count - 1);
            ValidateBuildingAreaPolygon(points);
            return points;
        }

        private static float BuildingAreaCross(float2 a, float2 b, float2 c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        private static bool BuildingAreaSegmentsCross(float2 a, float2 b, float2 c, float2 d) => BuildingAreaCross(a, b, c) * BuildingAreaCross(a, b, d) < 0 && BuildingAreaCross(c, d, a) * BuildingAreaCross(c, d, b) < 0;
        private static void ValidateBuildingAreaPolygon(List<float3> points)
        {
            if (points.Count < 3 || points.Count > 64) throw new QueryException("INVALID_ARGUMENT", "boundary must contain 3..64 distinct points.");
            for (int i = 0; i < points.Count; i++)
            {
                if (!math.all(math.isfinite(points[i])) || math.any(math.abs(points[i].xz) > 7168)) throw new QueryException("INVALID_ARGUMENT", "boundary coordinates must be finite and inside the playable coordinate range.");
                if (math.distance(points[i].xz, points[(i + 1) % points.Count].xz) < 4) throw new QueryException("BUILDING_AREA_EDGE_TOO_SHORT", "Adjacent area points must be at least 4 metres apart.");
            }
            if (PolygonArea(points) < 100) throw new QueryException("BUILDING_AREA_TOO_SMALL", "Building area surface must be at least 100 square metres.");
            for (int i = 0; i < points.Count; i++) for (int j = i + 1; j < points.Count; j++)
            {
                if (j == (i + 1) % points.Count || i == (j + 1) % points.Count) continue;
                if (BuildingAreaSegmentsCross(points[i].xz, points[(i + 1) % points.Count].xz, points[j].xz, points[(j + 1) % points.Count].xz)) throw new QueryException("BUILDING_AREA_SELF_INTERSECTION", "Building area boundary must not self-intersect.");
            }
        }

        private static string BuildingAreaKind(EntityManager em, Entity prefab)
        {
            if (em.HasComponent<StorageAreaData>(prefab)) return "storage";
            if (em.HasComponent<ExtractorAreaData>(prefab)) return "extractor";
            return "other";
        }

        private JArray ResourceNames(Resource resources)
        {
            var result = new JArray();
            foreach (Resource value in Enum.GetValues(typeof(Resource)))
                if (value != Resource.NoResource && value != Resource.All && value != Resource.Last && (((ulong)value & ((ulong)value - 1)) == 0) && (resources & value) != 0) result.Add(value.ToString());
            return result;
        }

        private JObject BuildingAreaPrefabRow(World world, Entity prefab)
        {
            var em = world.EntityManager; var prefabSystem = world.GetExistingSystemManaged<PrefabSystem>();
            prefabSystem.TryGetPrefab<PrefabBase>(prefab, out var prefabObject);
            var row = new JObject { ["name"] = prefabObject?.name, ["kind"] = BuildingAreaKind(em, prefab), ["locked"] = PrefabLocked(em, prefab) };
            if (em.HasComponent<AreaGeometryData>(prefab))
            {
                var geometry = em.GetComponentData<AreaGeometryData>(prefab);
                row["area_type"] = geometry.m_Type.ToString(); row["geometry_flags"] = geometry.m_Flags.ToString(); row["snap_distance_m"] = geometry.m_SnapDistance;
            }
            if (em.HasComponent<StorageAreaData>(prefab))
            {
                var storage = em.GetComponentData<StorageAreaData>(prefab);
                row["allowed_resources"] = ResourceNames(storage.m_Resources); row["capacity"] = storage.m_Capacity;
            }
            if (em.HasComponent<ExtractorAreaData>(prefab))
            {
                var extractor = em.GetComponentData<ExtractorAreaData>(prefab);
                row["map_feature"] = extractor.m_MapFeature.ToString(); row["requires_natural_resource"] = extractor.m_RequireNaturalResource;
                row["object_spawn_factor"] = extractor.m_ObjectSpawnFactor; row["max_object_area"] = extractor.m_MaxObjectArea;
            }
            return row;
        }

        private JObject BuildingAreaRow(World world, Entity entity, bool includeBoundary)
        {
            var em = world.EntityManager; var owner = em.GetComponentData<Owner>(entity).m_Owner; var prefab = em.GetComponentData<PrefabRef>(entity).m_Prefab;
            var points = ReadBuildingAreaPoints(em, entity); var row = BuildingAreaPrefabRow(world, prefab);
            row["area_id"] = m_Session + ":" + entity.Index + ":" + entity.Version; row["building_id"] = m_Session + ":" + owner.Index + ":" + owner.Version;
            row["point_count"] = points.Count; row["surface_area_m2"] = em.HasComponent<Geometry>(entity) ? em.GetComponentData<Geometry>(entity).m_SurfaceArea : PolygonArea(points);
            if (em.HasComponent<Geometry>(entity))
            {
                var geometry = em.GetComponentData<Geometry>(entity); row["center"] = PointJson(geometry.m_CenterPosition);
                row["bounds"] = new JObject { ["min"] = PointJson(geometry.m_Bounds.min), ["max"] = PointJson(geometry.m_Bounds.max) };
            }
            if (em.HasComponent<Area>(entity)) row["area_flags"] = em.GetComponentData<Area>(entity).m_Flags.ToString();
            if (em.HasComponent<Storage>(entity)) { var storage = em.GetComponentData<Storage>(entity); row["stored_amount"] = storage.m_Amount; row["work_amount"] = storage.m_WorkAmount; }
            if (em.HasComponent<Extractor>(entity))
            {
                var extractor = em.GetComponentData<Extractor>(entity); row["resource_amount"] = extractor.m_ResourceAmount; row["max_concentration"] = extractor.m_MaxConcentration;
                row["extracted_amount"] = extractor.m_ExtractedAmount; row["total_extracted"] = extractor.m_TotalExtracted; row["work_type"] = extractor.m_WorkType.ToString();
            }
            if (em.HasBuffer<MapFeatureElement>(entity))
            {
                var features = em.GetBuffer<MapFeatureElement>(entity, true); var values = new JObject();
                for (int i = 0; i < features.Length && i < (int)MapFeature.Count; i++) values[((MapFeature)i).ToString()] = new JObject { ["amount"] = features[i].m_Amount, ["renewal_rate"] = features[i].m_RenewalRate };
                row["map_features"] = values;
            }
            if (includeBoundary) row["boundary"] = new JArray(points.Select(PointJson));
            return row;
        }

        private JObject ListBuildingAreas(JObject args, World world)
        {
            var owner = ResolveBuildingAreaOwner((string)args["building_id"], world); var em = world.EntityManager; var ownerPrefab = em.GetComponentData<PrefabRef>(owner).m_Prefab;
            var available = new JArray();
            if (em.HasBuffer<Game.Prefabs.SubArea>(ownerPrefab))
            {
                var prefabs = em.GetBuffer<Game.Prefabs.SubArea>(ownerPrefab, true); var seen = new HashSet<Entity>();
                for (int i = 0; i < prefabs.Length; i++) if (seen.Add(prefabs[i].m_Prefab)) available.Add(BuildingAreaPrefabRow(world, prefabs[i].m_Prefab));
            }
            var items = new JArray();
            if (em.HasBuffer<Game.Areas.SubArea>(owner))
            {
                var areas = em.GetBuffer<Game.Areas.SubArea>(owner, true);
                for (int i = 0; i < areas.Length; i++) if (PermanentBuildingArea(em, areas[i].m_Area) && em.GetComponentData<Owner>(areas[i].m_Area).m_Owner == owner) items.Add(BuildingAreaRow(world, areas[i].m_Area, true));
            }
            return new JObject { ["building_id"] = m_Session + ":" + owner.Index + ":" + owner.Version, ["available_area_prefabs"] = available, ["total"] = items.Count, ["items"] = items };
        }

        private Entity ResolveCompatibleBuildingAreaPrefab(string name, Entity owner, World world)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new QueryException("INVALID_ARGUMENT", "area_prefab is required for create mode.");
            var em = world.EntityManager; var ownerPrefab = em.GetComponentData<PrefabRef>(owner).m_Prefab; var prefabSystem = world.GetExistingSystemManaged<PrefabSystem>();
            if (em.HasBuffer<Game.Prefabs.SubArea>(ownerPrefab))
            {
                var allowed = em.GetBuffer<Game.Prefabs.SubArea>(ownerPrefab, true);
                for (int i = 0; i < allowed.Length; i++) if (prefabSystem.TryGetPrefab<PrefabBase>(allowed[i].m_Prefab, out var prefab) && prefab.name == name)
                {
                    if (PrefabLocked(em, allowed[i].m_Prefab)) throw new QueryException("BUILDING_AREA_PREFAB_LOCKED", "The selected building area prefab is locked.");
                    return allowed[i].m_Prefab;
                }
            }
            throw new QueryException("INCOMPATIBLE_BUILDING_AREA_PREFAB", "Use an exact area prefab returned by list_building_areas for this building.");
        }

        private static bool BuildingAreaPrefabAllowed(EntityManager em, Entity ownerPrefab, Entity areaPrefab)
        {
            if (!em.Exists(ownerPrefab) || !em.HasBuffer<Game.Prefabs.SubArea>(ownerPrefab)) return false;
            var allowed = em.GetBuffer<Game.Prefabs.SubArea>(ownerPrefab, true);
            for (int i = 0; i < allowed.Length; i++) if (allowed[i].m_Prefab == areaPrefab) return true;
            return false;
        }

        private BuildingAreaOperation PreviewBuildingArea(JObject args, World world)
        {
            var mode = ((string)args["mode"] ?? "").ToLowerInvariant();
            if (mode != "create" && mode != "boundary" && mode != "delete") throw new QueryException("INVALID_ARGUMENT", "mode must be create, boundary, or delete.");
            var requestKey = RequestKey(args); var fingerprint = args.ToString(Formatting.None);
            if (m_BuildingAreaRequestIds.TryGetValue(requestKey, out var existingId))
            {
                var existing = m_BuildingAreaOperations[existingId];
                if (existing.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another building-area operation.");
                return existing;
            }
            if (m_BuildingAreaOperations.Count >= 128) throw new QueryException("BUILDING_AREA_OPERATION_LIMIT", "This city session has reached 128 building-area operations.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a building-area change.");
            var tool = world.GetOrCreateSystemManaged<McpBuildingAreaToolSystem>(); var toolSystem = world.GetExistingSystemManaged<ToolSystem>();
            if (tool.Busy || !(toolSystem.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var em = world.EntityManager; var operation = new BuildingAreaOperation { Session = m_Session, RequestId = requestKey, Fingerprint = fingerprint, Type = mode };
            if (mode == "create")
            {
                operation.Owner = ResolveBuildingAreaOwner((string)args["building_id"], world); operation.OwnerPrefab = em.GetComponentData<PrefabRef>(operation.Owner).m_Prefab;
                operation.PrefabName = (string)args["area_prefab"]; operation.Prefab = ResolveCompatibleBuildingAreaPrefab(operation.PrefabName, operation.Owner, world);
                operation.AreaInfo = BuildingAreaPrefabRow(world, operation.Prefab);
            }
            else
            {
                operation.Target = ResolveBuildingArea((string)args["area_id"], world); operation.Owner = em.GetComponentData<Owner>(operation.Target).m_Owner;
                operation.OwnerPrefab = em.GetComponentData<PrefabRef>(operation.Owner).m_Prefab; operation.Prefab = em.GetComponentData<PrefabRef>(operation.Target).m_Prefab;
                world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(operation.Prefab, out var prefab); operation.PrefabName = prefab?.name;
                operation.OriginalPoints.AddRange(ReadBuildingAreaPoints(em, operation.Target));
                operation.AreaInfo = BuildingAreaRow(world, operation.Target, false);
                if (!BuildingAreaPrefabAllowed(em, operation.OwnerPrefab, operation.Prefab)) throw new QueryException("BUILDING_AREA_COMPATIBILITY_CHANGED", "The target area prefab is no longer declared by its owner building prefab.");
            }
            if (mode == "create" || mode == "boundary") operation.Points.AddRange(ParseBuildingAreaBoundary(args["boundary"] as JArray));
            else operation.Points.AddRange(operation.OriginalPoints);
            m_BuildingAreaOperations.Add(operation.Id, operation); m_BuildingAreaRequestIds.Add(requestKey, operation.Id); tool.Begin(operation); return operation;
        }

        private BuildingAreaOperation BuildingAreaOperationById(JObject args)
        {
            if (!m_BuildingAreaOperations.TryGetValue((string)args["operation_id"] ?? "", out var operation) || operation.Session != m_Session) throw new QueryException("BUILDING_AREA_OPERATION_NOT_FOUND", "Unknown building-area operation in this city session.");
            return operation;
        }

        private JObject GetBuildingAreaOperation(JObject args) => BuildingAreaOperationById(args).Json();
        private JObject ApplyBuildingAreaOperation(JObject args, World world)
        {
            var operation = BuildingAreaOperationById(args); var requestKey = RequestKey(args); long maxCost = ComponentInspector.Int(args, "max_cost", 0, 0, 1000000000);
            if (operation.CommitRequestId != null)
            {
                if (operation.CommitRequestId != requestKey || operation.MaxCost != maxCost) throw new QueryException("IDEMPOTENCY_CONFLICT", "This building-area operation already has another commit request.");
                return operation.Json();
            }
            if (operation.State != "preview_ready" || operation.CancelRequested || DateTime.UtcNow >= operation.Expires) throw new QueryException("BUILDING_AREA_NOT_READY", "Wait for a valid unexpired building-area preview.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before applying a building-area change.");
            if (operation.Cost > maxCost) throw new QueryException("MAX_COST_EXCEEDED", "The current building-area preview exceeds max_cost.");
            operation.CommitRequestId = requestKey; operation.MaxCost = maxCost; operation.CommitRequested = true; return operation.Json();
        }

        private JObject CancelBuildingAreaPreview(JObject args)
        {
            var operation = BuildingAreaOperationById(args);
            if (operation.ApplyDispatched) throw new QueryException("APPLY_ALREADY_DISPATCHED", "The native building-area apply was already dispatched.");
            if (!operation.Terminal) operation.CancelRequested = true;
            return operation.Json();
        }
    }
}
