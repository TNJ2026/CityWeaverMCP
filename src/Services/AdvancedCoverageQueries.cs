using System;
using System.Collections.Generic;
using System.Linq;
using Game.Buildings;
using Game.Citizens;
using Game.Common;
using Game.Prefabs;
using Game.Routes;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private float3 CoverageCenter(JObject args, World world, string stopKey, string facilityKey, string buildingKey)
        {
            var em = world.EntityManager;
            if (args[stopKey] != null)
            {
                var stop = ResolveStopToken((string)args[stopKey], world);
                return StopPosition(em, stop);
            }
            if (args[facilityKey] != null)
            {
                Entity facility;
                try { facility = ResolveTransportFacility(new JObject { ["facility_id"] = args[facilityKey] }, world); }
                catch (QueryException) { facility = ResolveCityServiceFacility(new JObject { ["facility_id"] = args[facilityKey] }, world); }
                return em.GetComponentData<Game.Objects.Transform>(facility).m_Position;
            }
            if (args[buildingKey] != null)
            {
                var building = ParseEntity((string)args[buildingKey], em);
                if (!em.HasComponent<Building>(building) || !em.HasComponent<Game.Objects.Transform>(building)) throw new QueryException("NOT_A_BUILDING", "building_id must identify a building with a readable position.");
                return em.GetComponentData<Game.Objects.Transform>(building).m_Position;
            }
            if (args["position"] is JObject position) return new float3(BuildingNumber(position, "x", 0, -7168, 7168), 0, BuildingNumber(position, "z", 0, -7168, 7168));
            throw new QueryException("INVALID_ARGUMENT", "Provide a stop/facility/building ID or position.");
        }

        private List<float3> AnalysisCenters(JObject args, World world)
        {
            if (!(args["positions"] is JArray positions))
                return new List<float3> { CoverageCenter(args, world, "stop_id", "facility_id", "building_id") };
            if (positions.Count < 1 || positions.Count > 32 || args["position"] != null || args["stop_id"] != null || args["facility_id"] != null || args["building_id"] != null)
                throw new QueryException("INVALID_ARGUMENT", "Provide 1..32 positions without another center selector.");
            var centers = new List<float3>();
            foreach (var token in positions)
            {
                if (!(token is JObject position) || position["x"] == null || position["z"] == null)
                    throw new QueryException("INVALID_ARGUMENT", "Each position must contain x and z.");
                centers.Add(new float3(BuildingNumber(position, "x", 0, -7168, 7168), 0, BuildingNumber(position, "z", 0, -7168, 7168)));
            }
            return centers;
        }

        private JObject AnalyzeTransportCatchment(JObject args, World world)
        {
            var em = world.EntityManager; var centers = AnalysisCenters(args, world);
            float radius = BuildingNumber(args, "radius_m", 500, 1, 5000), radiusSq = radius * radius;
            string type = ((string)args["transport_type"] ?? "").Trim();
            int limit = ComponentInspector.Int(args, "stop_limit", 64, 0, 256);
            var stops = new PlanningSpatialIndex<Tuple<float2, Entity, int>>(radius);
            var relevantStops = new HashSet<Entity>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Routes.TransportStop>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<ConnectedRoute>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var stop in entities)
            {
                var prefab = em.GetComponentData<PrefabRef>(stop).m_Prefab; if (!em.HasComponent<TransportStopData>(prefab)) continue;
                var data = em.GetComponentData<TransportStopData>(prefab);
                if (type.Length > 0 && !string.Equals(type, data.m_TransportType.ToString(), StringComparison.OrdinalIgnoreCase)) continue;
                var p = StopPosition(em, stop).xz;
                if (!centers.Any(center => math.distancesq(p, center.xz) <= radiusSq)) continue;
                stops.Add(p, p, Tuple.Create(p, stop, em.GetBuffer<ConnectedRoute>(stop, true).Length));
                relevantStops.Add(stop);
            }
            // Aggregate waypoint queues once, instead of rescanning every route for each stop.
            var waitingByStop = new Dictionary<Entity, int>();
            if (relevantStops.Count > 0)
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<TransportLine>(), ComponentType.ReadOnly<RouteWaypoint>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var lines = q.ToEntityArray(Allocator.Temp)) foreach (var line in lines)
            {
                var waypoints = em.GetBuffer<RouteWaypoint>(line, true);
                for (int i = 0; i < waypoints.Length; i++)
                {
                    var waypoint = waypoints[i].m_Waypoint;
                    if (!em.Exists(waypoint) || !em.HasComponent<Connected>(waypoint) || !em.HasComponent<WaitingPassengers>(waypoint)) continue;
                    var stop = em.GetComponentData<Connected>(waypoint).m_Connected;
                    if (!relevantStops.Contains(stop)) continue;
                    waitingByStop.TryGetValue(stop, out int count);
                    waitingByStop[stop] = count + em.GetComponentData<WaitingPassengers>(waypoint).m_Count;
                }
            }
            var residences = new PlanningSpatialIndex<Tuple<float2, Entity>>(radius);
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<ResidentialProperty>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities)
            {
                var p = em.GetComponentData<Game.Objects.Transform>(e).m_Position.xz;
                residences.Add(p, p, Tuple.Create(p, e));
            }
            var results = new JArray();
            foreach (var center in centers)
            {
                var nearby = stops.Query(center.xz - radius, center.xz + radius)
                    .Where(s => math.distancesq(s.Item1, center.xz) <= radiusSq)
                    .OrderBy(s => math.distancesq(s.Item1, center.xz)).ThenBy(s => s.Item2.Index).ToList();
                int Waiting(Entity stop) => waitingByStop.TryGetValue(stop, out int count) ? count : 0;
                var rows = new JArray(nearby.Take(limit).Select(s => new JObject { ["stop_id"] = EntityId(s.Item2),
                    ["distance_m"] = math.distance(s.Item1, center.xz), ["connected_line_count"] = s.Item3, ["waiting_passengers"] = Waiting(s.Item2) }));
                results.Add(new JObject { ["center"] = PointJson(center), ["radius_m"] = radius, ["transport_type"] = type.Length == 0 ? null : type,
                    ["coverage_model"] = "euclidean_stop_catchment_proxy",
                    ["residential_buildings_in_range"] = residences.Query(center.xz - radius, center.xz + radius).Count(r => math.distancesq(r.Item1, center.xz) <= radiusSq),
                    ["nearby_stop_count"] = nearby.Count, ["nearby_waiting_passengers"] = nearby.Sum(s => Waiting(s.Item2)),
                    ["listed_waiting_passengers"] = nearby.Take(limit).Sum(s => Waiting(s.Item2)), ["stops"] = rows,
                    ["notes"] = "Straight-line proxy; total waiting passengers are independent of stop_limit. Pedestrian paths, transfers, platform capacity and congestion are not simulated." });
            }
            return args["positions"] != null ? new JObject { ["items"] = results, ["snapshot_reads"] = 1 } : (JObject)results[0];
        }

        private JObject AnalyzeEducationDemand(JObject args, World world)
        {
            var em = world.EntityManager; var centers = AnalysisCenters(args, world);
            float radius = BuildingNumber(args, "radius_m", 1000, 1, 5000), radiusSq = radius * radius;
            int requestedLevel = ComponentInspector.Int(args, "education_level", -1, -1, 4);
            // Several thousand students may share one CurrentBuilding. Aggregate before indexing.
            var groups = new Dictionary<(Entity, int), int>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Citizen>(), ComponentType.ReadOnly<Game.Citizens.Student>(), ComponentType.ReadOnly<CurrentBuilding>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var citizen in entities)
            {
                var current = em.GetComponentData<CurrentBuilding>(citizen).m_CurrentBuilding;
                if (!em.Exists(current) || !em.HasComponent<Game.Objects.Transform>(current)) continue;
                var key = (current, (int)em.GetComponentData<Game.Citizens.Student>(citizen).m_Level);
                groups.TryGetValue(key, out int count); groups[key] = count + 1;
            }
            var students = new PlanningSpatialIndex<Tuple<float2, int, int, Entity>>(radius);
            foreach (var group in groups)
            {
                var p = em.GetComponentData<Game.Objects.Transform>(group.Key.Item1).m_Position.xz;
                students.Add(p, p, Tuple.Create(p, group.Key.Item2, group.Value, group.Key.Item1));
            }
            var schools = new PlanningSpatialIndex<Tuple<float2, JObject>>(radius);
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var school in entities)
            {
                var prefab = em.GetComponentData<PrefabRef>(school).m_Prefab; if (!em.HasComponent<SchoolData>(prefab)) continue;
                var p = em.GetComponentData<Game.Objects.Transform>(school).m_Position.xz;
                var data = em.GetComponentData<SchoolData>(prefab); int enrolled = em.HasBuffer<Game.Buildings.Student>(school) ? em.GetBuffer<Game.Buildings.Student>(school, true).Length : 0;
                schools.Add(p, p, Tuple.Create(p, new JObject { ["facility_id"] = EntityId(school), ["education_level"] = data.m_EducationLevel,
                    ["student_capacity"] = data.m_StudentCapacity, ["enrolled_students"] = enrolled, ["available_capacity"] = Math.Max(0, data.m_StudentCapacity - enrolled) }));
            }
            var results = new JArray();
            foreach (var center in centers)
            {
                var nearbyStudents = students.Query(center.xz - radius, center.xz + radius).Where(s => math.distancesq(s.Item1, center.xz) <= radiusSq).ToList();
                var nearbySchools = schools.Query(center.xz - radius, center.xz + radius).Where(s => math.distancesq(s.Item1, center.xz) <= radiusSq)
                    .Select(s => { var row = (JObject)s.Item2.DeepClone(); row["distance_m"] = math.distance(s.Item1, center.xz); return row; }).ToList();
                results.Add(new JObject { ["center"] = PointJson(center), ["radius_m"] = radius, ["requested_education_level"] = requestedLevel < 0 ? null : (JToken)requestedLevel,
                    ["coverage_model"] = "current_building_student_proxy", ["students_in_range"] = nearbyStudents.Sum(s => s.Item3),
                    ["matching_students_in_range"] = nearbyStudents.Where(s => requestedLevel < 0 || s.Item2 == requestedLevel).Sum(s => s.Item3),
                    ["schools_in_range"] = nearbySchools.Count, ["schools"] = new JArray(nearbySchools),
                    ["total_capacity"] = nearbySchools.Sum(x => (int?)x["student_capacity"] ?? 0), ["total_available_capacity"] = nearbySchools.Sum(x => (int?)x["available_capacity"] ?? 0),
                    ["notes"] = "Students use CurrentBuilding and enrollment buffers; future enrollment, pathfinding and native school assignment are not simulated." });
            }
            return args["positions"] != null ? new JObject { ["items"] = results, ["snapshot_reads"] = 1 } : (JObject)results[0];
        }

        private JObject AnalyzeAttractionImpact(JObject args, World world)
        {
            var em = world.EntityManager; float3 center = CoverageCenter(args, world, "stop_id", "facility_id", "building_id"); float radius = BuildingNumber(args, "radius_m", 500, 1, 5000); float radiusSq = radius * radius;
            int parks = 0, uniqueBuildings = 0, nearbyBuildings = 0;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities)
            {
                var p = em.GetComponentData<Game.Objects.Transform>(e).m_Position; if (math.distancesq(p.xz, center.xz) > radiusSq) continue; nearbyBuildings++;
                var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab; if (em.HasComponent<Game.Buildings.Park>(e) || em.HasComponent<ParkData>(prefab)) parks++;
                if (em.HasComponent<PlaceableObjectData>(prefab) && (em.GetComponentData<PlaceableObjectData>(prefab).m_Flags & Game.Objects.PlacementFlags.Unique) != 0) uniqueBuildings++;
            }
            int stops = 0; using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Routes.TransportStop>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>())) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities) if (math.distancesq(em.GetComponentData<Game.Objects.Transform>(e).m_Position.xz, center.xz) <= radiusSq) stops++;
            return new JObject { ["center"] = PointJson(center), ["radius_m"] = radius, ["impact_model"] = "park_unique_building_proximity_proxy", ["nearby_buildings"] = nearbyBuildings, ["nearby_parks"] = parks, ["nearby_unique_buildings"] = uniqueBuildings, ["nearby_transport_stops"] = stops, ["notes"] = "Proximity indicators only; native entertainment value, visitor generation, noise, land value and tourism simulation are not exposed as a single deterministic radius." };
        }
    }
}
