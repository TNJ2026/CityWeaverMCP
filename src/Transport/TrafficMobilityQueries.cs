using System;
using System.Collections.Generic;
using System.Linq;
using Game.Citizens;
using Game.Common;
using Game.Creatures;
using Game.Economy;
using Game.Net;
using Game.Objects;
using Game.Pathfind;
using Game.Simulation;
using Game.Vehicles;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private static string VehicleClass(EntityManager em, Entity e)
        {
            if (em.HasComponent<Bicycle>(e)) return "bicycle";
            if (em.HasComponent<Train>(e)) return "train";
            if (em.HasComponent<Watercraft>(e)) return "watercraft";
            if (em.HasComponent<Aircraft>(e)) return "aircraft";
            if (em.HasComponent<Car>(e)) return "car";
            return "other";
        }

        private static string VehicleRole(EntityManager em, Entity e)
        {
            if (em.HasComponent<Taxi>(e)) return "taxi";
            if (em.HasComponent<PublicTransport>(e) || em.HasComponent<PassengerTransport>(e)) return "public_transport";
            if (em.HasComponent<CargoTransport>(e)) return "cargo_transport";
            if (em.HasComponent<DeliveryTruck>(e) || em.HasComponent<GoodsDeliveryVehicle>(e)) return "delivery";
            if (em.HasComponent<PoliceCar>(e) || em.HasComponent<Ambulance>(e) || em.HasComponent<FireEngine>(e) || em.HasComponent<GarbageTruck>(e) || em.HasComponent<Hearse>(e) || em.HasComponent<PostVan>(e) || em.HasComponent<MaintenanceVehicle>(e) || em.HasComponent<WorkVehicle>(e)) return "service";
            if (em.HasComponent<PersonalCar>(e)) return "personal";
            return "other";
        }

        private static Entity VehicleLane(EntityManager em, Entity e)
        {
            if (em.HasComponent<CarCurrentLane>(e)) return em.GetComponentData<CarCurrentLane>(e).m_Lane;
            if (em.HasComponent<TrainCurrentLane>(e)) return em.GetComponentData<TrainCurrentLane>(e).m_Front.m_Lane;
            if (em.HasComponent<WatercraftCurrentLane>(e)) return em.GetComponentData<WatercraftCurrentLane>(e).m_Lane;
            if (em.HasComponent<AircraftCurrentLane>(e)) return em.GetComponentData<AircraftCurrentLane>(e).m_Lane;
            if (em.HasComponent<ParkedCar>(e)) return em.GetComponentData<ParkedCar>(e).m_Lane;
            return Entity.Null;
        }

        private static Entity OwningRoad(EntityManager em, Entity lane)
        {
            var cursor = lane;
            for (int i = 0; i < 5 && cursor != Entity.Null && em.Exists(cursor); i++)
            {
                if (em.HasComponent<Game.Net.Road>(cursor) && em.HasComponent<Game.Net.Edge>(cursor)) return cursor;
                if (!em.HasComponent<Owner>(cursor)) break;
                cursor = em.GetComponentData<Owner>(cursor).m_Owner;
            }
            return Entity.Null;
        }

        private static float Speed(EntityManager em, Entity e)
        {
            return em.HasComponent<Moving>(e) ? math.length(em.GetComponentData<Moving>(e).m_Velocity) : 0f;
        }

        private static bool VehicleStuck(EntityManager em, Entity e)
        {
            if (em.HasComponent<PathOwner>(e))
            {
                var state = em.GetComponentData<PathOwner>(e).m_State;
                if ((state & (PathFlags.Stuck | PathFlags.Failed)) != 0) return true;
            }
            return false;
        }

        private JObject VehicleJson(Entity e, World world, bool detail)
        {
            var em = world.EntityManager;
            var row = EntityRow(e, world, em);
            var lane = VehicleLane(em, e);
            var road = OwningRoad(em, lane);
            row["vehicle_class"] = VehicleClass(em, e);
            row["role"] = VehicleRole(em, e);
            row["speed_mps"] = Speed(em, e);
            row["speed_kph"] = Speed(em, e) * 3.6f;
            row["moving"] = em.HasComponent<Moving>(e) && Speed(em, e) > .15f;
            row["parked"] = em.HasComponent<ParkedCar>(e) || em.HasComponent<ParkedTrain>(e);
            row["stuck"] = VehicleStuck(em, e);
            row["lane_id"] = OptionalEntity(m_Session, lane);
            row["road_edge_id"] = OptionalEntity(m_Session, road);
            row["owner_id"] = em.HasComponent<Owner>(e) ? OptionalEntity(m_Session, em.GetComponentData<Owner>(e).m_Owner) : JValue.CreateNull();
            row["controller_id"] = em.HasComponent<Controller>(e) ? OptionalEntity(m_Session, em.GetComponentData<Controller>(e).m_Controller) : JValue.CreateNull();
            row["target_id"] = em.HasComponent<Target>(e) ? OptionalEntity(m_Session, em.GetComponentData<Target>(e).m_Target) : JValue.CreateNull();
            if (em.HasComponent<PathOwner>(e)) { var p = em.GetComponentData<PathOwner>(e); row["path_state"] = p.m_State.ToString(); row["path_element_index"] = p.m_ElementIndex; }
            if (em.HasComponent<PathInformation>(e)) { var p = em.GetComponentData<PathInformation>(e); row["path"] = new JObject { ["origin_id"] = OptionalEntity(m_Session, p.m_Origin), ["destination_id"] = OptionalEntity(m_Session, p.m_Destination), ["distance_m"] = p.m_Distance, ["duration"] = p.m_Duration, ["cost"] = p.m_TotalCost, ["methods"] = p.m_Methods.ToString(), ["state"] = p.m_State.ToString() }; }
            if (em.HasComponent<Odometer>(e)) row["odometer_m"] = em.GetComponentData<Odometer>(e).m_Distance;
            if (em.HasComponent<Car>(e)) row["car_flags"] = em.GetComponentData<Car>(e).m_Flags.ToString();
            if (em.HasComponent<CarNavigation>(e)) { var n = em.GetComponentData<CarNavigation>(e); row["navigation_max_speed_mps"] = n.m_MaxSpeed; row["navigation_target_position"] = new JObject { ["x"] = n.m_TargetPosition.x, ["y"] = n.m_TargetPosition.y, ["z"] = n.m_TargetPosition.z }; }
            if (em.HasComponent<WatercraftNavigation>(e)) { var n = em.GetComponentData<WatercraftNavigation>(e); row["navigation_max_speed_mps"] = n.m_MaxSpeed; row["navigation_target_position"] = new JObject { ["x"] = n.m_TargetPosition.x, ["y"] = n.m_TargetPosition.y, ["z"] = n.m_TargetPosition.z }; }
            if (em.HasComponent<AircraftNavigation>(e)) { var n = em.GetComponentData<AircraftNavigation>(e); row["navigation_max_speed_mps"] = n.m_MaxSpeed; row["navigation_target_position"] = new JObject { ["x"] = n.m_TargetPosition.x, ["y"] = n.m_TargetPosition.y, ["z"] = n.m_TargetPosition.z }; }
            if (em.HasComponent<TrainNavigation>(e)) row["navigation_speed_mps"] = em.GetComponentData<TrainNavigation>(e).m_Speed;
            if (em.HasComponent<PersonalCar>(e)) { var p = em.GetComponentData<PersonalCar>(e); row["personal_car"] = new JObject { ["keeper_id"] = OptionalEntity(m_Session, p.m_Keeper), ["state"] = p.m_State.ToString() }; }
            if (em.HasComponent<DeliveryTruck>(e)) { var d = em.GetComponentData<DeliveryTruck>(e); row["delivery"] = new JObject { ["resource"] = d.m_Resource.ToString(), ["amount"] = d.m_Amount, ["state"] = d.m_State.ToString() }; }
            if (em.HasBuffer<Passenger>(e)) { var b = em.GetBuffer<Passenger>(e, true); row["passenger_count"] = b.Length; if (detail) { var a = new JArray(); for (int i = 0; i < Math.Min(256, b.Length); i++) a.Add(OptionalEntity(m_Session, b[i].m_Passenger)); row["passenger_ids"] = a; row["passengers_truncated"] = b.Length > a.Count; } }
            if (em.HasBuffer<LayoutElement>(e)) { var b = em.GetBuffer<LayoutElement>(e, true); row["layout_vehicle_count"] = b.Length; if (detail) { var a = new JArray(); for (int i = 0; i < Math.Min(64, b.Length); i++) a.Add(OptionalEntity(m_Session, b[i].m_Vehicle)); row["layout_vehicle_ids"] = a; } }
            return row;
        }

        private Entity ResolveVehicle(JObject args, World world)
        {
            var e = ParseEntity((string)args["vehicle_id"], world.EntityManager);
            if (!world.EntityManager.HasComponent<Vehicle>(e)) throw new QueryException("VEHICLE_NOT_FOUND", "vehicle_id must identify a permanent live vehicle.");
            return e;
        }

        private JObject ListVehicles(JObject args, World world)
        {
            var em = world.EntityManager; int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 50, 1, 500);
            string cls = ((string)args["vehicle_class"] ?? "all").ToLowerInvariant(), role = ((string)args["role"] ?? "all").ToLowerInvariant(), state = ((string)args["state"] ?? "all").ToLowerInvariant();
            var rows = new List<Entity>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Vehicle>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>(), ComponentType.ReadOnly<Game.Prefabs.PrefabData>() } }))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities)
            {
                bool parked = em.HasComponent<ParkedCar>(e) || em.HasComponent<ParkedTrain>(e), stuck = VehicleStuck(em, e), moving = em.HasComponent<Moving>(e) && Speed(em, e) > .15f;
                if (cls != "all" && VehicleClass(em, e) != cls || role != "all" && VehicleRole(em, e) != role || state == "parked" && !parked || state == "moving" && !moving || state == "stuck" && !stuck) continue;
                rows.Add(e);
            }
            rows.Sort((a, b) => a.Index.CompareTo(b.Index));
            return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(e => VehicleJson(e, world, false))) };
        }

        private JObject GetVehicle(JObject args, World world) => VehicleJson(ResolveVehicle(args, world), world, true);

        private JObject PathJson(Entity e, JObject args, World world)
        {
            var em = world.EntityManager; int offset = ComponentInspector.Int(args, "offset", 0, 0, 100000), limit = ComponentInspector.Int(args, "limit", 100, 1, 1000); var items = new JArray(); int total = 0;
            if (em.HasBuffer<PathElement>(e))
            {
                var b = em.GetBuffer<PathElement>(e, true); total = b.Length;
                for (int i = offset; i < Math.Min(offset + limit, b.Length); i++) { var x = b[i]; var road = OwningRoad(em, x.m_Target); items.Add(new JObject { ["index"] = i, ["target_id"] = OptionalEntity(m_Session, x.m_Target), ["road_edge_id"] = OptionalEntity(m_Session, road), ["target_delta"] = new JArray(x.m_TargetDelta.x, x.m_TargetDelta.y), ["flags"] = x.m_Flags.ToString() }); }
            }
            var result = new JObject { ["entity_id"] = EntityId(e), ["total"] = total, ["offset"] = offset, ["limit"] = limit, ["next_offset"] = offset + limit < total ? new JValue(offset + limit) : JValue.CreateNull(), ["items"] = items };
            if (em.HasComponent<PathOwner>(e)) { var p = em.GetComponentData<PathOwner>(e); result["current_index"] = p.m_ElementIndex; result["state"] = p.m_State.ToString(); }
            if (em.HasComponent<PathInformation>(e)) { var p = em.GetComponentData<PathInformation>(e); result["origin_id"] = OptionalEntity(m_Session, p.m_Origin); result["destination_id"] = OptionalEntity(m_Session, p.m_Destination); result["distance_m"] = p.m_Distance; result["duration"] = p.m_Duration; result["methods"] = p.m_Methods.ToString(); }
            return result;
        }

        private JObject GetVehiclePath(JObject args, World world) => PathJson(ResolveVehicle(args, world), args, world);

        private JObject TravelerJson(Entity e, World world, bool detail)
        {
            var em = world.EntityManager; var row = EntityRow(e, world, em); var human = em.GetComponentData<Human>(e); Entity citizen = Entity.Null;
            if (em.HasComponent<Resident>(e)) citizen = em.GetComponentData<Resident>(e).m_Citizen;
            row["citizen_id"] = OptionalEntity(m_Session, citizen); row["human_flags"] = human.m_Flags.ToString(); row["waiting"] = (human.m_Flags & HumanFlags.Waiting) != 0; row["speed_mps"] = Speed(em, e); row["speed_kph"] = Speed(em, e) * 3.6f;
            Entity vehicle = em.HasComponent<CurrentVehicle>(e) ? em.GetComponentData<CurrentVehicle>(e).m_Vehicle : Entity.Null; row["vehicle_id"] = OptionalEntity(m_Session, vehicle); row["mode"] = vehicle != Entity.Null ? "riding" : em.HasComponent<HumanCurrentLane>(e) ? "walking" : "stationary";
            if (em.HasComponent<HumanCurrentLane>(e)) { var l = em.GetComponentData<HumanCurrentLane>(e); row["lane_id"] = OptionalEntity(m_Session, l.m_Lane); row["road_edge_id"] = OptionalEntity(m_Session, OwningRoad(em, l.m_Lane)); row["lane_flags"] = l.m_Flags.ToString(); }
            row["target_id"] = em.HasComponent<Target>(e) ? OptionalEntity(m_Session, em.GetComponentData<Target>(e).m_Target) : JValue.CreateNull();
            if (em.HasComponent<HumanNavigation>(e)) row["navigation_max_speed_mps"] = em.GetComponentData<HumanNavigation>(e).m_MaxSpeed;
            if (em.HasComponent<PathOwner>(e)) { var p = em.GetComponentData<PathOwner>(e); row["path_state"] = p.m_State.ToString(); row["path_element_index"] = p.m_ElementIndex; row["stuck"] = (p.m_State & (PathFlags.Stuck | PathFlags.Failed)) != 0; } else row["stuck"] = false;
            if (citizen != Entity.Null && em.Exists(citizen) && em.HasComponent<TravelPurpose>(citizen)) { var p = em.GetComponentData<TravelPurpose>(citizen); row["purpose"] = p.m_Purpose.ToString(); row["purpose_data"] = p.m_Data; row["purpose_resource"] = p.m_Resource.ToString(); }
            if (detail && citizen != Entity.Null && em.Exists(citizen)) row["citizen"] = CitizenJson(citizen, world);
            return row;
        }

        private Entity ResolveTraveler(JObject args, World world)
        {
            var e = ParseEntity((string)args["traveler_id"], world.EntityManager); if (!world.EntityManager.HasComponent<Human>(e)) throw new QueryException("TRAVELER_NOT_FOUND", "traveler_id must identify a live human simulation entity."); return e;
        }

        private JObject ListTravelers(JObject args, World world)
        {
            var em = world.EntityManager; int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 50, 1, 500); string mode = ((string)args["mode"] ?? "all").ToLowerInvariant(); var rows = new List<Entity>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Human>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>(), ComponentType.ReadOnly<Game.Prefabs.PrefabData>() } })) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities) { Entity vehicle = em.HasComponent<CurrentVehicle>(e) ? em.GetComponentData<CurrentVehicle>(e).m_Vehicle : Entity.Null; bool stuck = em.HasComponent<PathOwner>(e) && (em.GetComponentData<PathOwner>(e).m_State & (PathFlags.Stuck | PathFlags.Failed)) != 0, waiting = (em.GetComponentData<Human>(e).m_Flags & HumanFlags.Waiting) != 0; if (mode == "walking" && (vehicle != Entity.Null || !em.HasComponent<HumanCurrentLane>(e)) || mode == "riding" && vehicle == Entity.Null || mode == "waiting" && !waiting || mode == "stuck" && !stuck) continue; rows.Add(e); }
            rows.Sort((a, b) => a.Index.CompareTo(b.Index)); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(e => TravelerJson(e, world, false))) };
        }

        private JObject GetTraveler(JObject args, World world) => TravelerJson(ResolveTraveler(args, world), world, true);
        private JObject GetTravelerPath(JObject args, World world) => PathJson(ResolveTraveler(args, world), args, world);

        private Entity CitizenCreature(Entity citizen, EntityManager em)
        {
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Human>(), ComponentType.ReadOnly<Resident>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (em.GetComponentData<Resident>(e).m_Citizen == citizen) return e; return Entity.Null;
        }

        private JObject ListCitizenTrips(JObject args, World world)
        {
            var em = world.EntityManager; Entity citizen = ParseEntity((string)args["citizen_id"], em); if (!em.HasComponent<Citizen>(citizen)) throw new QueryException("CITIZEN_NOT_FOUND", "citizen_id must identify a citizen."); var queued = new JArray();
            if (em.HasBuffer<TripNeeded>(citizen)) { var b = em.GetBuffer<TripNeeded>(citizen, true); for (int i = 0; i < b.Length; i++) { var t = b[i]; queued.Add(new JObject { ["index"] = i, ["target_id"] = OptionalEntity(m_Session, t.m_TargetAgent), ["purpose"] = t.m_Purpose.ToString(), ["data"] = t.m_Data, ["resource"] = t.m_Resource.ToString(), ["priority"] = t.m_Priority }); } }
            var creature = CitizenCreature(citizen, em); return new JObject { ["citizen_id"] = EntityId(citizen), ["current_building_id"] = em.HasComponent<CurrentBuilding>(citizen) ? OptionalEntity(m_Session, em.GetComponentData<CurrentBuilding>(citizen).m_CurrentBuilding) : JValue.CreateNull(), ["queued_count"] = queued.Count, ["queued"] = queued, ["active_traveler_id"] = OptionalEntity(m_Session, creature), ["active"] = creature == Entity.Null ? JValue.CreateNull() : TravelerJson(creature, world, false) };
        }

        private JObject InspectLaneConnections(JObject args, World world)
        {
            var em = world.EntityManager; Entity road = args["road_edge_id"] == null ? Entity.Null : ParseEntity((string)args["road_edge_id"], em); int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 100, 1, 1000); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<ConnectionLane>(), ComponentType.ReadOnly<Game.Net.Lane>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var owner = em.HasComponent<Owner>(e) ? em.GetComponentData<Owner>(e).m_Owner : Entity.Null; var owningRoad = OwningRoad(em, e); if (road != Entity.Null && owningRoad != road && owner != road) continue; var c = em.GetComponentData<ConnectionLane>(e); var l = em.GetComponentData<Game.Net.Lane>(e); rows.Add(new JObject { ["lane_id"] = EntityId(e), ["owner_id"] = OptionalEntity(m_Session, owner), ["road_edge_id"] = OptionalEntity(m_Session, owningRoad), ["flags"] = c.m_Flags.ToString(), ["road_types"] = c.m_RoadTypes.ToString(), ["track_types"] = c.m_TrackTypes.ToString(), ["start_owner_index"] = l.m_StartNode.GetOwnerIndex(), ["end_owner_index"] = l.m_EndNode.GetOwnerIndex(), ["start_lane_index"] = l.m_StartNode.GetLaneIndex(), ["end_lane_index"] = l.m_EndNode.GetLaneIndex() }); }
            return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }

        private JObject AnalyzeTrafficFlow(JObject args, World world)
        {
            var em = world.EntityManager; int limit = ComponentInspector.Int(args, "limit", 20, 1, 200); float stopped = (float?)args["stopped_speed_mps"] ?? .5f; var map = new Dictionary<Entity, int[]>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Vehicle>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>(), ComponentType.ReadOnly<ParkedCar>(), ComponentType.ReadOnly<ParkedTrain>() } })) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var road = OwningRoad(em, VehicleLane(em, e)); if (road == Entity.Null) continue; if (!map.TryGetValue(road, out var v)) map[road] = v = new int[4]; v[0]++; if (Speed(em, e) <= stopped) v[1]++; if (VehicleStuck(em, e)) v[2]++; v[3] += (int)Math.Round(Speed(em, e) * 100); }
            var rows = map.Select(x => new JObject { ["road_edge_id"] = EntityId(x.Key), ["vehicle_count"] = x.Value[0], ["stopped_count"] = x.Value[1], ["stuck_count"] = x.Value[2], ["stopped_ratio"] = x.Value[0] == 0 ? 0 : (double)x.Value[1] / x.Value[0], ["average_speed_mps"] = x.Value[0] == 0 ? 0 : x.Value[3] / 100.0 / x.Value[0], ["score"] = x.Value[1] * 2 + x.Value[2] * 10 + x.Value[0] }).OrderByDescending(x => (double)x["score"]).Take(limit).ToArray();
            return new JObject { ["roads_with_vehicles"] = map.Count, ["active_vehicle_count"] = map.Sum(x => x.Value[0]), ["stopped_vehicle_count"] = map.Sum(x => x.Value[1]), ["stuck_vehicle_count"] = map.Sum(x => x.Value[2]), ["items"] = new JArray(rows), ["score_note"] = "vehicle_count + 2*stopped_count + 10*stuck_count" };
        }

        private JObject AnalyzeParking(JObject args, World world)
        {
            var em = world.EntityManager; int limit = ComponentInspector.Int(args, "limit", 50, 1, 500); var lanes = new List<JObject>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Game.Net.ParkingLane>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var p = em.GetComponentData<Game.Net.ParkingLane>(e); lanes.Add(new JObject { ["lane_id"] = EntityId(e), ["road_edge_id"] = OptionalEntity(m_Session, OwningRoad(em, e)), ["free_space_m"] = p.m_FreeSpace, ["parking_fee"] = p.m_ParkingFee, ["comfort_factor"] = p.m_ComfortFactor, ["taxi_availability"] = p.m_TaxiAvailability, ["taxi_fee"] = p.m_TaxiFee, ["flags"] = p.m_Flags.ToString() }); }
            int parkedCars; using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Vehicle>(), ComponentType.ReadOnly<ParkedCar>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) parkedCars = q.CalculateEntityCount();
            return new JObject { ["parking_lane_count"] = lanes.Count, ["parked_vehicle_count"] = parkedCars, ["total_reported_free_space_m"] = lanes.Sum(x => (double)x["free_space_m"]), ["items"] = new JArray(lanes.OrderBy(x => (double)x["free_space_m"]).Take(limit)) };
        }

        private JObject RequestVehicleReroute(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var e = ResolveVehicle(args, world); if (!em.HasComponent<PathOwner>(e)) throw new QueryException("VEHICLE_PATH_UNAVAILABLE", "The selected vehicle has no PathOwner."); var p = em.GetComponentData<PathOwner>(e); var before = p.m_State; p.m_State &= ~PathFlags.Failed; p.m_State |= PathFlags.Obsolete; em.SetComponentData(e, p); return new JObject { ["vehicle_id"] = EntityId(e), ["path_state_before"] = before.ToString(), ["path_state"] = p.m_State.ToString(), ["reroute_requested"] = true };
        }

        private JObject SetVehicleTarget(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var e = ResolveVehicle(args, world); var target = ParseEntity((string)args["target_id"], em); if (!em.HasComponent<PathOwner>(e) || !em.HasComponent<Target>(e)) throw new QueryException("VEHICLE_TARGET_UNAVAILABLE", "The vehicle must have Target and PathOwner components."); var p = em.GetComponentData<PathOwner>(e); var t = em.GetComponentData<Target>(e); var before = t.m_Target; VehicleUtils.SetTarget(ref p, ref t, target); em.SetComponentData(e, p); em.SetComponentData(e, t); return new JObject { ["vehicle_id"] = EntityId(e), ["target_before_id"] = OptionalEntity(m_Session, before), ["target_id"] = EntityId(target), ["reroute_requested"] = true };
        }

        private JObject SetVehicleBehavior(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var e = ResolveVehicle(args, world); if (args["max_speed_mps"] == null && args["prefer_public_transport_lanes"] == null && args["use_public_transport_lanes"] == null && args["clear_velocity"] == null) throw new QueryException("INVALID_ARGUMENT", "Provide at least one vehicle behavior field."); var before = VehicleJson(e, world, false);
            bool wantsSpeed = args["max_speed_mps"] != null, wantsLaneFlags = args["prefer_public_transport_lanes"] != null || args["use_public_transport_lanes"] != null;
            if (wantsSpeed && !em.HasComponent<CarNavigation>(e) && !em.HasComponent<WatercraftNavigation>(e) && !em.HasComponent<AircraftNavigation>(e)) throw new QueryException("VEHICLE_SPEED_CONTROL_UNAVAILABLE", "Active car, watercraft, and aircraft navigation expose a writable maximum speed. TrainNavigation exposes current speed rather than a stable maximum and is left to the simulation.");
            if (wantsLaneFlags && !em.HasComponent<Car>(e)) throw new QueryException("VEHICLE_LANE_BEHAVIOR_UNAVAILABLE", "Lane preference flags apply to cars.");
            if (wantsSpeed) { float speed = (float)args["max_speed_mps"]; if (em.HasComponent<CarNavigation>(e)) { var n = em.GetComponentData<CarNavigation>(e); n.m_MaxSpeed = speed; em.SetComponentData(e, n); } else if (em.HasComponent<WatercraftNavigation>(e)) { var n = em.GetComponentData<WatercraftNavigation>(e); n.m_MaxSpeed = speed; em.SetComponentData(e, n); } else { var n = em.GetComponentData<AircraftNavigation>(e); n.m_MaxSpeed = speed; em.SetComponentData(e, n); } }
            if (args["prefer_public_transport_lanes"] != null || args["use_public_transport_lanes"] != null) { if (!em.HasComponent<Car>(e)) throw new QueryException("VEHICLE_LANE_BEHAVIOR_UNAVAILABLE", "Lane preference flags apply to cars."); var c = em.GetComponentData<Car>(e); if (args["prefer_public_transport_lanes"] != null) c.m_Flags = (bool)args["prefer_public_transport_lanes"] ? c.m_Flags | CarFlags.PreferPublicTransportLanes : c.m_Flags & ~CarFlags.PreferPublicTransportLanes; if (args["use_public_transport_lanes"] != null) c.m_Flags = (bool)args["use_public_transport_lanes"] ? c.m_Flags | CarFlags.UsePublicTransportLanes : c.m_Flags & ~CarFlags.UsePublicTransportLanes; em.SetComponentData(e, c); }
            if ((bool?)args["clear_velocity"] == true && em.HasComponent<Moving>(e)) { var m = em.GetComponentData<Moving>(e); m.m_Velocity = float3.zero; m.m_AngularVelocity = float3.zero; em.SetComponentData(e, m); }
            return new JObject { ["vehicle_id"] = EntityId(e), ["before"] = before, ["after"] = VehicleJson(e, world, false), ["simulation_may_recalculate_navigation_speed"] = true };
        }

        private int DeleteVehicleGroup(Entity e, EntityManager em)
        {
            var targets = new HashSet<Entity>(); if (em.HasComponent<Controller>(e)) { var c = em.GetComponentData<Controller>(e).m_Controller; if (c != Entity.Null && em.Exists(c)) e = c; } targets.Add(e); if (em.HasBuffer<LayoutElement>(e)) { var b = em.GetBuffer<LayoutElement>(e, true); for (int i = 0; i < b.Length; i++) if (em.Exists(b[i].m_Vehicle)) targets.Add(b[i].m_Vehicle); } foreach (var x in targets) if (!em.HasComponent<Deleted>(x)) em.AddComponent<Deleted>(x); return targets.Count;
        }

        private JObject RemoveVehicle(JObject args, World world) { RequirePaused(world); var e = ResolveVehicle(args, world); int count = DeleteVehicleGroup(e, world.EntityManager); return new JObject { ["vehicle_id"] = EntityId(e), ["deleted_vehicle_entities"] = count, ["cleanup_queued"] = true }; }

        private JObject RequestTravelerReroute(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var e = ResolveTraveler(args, world); if (!em.HasComponent<PathOwner>(e)) throw new QueryException("TRAVELER_PATH_UNAVAILABLE", "The selected traveler has no PathOwner."); var p = em.GetComponentData<PathOwner>(e); var before = p.m_State; p.m_State &= ~PathFlags.Failed; p.m_State |= PathFlags.Obsolete; em.SetComponentData(e, p); return new JObject { ["traveler_id"] = EntityId(e), ["path_state_before"] = before.ToString(), ["path_state"] = p.m_State.ToString(), ["reroute_requested"] = true };
        }

        private JObject SetTravelerTarget(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var e = ResolveTraveler(args, world); var destination = ParseEntity((string)args["target_id"], em); if (!em.HasComponent<Target>(e) || !em.HasComponent<PathOwner>(e)) throw new QueryException("TRAVELER_TARGET_UNAVAILABLE", "The traveler must have Target and PathOwner."); var t = em.GetComponentData<Target>(e); var before = t.m_Target; t.m_Target = destination; var p = em.GetComponentData<PathOwner>(e); p.m_State &= ~PathFlags.Failed; p.m_State |= PathFlags.Obsolete; em.SetComponentData(e, t); em.SetComponentData(e, p); return new JObject { ["traveler_id"] = EntityId(e), ["target_before_id"] = OptionalEntity(m_Session, before), ["target_id"] = EntityId(destination), ["reroute_requested"] = true };
        }

        private JObject SetTravelerSpeed(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var e = ResolveTraveler(args, world); float value = (float)args["max_speed_mps"]; if (!em.HasComponent<HumanNavigation>(e)) throw new QueryException("TRAVELER_SPEED_CONTROL_UNAVAILABLE", "The traveler has no HumanNavigation component."); var n = em.GetComponentData<HumanNavigation>(e); float before = n.m_MaxSpeed; n.m_MaxSpeed = value; em.SetComponentData(e, n); return new JObject { ["traveler_id"] = EntityId(e), ["max_speed_before_mps"] = before, ["max_speed_mps"] = value, ["simulation_may_recalculate"] = true };
        }

        private JObject RequestCitizenTrip(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var citizen = ParseEntity((string)args["citizen_id"], em); var target = ParseEntity((string)args["target_id"], em); if (!em.HasComponent<Citizen>(citizen) || !em.HasBuffer<TripNeeded>(citizen)) throw new QueryException("CITIZEN_TRIP_UNAVAILABLE", "citizen_id must identify a citizen with a TripNeeded buffer."); Purpose purpose; if (!Enum.TryParse((string)args["purpose"] ?? "Traveling", true, out purpose) || purpose == Purpose.None || purpose == Purpose.Count) throw new QueryException("INVALID_TRIP_PURPOSE", "Use a named citizen Purpose other than None or Count."); Resource resource = Resource.NoResource; string resourceText = ((string)args["resource"] ?? "").Trim(); if (resourceText.Length > 0 && !Enum.TryParse(resourceText, true, out resource)) throw new QueryException("INVALID_RESOURCE", "Use an exact resource name."); var b = em.GetBuffer<TripNeeded>(citizen); b.Add(new TripNeeded { m_TargetAgent = target, m_Purpose = purpose, m_Data = ComponentInspector.Int(args, "data", 0, int.MinValue, int.MaxValue), m_Resource = resource, m_Priority = (byte)ComponentInspector.Int(args, "priority", 128, 0, 255) }); return new JObject { ["citizen_id"] = EntityId(citizen), ["target_id"] = EntityId(target), ["purpose"] = purpose.ToString(), ["queued_count"] = b.Length, ["native_trip_queued"] = true, ["vehicle_mode_selected_by_game"] = true };
        }

        private JObject CancelCitizenTrips(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var citizen = ParseEntity((string)args["citizen_id"], em); if (!em.HasComponent<Citizen>(citizen) || !em.HasBuffer<TripNeeded>(citizen)) throw new QueryException("CITIZEN_TRIP_UNAVAILABLE", "citizen_id must identify a citizen with a TripNeeded buffer."); string purposeText = ((string)args["purpose"] ?? "").Trim(); Purpose purpose = Purpose.None; if (purposeText.Length > 0 && !Enum.TryParse(purposeText, true, out purpose)) throw new QueryException("INVALID_TRIP_PURPOSE", "Use an exact Purpose name."); var b = em.GetBuffer<TripNeeded>(citizen); int removed = 0; for (int i = b.Length - 1; i >= 0; i--) if (purposeText.Length == 0 || b[i].m_Purpose == purpose) { b.RemoveAt(i); removed++; } return new JObject { ["citizen_id"] = EntityId(citizen), ["removed"] = removed, ["remaining"] = b.Length, ["active_trip_unchanged"] = true };
        }

        private JObject ManageTraffic(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; string action = ((string)args["action"] ?? "reroute_stuck").ToLowerInvariant(); int limit = ComponentInspector.Int(args, "limit", 100, 1, 5000), matched = 0, changed = 0; var ids = new JArray();
            if (action != "reroute_stuck" && action != "remove_stuck" && action != "remove_parked") throw new QueryException("INVALID_ARGUMENT", "action must be reroute_stuck, remove_stuck, or remove_parked.");
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Vehicle>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>(), ComponentType.ReadOnly<Game.Prefabs.PrefabData>() } })) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
            {
                bool match = action == "remove_parked" ? em.HasComponent<ParkedCar>(e) || em.HasComponent<ParkedTrain>(e) : VehicleStuck(em, e); if (!match) continue; matched++; if (changed >= limit) continue;
                if (action == "reroute_stuck") { if (!em.HasComponent<PathOwner>(e)) continue; var p = em.GetComponentData<PathOwner>(e); p.m_State &= ~(PathFlags.Failed | PathFlags.Stuck); p.m_State |= PathFlags.Obsolete; em.SetComponentData(e, p); }
                else if (action == "remove_stuck" || action == "remove_parked") DeleteVehicleGroup(e, em); else throw new QueryException("INVALID_ARGUMENT", "action must be reroute_stuck, remove_stuck, or remove_parked."); changed++; if (ids.Count < 100) ids.Add(EntityId(e));
            }
            return new JObject { ["action"] = action, ["matched"] = matched, ["changed"] = changed, ["limit"] = limit, ["vehicle_ids"] = ids, ["ids_truncated"] = changed > ids.Count };
        }
    }
}
