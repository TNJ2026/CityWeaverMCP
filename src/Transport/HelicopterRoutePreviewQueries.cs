using System;
using Game.Common;
using Game.Prefabs;
using Game.Routes;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        // A bounded, read-only snapshot of this mod's native previews. Temporary
        // IDs are diagnostic references, never valid permanent mutation targets.
        private JObject ReadHelicopterRoutePreviews(World world)
        {
            SyncReads(world);
            var em = world.EntityManager;
            var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var rows = new JArray();
            int total = 0;
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<Temp>(),
                ComponentType.ReadOnly<RouteWaypoint>(), ComponentType.ReadOnly<PrefabRef>(),
                ComponentType.Exclude<Deleted>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
            foreach (var route in entities)
            {
                if (!prefabs.TryGetPrefab<PrefabBase>(em.GetComponentData<PrefabRef>(route), out var prefab)
                    || prefab.name != OptionalHelicopterRuntime.Line) continue;
                total++;
                if (rows.Count >= 4) continue;
                var waypoints = em.GetBuffer<RouteWaypoint>(route, true);
                var points = new JArray();
                for (int i = 0; i < Math.Min(waypoints.Length, 16); i++)
                    points.Add(ReadHelicopterPreviewEntity(em, waypoints[i].m_Waypoint, i,
                        "Game.Routes.Connected", "Game.Routes.Position", "Game.Routes.AccessLane",
                        "Game.Routes.RouteLane", "Game.Tools.Error"));
                var segments = new JArray();
                int segmentCount = 0;
                if (em.HasBuffer<RouteSegment>(route))
                {
                    var buffer = em.GetBuffer<RouteSegment>(route, true);
                    segmentCount = buffer.Length;
                    for (int i = 0; i < Math.Min(buffer.Length, 16); i++)
                        segments.Add(ReadHelicopterPreviewEntity(em, buffer[i].m_Segment, i,
                            "Game.Pathfind.PathInformation", "Game.Routes.PathTargets",
                            "Game.Pathfind.PathElement", "Game.Tools.Error"));
                }
                rows.Add(new JObject {
                    ["temporary_route_id"] = EntityId(route),
                    ["temp"] = Inspector.Read(em, route, "Game.Tools.Temp", 0, 1),
                    ["waypoint_count"] = waypoints.Length, ["waypoints"] = points,
                    ["segment_count"] = segmentCount, ["segments"] = segments,
                    ["truncated"] = waypoints.Length > points.Count || segmentCount > segments.Count
                });
            }
            return new JObject {
                ["total"] = total, ["items"] = rows, ["truncated"] = total > rows.Count,
                ["policy_error"] = OptionalHelicopterRuntime.SystemValue(world,"PassengerHelicopterRouteToolPolicySystem","LastError"),
                ["scope"] = "Read-only live helicopter previews; temporary IDs expire when the tool changes. PathElement buffers show at most 8 entries."
            };
        }

        private JObject ReadHelicopterPreviewEntity(EntityManager em, Entity entity, int index, params string[] components)
        {
            var row = new JObject { ["index"] = index, ["temporary_entity_id"] = EntityId(entity) };
            if (!em.Exists(entity) || em.HasComponent<Deleted>(entity)) { row["unavailable"] = true; return row; }
            var values = new JObject();
            foreach (var component in components) values[component] = Inspector.Read(em, entity, component, 0, 8);
            row["components"] = values;
            return row;
        }
    }
}
