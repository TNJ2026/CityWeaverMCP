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

namespace CitiesSkylines2Mod
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

        private int ResidentialCount(float3 center, float radius, World world)
        {
            int count = 0; var em = world.EntityManager; float radiusSq = radius * radius;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<ResidentialProperty>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities) if (math.distancesq(em.GetComponentData<Game.Objects.Transform>(e).m_Position.xz, center.xz) <= radiusSq) count++;
            return count;
        }

        private JObject AnalyzeTransportCatchment(JObject args, World world)
        {
            var em = world.EntityManager; float3 center = CoverageCenter(args, world, "stop_id", "facility_id", "building_id");
            float radius = BuildingNumber(args, "radius_m", 500, 1, 5000); float radiusSq = radius * radius; string type = ((string)args["transport_type"] ?? "").Trim();
            var stops = new List<Tuple<float, Entity, int>>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Routes.TransportStop>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<ConnectedRoute>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var stop in entities)
            {
                var prefab = em.GetComponentData<PrefabRef>(stop).m_Prefab; if (!em.HasComponent<TransportStopData>(prefab)) continue;
                var data = em.GetComponentData<TransportStopData>(prefab); if (type.Length > 0 && !string.Equals(type, data.m_TransportType.ToString(), StringComparison.OrdinalIgnoreCase)) continue;
                var p = StopPosition(em, stop); float d = math.distance(p.xz, center.xz); if (d > radius) continue;
                int lines = em.GetBuffer<ConnectedRoute>(stop, true).Length; stops.Add(Tuple.Create(d, stop, lines));
            }
            stops.Sort((a, b) => a.Item1.CompareTo(b.Item1)); int waiting = 0;
            var rows = new JArray(); int limit = ComponentInspector.Int(args, "stop_limit", 64, 0, 256);
            foreach (var item in stops.Take(limit))
            {
                int stopWaiting = 0;
                using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<TransportLine>(), ComponentType.ReadOnly<RouteWaypoint>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
                using (var lines = q.ToEntityArray(Allocator.Temp)) foreach (var line in lines)
                {
                    var waypoints = em.GetBuffer<RouteWaypoint>(line, true);
                    for (int i = 0; i < waypoints.Length; i++)
                    {
                        var waypoint = waypoints[i].m_Waypoint;
                        if (!em.Exists(waypoint) || !em.HasComponent<Connected>(waypoint) || em.GetComponentData<Connected>(waypoint).m_Connected != item.Item2) continue;
                        if (em.HasComponent<WaitingPassengers>(waypoint)) stopWaiting += em.GetComponentData<WaitingPassengers>(waypoint).m_Count;
                    }
                }
                waiting += stopWaiting; rows.Add(new JObject { ["stop_id"] = EntityId(item.Item2), ["distance_m"] = item.Item1, ["connected_line_count"] = item.Item3, ["waiting_passengers"] = stopWaiting });
            }
            return new JObject { ["center"] = PointJson(center), ["radius_m"] = radius, ["transport_type"] = type.Length == 0 ? null : type, ["coverage_model"] = "euclidean_stop_catchment_proxy", ["residential_buildings_in_range"] = ResidentialCount(center, radius, world), ["nearby_stop_count"] = stops.Count, ["nearby_waiting_passengers"] = waiting, ["stops"] = rows, ["notes"] = "Straight-line catchment proxy; it does not calculate pedestrian paths, transfer quality, platform capacity or traffic congestion." };
        }

        private JObject AnalyzeEducationDemand(JObject args, World world)
        {
            var em = world.EntityManager; float3 center = CoverageCenter(args, world, "stop_id", "facility_id", "building_id");
            float radius = BuildingNumber(args, "radius_m", 1000, 1, 5000); int requestedLevel = ComponentInspector.Int(args, "education_level", -1, -1, 4); float radiusSq = radius * radius;
            int students = 0, matchingStudents = 0; var schools = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Citizen>(), ComponentType.ReadOnly<Game.Citizens.Student>(), ComponentType.ReadOnly<CurrentBuilding>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var citizen in entities)
            {
                var current = em.GetComponentData<CurrentBuilding>(citizen).m_CurrentBuilding; if (!em.Exists(current) || !em.HasComponent<Game.Objects.Transform>(current)) continue;
                if (math.distancesq(em.GetComponentData<Game.Objects.Transform>(current).m_Position.xz, center.xz) > radiusSq) continue;
                students++; var level = em.GetComponentData<Game.Citizens.Student>(citizen).m_Level; if (requestedLevel < 0 || level == requestedLevel) matchingStudents++;
            }
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var school in entities)
            {
                var prefab = em.GetComponentData<PrefabRef>(school).m_Prefab; if (!em.HasComponent<SchoolData>(prefab)) continue;
                var p = em.GetComponentData<Game.Objects.Transform>(school).m_Position; if (math.distancesq(p.xz, center.xz) > radiusSq) continue;
                var data = em.GetComponentData<SchoolData>(prefab); int enrolled = em.HasBuffer<Game.Buildings.Student>(school) ? em.GetBuffer<Game.Buildings.Student>(school, true).Length : 0;
                schools.Add(new JObject { ["facility_id"] = EntityId(school), ["education_level"] = data.m_EducationLevel, ["student_capacity"] = data.m_StudentCapacity, ["enrolled_students"] = enrolled, ["available_capacity"] = Math.Max(0, data.m_StudentCapacity - enrolled), ["distance_m"] = math.distance(p.xz, center.xz) });
            }
            return new JObject { ["center"] = PointJson(center), ["radius_m"] = radius, ["requested_education_level"] = requestedLevel < 0 ? null : (JToken)requestedLevel, ["coverage_model"] = "current_building_student_proxy", ["students_in_range"] = students, ["matching_students_in_range"] = matchingStudents, ["schools_in_range"] = schools.Count, ["schools"] = new JArray(schools), ["total_capacity"] = schools.Sum(x => (int?)x["student_capacity"] ?? 0), ["total_available_capacity"] = schools.Sum(x => (int?)x["available_capacity"] ?? 0), ["notes"] = "Students are located through CurrentBuilding and school enrollment buffers; this does not simulate future enrollment, pathfinding or native school assignment decisions." };
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
