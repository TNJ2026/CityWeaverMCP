using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Colossal.Entities;
using Game.Buildings;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed class BuildingPlacementPlan
    {
        public Entity Prefab, ParentRoad;
        public string PrefabName, RoadPrefab, Side;
        public float3 Position;
        public quaternion Rotation;
        public float RotationDegrees, TerrainMin, TerrainMax, FoundationTarget, RoadSurfaceHeight, EntranceDistance, EntranceAngle;
        public int SampleCount;
        public bool FoundationLevelingRequired;
    }

    public sealed class BuildingOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint;
        public string Type, State = "queued", Error, CommitRequestId, PrefabName, OriginalPrefabName, UpgradePlacementMode, UpgradePlacementSide;
        public Entity Prefab, Target, OriginalPrefab, ParentRoad;
        public float3 Position, OriginalPosition;
        public quaternion Rotation, OriginalRotation;
        public float RotationDegrees, UpgradePlacementOffset;
        public long Cost, MaxCost;
        public readonly JArray Errors = new JArray();
        public readonly JArray Warnings = new JArray();
        public readonly List<Entity> PreviewEntities = new List<Entity>();
        public readonly List<Entity> ResultEntities = new List<Entity>();
        public readonly List<BuildingPlacementPlan> Placements = new List<BuildingPlacementPlan>();
        public int ExpectedResultCount = 1;
        public bool CommitRequested, ApplyDispatched, CancelRequested;
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired" || State == "outcome_unknown";
        public string EntityId(Entity e) => e == Entity.Null ? null : Session + ":" + e.Index + ":" + e.Version;
        private static JObject Point(float3 p) => new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z };
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["operation_type"] = Type, ["state"] = State,
            ["building_prefab"] = PrefabName, ["original_building_prefab"] = OriginalPrefabName,
            ["target_building_id"] = EntityId(Target), ["road_edge_id"] = EntityId(ParentRoad), ["position"] = Point(Position),
            ["original_position"] = Target != Entity.Null ? Point(OriginalPosition) : null,
            ["upgrade_placement_mode"] = Type == "upgrade" ? UpgradePlacementMode : null,
            ["upgrade_placement_side"] = Type == "upgrade" ? UpgradePlacementSide : null,
            ["upgrade_placement_offset_m"] = Type == "upgrade" ? new JValue(UpgradePlacementOffset) : null,
            ["rotation_degrees"] = RotationDegrees, ["cost"] = Cost, ["max_cost"] = MaxCost,
            ["errors"] = Errors.DeepClone(), ["warnings"] = Warnings.DeepClone(), ["error"] = Error,
            ["preview_entity_count"] = PreviewEntities.Count, ["expected_building_count"] = ExpectedResultCount,
            ["placements"] = Placements.Count == 0 ? null : new JArray(Placements.Select((p, i) => new JObject {
                ["index"] = i, ["building_prefab"] = p.PrefabName, ["road_edge_id"] = EntityId(p.ParentRoad),
                ["position"] = Point(p.Position), ["rotation_degrees"] = p.RotationDegrees, ["road_side"] = p.Side,
                ["foundation_target_height_m"] = p.FoundationTarget, ["terrain_min_m"] = p.TerrainMin, ["terrain_max_m"] = p.TerrainMax,
                ["terrain_relief_m"] = p.TerrainMax - p.TerrainMin, ["foundation_leveling_required"] = p.FoundationLevelingRequired,
                ["entrance_distance_m"] = p.EntranceDistance, ["entrance_angle_error_degrees"] = p.EntranceAngle
            })),
            ["result_entity_ids"] = new JArray(ResultEntities.Select(EntityId)),
            ["expires_at_utc"] = Expires.ToString("O"), ["commit_dispatched"] = ApplyDispatched,
            ["can_commit"] = State == "preview_ready" && !CommitRequested && !CancelRequested,
            ["note"] = "Only completed confirms a permanent building change. Poll this operation after a timeout."
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, BuildingOperation> m_BuildingOperations = new Dictionary<string, BuildingOperation>();
        private readonly Dictionary<string, string> m_BuildingRequestIds = new Dictionary<string, string>();
        private McpBuildingToolSystem BuildingTool(World world) => world.GetExistingSystemManaged<McpBuildingToolSystem>() ?? throw new QueryException("BUILDING_TOOL_UNAVAILABLE", "Building tool was not initialized.");

        private void ResetBuildingOperations()
        {
            var world = World.DefaultGameObjectInjectionWorld;
            if (world != null && world.IsCreated) world.GetExistingSystemManaged<McpBuildingToolSystem>()?.AbortForLoading();
            m_BuildingOperations.Clear(); m_BuildingRequestIds.Clear();
            m_CityServiceOperationIds.Clear();
            m_TransportFacilityOperationIds.Clear();
        }

        private static float BuildingNumber(JObject args, string name, float fallback, float min, float max)
        {
            var token = args[name]; if (token == null) return fallback;
            if ((token.Type != JTokenType.Float && token.Type != JTokenType.Integer) || !float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) || !math.isfinite(value) || value < min || value > max)
                throw new QueryException("INVALID_ARGUMENT", name + " must be a finite number from " + min + " to " + max + ".");
            return value;
        }

        private Entity ResolveBuildingPrefab(string name, World world, bool upgrade)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new QueryException("INVALID_ARGUMENT", "An exact building prefab name is required.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
                foreach (var entity in entities)
                {
                    bool isUpgrade = em.HasComponent<Game.Prefabs.ServiceUpgradeData>(entity);
                    bool kind = upgrade ? isUpgrade : !isUpgrade && em.HasComponent<BuildingData>(entity) && em.HasComponent<PlaceableObjectData>(entity);
                    if (kind && prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) && prefab.name == name) return entity;
                }
            throw new QueryException(upgrade ? "UNKNOWN_BUILDING_UPGRADE" : "UNKNOWN_BUILDING_PREFAB", "Use an exact unlocked name returned by list_building_prefabs.");
        }

        private static bool PrefabLocked(EntityManager em, Entity prefab) => em.HasComponent<Locked>(prefab) && em.IsComponentEnabled<Locked>(prefab);

        private JObject ListBuildingPrefabs(JObject args, World world)
        {
            var search = ((string)args["search"] ?? "").Trim(); var kind = ((string)args["kind"] ?? "building").ToLowerInvariant();
            if (kind != "building" && kind != "upgrade" && kind != "all") throw new QueryException("INVALID_ARGUMENT", "kind must be building, upgrade, or all.");
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 100000), limit = ComponentInspector.Int(args, "limit", 50, 1, 100);
            bool unlockedOnly = (bool?)args["unlocked_only"] ?? true;
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var rows = new List<JObject>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
                foreach (var entity in entities)
                {
                    bool upgrade = em.HasComponent<Game.Prefabs.ServiceUpgradeData>(entity);
                    bool building = !upgrade && em.HasComponent<BuildingData>(entity) && em.HasComponent<PlaceableObjectData>(entity);
                    if ((!building && !upgrade) || (kind == "building" && !building) || (kind == "upgrade" && !upgrade)) continue;
                    if (!prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) || (!string.IsNullOrEmpty(search) && prefab.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0)) continue;
                    bool locked = PrefabLocked(em, entity); if (unlockedOnly && locked) continue;
                    var row = new JObject { ["name"] = prefab.name, ["kind"] = upgrade ? "upgrade" : "building", ["locked"] = locked };
                    if (em.HasComponent<BuildingData>(entity)) { var data = em.GetComponentData<BuildingData>(entity); row["lot_cells"] = new JObject { ["width"] = data.m_LotSize.x, ["depth"] = data.m_LotSize.y };
                        row["building_flags"] = data.m_Flags.ToString(); row["requires_road"] = (data.m_Flags & Game.Prefabs.BuildingFlags.RequireRoad) != 0;
                        row["requires_access"] = (data.m_Flags & Game.Prefabs.BuildingFlags.RequireAccess) != 0; row["can_be_roadside"] = (data.m_Flags & Game.Prefabs.BuildingFlags.CanBeRoadSide) != 0;
                        row["access_sides"] = new JArray(new[] { ((data.m_Flags & Game.Prefabs.BuildingFlags.LeftAccess) != 0, "left"), ((data.m_Flags & Game.Prefabs.BuildingFlags.RightAccess) != 0, "right"), ((data.m_Flags & Game.Prefabs.BuildingFlags.BackAccess) != 0, "back") }.Where(x => x.Item1).Select(x => x.Item2)); }
                    if (em.HasComponent<PlaceableObjectData>(entity)) { var place = em.GetComponentData<PlaceableObjectData>(entity); row["construction_cost"] = place.m_ConstructionCost; row["placement_flags"] = place.m_Flags.ToString();
                        row["placement"] = new JObject { ["road_side"] = (place.m_Flags & Game.Objects.PlacementFlags.RoadSide) != 0, ["on_ground"] = (place.m_Flags & Game.Objects.PlacementFlags.OnGround) != 0,
                            ["owner_side"] = (place.m_Flags & Game.Objects.PlacementFlags.OwnerSide) != 0, ["shoreline"] = (place.m_Flags & Game.Objects.PlacementFlags.Shoreline) != 0,
                            ["floating"] = (place.m_Flags & Game.Objects.PlacementFlags.Floating) != 0, ["road_node"] = (place.m_Flags & Game.Objects.PlacementFlags.RoadNode) != 0,
                            ["road_edge"] = (place.m_Flags & Game.Objects.PlacementFlags.RoadEdge) != 0, ["unique"] = (place.m_Flags & Game.Objects.PlacementFlags.Unique) != 0 }; }
                    if (upgrade) { var data = em.GetComponentData<Game.Prefabs.ServiceUpgradeData>(entity); row["upgrade_cost"] = data.m_UpgradeCost; row["forbid_multiple"] = data.m_ForbidMultiple;
                        row["max_placement_distance_m"] = data.m_MaxPlacementDistance; row["max_placement_offset_cells"] = data.m_MaxPlacementOffset;
                        row["compatible_building_count"] = em.HasBuffer<ServiceUpgradeBuilding>(entity) ? em.GetBuffer<ServiceUpgradeBuilding>(entity, true).Length : 0; }
                    if (em.HasComponent<ObjectGeometryData>(entity)) { var geometry = em.GetComponentData<ObjectGeometryData>(entity); row["size_m"] = new JObject { ["x"] = geometry.m_Size.x, ["y"] = geometry.m_Size.y, ["z"] = geometry.m_Size.z }; }
                    rows.Add(row);
                }
            rows.Sort((a, b) => string.CompareOrdinal((string)a["name"], (string)b["name"]));
            return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : null, ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }

        private static JObject UpgradeRangePoint(float3 center, float2 right, float2 forward, float localX, float localZ)
        {
            var point = center.xz + right * localX + forward * localZ;
            return new JObject { ["x"] = point.x, ["y"] = center.y, ["z"] = point.y };
        }

        private static JArray UpgradeValidationOutline(float3 center, float2 forward, float width, float length, float roundness, bool circular)
        {
            var result = new JArray(); var right = MathUtils.Right(forward); const int arcSteps = 8;
            if (circular)
            {
                for (int i = 0; i < arcSteps * 4; i++)
                {
                    float angle = math.PI * 2f * i / (arcSteps * 4);
                    result.Add(UpgradeRangePoint(center, right, forward, math.cos(angle) * roundness, math.sin(angle) * roundness));
                }
                return result;
            }
            float radius = math.max(0, roundness - 8f), halfWidth = width * .5f, halfLength = length * .5f;
            if (radius < .001f)
            {
                result.Add(UpgradeRangePoint(center, right, forward, halfWidth, halfLength));
                result.Add(UpgradeRangePoint(center, right, forward, -halfWidth, halfLength));
                result.Add(UpgradeRangePoint(center, right, forward, -halfWidth, -halfLength));
                result.Add(UpgradeRangePoint(center, right, forward, halfWidth, -halfLength));
                return result;
            }
            var centers = new[] { new float2(halfWidth - radius, halfLength - radius), new float2(-halfWidth + radius, halfLength - radius),
                new float2(-halfWidth + radius, -halfLength + radius), new float2(halfWidth - radius, -halfLength + radius) };
            for (int corner = 0; corner < 4; corner++) for (int i = 0; i < arcSteps; i++)
            {
                float angle = math.radians(90f * corner + 90f * i / (arcSteps - 1));
                result.Add(UpgradeRangePoint(center, right, forward, centers[corner].x + math.cos(angle) * radius, centers[corner].y + math.sin(angle) * radius));
            }
            return result;
        }

        private static bool UpgradeRangeContains(float3 center, float2 forward, float width, float length, float roundness, bool circular, float2 point)
        {
            var delta = point - center.xz;
            if (circular) return math.length(delta) <= roundness + .001f;
            float radius = math.max(0, roundness - 8f);
            var local = math.abs(new float2(math.dot(delta, MathUtils.Right(forward)), math.dot(delta, forward)));
            local = math.max(0, local - new float2(width * .5f, length * .5f) + radius);
            return math.length(local) <= radius + .001f;
        }

        private static bool UpgradeFootprintInsideRange(float3 center, float2 forward, float width, float length, float roundness, bool circular, BuildingData module, float3 position, quaternion rotation)
        {
            var corners = BuildingUtils.CalculateCorners(position, rotation, (float2)module.m_LotSize * 4f - .4f);
            return UpgradeRangeContains(center, forward, width, length, roundness, circular, corners.a.xz) &&
                UpgradeRangeContains(center, forward, width, length, roundness, circular, corners.b.xz) &&
                UpgradeRangeContains(center, forward, width, length, roundness, circular, corners.c.xz) &&
                UpgradeRangeContains(center, forward, width, length, roundness, circular, corners.d.xz);
        }

        private static JObject UpgradeSnapSegment(string side, float3 a, float3 b, float phase, float trimOrExtension, float3 ownerPosition, quaternion ownerRotation)
        {
            float3 delta = b - a; float lineLength = math.length(delta.xz); float3 direction = math.normalizesafe(delta, new float3(1, 0, 0));
            float minT = -trimOrExtension, maxT = lineLength + trimOrExtension;
            var start = a + direction * minT; var end = a + direction * maxT; var points = new JArray();
            var inverse = math.inverse(ownerRotation); var offsets = new List<float> { minT, maxT };
            int first = (int)math.ceil((minT + phase) / 8f), last = (int)math.floor((maxT + phase) / 8f);
            for (int k = first; k <= last; k++) offsets.Add(k * 8f - phase);
            foreach (var t in offsets.Distinct().OrderBy(x => x))
            {
                var position = a + direction * t; var local = math.mul(inverse, position - ownerPosition);
                float lateral = side == "back" || side == "front" ? local.x : local.z;
                points.Add(new JObject { ["position"] = PointJson(position), ["placement_offset_m"] = lateral,
                    ["clamped_endpoint"] = math.abs(t - minT) < .001f || math.abs(t - maxT) < .001f });
            }
            return new JObject { ["side"] = side, ["start"] = PointJson(start), ["end"] = PointJson(end), ["length_m"] = math.distance(start.xz, end.xz), ["snap_points"] = points };
        }

        private JObject UpgradePlacementGeometry(EntityManager em, Entity buildingEntity, Entity buildingPrefab, Entity upgradePrefab, Game.Prefabs.ServiceUpgradeData upgradeData, World world)
        {
            if (!em.HasComponent<BuildingData>(buildingPrefab) || !em.HasComponent<BuildingData>(upgradePrefab) || !em.HasComponent<Game.Objects.Transform>(buildingEntity))
                return new JObject { ["mode"] = em.HasComponent<BuildingExtensionData>(upgradePrefab) ? "fixed_extension" : "native_only", ["placement_range"] = null, ["owner_side_snap"] = null };
            var owner = em.GetComponentData<BuildingData>(buildingPrefab); var module = em.GetComponentData<BuildingData>(upgradePrefab);
            var transform = em.GetComponentData<Game.Objects.Transform>(buildingEntity); var forward3 = math.forward(transform.m_Rotation);
            JObject range = null; float rangeWidth = 0, rangeLength = 0, rangeRoundness = 0; bool rangeCircular = false; float2 rangeForward2 = default(float2);
            if (upgradeData.m_MaxPlacementDistance != 0f)
            {
                BuildingUtils.CalculateUpgradeRangeValues(transform.m_Rotation, owner, module, upgradeData, out var rangeForward, out var width, out var length, out var roundness, out var circular);
                rangeWidth = width; rangeLength = length; rangeRoundness = roundness; rangeCircular = circular; rangeForward2 = rangeForward.xz;
                range = new JObject { ["shape"] = circular ? "circle" : "rounded_rectangle", ["center"] = PointJson(transform.m_Position),
                    ["forward"] = new JObject { ["x"] = rangeForward.x, ["z"] = rangeForward.z }, ["width_m"] = width, ["length_m"] = length,
                    ["validation_corner_radius_m"] = circular ? roundness : math.max(0, roundness - 8f), ["circular"] = circular,
                    ["display"] = circular ? new JObject { ["diameter_m"] = width } : new JObject { ["center_line_length_m"] = length - roundness * 2f, ["stroke_width_m"] = width, ["normalized_roundness"] = roundness * 2f / width },
                    ["validation_outline"] = UpgradeValidationOutline(transform.m_Position, rangeForward.xz, width, length, roundness, circular),
                    ["note"] = "The native validator requires all four upgrade lot corners to remain inside this rounded range; collision and terrain checks are separate." };
            }
            int maxOffset = module.m_LotSize.x - 1;
            if (upgradeData.m_MaxPlacementOffset >= 0) maxOffset = upgradeData.m_MaxPlacementOffset;
            int2 expandedLot = owner.m_LotSize + module.m_LotSize.y; var corners = BuildingUtils.CalculateCorners(transform, expandedLot);
            float phase = ((module.m_LotSize.x - module.m_LotSize.y) & 1) != 0 ? 4f : 0f;
            float trimOrExtension = math.min(2 * maxOffset - module.m_LotSize.y - module.m_LotSize.x, module.m_LotSize.y - module.m_LotSize.x) * 4f;
            var segments = new JArray {
                UpgradeSnapSegment("back", corners.a, corners.b, phase, trimOrExtension, transform.m_Position, transform.m_Rotation),
                UpgradeSnapSegment("left", corners.b, corners.c, phase, trimOrExtension, transform.m_Position, transform.m_Rotation),
                UpgradeSnapSegment("front", corners.c, corners.d, phase, trimOrExtension, transform.m_Position, transform.m_Rotation),
                UpgradeSnapSegment("right", corners.d, corners.a, phase, trimOrExtension, transform.m_Position, transform.m_Rotation) };
            var roadCandidates = new JArray(); JObject roadRejected = null;
            if (upgradeData.m_MaxPlacementDistance != 0f)
            {
                float radius = math.min(3000, math.max(rangeWidth, rangeLength) * .75f + 64f);
                var sites = FindBuildingSites(upgradePrefab, PrefabHalfExtents(em, upgradePrefab), transform.m_Position.xz, radius, "either", 128, world, out roadRejected);
                var formatter = new BuildingOperation { Session = m_Session };
                foreach (var site in sites)
                {
                    if (site.Collision || roadCandidates.Count >= 32) continue;
                    try
                    {
                        var curve = em.GetComponentData<Curve>(site.Edge).m_Bezier; MathUtils.Distance(curve.xz, site.RoadPosition.xz, out float t);
                        var plan = RoadsidePlacement(upgradePrefab, site.Edge, t, site.Side == "left" ? 1 : -1, true, 8, world);
                        if (!UpgradeFootprintInsideRange(transform.m_Position, rangeForward2, rangeWidth, rangeLength, rangeRoundness, rangeCircular, module, plan.Position, plan.Rotation)) continue;
                        roadCandidates.Add(new JObject { ["position"] = PointJson(plan.Position), ["rotation_degrees"] = plan.RotationDegrees,
                            ["road_edge_id"] = formatter.EntityId(site.Edge), ["road_side"] = plan.Side, ["road_prefab"] = plan.RoadPrefab,
                            ["terrain_relief_m"] = plan.TerrainMax - plan.TerrainMin, ["foundation_leveling_required"] = plan.FoundationLevelingRequired });
                    }
                    catch (QueryException) { }
                }
            }
            return new JObject { ["mode"] = upgradeData.m_MaxPlacementDistance != 0f ? "owner_side_and_road_side" : "owner_side", ["owner_position"] = PointJson(transform.m_Position),
                ["owner_forward"] = new JObject { ["x"] = forward3.x, ["z"] = forward3.z }, ["owner_lot_cells"] = new JObject { ["width"] = owner.m_LotSize.x, ["depth"] = owner.m_LotSize.y },
                ["upgrade_lot_cells"] = new JObject { ["width"] = module.m_LotSize.x, ["depth"] = module.m_LotSize.y }, ["placement_range"] = range,
                ["owner_side_snap"] = new JObject { ["max_placement_offset_cells"] = upgradeData.m_MaxPlacementOffset, ["effective_max_placement_offset_cells"] = maxOffset,
                    ["snap_step_m"] = 8, ["snap_phase_m"] = phase, ["trim_or_extension_m"] = trimOrExtension, ["segments"] = segments },
                ["road_side_candidates"] = roadCandidates, ["road_candidate_rejections"] = roadRejected };
        }

        private JObject ListBuildingUpgrades(JObject args, World world)
        {
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var buildingEntity = ParseEntity((string)args["building_id"], em);
            if (!em.HasComponent<Building>(buildingEntity) || !em.HasComponent<PrefabRef>(buildingEntity) || em.HasComponent<Deleted>(buildingEntity) || em.HasComponent<Temp>(buildingEntity))
                throw new QueryException("NOT_A_BUILDING", "building_id must identify a permanent building.");
            var buildingPrefab = em.GetComponentData<PrefabRef>(buildingEntity).m_Prefab; var installed = new List<Entity>();
            if (em.HasBuffer<InstalledUpgrade>(buildingEntity))
            {
                var buffer = em.GetBuffer<InstalledUpgrade>(buildingEntity, true);
                for (int i = 0; i < buffer.Length; i++) if (buffer[i].m_Upgrade != Entity.Null && em.Exists(buffer[i].m_Upgrade) && !em.HasComponent<Deleted>(buffer[i].m_Upgrade)) installed.Add(buffer[i].m_Upgrade);
            }
            var installedPrefabs = new List<Entity>(); foreach (var entity in installed) if (em.HasComponent<PrefabRef>(entity)) installedPrefabs.Add(em.GetComponentData<PrefabRef>(entity).m_Prefab);
            var rows = new List<JObject>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Prefabs.ServiceUpgradeData>(), ComponentType.ReadOnly<ServiceUpgradeBuilding>(), ComponentType.ReadOnly<PrefabData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
            {
                var compatible = em.GetBuffer<ServiceUpgradeBuilding>(entity, true); bool matches = false;
                for (int i = 0; i < compatible.Length; i++) if (compatible[i].m_Building == buildingPrefab) { matches = true; break; }
                if (!matches || !prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab)) continue;
                var data = em.GetComponentData<Game.Prefabs.ServiceUpgradeData>(entity); int installedCount = installedPrefabs.Count(x => x == entity); bool locked = PrefabLocked(em, entity);
                rows.Add(new JObject { ["name"] = prefab.name, ["locked"] = locked, ["upgrade_cost"] = data.m_UpgradeCost, ["forbid_multiple"] = data.m_ForbidMultiple,
                    ["max_placement_distance_m"] = data.m_MaxPlacementDistance, ["max_placement_offset_cells"] = data.m_MaxPlacementOffset, ["installed_count"] = installedCount,
                    ["can_install"] = !locked && (!data.m_ForbidMultiple || installedCount == 0),
                    ["placement_geometry"] = UpgradePlacementGeometry(em, buildingEntity, buildingPrefab, entity, data, world) });
            }
            rows.Sort((a, b) => string.CompareOrdinal((string)a["name"], (string)b["name"]));
            return new JObject { ["building_id"] = new BuildingOperation { Session = m_Session }.EntityId(buildingEntity), ["building_prefab"] = prefabs.GetPrefab<PrefabBase>(buildingPrefab).name,
                ["compatible_upgrade_count"] = rows.Count, ["installed_upgrade_count"] = installed.Count, ["installed_upgrade_ids"] = new JArray(installed.Select(x => new BuildingOperation { Session = m_Session }.EntityId(x))), ["items"] = new JArray(rows) };
        }

        private Entity TopLevelBuilding(JObject args, World world)
        {
            var entity = ParseEntity((string)args["building_id"], world.EntityManager);
            if (!world.EntityManager.HasComponent<Building>(entity) || world.EntityManager.HasComponent<Deleted>(entity) || world.EntityManager.HasComponent<Temp>(entity))
                throw new QueryException("NOT_A_BUILDING", "building_id must identify a permanent top-level building.");
            return entity;
        }

        private JObject GetBuildingState(JObject args, World world)
        {
            var em = world.EntityManager; var entity = TopLevelBuilding(args, world); var building = em.GetComponentData<Building>(entity);
            string customName = null; var names = world.GetExistingSystemManaged<Game.UI.NameSystem>(); names?.TryGetCustomName(entity, out customName);
            var policies = new JArray();
            if (em.HasBuffer<Game.Policies.Policy>(entity))
            {
                var buffer = em.GetBuffer<Game.Policies.Policy>(entity, true); var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
                for (int i = 0; i < buffer.Length; i++)
                {
                    string name = null; if (prefabs.TryGetPrefab<PrefabBase>(buffer[i].m_Policy, out var prefab)) name = prefab.name;
                    policies.Add(new JObject { ["policy"] = name, ["active"] = (buffer[i].m_Flags & Game.Policies.PolicyFlags.Active) != 0, ["adjustment"] = buffer[i].m_Adjustment });
                }
            }
            return new JObject { ["building_id"] = new BuildingOperation { Session = m_Session }.EntityId(entity), ["custom_name"] = customName,
                ["active"] = !BuildingUtils.CheckOption(building, BuildingOption.Inactive),
                ["can_change_active"] = em.HasComponent<Game.City.CityServiceUpkeep>(entity) && em.HasBuffer<Efficiency>(entity), ["policies"] = policies };
        }

        private JObject SetBuildingName(JObject args, World world)
        {
            var entity = TopLevelBuilding(args, world); string name = ((string)args["name"] ?? "").Trim();
            if (name.Length > 100) throw new QueryException("INVALID_ARGUMENT", "name must contain at most 100 characters.");
            world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(entity, name);
            return new JObject { ["building_id"] = new BuildingOperation { Session = m_Session }.EntityId(entity), ["custom_name"] = string.IsNullOrWhiteSpace(name) ? null : name, ["cleared"] = string.IsNullOrWhiteSpace(name) };
        }

        private JObject SetBuildingActive(JObject args, World world)
        {
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing a building policy.");
            var em = world.EntityManager; var entity = TopLevelBuilding(args, world);
            if (!em.HasComponent<Game.City.CityServiceUpkeep>(entity) || !em.HasBuffer<Efficiency>(entity)) throw new QueryException("BUILDING_ACTIVE_STATE_UNSUPPORTED", "Only service buildings with efficiency data support activation changes.");
            bool active = (bool)args["active"]; var current = !BuildingUtils.CheckOption(em.GetComponentData<Building>(entity), BuildingOption.Inactive);
            Entity inactivePolicy = Entity.Null;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>(), ComponentType.ReadOnly<BuildingOptionData>()))
            using (var policies = q.ToEntityArray(Allocator.Temp)) foreach (var policy in policies)
                if (BuildingUtils.HasOption(em.GetComponentData<BuildingOptionData>(policy), BuildingOption.Inactive)) { inactivePolicy = policy; break; }
            if (inactivePolicy == Entity.Null) throw new QueryException("BUILDING_POLICY_UNAVAILABLE", "The game's inactive-building policy prefab is unavailable.");
            if (current != active) world.GetOrCreateSystemManaged<Game.UI.InGame.PoliciesUISystem>().SetPolicy(entity, inactivePolicy, !active, 0);
            return new JObject { ["building_id"] = new BuildingOperation { Session = m_Session }.EntityId(entity), ["active_before"] = current, ["requested_active"] = active,
                ["change_queued"] = current != active, ["note"] = current == active ? "The building already has the requested state." : "The native policy event was queued; call get_building_state to verify it on the next frame." };
        }

        private static bool HasParkingLanes(EntityManager em, DynamicBuffer<Game.Net.SubLane> lanes)
        {
            for (int i = 0; i < lanes.Length; i++)
            {
                var lane = lanes[i].m_SubLane;
                if (em.TryGetComponent<Game.Net.ParkingLane>(lane, out var parking) && (parking.m_Flags & ParkingLaneFlags.VirtualLane) == 0) return true;
                if (em.TryGetComponent<Game.Net.ConnectionLane>(lane, out var connection) && (connection.m_Flags & ConnectionLaneFlags.Parking) != 0) return true;
            }
            return false;
        }

        private static bool HasParkingLanes(EntityManager em, Entity building)
        {
            if (em.TryGetBuffer<Game.Net.SubLane>(building, true, out var lanes) && HasParkingLanes(em, lanes)) return true;
            if (em.TryGetBuffer<Game.Net.SubNet>(building, true, out var nets))
                for (int i = 0; i < nets.Length; i++)
                    if (em.TryGetBuffer<Game.Net.SubLane>(nets[i].m_SubNet, true, out var netLanes) && HasParkingLanes(em, netLanes)) return true;
            if (em.TryGetBuffer<Game.Objects.SubObject>(building, true, out var objects))
                for (int i = 0; i < objects.Length; i++)
                {
                    var child = objects[i].m_SubObject;
                    if (em.TryGetBuffer<Game.Net.SubLane>(child, true, out var childLanes) && HasParkingLanes(em, childLanes)) return true;
                    if (HasParkingLanes(em, child)) return true;
                }
            return false;
        }

        private static bool BuildingPolicyApplies(EntityManager em, Entity building, Entity policy, out string option)
        {
            option = null;
            if (!em.TryGetComponent<BuildingOptionData>(policy, out var data)) return false;
            if (BuildingUtils.HasOption(data, BuildingOption.PaidParking) && em.TryGetComponent<PrefabRef>(building, out var prefabRef) &&
                em.TryGetComponent<BuildingData>(prefabRef.m_Prefab, out var buildingData) &&
                (buildingData.m_Flags & (Game.Prefabs.BuildingFlags.RestrictedPedestrian | Game.Prefabs.BuildingFlags.RestrictedCar)) == 0 && HasParkingLanes(em, building))
            { option = "paid_parking"; return true; }
            if (BuildingUtils.HasOption(data, BuildingOption.Empty) && em.TryGetComponent<PrefabRef>(building, out var garbageRef) &&
                em.TryGetComponent<GarbageFacilityData>(garbageRef.m_Prefab, out var garbage) && garbage.m_LongTermStorage)
            { option = "empty"; return true; }
            if (BuildingUtils.HasOption(data, BuildingOption.Inactive) && em.HasComponent<Game.City.CityServiceUpkeep>(building) && em.HasBuffer<Efficiency>(building))
            { option = "inactive"; return true; }
            return false;
        }

        private JObject ListBuildingPolicies(JObject args, World world)
        {
            var em = world.EntityManager; var building = TopLevelBuilding(args, world); var prefabSystem = world.GetExistingSystemManaged<PrefabSystem>();
            DynamicBuffer<Game.Policies.Policy> current = default; bool hasCurrent = em.TryGetBuffer(building, true, out current); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>(), ComponentType.ReadOnly<BuildingOptionData>()))
            using (var policies = q.ToEntityArray(Allocator.Temp)) foreach (var policy in policies)
            {
                if (!BuildingPolicyApplies(em, building, policy, out var option) || !prefabSystem.TryGetPrefab<PrefabBase>(policy, out var prefab)) continue;
                bool active = false; float value = em.HasComponent<PolicySliderData>(policy) ? em.GetComponentData<PolicySliderData>(policy).m_Default : 0;
                if (hasCurrent) for (int i = 0; i < current.Length; i++) if (current[i].m_Policy == policy) { active = (current[i].m_Flags & Game.Policies.PolicyFlags.Active) != 0; value = current[i].m_Adjustment; break; }
                var row = new JObject { ["name"] = prefab.name, ["option"] = option, ["active"] = active, ["locked"] = PrefabLocked(em, policy), ["adjustment"] = value };
                if (em.HasComponent<PolicySliderData>(policy)) { var slider = em.GetComponentData<PolicySliderData>(policy); row["slider"] = new JObject { ["min"] = slider.m_Range.min, ["max"] = slider.m_Range.max, ["default"] = slider.m_Default, ["step"] = slider.m_Step, ["unit"] = slider.m_Unit }; }
                rows.Add(row);
            }
            rows.Sort((a, b) => string.CompareOrdinal((string)a["name"], (string)b["name"]));
            return new JObject { ["building_id"] = new BuildingOperation { Session = m_Session }.EntityId(building), ["items"] = new JArray(rows) };
        }

        private JObject SetBuildingPolicy(JObject args, World world)
        {
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing a building policy.");
            var em = world.EntityManager; var building = TopLevelBuilding(args, world); string requested = ((string)args["policy"] ?? "").Trim();
            Entity selected = Entity.Null; PrefabBase selectedPrefab = null; string option = null;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>(), ComponentType.ReadOnly<BuildingOptionData>()))
            using (var policies = q.ToEntityArray(Allocator.Temp)) foreach (var policy in policies)
                if (BuildingPolicyApplies(em, building, policy, out var candidateOption) && world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(policy, out var prefab) &&
                    (string.Equals(prefab.name, requested, StringComparison.OrdinalIgnoreCase) || string.Equals(candidateOption, requested, StringComparison.OrdinalIgnoreCase)))
                { selected = policy; selectedPrefab = prefab; option = candidateOption; break; }
            if (selected == Entity.Null) throw new QueryException("BUILDING_POLICY_NOT_APPLICABLE", "policy must be an applicable exact name or option returned by list_building_policies.");
            if (PrefabLocked(em, selected)) throw new QueryException("BUILDING_POLICY_LOCKED", "The requested building policy is locked.");
            bool active = (bool)args["active"]; float adjustment = (float?)args["adjustment"] ?? (em.HasComponent<PolicySliderData>(selected) ? em.GetComponentData<PolicySliderData>(selected).m_Default : 0);
            if (!math.isfinite(adjustment)) throw new QueryException("INVALID_ARGUMENT", "adjustment must be finite.");
            if (em.HasComponent<PolicySliderData>(selected)) { var slider = em.GetComponentData<PolicySliderData>(selected); if (adjustment < slider.m_Range.min || adjustment > slider.m_Range.max) throw new QueryException("INVALID_ARGUMENT", "adjustment is outside the policy slider range."); }
            else if (args["adjustment"] != null && math.abs(adjustment) > .0001f) throw new QueryException("INVALID_ARGUMENT", "This policy has no adjustment slider.");
            world.GetOrCreateSystemManaged<Game.UI.InGame.PoliciesUISystem>().SetPolicy(building, selected, active, adjustment);
            return new JObject { ["building_id"] = new BuildingOperation { Session = m_Session }.EntityId(building), ["policy"] = selectedPrefab.name, ["option"] = option,
                ["requested_active"] = active, ["requested_adjustment"] = adjustment, ["change_queued"] = true, ["note"] = "The native policy event was queued; call list_building_policies or get_building_state to verify it on the next frame." };
        }

        private sealed class RoadSite { public Entity Edge; public float3 RoadPosition, Position; public float2 Tangent; public float RotationDegrees, Distance, Score, RoadSurfaceHeight, TerrainHeightAtRoad, HeightGap, TerrainRelief; public bool Collision; public string Side, RoadPrefab; }

        private static float2 RotateAxis(quaternion rotation, float3 axis) => math.normalizesafe(math.mul(rotation, axis).xz, axis.xz);
        private static bool FootprintsOverlap(float2 aCenter, quaternion aRotation, float2 aHalf, float2 bCenter, quaternion bRotation, float2 bHalf, float clearance = .25f)
        {
            var ax = RotateAxis(aRotation, new float3(1, 0, 0)); var az = RotateAxis(aRotation, new float3(0, 0, 1));
            var bx = RotateAxis(bRotation, new float3(1, 0, 0)); var bz = RotateAxis(bRotation, new float3(0, 0, 1)); var delta = bCenter - aCenter;
            foreach (var axis in new[] { ax, az, bx, bz })
            {
                float distance = math.abs(math.dot(delta, axis));
                float aRadius = aHalf.x * math.abs(math.dot(ax, axis)) + aHalf.y * math.abs(math.dot(az, axis));
                float bRadius = bHalf.x * math.abs(math.dot(bx, axis)) + bHalf.y * math.abs(math.dot(bz, axis));
                if (distance >= aRadius + bRadius + clearance) return false;
            }
            return true;
        }

        private static float2 PrefabHalfExtents(EntityManager em, Entity prefab)
        {
            float2 half = new float2(4);
            if (em.HasComponent<BuildingData>(prefab)) { var data = em.GetComponentData<BuildingData>(prefab); half = new float2(math.max(4, data.m_LotSize.x * 4f), math.max(4, data.m_LotSize.y * 4f)); }
            if (em.HasComponent<ObjectGeometryData>(prefab)) { var size = em.GetComponentData<ObjectGeometryData>(prefab).m_Size.xz * .5f; half = math.max(half, size); }
            return half;
        }

        private BuildingPlacementPlan RoadsidePlacement(Entity prefab, Entity edge, float t, float sign, bool autoLevel, float maxRelief, World world)
        {
            var em = world.EntityManager;
            if (!em.HasComponent<Road>(edge) || !em.HasComponent<Edge>(edge) || !em.HasComponent<Curve>(edge) || !em.HasComponent<PrefabRef>(edge) || em.HasComponent<Deleted>(edge) || em.HasComponent<Temp>(edge))
                throw new QueryException("NOT_A_ROAD", "Every road_edge_id must identify a permanent road edge.");
            var roadPrefab = em.GetComponentData<PrefabRef>(edge).m_Prefab;
            if (!em.HasComponent<RoadData>(roadPrefab) || (em.GetComponentData<RoadData>(roadPrefab).m_Flags & Game.Prefabs.RoadFlags.EnableZoning) == 0)
                throw new QueryException("ROAD_DOES_NOT_SUPPORT_BUILDINGS", "The selected road must support zoning and roadside buildings.");
            var curve = em.GetComponentData<Curve>(edge).m_Bezier; t = math.clamp(t, .02f, .98f); var road = MathUtils.Position(curve, t);
            float u = 1 - t; float3 derivative = 3 * (curve.b - curve.a) * u * u + 6 * (curve.c - curve.b) * u * t + 3 * (curve.d - curve.c) * t * t;
            float horizontal = math.length(derivative.xz); if (horizontal < .01f || math.abs(derivative.y) / horizontal > .15f) throw new QueryException("ROAD_TOO_STEEP", "Building entrances require a road slope at or below 15 percent.");
            float2 tangent = derivative.xz / horizontal, normal = new float2(-tangent.y, tangent.x);
            float2 half = PrefabHalfExtents(em, prefab);
            float roadHalfWidth = 8, roadSurface = road.y;
            if (em.HasComponent<Composition>(edge)) { var composition = em.GetComponentData<Composition>(edge).m_Edge; if (em.HasComponent<NetCompositionData>(composition)) { var net = em.GetComponentData<NetCompositionData>(composition); roadHalfWidth = math.max(1, net.m_Width * .5f); roadSurface += net.m_SurfaceHeight.max; } }
            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true); if (!terrain.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height data is not ready.");
            var atRoad = road; float roadTerrain = TerrainUtils.SampleHeight(ref terrain, atRoad); if (math.abs(roadSurface - roadTerrain) > 2f) throw new QueryException("ROAD_TERRAIN_HEIGHT_MISMATCH", "The road surface must remain within 2 metres of terrain for a building entrance.");
            float entranceDistance = roadHalfWidth + half.y + .25f; float2 center = road.xz + normal * sign * entranceDistance;
            float2 facingRoad = -normal * sign; float angle = math.degrees(math.atan2(facingRoad.x, facingRoad.y)); var rotation = quaternion.RotateY(math.radians(angle));
            float min = float.MaxValue, max = float.MinValue;
            for (int ix = -1; ix <= 1; ix++) for (int iz = -1; iz <= 1; iz++)
            {
                float2 sample = center + tangent * (half.x * ix) + normal * (half.y * iz); var p = new float3(sample.x, 0, sample.y); float h = TerrainUtils.SampleHeight(ref terrain, p); min = math.min(min, h); max = math.max(max, h);
            }
            float relief = max - min; if (relief > maxRelief) throw new QueryException("FOUNDATION_RELIEF_TOO_HIGH", "The requested foundation exceeds max_terrain_relief_m.");
            if (relief > .25f && !autoLevel) throw new QueryException("FOUNDATION_LEVELING_REQUIRED", "Enable auto_level_foundations or select flatter terrain.");
            var position = new float3(center.x, roadSurface, center.y); string roadName = null; world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(roadPrefab, out var rp); roadName = rp?.name;
            return new BuildingPlacementPlan { Prefab = prefab, ParentRoad = edge, PrefabName = world.GetExistingSystemManaged<PrefabSystem>().GetPrefab<PrefabBase>(prefab).name, RoadPrefab = roadName,
                Side = sign > 0 ? "left" : "right", Position = position, Rotation = rotation, RotationDegrees = angle, TerrainMin = min, TerrainMax = max,
                FoundationTarget = roadSurface, FoundationLevelingRequired = relief > .25f, SampleCount = 9, RoadSurfaceHeight = roadSurface, EntranceDistance = entranceDistance, EntranceAngle = 0 };
        }

        private float2 ReservedBuildingHalfExtents(Entity prefab, JArray reserveArgs, World world, out List<string> reservedUpgradeNames)
        {
            var em = world.EntityManager;
            var reservedHalf = PrefabHalfExtents(em, prefab);
            reservedUpgradeNames = new List<string>();
            if (reserveArgs == null) return reservedHalf;
            foreach (var token in reserveArgs)
            {
                var upgradeName = (string)token;
                var upgrade = ResolveBuildingPrefab(upgradeName, world, true);
                if (PrefabLocked(em, upgrade)) throw new QueryException("BUILDING_LOCKED", "Reserved upgrade prefab is locked: " + upgradeName);
                bool compatible = false;
                if (em.HasBuffer<ServiceUpgradeBuilding>(upgrade))
                {
                    var compatibleBuildings = em.GetBuffer<ServiceUpgradeBuilding>(upgrade, true);
                    for (int i = 0; i < compatibleBuildings.Length; i++) if (compatibleBuildings[i].m_Building == prefab) { compatible = true; break; }
                }
                if (!compatible) throw new QueryException("INCOMPATIBLE_BUILDING_UPGRADE", upgradeName + " is not compatible with the selected building prefab.");
                var upgradeHalf = PrefabHalfExtents(em, upgrade);
                reservedHalf = new float2(math.max(reservedHalf.x, upgradeHalf.x), reservedHalf.y + upgradeHalf.y);
                if (!reservedUpgradeNames.Contains(upgradeName)) reservedUpgradeNames.Add(upgradeName);
            }
            return reservedHalf;
        }

        private JObject PlanBuildingRow(JObject args, World world)
        {
            var prefab = ResolveBuildingPrefab((string)args["building_prefab"], world, false); var em = world.EntityManager;
            if (PrefabLocked(em, prefab)) throw new QueryException("BUILDING_LOCKED", "This building prefab is locked.");
            var placementFlags = em.GetComponentData<PlaceableObjectData>(prefab).m_Flags;
            if ((placementFlags & Game.Objects.PlacementFlags.RoadSide) == 0 || (placementFlags & Game.Objects.PlacementFlags.OnGround) == 0) throw new QueryException("BUILDING_REQUIRES_SPECIAL_PLACEMENT", "Batch row planning supports RoadSide + OnGround buildings.");
            if (!(args["road_edge_ids"] is JArray ids) || ids.Count < 1 || ids.Count > 64) throw new QueryException("INVALID_ARGUMENT", "road_edge_ids must contain 1..64 permanent roads.");
            string side = ((string)args["road_side"] ?? "both").ToLowerInvariant(); if (side != "left" && side != "right" && side != "both") throw new QueryException("INVALID_ARGUMENT", "road_side must be left, right, or both.");
            int maximum = ComponentInspector.Int(args, "maximum_buildings", 32, 1, 32); float spacing = BuildingNumber(args, "spacing_m", 8, 0, 128);
            bool autoLevel = (bool?)args["auto_level_foundations"] ?? true; float maxRelief = BuildingNumber(args, "max_terrain_relief_m", 8, .25f, 32);
            // Optional upgrade reservations make row spacing/collision checks
            // account for modules that will be attached behind the host later.
            // The native upgrade preview remains authoritative at install time.
            var reservedHalf = ReservedBuildingHalfExtents(prefab, args["reserve_upgrade_prefabs"] as JArray, world, out var reservedUpgradeNames);
            float buildingWidth = reservedHalf.x * 2f; float step = buildingWidth + spacing;
            var plans = new List<BuildingPlacementPlan>(); var rejected = new JObject { ["collision"] = 0, ["road_or_terrain"] = 0 };
            foreach (var id in ids)
            {
                var edge = ParseEntity((string)id, em); if (!em.HasComponent<Curve>(edge)) throw new QueryException("NOT_A_ROAD", "road_edge_ids contains a non-road entity.");
                float length = math.max(1, em.GetComponentData<Curve>(edge).m_Length); int slots = math.max(1, (int)math.floor(length / step));
                for (int slot = 0; slot < slots && plans.Count < maximum; slot++) foreach (var sign in side == "left" ? new[] { 1f } : side == "right" ? new[] { -1f } : new[] { 1f, -1f })
                {
                    if (plans.Count >= maximum) break; BuildingPlacementPlan plan;
                    try { plan = RoadsidePlacement(prefab, edge, (slot + .5f) / slots, sign, autoLevel, maxRelief, world); }
                    catch (QueryException) { rejected["road_or_terrain"] = (int)rejected["road_or_terrain"] + 1; continue; }
                    var half = reservedHalf; bool collision = false;
                    foreach (var other in plans) if (FootprintsOverlap(plan.Position.xz, plan.Rotation, half, other.Position.xz, other.Rotation, half, 1)) { collision = true; break; }
                    if (!collision)
                    {
                        using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                        using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var existing in entities)
                        {
                            var transform = em.GetComponentData<Game.Objects.Transform>(existing); var existingPrefab = em.GetComponentData<PrefabRef>(existing).m_Prefab; float2 existingHalf = PrefabHalfExtents(em, existingPrefab);
                            if (FootprintsOverlap(plan.Position.xz, plan.Rotation, half, transform.m_Position.xz, transform.m_Rotation, existingHalf, 1)) { collision = true; break; }
                        }
                    }
                    if (collision) { rejected["collision"] = (int)rejected["collision"] + 1; continue; } plans.Add(plan);
                }
            }
            var format = new BuildingOperation { Session = m_Session };
            return new JObject { ["building_prefab"] = (string)args["building_prefab"], ["planned_building_count"] = plans.Count, ["auto_level_foundations"] = autoLevel,
                ["placements"] = new JArray(plans.Select((p, i) => new JObject { ["index"] = i, ["position"] = new JObject { ["x"] = p.Position.x, ["y"] = p.Position.y, ["z"] = p.Position.z },
                    ["rotation_degrees"] = p.RotationDegrees, ["road_edge_id"] = format.EntityId(p.ParentRoad), ["road_side"] = p.Side, ["road_prefab"] = p.RoadPrefab,
                    ["foundation_target_height_m"] = p.FoundationTarget, ["terrain_min_m"] = p.TerrainMin, ["terrain_max_m"] = p.TerrainMax, ["terrain_relief_m"] = p.TerrainMax - p.TerrainMin,
                    ["foundation_leveling_required"] = p.FoundationLevelingRequired, ["entrance_distance_m"] = p.EntranceDistance, ["entrance_angle_error_degrees"] = p.EntranceAngle })),
                ["reserved_upgrade_prefabs"] = new JArray(reservedUpgradeNames),
                ["reserved_footprint_half_extents_m"] = new JObject { ["x"] = reservedHalf.x, ["z"] = reservedHalf.y },
                ["rejected"] = rejected, ["note"] = "Pass placements unchanged to preview_building_batch_placement. Reserved upgrade extents are used for planning clearance; native object-tool validation remains authoritative and applies prefab foundation terraforming during commit." };
        }

        private List<RoadSite> FindBuildingSites(Entity prefab, float2 footprintHalf, float2 near, float radius, string side, int count, World world, out JObject rejected)
        {
            var em = world.EntityManager; var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!terrain.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height data is not ready.");
            int nonZoningRoad = 0, elevatedOrSunkenRoad = 0, steepRoad = 0, unevenSite = 0;
            float halfDepth = math.max(4, footprintHalf.y); float halfWidth = math.max(4, footprintHalf.x);
            var existing = new List<(float2 p, float r)>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities) { var p = em.GetComponentData<Game.Objects.Transform>(e).m_Position.xz; float r = 8; var pe = em.GetComponentData<PrefabRef>(e).m_Prefab; if (em.HasComponent<ObjectGeometryData>(pe)) { var s = em.GetComponentData<ObjectGeometryData>(pe).m_Size.xz; r = math.length(s) * .5f; } existing.Add((p, r)); }
            var sites = new List<RoadSite>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var edges = q.ToEntityArray(Allocator.Temp)) foreach (var edge in edges)
            {
                var curve = em.GetComponentData<Curve>(edge).m_Bezier; MathUtils.Distance(curve.xz, near, out float t); var road = MathUtils.Position(curve, t);
                float roadDistance = math.distance(road.xz, near); if (roadDistance > radius) continue;
                string roadPrefabName = null;
                if (!em.HasComponent<PrefabRef>(edge)) { ++nonZoningRoad; continue; }
                var roadPrefab = em.GetComponentData<PrefabRef>(edge).m_Prefab;
                if (!em.HasComponent<RoadData>(roadPrefab) || (em.GetComponentData<RoadData>(roadPrefab).m_Flags & Game.Prefabs.RoadFlags.EnableZoning) == 0) { ++nonZoningRoad; continue; }
                if (world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(roadPrefab, out var roadPrefabObject)) roadPrefabName = roadPrefabObject.name;
                float roadHalfWidth = 8f;
                if (em.HasComponent<Composition>(edge))
                {
                    var composition = em.GetComponentData<Composition>(edge).m_Edge;
                    if (em.HasComponent<NetCompositionData>(composition)) roadHalfWidth = math.max(1f, em.GetComponentData<NetCompositionData>(composition).m_Width * .5f);
                }
                float u = 1 - t; float3 derivative = 3 * (curve.b - curve.a) * u * u + 6 * (curve.c - curve.b) * u * t + 3 * (curve.d - curve.c) * t * t;
                float horizontalDerivative = math.length(derivative.xz);
                if (horizontalDerivative < .01f || math.abs(derivative.y) / horizontalDerivative > .15f) { ++steepRoad; continue; }
                var roadTerrainPoint = road; float terrainAtRoad = TerrainUtils.SampleHeight(ref terrain, roadTerrainPoint);
                float roadSurface = road.y;
                if (em.HasComponent<Composition>(edge))
                {
                    var composition = em.GetComponentData<Composition>(edge).m_Edge;
                    if (em.HasComponent<NetCompositionData>(composition)) roadSurface += em.GetComponentData<NetCompositionData>(composition).m_SurfaceHeight.max;
                }
                float heightGap = roadSurface - terrainAtRoad;
                if (math.abs(heightGap) > 2f) { ++elevatedOrSunkenRoad; continue; }
                float2 tangent = math.normalizesafe(derivative.xz, new float2(1, 0)); float2 normal = new float2(-tangent.y, tangent.x);
                foreach (var sign in side == "left" ? new[] { 1f } : side == "right" ? new[] { -1f } : new[] { 1f, -1f })
                {
                    float2 xz = road.xz + normal * sign * (halfDepth + roadHalfWidth + .25f); var p = new float3(xz.x, 0, xz.y); p.y = TerrainUtils.SampleHeight(ref terrain, p);
                    float minHeight = p.y, maxHeight = p.y;
                    foreach (var corner in new[] { xz + tangent * halfWidth + normal * halfDepth, xz + tangent * halfWidth - normal * halfDepth, xz - tangent * halfWidth + normal * halfDepth, xz - tangent * halfWidth - normal * halfDepth })
                    {
                        var samplePoint = new float3(corner.x, 0, corner.y); float h = TerrainUtils.SampleHeight(ref terrain, samplePoint); minHeight = math.min(minHeight, h); maxHeight = math.max(maxHeight, h);
                    }
                    float terrainRelief = maxHeight - minHeight;
                    if (terrainRelief > 3f || math.abs(p.y - roadSurface) > 2f) { ++unevenSite; continue; }
                    bool collision = existing.Any(x => math.distance(x.p, xz) < x.r + math.length(new float2(halfWidth, halfDepth)));
                    float2 facingRoad = -normal * sign;
                    sites.Add(new RoadSite { Edge = edge, RoadPosition = road, Position = p, Tangent = tangent, RotationDegrees = math.degrees(math.atan2(facingRoad.x, facingRoad.y)), Distance = roadDistance, Collision = collision, Side = sign > 0 ? "left" : "right", Score = roadDistance + (collision ? 100000 : 0), RoadPrefab = roadPrefabName, RoadSurfaceHeight = roadSurface, TerrainHeightAtRoad = terrainAtRoad, HeightGap = heightGap, TerrainRelief = terrainRelief });
                }
            }
            rejected = new JObject { ["non_zoning_or_highway_edges"] = nonZoningRoad, ["elevated_or_sunken_edges"] = elevatedOrSunkenRoad, ["steep_edges"] = steepRoad, ["uneven_or_height_mismatched_sites"] = unevenSite };
            return sites.OrderBy(x => x.Score).ThenBy(x => x.Edge.Index).Take(count).ToList();
        }

        private JObject PlanBuildingSite(JObject args, World world)
        {
            var prefab = ResolveBuildingPrefab((string)args["building_prefab"], world, false); if (PrefabLocked(world.EntityManager, prefab)) throw new QueryException("BUILDING_LOCKED", "This building prefab is locked.");
            var placement = world.EntityManager.GetComponentData<PlaceableObjectData>(prefab).m_Flags;
            if ((placement & Game.Objects.PlacementFlags.RoadSide) == 0 || (placement & Game.Objects.PlacementFlags.OnGround) == 0)
                throw new QueryException("BUILDING_REQUIRES_SPECIAL_PLACEMENT", "The roadside planner supports RoadSide + OnGround buildings. Use list_building_prefabs to inspect placement flags, then preview_building_placement with an exact valid position for shoreline, floating, road-node, road-edge, or other special buildings.");
            if (!(args["near"] is JObject near)) throw new QueryException("INVALID_ARGUMENT", "near must contain x and z.");
            var origin = new float2(BuildingNumber(near, "x", 0, -7168, 7168), BuildingNumber(near, "z", 0, -7168, 7168));
            float radius = BuildingNumber(args, "search_radius_m", 500, 16, 3000); int count = ComponentInspector.Int(args, "candidate_count", 8, 1, 32); var side = ((string)args["road_side"] ?? "either").ToLowerInvariant();
            if (side != "left" && side != "right" && side != "either") throw new QueryException("INVALID_ARGUMENT", "road_side must be left, right, or either.");
            var reservedHalf = ReservedBuildingHalfExtents(prefab, args["reserve_upgrade_prefabs"] as JArray, world, out var reservedUpgradeNames);
            var sites = FindBuildingSites(prefab, reservedHalf, origin, radius, side, count, world, out var rejected); var op = new BuildingOperation { Session = m_Session };
            return new JObject { ["building_prefab"] = (string)args["building_prefab"], ["candidate_count"] = sites.Count,
                ["candidates"] = new JArray(sites.Select((s, i) => new JObject { ["index"] = i, ["position"] = new JObject { ["x"] = s.Position.x, ["y"] = s.Position.y, ["z"] = s.Position.z }, ["rotation_degrees"] = s.RotationDegrees, ["road_edge_id"] = op.EntityId(s.Edge), ["road_prefab"] = s.RoadPrefab, ["road_side"] = s.Side, ["road_surface_height"] = s.RoadSurfaceHeight, ["terrain_height_at_road"] = s.TerrainHeightAtRoad, ["road_terrain_height_gap_m"] = s.HeightGap, ["site_terrain_relief_m"] = s.TerrainRelief, ["distance_from_request_m"] = s.Distance, ["approximate_collision"] = s.Collision, ["score"] = s.Score })),
                ["reserved_upgrade_prefabs"] = new JArray(reservedUpgradeNames),
                ["reserved_footprint_half_extents_m"] = new JObject { ["x"] = reservedHalf.x, ["z"] = reservedHalf.y },
                ["rejected"] = rejected, ["note"] = sites.Count == 0 ? "No safe roadside site was found. Roads must allow zoning/building access and remain within 2 m of terrain; repair road/terrain elevation or search another area." : "Candidates use zoning-capable ground roads with terrain-height and optional upgrade-footprint clearance checks. Follow with preview_building_placement for authoritative native validation." };
        }

        private static float AngleDifference(float a, float b)
        {
            float value = math.abs((a - b) % 360f); return value > 180 ? 360 - value : value;
        }

        private JObject PlanSpecialBuildingSite(JObject args, World world)
        {
            var em = world.EntityManager;
            var prefab = ResolveBuildingPrefab((string)args["building_prefab"], world, false);
            if (PrefabLocked(em, prefab)) throw new QueryException("BUILDING_LOCKED", "This building prefab is locked.");
            var flags = em.GetComponentData<PlaceableObjectData>(prefab).m_Flags;
            string mode = ((string)args["mode"] ?? "auto").ToLowerInvariant();
            if (mode == "auto") mode = (flags & Game.Objects.PlacementFlags.RoadEdge) != 0 ? "road_edge" : (flags & Game.Objects.PlacementFlags.Shoreline) != 0 ? "shoreline" : (flags & Game.Objects.PlacementFlags.Floating) != 0 ? "floating" : (flags & Game.Objects.PlacementFlags.RoadNode) != 0 ? "road_node" : "";
            if (!new[] { "shoreline", "floating", "road_edge", "road_node" }.Contains(mode)) throw new QueryException("SPECIAL_PLACEMENT_UNSUPPORTED", "Prefab has no supported shoreline, floating, road-edge, or road-node placement mode.");
            if (!(args["near"] is JObject near)) throw new QueryException("INVALID_ARGUMENT", "near must contain x and z.");
            var origin = new float2(BuildingNumber(near, "x", 0, -7168, 7168), BuildingNumber(near, "z", 0, -7168, 7168));
            float radius = BuildingNumber(args, "search_radius_m", 500, 16, 3000);
            int count = ComponentInspector.Int(args, "candidate_count", 8, 1, 32);
            float minDepth = BuildingNumber(args, "minimum_water_depth_m", 1, .05f, 100);
            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!terrain.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain data is unavailable.");
            var format = new BuildingOperation { Session = m_Session };
            var candidates = new List<Tuple<float, JObject>>();
            float2 prefabHalf = PrefabHalfExtents(em, prefab);
            if (mode == "road_edge")
            {
                using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                using (var edges = q.ToEntityArray(Allocator.Temp)) foreach (var edge in edges)
                {
                    var curveData = em.GetComponentData<Curve>(edge);
                    var curve = curveData.m_Bezier;
                    MathUtils.Distance(curve.xz, origin, out float t);
                    float length = math.max(1, curveData.m_Length);
                    float endpointMargin = math.clamp((prefabHalf.x + 2) / length, .02f, .45f);
                    t = math.clamp(t, endpointMargin, 1 - endpointMargin);
                    var p = MathUtils.Position(curve, t);
                    float d = math.distance(p.xz, origin);
                    if (d > radius) continue;
                    float u = 1 - t;
                    var dir = 3 * (curve.b - curve.a) * u * u + 6 * (curve.c - curve.b) * u * t + 3 * (curve.d - curve.c) * t * t;
                    float angle = math.degrees(math.atan2(dir.x, dir.z));
                    var networkPrefab = em.GetComponentData<PrefabRef>(edge).m_Prefab;
                    string networkPrefabName = world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(networkPrefab, out var networkPrefabObject) ? networkPrefabObject.name : null;
                    candidates.Add(Tuple.Create(d, new JObject {
                        ["position"] = new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z }, ["rotation_degrees"] = angle,
                        ["snap_target_id"] = format.EntityId(edge), ["snap_target_kind"] = "network_edge", ["network_prefab"] = networkPrefabName,
                        ["edge_parameter"] = t, ["endpoint_clearance_m"] = math.min(t, 1 - t) * length, ["distance_from_request_m"] = d
                    }));
                }
            }
            else if (mode == "road_node")
            {
                using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Node>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                using (var nodes = q.ToEntityArray(Allocator.Temp)) foreach (var node in nodes)
                {
                    var n = em.GetComponentData<Node>(node); float d = math.distance(n.m_Position.xz, origin); if (d > radius) continue;
                    var forward = math.mul(n.m_Rotation, new float3(0, 0, 1));
                    candidates.Add(Tuple.Create(d, new JObject { ["position"] = new JObject { ["x"] = n.m_Position.x, ["y"] = n.m_Position.y, ["z"] = n.m_Position.z },
                        ["rotation_degrees"] = math.degrees(math.atan2(forward.x, forward.z)), ["snap_target_id"] = format.EntityId(node), ["snap_target_kind"] = "network_node", ["distance_from_request_m"] = d }));
                }
            }
            else
            {
                var waterSystem = world.GetExistingSystemManaged<WaterSystem>(); var surface = waterSystem.GetSurfaceData(out var deps); deps.Complete();
                if (!surface.isCreated) throw new QueryException("WATER_UNAVAILABLE", "Water surface data is unavailable.");
                bool requiresRoad = em.HasComponent<BuildingData>(prefab) && (em.GetComponentData<BuildingData>(prefab).m_Flags & Game.Prefabs.BuildingFlags.RequireRoad) != 0;
                if (mode == "shoreline" && requiresRoad)
                {
                    using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Road>(), ComponentType.ReadOnly<Edge>(), ComponentType.ReadOnly<Curve>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                    using (var edges = q.ToEntityArray(Allocator.Temp)) foreach (var edge in edges)
                    {
                        var curve = em.GetComponentData<Curve>(edge).m_Bezier; MathUtils.Distance(curve.xz, origin, out float closestT);
                        foreach (float t in new[] { math.clamp(closestT, .05f, .95f), .25f, .5f, .75f }.Distinct()) foreach (float sign in new[] { 1f, -1f })
                        {
                            BuildingPlacementPlan plan; try { plan = RoadsidePlacement(prefab, edge, t, sign, true, 8, world); } catch (QueryException) { continue; }
                            float distance = math.distance(plan.Position.xz, origin); if (distance > radius) continue;
                            var roadPoint = MathUtils.Position(curve, t); float2 outward = math.normalizesafe(plan.Position.xz - roadPoint.xz, new float2(0, 1));
                            var waterPoint = new float3(plan.Position.x + outward.x * (prefabHalf.y + 2), 0, plan.Position.z + outward.y * (prefabHalf.y + 2));
                            float waterDepth = WaterUtils.SampleDepth(ref surface, waterPoint); if (waterDepth < minDepth) continue;
                            bool hasWater; float waterHeight = WaterUtils.SampleHeight(ref surface, ref terrain, waterPoint, out hasWater); if (!hasWater) continue;
                            candidates.Add(Tuple.Create(distance, new JObject { ["position"] = new JObject { ["x"] = plan.Position.x, ["y"] = plan.Position.y, ["z"] = plan.Position.z },
                                ["rotation_degrees"] = plan.RotationDegrees, ["snap_target_id"] = format.EntityId(edge), ["snap_target_kind"] = "shoreline_road_edge",
                                ["road_side"] = plan.Side, ["water_depth_at_outer_edge_m"] = waterDepth, ["water_surface_height_m"] = waterHeight, ["distance_from_request_m"] = distance }));
                        }
                    }
                }
                else
                {
                    float step = math.clamp(radius / 20f, 8, 64);
                    for (float z = origin.y - radius; z <= origin.y + radius; z += step) for (float x = origin.x - radius; x <= origin.x + radius; x += step)
                    {
                        var p = new float3(x, 0, z); float distance = math.distance(p.xz, origin); if (distance > radius) continue;
                        float depth = WaterUtils.SampleDepth(ref surface, p); if (mode == "floating" && depth < minDepth) continue;
                        float dx = WaterUtils.SampleDepth(ref surface, new float3(x + step, 0, z)) - WaterUtils.SampleDepth(ref surface, new float3(x - step, 0, z));
                        float dz = WaterUtils.SampleDepth(ref surface, new float3(x, 0, z + step)) - WaterUtils.SampleDepth(ref surface, new float3(x, 0, z - step));
                        float gradient = math.length(new float2(dx, dz)); if (mode == "shoreline" && (depth > minDepth || gradient < minDepth)) continue;
                        bool hasWater; float waterHeight = WaterUtils.SampleHeight(ref surface, ref terrain, p, out hasWater); if (mode == "floating" && !hasWater) continue;
                        float shorelineGap = 0, outerDepth = depth;
                        if (mode == "shoreline")
                        {
                            float2 waterDirection = math.normalizesafe(new float2(dx, dz), new float2(0, 1));
                            float probeDistance = prefabHalf.y + 2;
                            var outer = new float3(p.x + waterDirection.x * probeDistance, 0, p.z + waterDirection.y * probeDistance);
                            var inner = new float3(p.x - waterDirection.x * probeDistance, 0, p.z - waterDirection.y * probeDistance);
                            outerDepth = WaterUtils.SampleDepth(ref surface, outer); if (outerDepth < minDepth || WaterUtils.SampleDepth(ref surface, inner) > minDepth) continue;
                            waterHeight = WaterUtils.SampleHeight(ref surface, ref terrain, outer, out hasWater); if (!hasWater) continue;
                            p.y = TerrainUtils.SampleHeight(ref terrain, p); shorelineGap = math.abs(p.y - waterHeight);
                        }
                        else p.y = waterHeight;
                        float angle = gradient > .001f ? math.degrees(math.atan2(dx, dz)) : 0;
                        if (mode == "shoreline") { angle += 180; if (angle > 180) angle -= 360; }
                        candidates.Add(Tuple.Create(distance + (mode == "shoreline" ? math.abs(depth) * 10 + shorelineGap * 20 : 0), new JObject { ["position"] = new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z },
                            ["rotation_degrees"] = angle, ["snap_target_id"] = null, ["snap_target_kind"] = mode, ["water_depth_m"] = depth,
                            ["water_depth_at_outer_edge_m"] = outerDepth, ["water_surface_height_m"] = waterHeight, ["shoreline_height_gap_m"] = shorelineGap, ["distance_from_request_m"] = distance }));
                    }
                }
            }
            var selected = candidates.OrderBy(x => x.Item1).Take(count).Select((x, i) => { x.Item2["index"] = i; return x.Item2; }).ToList();
            return new JObject { ["building_prefab"] = (string)args["building_prefab"], ["placement_mode"] = mode, ["candidate_count"] = selected.Count,
                ["total_candidate_count"] = candidates.Count, ["candidates"] = new JArray(selected),
                ["note"] = "Candidates use live network, terrain and water data. Road-edge candidates reserve the prefab footprint from endpoints; road-required shoreline candidates verify both road frontage and water at the outer edge. Native preview remains authoritative." };
        }

        private BuildingOperation PreviewBuildingBatchPlacement(JObject args, World world)
        {
            var key = RequestKey(args); var fingerprint = new JObject { ["type"] = "batch_place", ["args"] = args.DeepClone() }.ToString(Formatting.None);
            if (m_BuildingRequestIds.TryGetValue(key, out var oldId)) { var old = m_BuildingOperations[oldId]; if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another building operation."); return old; }
            if (m_BuildingOperations.Count >= 128) throw new QueryException("BUILDING_OPERATION_LIMIT", "This city session has reached 128 building operations; reload the city to reset the journal.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a building change.");
            var tool = BuildingTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var em = world.EntityManager; string prefabName = (string)args["building_prefab"]; var prefab = ResolveBuildingPrefab(prefabName, world, false);
            if (PrefabLocked(em, prefab)) throw new QueryException("BUILDING_LOCKED", "The selected building prefab is locked.");
            var placementFlags = em.GetComponentData<PlaceableObjectData>(prefab).m_Flags;
            if ((placementFlags & Game.Objects.PlacementFlags.RoadSide) == 0 || (placementFlags & Game.Objects.PlacementFlags.OnGround) == 0) throw new QueryException("BUILDING_REQUIRES_SPECIAL_PLACEMENT", "Batch placement supports RoadSide + OnGround buildings.");
            if (!(args["placements"] is JArray input) || input.Count < 1 || input.Count > 32) throw new QueryException("INVALID_ARGUMENT", "placements must contain 1..32 planned buildings.");
            bool autoLevel = (bool?)args["auto_level_foundations"] ?? true; float maxRelief = BuildingNumber(args, "max_terrain_relief_m", 8, .25f, 32);
            var op = new BuildingOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, Type = "batch_place", Prefab = prefab, PrefabName = prefabName, ExpectedResultCount = input.Count };
            var half = PrefabHalfExtents(em, prefab);
            for (int i = 0; i < input.Count; i++)
            {
                if (!(input[i] is JObject row) || !(row["position"] is JObject position)) throw new QueryException("INVALID_ARGUMENT", "Each placement requires position, rotation_degrees and road_edge_id.");
                var edge = ParseEntity((string)row["road_edge_id"], em); float2 requested = new float2(BuildingNumber(position, "x", 0, -7168, 7168), BuildingNumber(position, "z", 0, -7168, 7168));
                if (!em.HasComponent<Curve>(edge)) throw new QueryException("NOT_A_ROAD", "A placement road_edge_id is not a road."); var curve = em.GetComponentData<Curve>(edge).m_Bezier; MathUtils.Distance(curve.xz, requested, out float t); var road = MathUtils.Position(curve, t);
                float u = 1 - t; var derivative = 3 * (curve.b - curve.a) * u * u + 6 * (curve.c - curve.b) * u * t + 3 * (curve.d - curve.c) * t * t; var tangent = math.normalizesafe(derivative.xz, new float2(1, 0)); var normal = new float2(-tangent.y, tangent.x);
                float sign = math.dot(requested - road.xz, normal) >= 0 ? 1 : -1; var plan = RoadsidePlacement(prefab, edge, t, sign, autoLevel, maxRelief, world);
                float requestedRotation = BuildingNumber(row, "rotation_degrees", 0, -360, 360);
                if (math.distance(requested, plan.Position.xz) > 1f) throw new QueryException("BUILDING_ENTRANCE_MISALIGNED", "Placement " + i + " must keep its entrance edge within 1 metre of the computed road frontage.");
                float angleError = AngleDifference(requestedRotation, plan.RotationDegrees); if (angleError > 2f) throw new QueryException("BUILDING_ENTRANCE_WRONG_DIRECTION", "Placement " + i + " must face the selected road within 2 degrees.");
                plan.Position = new float3(requested.x, plan.FoundationTarget, requested.y); plan.RotationDegrees = requestedRotation; plan.Rotation = quaternion.RotateY(math.radians(requestedRotation)); plan.EntranceAngle = angleError;
                foreach (var previous in op.Placements) if (FootprintsOverlap(plan.Position.xz, plan.Rotation, half, previous.Position.xz, previous.Rotation, half, 1)) throw new QueryException("BATCH_BUILDING_COLLISION", "Planned building footprints overlap at placement " + i + ".");
                op.Placements.Add(plan);
            }
            var first = op.Placements[0]; op.Position = first.Position; op.Rotation = first.Rotation; op.RotationDegrees = first.RotationDegrees; op.ParentRoad = first.ParentRoad;
            m_BuildingOperations.Add(op.Id, op); m_BuildingRequestIds.Add(key, op.Id); tool.Begin(op); return op;
        }

        private BuildingOperation PreviewBuildingOperation(JObject args, World world, string type)
        {
            var key = RequestKey(args); var fingerprint = new JObject { ["type"] = type, ["args"] = args.DeepClone() }.ToString(Formatting.None);
            if (m_BuildingRequestIds.TryGetValue(key, out var oldId)) { var old = m_BuildingOperations[oldId]; if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another building operation."); return old; }
            if (m_BuildingOperations.Count >= 128) throw new QueryException("BUILDING_OPERATION_LIMIT", "This city session has reached 128 building operations; reload the city to reset the journal.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a building change.");
            var tool = BuildingTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>(); if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            var em = world.EntityManager; var op = new BuildingOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, Type = type };
            bool needsTarget = type != "place"; bool needsPosition = type == "place" || type == "move";
            if (needsTarget)
            {
                op.Target = ParseEntity((string)args["building_id"], em);
                if (!em.HasComponent<Building>(op.Target) && !em.HasComponent<Game.Buildings.ServiceUpgrade>(op.Target)) throw new QueryException("NOT_A_BUILDING", "building_id must identify a building or installed service upgrade.");
                if (!em.HasComponent<PrefabRef>(op.Target) || !em.HasComponent<Game.Objects.Transform>(op.Target)) throw new QueryException("BUILDING_DATA_UNAVAILABLE", "The target lacks prefab or transform data.");
                op.OriginalPrefab = em.GetComponentData<PrefabRef>(op.Target).m_Prefab; op.OriginalPrefabName = world.GetExistingSystemManaged<PrefabSystem>().GetPrefab<PrefabBase>(op.OriginalPrefab).name;
                var transform = em.GetComponentData<Game.Objects.Transform>(op.Target); op.OriginalPosition = transform.m_Position; op.OriginalRotation = transform.m_Rotation; op.Position = transform.m_Position; op.Rotation = transform.m_Rotation;
                bool isBuilding = em.HasComponent<Building>(op.Target), isUpgrade = em.HasComponent<Game.Buildings.ServiceUpgrade>(op.Target);
                if ((type == "move" || type == "replace" || type == "upgrade" || type == "rebuild" || type == "demolish") && !isBuilding)
                    throw new QueryException("NOT_A_BUILDING", type + " requires a permanent top-level building; use remove_upgrade for an installed upgrade module.");
                if (type == "remove_upgrade" && !isUpgrade) throw new QueryException("NOT_AN_INSTALLED_UPGRADE", "remove_upgrade requires an installed service-upgrade entity.");
                if (type == "rebuild" && !em.HasComponent<Destroyed>(op.Target)) throw new QueryException("BUILDING_NOT_DESTROYED", "Only a destroyed building can be rebuilt.");
            }
            if (type == "place" || type == "replace") { op.PrefabName = (string)args["building_prefab"]; op.Prefab = ResolveBuildingPrefab(op.PrefabName, world, false); }
            else if (type == "upgrade")
            {
                op.PrefabName = (string)args["upgrade_prefab"]; op.Prefab = ResolveBuildingPrefab(op.PrefabName, world, true);
                bool compatible = false;
                if (em.HasBuffer<ServiceUpgradeBuilding>(op.Prefab))
                {
                    var compatibleBuildings = em.GetBuffer<ServiceUpgradeBuilding>(op.Prefab, true);
                    for (int i = 0; i < compatibleBuildings.Length; i++)
                    {
                        if (compatibleBuildings[i].m_Building == op.OriginalPrefab) { compatible = true; break; }
                    }
                }
                if (!compatible)
                    throw new QueryException("INCOMPATIBLE_BUILDING_UPGRADE", "The selected upgrade is not compatible with this building. Use list_building_upgrades.");
                var upgradeData = em.GetComponentData<Game.Prefabs.ServiceUpgradeData>(op.Prefab);
                if (upgradeData.m_ForbidMultiple && em.HasBuffer<InstalledUpgrade>(op.Target))
                {
                    var installed = em.GetBuffer<InstalledUpgrade>(op.Target, true);
                    for (int i = 0; i < installed.Length; i++) if (em.Exists(installed[i].m_Upgrade) && em.HasComponent<PrefabRef>(installed[i].m_Upgrade) && em.GetComponentData<PrefabRef>(installed[i].m_Upgrade).m_Prefab == op.Prefab)
                        throw new QueryException("UPGRADE_ALREADY_INSTALLED", "This upgrade forbids multiple installations and is already installed.");
                }
                if (em.HasComponent<BuildingData>(op.OriginalPrefab) && em.HasComponent<BuildingData>(op.Prefab))
                {
                    var host = em.GetComponentData<BuildingData>(op.OriginalPrefab);
                    var module = em.GetComponentData<BuildingData>(op.Prefab);
                    var placementMode = ((string)args["placement_mode"] ?? "owner_side").ToLowerInvariant();
                    if (placementMode != "owner_side" && placementMode != "road_side")
                        throw new QueryException("INVALID_ARGUMENT", "placement_mode must be owner_side or road_side.");
                    op.UpgradePlacementMode = placementMode;
                    if (placementMode == "road_side")
                    {
                        if (upgradeData.m_MaxPlacementDistance == 0f)
                            throw new QueryException("UPGRADE_ROADSIDE_UNSUPPORTED", "This upgrade has no native roadside placement range; use owner_side.");
                        if (!(args["position"] is JObject roadPosition) || args["road_edge_id"] == null)
                            throw new QueryException("INVALID_ARGUMENT", "road_side upgrade placement requires position, rotation_degrees and road_edge_id from placement_geometry.road_side_candidates.");
                        var edge = ParseEntity((string)args["road_edge_id"], em);
                        if (!em.HasComponent<Curve>(edge)) throw new QueryException("NOT_A_ROAD_EDGE", "road_edge_id must identify a permanent road edge.");
                        var requested = new float2(BuildingNumber(roadPosition, "x", 0, -7168, 7168), BuildingNumber(roadPosition, "z", 0, -7168, 7168));
                        var curve = em.GetComponentData<Curve>(edge).m_Bezier; MathUtils.Distance(curve.xz, requested, out float t); var road = MathUtils.Position(curve, t);
                        float u = 1 - t; var derivative = 3 * (curve.b - curve.a) * u * u + 6 * (curve.c - curve.b) * u * t + 3 * (curve.d - curve.c) * t * t;
                        var tangent = math.normalizesafe(derivative.xz, new float2(1, 0)); var normal = new float2(-tangent.y, tangent.x);
                        float sign = math.dot(requested - road.xz, normal) >= 0 ? 1 : -1; var plan = RoadsidePlacement(op.Prefab, edge, t, sign, true, 8, world);
                        float requestedRotation = BuildingNumber(args, "rotation_degrees", plan.RotationDegrees, -360, 360);
                        if (math.distance(requested, plan.Position.xz) > 1f) throw new QueryException("BUILDING_ENTRANCE_MISALIGNED", "Use a road_side candidate returned for this upgrade; its entrance must remain within 1 metre of the computed road frontage.");
                        if (AngleDifference(requestedRotation, plan.RotationDegrees) > 2f) throw new QueryException("BUILDING_ENTRANCE_WRONG_DIRECTION", "The roadside upgrade must face its selected road within 2 degrees.");
                        op.ParentRoad = edge; op.Position = plan.Position; op.Rotation = plan.Rotation; op.RotationDegrees = plan.RotationDegrees;
                        op.UpgradePlacementSide = "road_" + plan.Side; op.UpgradePlacementOffset = 0;
                    }
                    else
                    {
                    var side = ((string)args["placement_side"] ?? "back").ToLowerInvariant();
                    var offset = BuildingNumber(args, "placement_offset_m", 0, -512, 512);
                    float3 local;
                    float localRotationDegrees;
                    switch (side)
                    {
                        case "back":
                            local = new float3(offset, 0, -(host.m_LotSize.y + module.m_LotSize.y) * 4f);
                            localRotationDegrees = 0;
                            break;
                        case "right":
                            local = new float3((host.m_LotSize.x + module.m_LotSize.y) * 4f, 0, offset);
                            localRotationDegrees = -90;
                            break;
                        case "left":
                            local = new float3(-(host.m_LotSize.x + module.m_LotSize.y) * 4f, 0, offset);
                            localRotationDegrees = 90;
                            break;
                        case "front":
                            local = new float3(offset, 0, (host.m_LotSize.y + module.m_LotSize.y) * 4f);
                            localRotationDegrees = 180;
                            break;
                        default:
                            throw new QueryException("INVALID_ARGUMENT", "placement_side must be back, right, left, or front.");
                    }
                    op.UpgradePlacementSide = side;
                    op.UpgradePlacementOffset = offset;
                    op.Position = op.OriginalPosition + math.mul(op.OriginalRotation, local);
                    op.Rotation = math.mul(op.OriginalRotation, quaternion.RotateY(math.radians(localRotationDegrees)));
                    var forward = math.forward(op.Rotation);
                    op.RotationDegrees = math.degrees(math.atan2(forward.x, forward.z));
                    }
                }
                else if (em.HasComponent<BuildingExtensionData>(op.Prefab))
                {
                    if (((string)args["placement_mode"] ?? "owner_side").ToLowerInvariant() == "road_side")
                        throw new QueryException("UPGRADE_PLACEMENT_FIXED", "This BuildingExtensionData upgrade has a fixed transform and cannot use road_side placement.");
                    var offset = BuildingNumber(args, "placement_offset_m", 0, -512, 512);
                    if (math.abs(offset) > .001f)
                        throw new QueryException("UPGRADE_PLACEMENT_FIXED", "This BuildingExtensionData upgrade has a fixed transform and does not accept placement_offset_m.");
                    var extension = em.GetComponentData<BuildingExtensionData>(op.Prefab);
                    op.UpgradePlacementMode = "fixed";
                    op.UpgradePlacementSide = "fixed";
                    op.UpgradePlacementOffset = 0;
                    op.Position = op.OriginalPosition + math.mul(op.OriginalRotation, extension.m_Position);
                    op.Rotation = op.OriginalRotation;
                    var forward = math.forward(op.Rotation);
                    op.RotationDegrees = math.degrees(math.atan2(forward.x, forward.z));
                }
            }
            else { op.Prefab = op.OriginalPrefab; op.PrefabName = op.OriginalPrefabName; }
            if (op.Prefab != Entity.Null && PrefabLocked(em, op.Prefab)) throw new QueryException("BUILDING_LOCKED", "The selected building or upgrade prefab is locked.");
            if (needsPosition)
            {
                if (!(args["position"] is JObject position)) throw new QueryException("INVALID_ARGUMENT", "position must contain x and z.");
                op.Position = new float3(BuildingNumber(position, "x", 0, -7168, 7168), 0, BuildingNumber(position, "z", 0, -7168, 7168));
                var heights = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true); if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height data is not ready."); op.Position.y = position["y"] != null ? BuildingNumber(position, "y", 0, -1024, 4096) : TerrainUtils.SampleHeight(ref heights, op.Position);
                op.RotationDegrees = BuildingNumber(args, "rotation_degrees", 0, -360, 360); op.Rotation = quaternion.RotateY(math.radians(op.RotationDegrees));
            }
            if ((string)args["snap_target_id"] != null && (string)args["road_edge_id"] != null)
                throw new QueryException("INVALID_ARGUMENT", "Use either snap_target_id or road_edge_id, not both.");
            if ((string)args["snap_target_id"] != null)
            {
                op.ParentRoad = ParseEntity((string)args["snap_target_id"], em);
                if ((!em.HasComponent<Edge>(op.ParentRoad) && !em.HasComponent<Node>(op.ParentRoad)) || em.HasComponent<Deleted>(op.ParentRoad) || em.HasComponent<Temp>(op.ParentRoad)) throw new QueryException("NOT_A_NETWORK_TARGET", "snap_target_id must identify a permanent network edge or node.");
            }
            else if ((string)args["road_edge_id"] != null)
            {
                op.ParentRoad = ParseEntity((string)args["road_edge_id"], em);
                if (!em.HasComponent<Edge>(op.ParentRoad) || !em.HasComponent<Road>(op.ParentRoad)) throw new QueryException("NOT_A_ROAD_EDGE", "road_edge_id must identify a permanent road edge.");
            }
            else if (op.Target != Entity.Null && em.HasComponent<Building>(op.Target)) op.ParentRoad = em.GetComponentData<Building>(op.Target).m_RoadEdge;
            m_BuildingOperations.Add(op.Id, op); m_BuildingRequestIds.Add(key, op.Id); tool.Begin(op); return op;
        }

        private BuildingOperation BuildingOperationById(JObject args)
        {
            if (!m_BuildingOperations.TryGetValue((string)args["operation_id"] ?? "", out var op) || op.Session != m_Session) throw new QueryException("BUILDING_OPERATION_NOT_FOUND", "Unknown building operation in this city session."); return op;
        }
        private JObject ApplyBuildingOperation(JObject args, World world)
        {
            var op = BuildingOperationById(args); var key = RequestKey(args); long maxCost = (long)ComponentInspector.Int(args, "max_cost", 0, 0, 1000000000);
            if (op.CommitRequestId != null) { if (op.CommitRequestId != key || op.MaxCost != maxCost) throw new QueryException("IDEMPOTENCY_CONFLICT", "This building operation already has another commit request."); return op.Json(); }
            if (op.State != "preview_ready" || op.CancelRequested || DateTime.UtcNow >= op.Expires) throw new QueryException("BUILDING_NOT_READY", "Wait for a valid unexpired building preview.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before applying a building change.");
            op.CommitRequestId = key; op.MaxCost = maxCost; op.CommitRequested = true; op.State = "commit_queued"; return op.Json();
        }
        private JObject CancelBuildingOperation(JObject args)
        {
            var op = BuildingOperationById(args); if (op.ApplyDispatched) throw new QueryException("ALREADY_COMMITTED", "Application already started."); if (!op.Terminal) { op.CancelRequested = true; op.State = "cancelled"; } return op.Json();
        }
    }
}
