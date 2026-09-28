using System;
using System.Collections.Generic;
using System.Linq;
using Game.Buildings;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Routes;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed class WorkRouteOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint, Type, State = "queued", Error, PrefabName;
        public Entity Owner, OwnerPrefab, Prefab, Target, Result;
        public readonly List<float3> Points = new List<float3>();
        public readonly List<Entity> Stops = new List<Entity>();
        public JObject ConnectionDetails = new JObject();
        public bool CommitRequested, CancelRequested, ApplyDispatched;
        public DateTime Expires = DateTime.UtcNow.AddMinutes(5);
        public JArray Errors = new JArray(), Warnings = new JArray();
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired" || State == "outcome_unknown";
        public string EntityId(Entity e) => e == Entity.Null ? null : Session + ":" + e.Index + ":" + e.Version;
        public void RefreshExpiry()
        {
            if ((State == "queued" || State == "preview_ready") && DateTime.UtcNow >= Expires)
                State = "expired";
        }
        public JObject Json()
        {
            RefreshExpiry();
            return new JObject
            {
                ["operation_id"] = Id, ["session_id"] = Session, ["request_id"] = RequestId,
                ["state"] = State, ["operation_type"] = Type,
                ["owner_building_id"] = EntityId(Owner), ["area_prefab"] = PrefabName,
                ["target_route_id"] = EntityId(Target), ["result_route_id"] = EntityId(Result),
                ["errors"] = Errors, ["warnings"] = Warnings, ["error"] = Error,
                ["validation_scope"] = "native_route_preview_and_path_validation",
                ["connection_details"] = ConnectionDetails,
                ["can_commit"] = State == "preview_ready",
                ["expires_at_utc"] = Expires.ToString("O")
            };
        }
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, WorkRouteOperation> m_WorkRouteOperations = new Dictionary<string, WorkRouteOperation>();
        private readonly Dictionary<string, string> m_WorkRouteRequestIds = new Dictionary<string, string>();

        private void ResetWorkRouteOperations()
        {
            World.DefaultGameObjectInjectionWorld?.GetExistingSystemManaged<McpWorkRouteToolSystem>()?.AbortForLoading();
            m_WorkRouteOperations.Clear();
            m_WorkRouteRequestIds.Clear();
        }

        private static bool PermanentWorkRoute(EntityManager em, Entity e)
            => em.Exists(e) && em.HasComponent<Route>(e) && em.HasBuffer<RouteWaypoint>(e)
               && em.HasComponent<Game.Routes.WorkRoute>(e) && em.HasComponent<Owner>(e)
               && em.HasComponent<PrefabRef>(e)
               && !em.HasComponent<Temp>(e) && !em.HasComponent<Deleted>(e);

        private Entity ResolveWorkRouteOwner(string id, World world)
        {
            var entity = ParseEntity(id, world.EntityManager);
            var em = world.EntityManager;
            if (!em.Exists(entity) || em.HasComponent<Deleted>(entity))
                throw new QueryException("WORK_ROUTE_OWNER_NOT_FOUND", "building_id must identify a permanent building.");
            if (!em.HasComponent<Building>(entity))
                throw new QueryException("WORK_ROUTE_OWNER_NOT_FOUND", "building_id must identify a building.");
            return entity;
        }

        private Entity ResolveWorkRoutePrefab(string wanted, World world)
        {
            var em = world.EntityManager;
            var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<RouteData>(), ComponentType.ReadOnly<WorkRouteData>()))
            using (var es = q.ToEntityArray(Allocator.Temp))
            foreach (var e in es)
                if (ps.TryGetPrefab<PrefabBase>(e, out var p) && string.Equals(p.name, wanted, StringComparison.OrdinalIgnoreCase))
                    return e;
            throw new QueryException("WORK_ROUTE_PREFAB_NOT_FOUND", "Use an exact unlocked name from list_building_prefabs.");
        }

        private Entity ResolveWorkRoute(string id, World world)
        {
            var entity = ParseEntity(id, world.EntityManager);
            if (!PermanentWorkRoute(world.EntityManager, entity))
                throw new QueryException("WORK_ROUTE_NOT_FOUND", "route_id must identify a permanent work route.");
            return entity;
        }

        private JObject WorkRouteRow(World world, Entity e, bool detail)
        {
            var em = world.EntityManager;
            var ps = world.GetExistingSystemManaged<PrefabSystem>();
            var pr = em.GetComponentData<PrefabRef>(e);
            ps.TryGetPrefab<PrefabBase>(pr.m_Prefab, out var pf);
            var route = em.GetComponentData<Route>(e);
            var owner = em.GetComponentData<Owner>(e).m_Owner;
            var waypoints = em.GetBuffer<RouteWaypoint>(e, true);
            int segmentCount = em.HasBuffer<RouteSegment>(e) ? em.GetBuffer<RouteSegment>(e, true).Length : 0;
            var row = new JObject
            {
                ["route_id"] = m_Session + ":" + e.Index + ":" + e.Version,
                ["name"] = null,
                ["prefab"] = pf?.name,
                ["complete"] = (route.m_Flags & RouteFlags.Complete) != 0,
                ["owner_building_id"] = EntityId(owner),
                ["waypoint_count"] = waypoints.Length,
                ["segment_count"] = segmentCount
            };
            var nameSystem = world.GetExistingSystemManaged<Game.UI.NameSystem>();
            string name = null;
            if (nameSystem != null)
                nameSystem.TryGetCustomName(e, out name);
            row["name"] = string.IsNullOrWhiteSpace(name) ? null : name;
            if (detail && waypoints.Length > 0)
            {
                var stops = new JArray();
                for (int i = 0; i < waypoints.Length; i++)
                {
                    var w = waypoints[i].m_Waypoint;
                    var item = new JObject { ["index"] = i, ["waypoint_id"] = m_Session + ":" + w.Index + ":" + w.Version };
                    if (em.HasComponent<Position>(w))
                        item["position"] = PointJson(em.GetComponentData<Position>(w).m_Position);
                    stops.Add(item);
                }
                row["waypoints"] = stops;
                row["connectivity"] = WorkRouteConnectivity.Read(em, e, EntityId);
            }
            return row;
        }

        private JObject ListWorkRoutes(JObject args, World world)
        {
            var rows = new List<JObject>();
            var em = world.EntityManager;
            string ownerFilter = ((string)args["owner_building_id"] ?? "").Trim();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Route>(), ComponentType.ReadOnly<RouteWaypoint>(), ComponentType.ReadOnly<Game.Routes.WorkRoute>(), ComponentType.ReadOnly<Owner>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Temp>(), ComponentType.Exclude<Deleted>()))
            using (var es = q.ToEntityArray(Allocator.Temp))
            foreach (var e in es)
            {
                var owner = em.GetComponentData<Owner>(e).m_Owner;
                if (!string.IsNullOrWhiteSpace(ownerFilter) && EntityId(owner) != ownerFilter) continue;
                rows.Add(WorkRouteRow(world, e, false));
            }
            return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows) };
        }

        private JObject GetWorkRoute(JObject args, World world)
        {
            var e = ResolveWorkRoute((string)args["route_id"], world);
            return WorkRouteRow(world, e, true);
        }

        private JObject PreviewWorkRoute(JObject args, World world)
        {
            string key = RequestKey(args);
            string fp = new JObject { ["kind"] = "work_route", ["args"] = args.DeepClone() }.ToString(Formatting.None);
            if (m_WorkRouteRequestIds.TryGetValue(key, out var existingId))
            {
                var existing = m_WorkRouteOperations[existingId];
                if (existing.Fingerprint != fp)
                    throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id was already used with different work route arguments.");
                return existing.Json();
            }
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0)
                throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing a work route.");
            if (m_WorkRouteOperations.Count >= 4096)
                throw new QueryException("WORK_ROUTE_OPERATION_LIMIT", "This city session has reached 4096 work route operations; reload the city to reset the journal.");

            var em = world.EntityManager;
            string routePrefab = (string)args["route_prefab"] ?? "Fishing Line";
            // Native work routes are owned by the top-level building (harbor main building)
            // and carry the ServiceUpgrade tag on the route entity itself, so any permanent
            // building is a valid owner; upgrades are accepted too for flexibility.
            var ownerEntity = ResolveWorkRouteOwner((string)args["owner_building_id"], world);

            // WorkRouteData excludes passenger/cargo routes even when their prefab has RouteData.
            var routePrefabEntity = ResolveWorkRoutePrefab(routePrefab, world);
            if (RoadOperation.IsLocked(em, routePrefabEntity))
                throw new QueryException("WORK_ROUTE_PREFAB_LOCKED", "The selected work route prefab is locked.");
            if (!WorkRouteSupportsOwner(em, routePrefabEntity, em.GetComponentData<PrefabRef>(ownerEntity).m_Prefab))
                throw new QueryException("WORK_ROUTE_OWNER_INCOMPATIBLE", "The selected work route is not an upgrade of the owner building prefab.");

            // Validate waypoints
            if (!(args["waypoints"] is JArray wpArray) || wpArray.Count < 2 || wpArray.Count > 64)
                throw new QueryException("INVALID_ARGUMENT", "waypoints must contain 2..64 points.");

            var op = new WorkRouteOperation
            {
                Session = m_Session, RequestId = key, Fingerprint = fp, Type = "create",
                Owner = ownerEntity, OwnerPrefab = em.GetComponentData<PrefabRef>(ownerEntity).m_Prefab,
                Prefab = routePrefabEntity, PrefabName = routePrefab,
            };

            foreach (var wp in wpArray.Cast<JObject>())
            {
                var point = new float3(
                    BuildingNumber(wp, "x", 0, -7168, 7168),
                    wp["y"] == null ? float.NaN : BuildingNumber(wp, "y", 0, -1024, 4096),
                    BuildingNumber(wp, "z", 0, -7168, 7168)
                );
                op.Points.Add(point);
            }

            ValidateWorkRoutePlan(op, world);
            for (int i = 0; i < op.Points.Count; i++)
            {
                var stop = FindNearestWorkStop(em, op.Points[i], 64f, op.Owner);
                op.Stops.Add(stop);
                if (stop != Entity.Null) op.Points[i] = em.GetComponentData<Game.Objects.Transform>(stop).m_Position;
            }
            // Check the snapped geometry, not only the caller's nearby points.
            ValidateWorkRoutePlan(op, world);
            op.Warnings.Add("Native path validation does not guarantee production or vehicle dispatch; verify after simulation resumes.");

            m_WorkRouteOperations.Add(op.Id, op);
            m_WorkRouteRequestIds.Add(key, op.Id);

            try { world.GetOrCreateSystemManaged<McpWorkRouteToolSystem>().Begin(op); }
            catch { op.State = "failed"; op.Error = "WORK_ROUTE_PREVIEW_NOT_STARTED"; throw; }

            return op.Json();
        }

        private WorkRouteOperation WorkRouteOperationById(JObject args)
        {
            string id = (string)args["operation_id"];
            if (id == null || !m_WorkRouteOperations.TryGetValue(id, out var op))
                throw new QueryException("UNKNOWN_OPERATION", "Unknown work route operation for this city session.");
            op.RefreshExpiry();
            return op;
        }

        private JObject GetWorkRouteOperation(JObject args, World world)
        {
            var op = WorkRouteOperationById(args);
            return op.Json();
        }

        private JObject ApplyWorkRouteOperation(JObject args, World world)
        {
            var op = WorkRouteOperationById(args);
            string key = RequestKey(args);
            if (key != op.RequestId)
                throw new QueryException("REQUEST_ID_CONFLICT", "Use the preview request_id.");
            if (op.State == "expired")
                throw new QueryException("WORK_ROUTE_PREVIEW_EXPIRED", "Preview expired; create a new operation after rechecking the map.");
            if (op.CommitRequested || op.ApplyDispatched) return op.Json();
            if (op.State != "preview_ready")
                throw new QueryException("INVALID_OPERATION_STATE", "Only a preview_ready work route operation can be applied.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0)
                throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before applying a work route operation.");

            // The map, water and owner may have changed since preview.
            ValidateWorkRoutePlan(op, world);

            op.CommitRequested = true;
            return op.Json();
        }

        // Nearest permanent WorkStop (Fishing Berth, Watercraft Work Location, ...) whose
        // transform lies within maxDist (XZ plane) of the requested waypoint position.
        private static Entity FindNearestWorkStop(EntityManager em, float3 position, float maxDist, Entity owner)
        {
            using (var query = em.CreateEntityQuery(
                ComponentType.ReadOnly<Game.Routes.WorkStop>(),
                ComponentType.ReadOnly<Game.Objects.Transform>(),
                ComponentType.Exclude<Deleted>(),
                ComponentType.Exclude<Temp>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
            {
                var best = Entity.Null;
                var bestSq = maxDist * maxDist;
                for (int i = 0; i < entities.Length; i++)
                {
                    var e = entities[i];
                    if (!em.HasBuffer<ConnectedRoute>(e) || !WorkStopOwnedBy(em, e, owner))
                        continue;
                    var p = em.GetComponentData<Game.Objects.Transform>(e).m_Position;
                    var dx = p.x - position.x;
                    var dz = p.z - position.z;
                    var dSq = dx * dx + dz * dz;
                    if (dSq <= bestSq)
                    {
                        bestSq = dSq;
                        best = e;
                    }
                }
                return best;
            }
        }

        private static bool WorkStopOwnedBy(EntityManager em, Entity stop, Entity owner)
        {
            var visited = new HashSet<Entity>();
            while (stop != Entity.Null && em.Exists(stop) && visited.Add(stop))
            {
                if (stop == owner) return true;
                if (!em.HasComponent<Owner>(stop)) return false;
                stop = em.GetComponentData<Owner>(stop).m_Owner;
            }
            return false;
        }

        private static Entity FindExistingRouteVehiclePrefab(EntityManager em, Entity routePrefab)
        {
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Route>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<VehicleModel>(), ComponentType.Exclude<Temp>(), ComponentType.Exclude<Deleted>()))
            using (var es = q.ToEntityArray(Allocator.Temp))
            foreach (var e in es)
            {
                if (em.GetComponentData<PrefabRef>(e).m_Prefab != routePrefab) continue;
                var models = em.GetBuffer<VehicleModel>(e, true);
                if (models.Length > 0 && models[0].m_PrimaryPrefab != Entity.Null)
                    return models[0].m_PrimaryPrefab;
            }
            return Entity.Null;
        }

        private static bool WorkRouteSupportsOwner(EntityManager em, Entity routePrefab, Entity ownerPrefab)
        {
            if (!em.HasBuffer<ServiceUpgradeBuilding>(routePrefab)) return false;
            var buildings = em.GetBuffer<ServiceUpgradeBuilding>(routePrefab, true);
            for (int i = 0; i < buildings.Length; i++)
                if (buildings[i].m_Building == ownerPrefab) return true;
            return false;
        }

        private static Entity ResolveWorkRouteVehiclePrefab(EntityManager em, Entity routePrefab)
        {
            var existing = FindExistingRouteVehiclePrefab(em, routePrefab);
            if (existing != Entity.Null) return existing;
            var route = em.GetComponentData<WorkRouteData>(routePrefab);
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<WorkVehicleData>(), ComponentType.ReadOnly<WatercraftData>()))
            using (var es = q.ToEntityArray(Allocator.Temp))
            foreach (var e in es)
            {
                var vehicle = em.GetComponentData<WorkVehicleData>(e);
                var craft = em.GetComponentData<WatercraftData>(e);
                if (vehicle.m_MapFeature == route.m_MapFeature && craft.m_SizeClass == route.m_SizeClass && !RoadOperation.IsLocked(em, e))
                    return e;
            }
            throw new QueryException("WORK_ROUTE_VEHICLE_NOT_FOUND", "No unlocked work watercraft matches the route's map feature and size class.");
        }

        private void ValidateWorkRoutePlan(WorkRouteOperation op, World world)
        {
            var em = world.EntityManager;
            if (!em.Exists(op.Owner) || em.HasComponent<Deleted>(op.Owner) || !em.HasComponent<Building>(op.Owner))
                throw new QueryException("WORK_ROUTE_OWNER_NOT_FOUND", "The owner building is no longer permanent.");
            if (em.GetComponentData<PrefabRef>(op.Owner).m_Prefab != op.OwnerPrefab || !WorkRouteSupportsOwner(em, op.Prefab, op.OwnerPrefab))
                throw new QueryException("WORK_ROUTE_OWNER_INCOMPATIBLE", "The owner or its prefab changed since preview.");
            if (RoadOperation.IsLocked(em, op.Prefab))
                throw new QueryException("WORK_ROUTE_PREFAB_LOCKED", "The work route prefab is locked.");
            ResolveWorkRouteVehiclePrefab(em, op.Prefab);

            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            var water = world.GetExistingSystemManaged<WaterSystem>().GetSurfaceData(out var deps);
            deps.Complete();
            if (!terrain.isCreated || !water.isCreated)
                throw new QueryException("WATER_UNAVAILABLE", "Terrain/water samples are unavailable.");
            if (FindNearestWorkStop(em, op.Points[0], 64f, op.Owner) == Entity.Null)
                throw new QueryException("WORK_ROUTE_MISSING_BERTH", "The first waypoint must be within 64 m of a permanent work stop.");
            if (op.Points.Count > 2 && math.distance(op.Points[0].xz, op.Points[op.Points.Count - 1].xz) < 8f)
                throw new QueryException("WORK_ROUTE_DUPLICATE_CLOSURE", "Do not repeat the first waypoint; work routes are closed automatically.");
            for (int i = 0; i < op.Points.Count; i++)
            {
                var point = op.Points[i];
                if (!math.isfinite(point.x) || !math.isfinite(point.z) || math.abs(point.x) > 7168 || math.abs(point.z) > 7168)
                    throw new QueryException("WORK_ROUTE_OUTSIDE_MAP", "Every waypoint must be within the map bounds.");
                if (float.IsNaN(point.y))
                {
                    bool present;
                    point.y = WaterUtils.SampleHeight(ref water, ref terrain, new float3(point.x, 0, point.z), out present);
                    if (!present) throw new QueryException("WORK_ROUTE_REQUIRES_WATER", "Every work route waypoint must be on water.");
                    op.Points[i] = point;
                }
                if (i > 0 && math.distance(point.xz, op.Points[i - 1].xz) < 8f)
                    throw new QueryException("WORK_ROUTE_WAYPOINT_TOO_CLOSE", "Adjacent work route waypoints must be at least 8 m apart.");
                var wet = WaterUtils.SampleDepth(ref water, point);
                if (!math.isfinite(wet) || wet < .1f)
                    throw new QueryException("WORK_ROUTE_REQUIRES_WATER", "Every work route waypoint must be on water.");
                bool hasWater;
                var surface = WaterUtils.SampleHeight(ref water, ref terrain, point, out hasWater);
                // Connected work locations are deck fixtures, not free water waypoints.
                // A semi-submersible's native stop is 18 m above water. Only trust the
                // exact same-owner stop snapshot; arbitrary elevated points remain invalid.
                var stop = i < op.Stops.Count ? op.Stops[i] : Entity.Null;
                bool nativeStop = stop != Entity.Null && em.Exists(stop) && !em.HasComponent<Deleted>(stop) &&
                    em.HasComponent<Game.Routes.WorkStop>(stop) && em.HasComponent<Game.Objects.Transform>(stop) &&
                    WorkStopOwnedBy(em, stop, op.Owner) &&
                    math.distance(em.GetComponentData<Game.Objects.Transform>(stop).m_Position, point) <= .25f;
                if (!WorkRoutePathValidation.HeightAllowed(hasWater, point.y, surface, nativeStop))
                    throw new QueryException("WORK_ROUTE_HEIGHT_MISMATCH", "Waypoint elevation must be within 8 m of the water surface.");
            }
            // A dry or out-of-bounds straight leg is not a safe route. Sampling is a
            // conservative preflight; native pathfinding still decides actual connectivity.
            for (int i = 0; i < op.Points.Count; i++)
            {
                var a = op.Points[i]; var b = op.Points[(i + 1) % op.Points.Count];
                var distance = math.distance(a.xz, b.xz);
                if (distance < 8f) continue; // two-point route may close over the same leg
                var samples = (int)math.ceil(distance / 8f);
                for (int step = 0; step <= samples; step++)
                {
                    var p = math.lerp(a, b, step / (float)samples);
                    if (math.abs(p.x) > 7168 || math.abs(p.z) > 7168 || WaterUtils.SampleDepth(ref water, p) < .1f)
                        throw new QueryException("WORK_ROUTE_DRY_LEG", "A route leg crosses dry water or leaves the map; add valid water waypoints.");
                }
            }
        }

        private JObject CancelWorkRouteOperation(JObject args)
        {
            var op = WorkRouteOperationById(args);
            if (!op.Terminal && !op.ApplyDispatched)
            {
                op.CancelRequested = true;
                op.State = "cancelled";
            }
            return op.Json();
        }

        // Deletes a permanent work route through the
        // native cascade: marking the route Deleted lets Game.Routes.ElementSystem flag its
        // waypoints/segments, while ReferencesSystem/WaypointConnectionSystem and vehicle
        // dispatch finish the cleanup. SubRoute and ConnectedRoute registrations are also
        // detached immediately so the state stays consistent while the city is paused.
        private JObject DeleteWorkRoute(JObject args, World world)
        {
            var em = world.EntityManager;
            var route = ResolveWorkRoute((string)args["route_id"], world);
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0)
                throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before deleting a work route.");

            var snapshot = WorkRouteRow(world, route, true);

            if (em.HasComponent<Owner>(route))
            {
                var owner = em.GetComponentData<Owner>(route).m_Owner;
                if (owner != Entity.Null && em.HasBuffer<Game.Routes.SubRoute>(owner))
                {
                    var subs = em.GetBuffer<Game.Routes.SubRoute>(owner);
                    for (int i = subs.Length - 1; i >= 0; i--)
                        if (subs[i].m_Route == route)
                            subs.RemoveAt(i);
                }
            }

            var waypointBuffer = em.GetBuffer<RouteWaypoint>(route, true);
            for (int i = 0; i < waypointBuffer.Length; i++)
            {
                var waypoint = waypointBuffer[i].m_Waypoint;
                if (!em.HasComponent<Connected>(waypoint))
                    continue;
                var stop = em.GetComponentData<Connected>(waypoint).m_Connected;
                if (stop == Entity.Null || !em.HasBuffer<ConnectedRoute>(stop))
                    continue;
                var connectedRoutes = em.GetBuffer<ConnectedRoute>(stop);
                for (int k = connectedRoutes.Length - 1; k >= 0; k--)
                    if (connectedRoutes[k].m_Waypoint == waypoint)
                        connectedRoutes.RemoveAt(k);
            }

            em.AddComponent<Deleted>(route);

            return new JObject
            {
                ["deleted_route_id"] = m_Session + ":" + route.Index + ":" + route.Version,
                ["route"] = snapshot,
                ["note"] = "Route marked Deleted; native ElementSystem/ReferencesSystem cascade removes waypoints, segments and dispatched vehicles once the simulation updates."
            };
        }
    }
}
