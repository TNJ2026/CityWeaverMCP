using System;
using System.Collections.Generic;
using System.Linq;
using Game.Buildings;
using Game.Common;
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
        private readonly HashSet<string> m_CityServiceOperationIds = new HashSet<string>();
        private static readonly string[] CityServiceKinds = { "all", "healthcare", "fire", "police", "education", "garbage", "deathcare", "maintenance", "park", "post", "parking", "welfare", "research", "emergency" };

        private static bool IsCityServicePrefab(EntityManager em, Entity p) => em.Exists(p) &&
            (em.HasComponent<HospitalData>(p) || em.HasComponent<FireStationData>(p) || em.HasComponent<FirewatchTowerData>(p) ||
             em.HasComponent<PoliceStationData>(p) || em.HasComponent<PrisonData>(p) || em.HasComponent<SchoolData>(p) ||
             em.HasComponent<GarbageFacilityData>(p) || em.HasComponent<DeathcareFacilityData>(p) || em.HasComponent<MaintenanceDepotData>(p) ||
             em.HasComponent<ParkData>(p) || em.HasComponent<PostFacilityData>(p) || em.HasComponent<ParkingFacilityData>(p) ||
             em.HasComponent<WelfareOfficeData>(p) || em.HasComponent<ResearchFacilityData>(p) || em.HasComponent<EmergencyShelterData>(p) || em.HasComponent<DisasterFacilityData>(p));

        private static bool IsPlaceableCityServicePrefab(EntityManager em, Entity p) => IsCityServicePrefab(em, p) && em.HasComponent<BuildingData>(p) &&
            em.HasComponent<PlaceableObjectData>(p) && !em.HasComponent<Game.Prefabs.ServiceUpgradeData>(p);

        private static string CityServiceKind(EntityManager em, Entity p)
        {
            if (em.HasComponent<HospitalData>(p)) return "healthcare";
            if (em.HasComponent<FireStationData>(p) || em.HasComponent<FirewatchTowerData>(p)) return "fire";
            if (em.HasComponent<PoliceStationData>(p) || em.HasComponent<PrisonData>(p)) return "police";
            if (em.HasComponent<SchoolData>(p)) return "education";
            if (em.HasComponent<GarbageFacilityData>(p)) return "garbage";
            if (em.HasComponent<DeathcareFacilityData>(p)) return "deathcare";
            if (em.HasComponent<MaintenanceDepotData>(p)) return "maintenance";
            if (em.HasComponent<ParkData>(p)) return "park";
            if (em.HasComponent<PostFacilityData>(p)) return "post";
            if (em.HasComponent<ParkingFacilityData>(p)) return "parking";
            if (em.HasComponent<WelfareOfficeData>(p)) return "welfare";
            if (em.HasComponent<ResearchFacilityData>(p)) return "research";
            return "emergency";
        }

        private Entity ResolveCityServicePrefab(string wanted, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
                if (IsPlaceableCityServicePrefab(em, e) && ps.TryGetPrefab<PrefabBase>(e, out var p) && string.Equals(p.name, wanted, StringComparison.OrdinalIgnoreCase)) return e;
            throw new QueryException("CITY_SERVICE_PREFAB_NOT_FOUND", "Use an exact name from list_city_service_prefabs.");
        }

        private JObject CityServicePrefabRow(World world, Entity p)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); ps.TryGetPrefab<PrefabBase>(p, out var pf);
            var row = new JObject { ["name"] = pf?.name, ["kind"] = CityServiceKind(em, p), ["locked"] = RoadOperation.IsLocked(em, p) };
            var place = em.GetComponentData<PlaceableObjectData>(p); row["construction_cost"] = place.m_ConstructionCost; row["placement_flags"] = place.m_Flags.ToString();
            row["placement_mode"] = (place.m_Flags & Game.Objects.PlacementFlags.RoadEdge) != 0 ? "road_edge" : (place.m_Flags & Game.Objects.PlacementFlags.Shoreline) != 0 ? "shoreline" : (place.m_Flags & Game.Objects.PlacementFlags.Floating) != 0 ? "floating" : (place.m_Flags & Game.Objects.PlacementFlags.RoadNode) != 0 ? "road_node" : "roadside";
            var b = em.GetComponentData<BuildingData>(p); row["lot_cells"] = new JObject { ["width"] = b.m_LotSize.x, ["depth"] = b.m_LotSize.y }; row["requires_road"] = (b.m_Flags & Game.Prefabs.BuildingFlags.RequireRoad) != 0;
            if (em.HasComponent<ObjectGeometryData>(p)) { var g = em.GetComponentData<ObjectGeometryData>(p); row["size_m"] = new JObject { ["x"] = g.m_Size.x, ["y"] = g.m_Size.y, ["z"] = g.m_Size.z }; }
            if (em.HasComponent<HospitalData>(p)) { var d = em.GetComponentData<HospitalData>(p); row["ambulance_capacity"] = d.m_AmbulanceCapacity; row["medical_helicopter_capacity"] = d.m_MedicalHelicopterCapacity; row["patient_capacity"] = d.m_PatientCapacity; row["treatment_bonus"] = d.m_TreatmentBonus; }
            if (em.HasComponent<FireStationData>(p)) { var d = em.GetComponentData<FireStationData>(p); row["fire_engine_capacity"] = d.m_FireEngineCapacity; row["fire_helicopter_capacity"] = d.m_FireHelicopterCapacity; row["disaster_response_capacity"] = d.m_DisasterResponseCapacity; }
            if (em.HasComponent<PoliceStationData>(p)) { var d = em.GetComponentData<PoliceStationData>(p); row["patrol_car_capacity"] = d.m_PatrolCarCapacity; row["police_helicopter_capacity"] = d.m_PoliceHelicopterCapacity; row["jail_capacity"] = d.m_JailCapacity; row["police_purposes"] = d.m_PurposeMask.ToString(); }
            if (em.HasComponent<PrisonData>(p)) { var d = em.GetComponentData<PrisonData>(p); row["prison_van_capacity"] = d.m_PrisonVanCapacity; row["prisoner_capacity"] = d.m_PrisonerCapacity; }
            if (em.HasComponent<SchoolData>(p)) { var d = em.GetComponentData<SchoolData>(p); row["student_capacity"] = d.m_StudentCapacity; row["education_level"] = d.m_EducationLevel; row["graduation_modifier"] = d.m_GraduationModifier; }
            if (em.HasComponent<GarbageFacilityData>(p)) { var d = em.GetComponentData<GarbageFacilityData>(p); row["garbage_capacity"] = d.m_GarbageCapacity; row["vehicle_capacity"] = d.m_VehicleCapacity; row["processing_speed"] = d.m_ProcessingSpeed; row["industrial_waste_only"] = d.m_IndustrialWasteOnly; row["long_term_storage"] = d.m_LongTermStorage; }
            if (em.HasComponent<DeathcareFacilityData>(p)) { var d = em.GetComponentData<DeathcareFacilityData>(p); row["hearse_capacity"] = d.m_HearseCapacity; row["storage_capacity"] = d.m_StorageCapacity; row["processing_rate"] = d.m_ProcessingRate; row["long_term_storage"] = d.m_LongTermStorage; }
            if (em.HasComponent<MaintenanceDepotData>(p)) { var d = em.GetComponentData<MaintenanceDepotData>(p); row["maintenance_types"] = d.m_MaintenanceType.ToString(); row["vehicle_capacity"] = d.m_VehicleCapacity; row["vehicle_efficiency"] = d.m_VehicleEfficiency; }
            if (em.HasComponent<ParkData>(p)) { var d = em.GetComponentData<ParkData>(p); row["maintenance_pool"] = d.m_MaintenancePool; row["allows_homeless"] = d.m_AllowHomeless; }
            if (em.HasComponent<PostFacilityData>(p)) { var d = em.GetComponentData<PostFacilityData>(p); row["post_van_capacity"] = d.m_PostVanCapacity; row["post_truck_capacity"] = d.m_PostTruckCapacity; row["mail_capacity"] = d.m_MailCapacity; row["sorting_rate"] = d.m_SortingRate; }
            if (em.HasComponent<ParkingFacilityData>(p)) { var d = em.GetComponentData<ParkingFacilityData>(p); row["parking_comfort_factor"] = d.m_ComfortFactor; row["garage_marker_capacity"] = d.m_GarageMarkerCapacity; row["road_types"] = d.m_RoadTypes.ToString(); }
            if (em.HasComponent<EmergencyShelterData>(p)) { var d = em.GetComponentData<EmergencyShelterData>(p); row["shelter_capacity"] = d.m_ShelterCapacity; row["vehicle_capacity"] = d.m_VehicleCapacity; }
            return row;
        }

        private JObject ListCityServicePrefabs(JObject args, World world)
        {
            string search = ((string)args["search"] ?? "").Trim(), kind = ((string)args["kind"] ?? "all").ToLowerInvariant();
            if (!CityServiceKinds.Contains(kind)) throw new QueryException("INVALID_ARGUMENT", "Unsupported city-service kind.");
            bool unlocked = (bool?)args["unlocked_only"] ?? true; int offset = ComponentInspector.Int(args, "offset", 0, 0, 10000), limit = ComponentInspector.Int(args, "limit", 50, 1, 100);
            var rows = new List<JObject>(); var em = world.EntityManager;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var p in es)
            {
                if (!IsPlaceableCityServicePrefab(em, p)) continue; var row = CityServicePrefabRow(world, p);
                if (unlocked && (bool)row["locked"] || kind != "all" && (string)row["kind"] != kind || search.Length > 0 && ((string)row["name"] ?? "").IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue; rows.Add(row);
            }
            rows = rows.OrderBy(x => (string)x["name"]).ToList(); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : null, ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }

        private Entity ResolveCityServiceFacility(JObject args, World world)
        {
            var e = ParseEntity((string)args["facility_id"], world.EntityManager); var em = world.EntityManager;
            if (!em.Exists(e) || !em.HasComponent<Building>(e) || !em.HasComponent<PrefabRef>(e) || em.HasComponent<Deleted>(e) || em.HasComponent<Temp>(e) || !IsCityServicePrefab(em, em.GetComponentData<PrefabRef>(e).m_Prefab))
                throw new QueryException("CITY_SERVICE_FACILITY_NOT_FOUND", "facility_id must identify a permanent city-service facility.");
            return e;
        }

        private JObject CityServiceFacilityRow(World world, Entity e, bool detail)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var p = em.GetComponentData<PrefabRef>(e).m_Prefab; ps.TryGetPrefab<PrefabBase>(p, out var pf); var t = em.GetComponentData<Game.Objects.Transform>(e);
            var building = em.GetComponentData<Building>(e);
            var row = new JObject { ["facility_id"] = m_Session + ":" + e.Index + ":" + e.Version, ["name"] = Name(world, e), ["prefab"] = pf?.name, ["kind"] = CityServiceKind(em, p), ["position"] = PointJson(t.m_Position), ["road_edge_id"] = OptionalEntity(m_Session, building.m_RoadEdge) };
            if (em.HasBuffer<Efficiency>(e)) { var b = em.GetBuffer<Efficiency>(e, true); row["efficiency_factors"] = new JArray(Enumerable.Range(0, b.Length).Select(i => (object)b[i].m_Efficiency)); }
            if (em.HasBuffer<Game.Vehicles.OwnedVehicle>(e)) { var b = em.GetBuffer<Game.Vehicles.OwnedVehicle>(e, true); row["owned_vehicle_count"] = b.Length; if (detail) row["owned_vehicle_ids"] = new JArray(Enumerable.Range(0, Math.Min(256, b.Length)).Select(i => (object)(m_Session + ":" + b[i].m_Vehicle.Index + ":" + b[i].m_Vehicle.Version))); }
            if (em.HasBuffer<Game.Buildings.Patient>(e)) row["patient_count"] = em.GetBuffer<Game.Buildings.Patient>(e, true).Length;
            if (em.HasBuffer<Game.Buildings.Student>(e)) row["student_count"] = em.GetBuffer<Game.Buildings.Student>(e, true).Length;
            if (em.HasBuffer<Game.Buildings.Occupant>(e)) row["occupant_count"] = em.GetBuffer<Game.Buildings.Occupant>(e, true).Length;
            if (em.HasComponent<Game.Buildings.Hospital>(e)) { var d = em.GetComponentData<Game.Buildings.Hospital>(e); row["hospital_flags"] = d.m_Flags.ToString(); row["treatment_bonus"] = d.m_TreatmentBonus; row["health_range"] = new JObject { ["min"] = d.m_MinHealth, ["max"] = d.m_MaxHealth }; row["request_pending"] = d.m_TargetRequest != Entity.Null; }
            if (em.HasComponent<Game.Buildings.FireStation>(e)) { var d = em.GetComponentData<Game.Buildings.FireStation>(e); row["fire_station_flags"] = d.m_Flags.ToString(); row["request_pending"] = d.m_TargetRequest != Entity.Null; }
            if (em.HasComponent<Game.Buildings.FirewatchTower>(e)) row["firewatch_flags"] = em.GetComponentData<Game.Buildings.FirewatchTower>(e).m_Flags.ToString();
            if (em.HasComponent<Game.Buildings.PoliceStation>(e)) { var d = em.GetComponentData<Game.Buildings.PoliceStation>(e); row["police_flags"] = d.m_Flags.ToString(); row["police_purposes"] = d.m_PurposeMask.ToString(); row["request_pending"] = d.m_TargetRequest != Entity.Null; row["prisoner_transport_pending"] = d.m_PrisonerTransportRequest != Entity.Null; }
            if (em.HasComponent<Game.Buildings.Prison>(e)) { var d = em.GetComponentData<Game.Buildings.Prison>(e); row["prison_flags"] = d.m_Flags.ToString(); row["prisoner_wellbeing"] = d.m_PrisonerWellbeing; row["prisoner_health"] = d.m_PrisonerHealth; }
            if (em.HasComponent<Game.Buildings.School>(e)) { var d = em.GetComponentData<Game.Buildings.School>(e); row["average_graduation_time"] = d.m_AverageGraduationTime; row["average_fail_probability"] = d.m_AverageFailProbability; row["student_wellbeing"] = d.m_StudentWellbeing; row["student_health"] = d.m_StudentHealth; }
            if (em.HasComponent<Game.Buildings.GarbageFacility>(e)) { var d = em.GetComponentData<Game.Buildings.GarbageFacility>(e); row["garbage_flags"] = d.m_Flags.ToString(); row["processing_rate"] = d.m_ProcessingRate; row["accept_priority"] = d.m_AcceptGarbagePriority; row["deliver_priority"] = d.m_DeliverGarbagePriority; }
            if (em.HasComponent<Game.Buildings.DeathcareFacility>(e)) { var d = em.GetComponentData<Game.Buildings.DeathcareFacility>(e); row["deathcare_flags"] = d.m_Flags.ToString(); row["processing_state"] = d.m_ProcessingState; row["long_term_stored_count"] = d.m_LongTermStoredCount; }
            if (em.HasComponent<Game.Buildings.MaintenanceDepot>(e)) row["maintenance_flags"] = em.GetComponentData<Game.Buildings.MaintenanceDepot>(e).m_Flags.ToString();
            if (em.HasComponent<Game.Buildings.Park>(e)) row["maintenance"] = em.GetComponentData<Game.Buildings.Park>(e).m_Maintenance;
            if (em.HasComponent<Game.Buildings.PostFacility>(e)) { var d = em.GetComponentData<Game.Buildings.PostFacility>(e); row["post_flags"] = d.m_Flags.ToString(); row["processing_factor"] = d.m_ProcessingFactor; row["accept_priority"] = d.m_AcceptMailPriority; row["deliver_priority"] = d.m_DeliverMailPriority; }
            if (em.HasComponent<Game.Buildings.ParkingFacility>(e)) { var d = em.GetComponentData<Game.Buildings.ParkingFacility>(e); row["parking_flags"] = d.m_Flags.ToString(); row["comfort_factor"] = d.m_ComfortFactor; }
            if (em.HasComponent<Game.Buildings.EmergencyShelter>(e)) row["emergency_shelter_flags"] = em.GetComponentData<Game.Buildings.EmergencyShelter>(e).m_Flags.ToString();
            if (detail && em.HasBuffer<Game.Economy.Resources>(e)) { var b = em.GetBuffer<Game.Economy.Resources>(e, true); var resources = new JObject(); for (int i = 0; i < b.Length; i++) if (b[i].m_Amount != 0) resources[b[i].m_Resource.ToString()] = b[i].m_Amount; row["stored_resources"] = resources; }
            return row;
        }

        private JObject ListCityServiceFacilities(JObject args, World world)
        {
            string kind = ((string)args["kind"] ?? "all").ToLowerInvariant(); if (!CityServiceKinds.Contains(kind)) throw new QueryException("INVALID_ARGUMENT", "Unsupported city-service kind.");
            var rows = new List<JObject>(); var em = world.EntityManager;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var p = em.GetComponentData<PrefabRef>(e).m_Prefab; if (IsCityServicePrefab(em, p) && (kind == "all" || CityServiceKind(em, p) == kind)) rows.Add(CityServiceFacilityRow(world, e, false)); }
            return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows) };
        }

        private JObject GetCityServiceFacility(JObject args, World world) => CityServiceFacilityRow(world, ResolveCityServiceFacility(args, world), true);

        private sealed class CoverageSnapshot
        {
            public int ResidentialCount;
            public readonly PlanningSpatialIndex<Tuple<float2, int, Entity>> Residences;
            public readonly PlanningSpatialIndex<Tuple<float2, Entity, string>> Facilities;
            public readonly Dictionary<(Tuple<float2, int, Entity>, string, float, Entity), bool> Covered = new Dictionary<(Tuple<float2, int, Entity>, string, float, Entity), bool>();
            public CoverageSnapshot(float radius)
            {
                Residences = new PlanningSpatialIndex<Tuple<float2, int, Entity>>(radius);
                Facilities = new PlanningSpatialIndex<Tuple<float2, Entity, string>>(radius);
            }
        }

        private CoverageSnapshot ReadCoverageSnapshot(World world, float radius)
        {
            var snapshot = new CoverageSnapshot(radius); var em = world.EntityManager;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Building>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities)
            {
                var p = em.GetComponentData<Game.Objects.Transform>(e).m_Position.xz;
                if (em.HasComponent<ResidentialProperty>(e))
                {
                    snapshot.ResidentialCount++;
                    snapshot.Residences.Add(p, p, Tuple.Create(p, em.HasBuffer<Renter>(e) ? em.GetBuffer<Renter>(e, true).Length : 0, e));
                }
                if (!em.HasComponent<PrefabRef>(e)) continue;
                var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab;
                if (IsCityServicePrefab(em, prefab)) snapshot.Facilities.Add(p, p, Tuple.Create(p, e, CityServiceKind(em, prefab)));
            }
            return snapshot;
        }

        private JObject AnalyzeServiceCoverage(JObject args, World world, CoverageSnapshot snapshot = null)
        {
            var em = world.EntityManager;
            if (args["positions"] is JArray positions)
            {
                if (positions.Count < 1 || positions.Count > 32 || args["position"] != null || args["facility_id"] != null)
                    throw new QueryException("INVALID_ARGUMENT", "Provide 1..32 positions without position or facility_id.");
                snapshot = snapshot ?? ReadCoverageSnapshot(world, BuildingNumber(args, "radius_m", 500, 1, 5000));
                var items = new JArray();
                foreach (var positionToken in positions)
                {
                    if (!(positionToken is JObject)) throw new QueryException("INVALID_ARGUMENT", "Each position must contain x and z.");
                    var single = (JObject)args.DeepClone(); single.Remove("positions"); single["position"] = positionToken.DeepClone();
                    items.Add(AnalyzeServiceCoverage(single, world, snapshot));
                }
                return new JObject { ["items"] = items, ["snapshot_reads"] = 1 };
            }
            string kind = ((string)args["kind"] ?? "all").ToLowerInvariant();
            if (!CityServiceKinds.Contains(kind)) throw new QueryException("INVALID_ARGUMENT", "Unsupported city-service kind.");

            Entity target = Entity.Null;
            float3 center;
            if (args["facility_id"] != null)
            {
                target = ResolveCityServiceFacility(new JObject { ["facility_id"] = args["facility_id"] }, world);
                var prefab = em.GetComponentData<PrefabRef>(target).m_Prefab;
                string targetKind = CityServiceKind(em, prefab);
                if (kind != "all" && kind != targetKind) throw new QueryException("SERVICE_KIND_MISMATCH", "kind does not match facility_id.");
                kind = targetKind;
                center = em.GetComponentData<Game.Objects.Transform>(target).m_Position;
            }
            else if (args["position"] is JObject position)
            {
                center = new float3(BuildingNumber(position, "x", 0, -7168, 7168), 0, BuildingNumber(position, "z", 0, -7168, 7168));
            }
            else throw new QueryException("INVALID_ARGUMENT", "Provide either facility_id or position.");

            float radius = BuildingNumber(args, "radius_m", 500, 1, 5000);
            int detailLimit = ComponentInspector.Int(args, "facility_limit", 32, 0, 256);
            float radiusSq = radius * radius;
            snapshot = snapshot ?? ReadCoverageSnapshot(world, radius);
            int totalResidentialBuildings = snapshot.ResidentialCount;
            var residences = snapshot.Residences.Query(center.xz - radius, center.xz + radius)
                .Where(r => math.distancesq(r.Item1, center.xz) <= radiusSq).ToList();
            int residentialBuildings = residences.Count, households = residences.Sum(r => r.Item2);
            var facilities = snapshot.Facilities.Query(center.xz - radius, center.xz + radius)
                .Where(f => f.Item2 != target && (kind == "all" || f.Item3 == kind) && math.distancesq(f.Item1, center.xz) <= radiusSq)
                .Select(f => Tuple.Create(math.distance(f.Item1, center.xz), f.Item2)).OrderBy(f => f.Item1).ToList();
            int uncoveredBuildings = 0, uncoveredHouseholds = 0;
            foreach (var residence in residences)
            {
                var key = (residence, kind, radius, target);
                if (!snapshot.Covered.TryGetValue(key, out bool covered))
                {
                    covered = snapshot.Facilities.Query(residence.Item1 - radius, residence.Item1 + radius)
                        .Any(f => f.Item2 != target && (kind == "all" || f.Item3 == kind) && math.distancesq(f.Item1, residence.Item1) <= radiusSq);
                    snapshot.Covered[key] = covered;
                }
                if (covered) continue;
                uncoveredBuildings++;
                uncoveredHouseholds += residence.Item2;
            }
            var facilityRows = new JArray();
            foreach (var item in facilities.Take(detailLimit))
            {
                var row = CityServiceFacilityRow(world, item.Item2, false);
                row["distance_m"] = item.Item1;
                facilityRows.Add(row);
            }
            var result = new JObject {
                ["kind"] = kind,
                ["center"] = PointJson(center),
                ["radius_m"] = radius,
                ["coverage_model"] = "euclidean_radius_proxy",
                ["residential_buildings_in_range"] = residentialBuildings,
                ["total_residential_buildings"] = totalResidentialBuildings,
                ["residential_building_share"] = totalResidentialBuildings == 0 ? 0 : (double)residentialBuildings / totalResidentialBuildings,
                ["households_in_range"] = households,
                ["uncovered_residential_buildings"] = uncoveredBuildings,
                ["uncovered_households"] = uncoveredHouseholds,
                ["marginal_coverage_model"] = "same_kind_equal_radius_union_proxy",
                ["existing_facilities_in_range"] = facilities.Count,
                ["nearest_existing_facility_distance_m"] = facilities.Count == 0 ? null : (JToken)facilities[0].Item1,
                ["existing_facilities"] = facilityRows,
                ["notes"] = "This is a configurable straight-line planning proxy. Marginal coverage excludes the union of same-kind facility circles, including centers up to twice the radius away, independently of facility_limit. It does not model capacity, operating state, native pathfinding, district assignments or a hidden fixed game radius. Use preview_city_service_placement for authoritative placement validation."
            };
            if (target != Entity.Null) result["facility_id"] = m_Session + ":" + target.Index + ":" + target.Version;
            return result;
        }

        private JObject PlanCityServiceSite(JObject args, World world)
        {
            var p = ResolveCityServicePrefab((string)args["building_prefab"], world); var f = world.EntityManager.GetComponentData<PlaceableObjectData>(p).m_Flags;
            var result = (f & (Game.Objects.PlacementFlags.Shoreline | Game.Objects.PlacementFlags.Floating | Game.Objects.PlacementFlags.RoadEdge | Game.Objects.PlacementFlags.RoadNode)) != 0 ? PlanSpecialBuildingSite(args, world) : PlanBuildingSite(args, world);
            if ((bool?)args["consider_service_coverage"] == true && result["candidates"] is JArray candidates)
            {
                string serviceKind = CityServiceKind(world.EntityManager, p); float radius = BuildingNumber(args, "coverage_radius_m", 500, 1, 5000);
                var snapshot = ReadCoverageSnapshot(world, radius);
                foreach (var token in candidates.OfType<JObject>())
                {
                    if (!(token["position"] is JObject position)) continue;
                    var analysis = AnalyzeServiceCoverage(new JObject { ["position"] = position, ["kind"] = serviceKind, ["radius_m"] = radius, ["facility_limit"] = 0 }, world, snapshot);
                    token["coverage_residential_buildings"] = analysis["residential_buildings_in_range"];
                    token["coverage_households"] = analysis["households_in_range"];
                    token["coverage_existing_facilities"] = analysis["existing_facilities_in_range"];
                    token["coverage_uncovered_residential_buildings"] = analysis["uncovered_residential_buildings"];
                    token["coverage_uncovered_households"] = analysis["uncovered_households"];
                    double baseScore = (double?)token["score"] ?? 0;
                    double benefit = serviceKind == "garbage"
                        ? -Math.Log(1 + ((int?)analysis["residential_buildings_in_range"] ?? 0))
                        : Math.Log(1 + ((int?)analysis["uncovered_households"] ?? 0) + ((int?)analysis["uncovered_residential_buildings"] ?? 0));
                    token["coverage_adjusted_score"] = baseScore - benefit * radius;
                }
                var ordered = candidates.OfType<JObject>().OrderBy(x => (double?)x["coverage_adjusted_score"] ?? (double?)x["score"] ?? double.MaxValue).ToList();
                candidates.Clear(); foreach (var item in ordered) candidates.Add(item);
                result["coverage_model"] = "euclidean_radius_proxy"; result["coverage_radius_m"] = radius;
                result["coverage_note"] = "Greedy marginal coverage: excludes residences within existing same-kind facility circles; garbage facilities instead minimize residential exposure. Capacity and native pathfinding are not modeled. Native preview and service simulation remain authoritative.";
            }
            return result;
        }

        private Entity CityServiceHost(Entity target, EntityManager em)
        {
            var at = target; for (int i = 0; i < 12 && em.Exists(at); i++) { if (em.HasComponent<Building>(at) && em.HasComponent<PrefabRef>(at) && IsCityServicePrefab(em, em.GetComponentData<PrefabRef>(at).m_Prefab)) return at; if (!em.HasComponent<Owner>(at)) break; at = em.GetComponentData<Owner>(at).m_Owner; } return Entity.Null;
        }
        private void ValidateCityServiceOperation(BuildingOperation op, World world)
        {
            var em = world.EntityManager; Entity host = op.Type == "remove_upgrade" ? CityServiceHost(op.Target, em) : op.Target;
            Entity p = host != Entity.Null && em.HasComponent<PrefabRef>(host) ? em.GetComponentData<PrefabRef>(host).m_Prefab : op.Type == "upgrade" ? op.OriginalPrefab : op.Prefab != Entity.Null ? op.Prefab : op.OriginalPrefab;
            if (!IsCityServicePrefab(em, p)) throw new QueryException("NOT_A_CITY_SERVICE_OPERATION", "The operation does not target a supported city-service facility.");
        }
        private JObject PreviewCityService(JObject args, World world, string type)
        {
            var copy = (JObject)args.DeepClone();
            if (type == "place") ResolveCityServicePrefab((string)args["building_prefab"], world);
            else if (type == "remove_upgrade") { var upgrade = ParseEntity((string)args["upgrade_id"], world.EntityManager); if (CityServiceHost(upgrade, world.EntityManager) == Entity.Null) throw new QueryException("CITY_SERVICE_UPGRADE_NOT_FOUND", "upgrade_id must belong to a city-service facility."); copy["building_id"] = copy["upgrade_id"]; copy.Remove("upgrade_id"); }
            else { ResolveCityServiceFacility(new JObject { ["facility_id"] = args["facility_id"] }, world); copy["building_id"] = copy["facility_id"]; copy.Remove("facility_id"); }
            var op = PreviewBuildingOperation(copy, world, type); ValidateCityServiceOperation(op, world); m_CityServiceOperationIds.Add(op.Id); return op.Json();
        }
        private BuildingOperation CityServiceOperation(JObject args) { var op = BuildingOperationById(args); if (!m_CityServiceOperationIds.Contains(op.Id)) throw new QueryException("CITY_SERVICE_OPERATION_NOT_FOUND", "operation_id does not identify a city-service operation."); return op; }
        private JObject GetCityServiceOperation(JObject args, World world) { var op = CityServiceOperation(args); return op.Json(); }
        private JObject ApplyCityServiceOperation(JObject args, World world) { CityServiceOperation(args); return ApplyBuildingOperation(args, world); }
        private JObject CancelCityServiceOperation(JObject args, World world) { CityServiceOperation(args); return CancelBuildingOperation(args); }
    }
}
