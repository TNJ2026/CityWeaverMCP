using System;
using System.Linq;
using Game.Common;
using Game.Prefabs;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private JObject GetPassengerHelicopterStatus(JObject args, World world)
        {
            var system = OptionalHelicopterRuntime.System(world,"PassengerHelicopterSystem");
            var ps = world.GetExistingSystemManaged<PrefabSystem>();
            var em = world.EntityManager;
            var assets = new JArray(); bool ready = (string)OptionalHelicopterRuntime.Read(system,"State") == "registered";
            foreach (var p in OptionalHelicopterRuntime.Read(system,"Registered") as System.Collections.Generic.IEnumerable<PrefabBase> ?? Enumerable.Empty<PrefabBase>())
            {
                bool exists = ps.TryGetEntity(p, out var entity) && em.Exists(entity);
                bool initialized = exists && !em.HasComponent<Created>(entity);
                ready &= initialized;
                var row = new JObject { ["prefab"] = p.name, ["type"] = p.GetType().Name, ["initialized"] = initialized };
                if (exists && em.HasComponent<BuildingData>(entity))
                {
                    var b = em.GetComponentData<BuildingData>(entity);
                    bool road = (b.m_Flags & BuildingFlags.RequireRoad) != 0;
                    row["requires_road"] = road; ready &= road;
                    row["lot_cells"] = new JObject { ["width"] = b.m_LotSize.x, ["depth"] = b.m_LotSize.y };
                }
                if (exists && em.HasComponent<PublicTransportVehicleData>(entity))
                    row["passenger_capacity"] = em.GetComponentData<PublicTransportVehicleData>(entity).m_PassengerCapacity;
                if (exists && em.HasComponent<HelicopterData>(entity))
                    row["flying_max_speed_kph"] = em.GetComponentData<HelicopterData>(entity).m_FlyingMaxSpeed * 3.6f;
                assets.Add(row);
            }
            return new JObject
            {
                ["state"] = OptionalHelicopterRuntime.Value(system,"State","not_registered"), ["error"] = OptionalHelicopterRuntime.Value(system,"Error"),
                ["ready"] = ready, ["transport_type"] = "Helicopter", ["assets"] = assets,
                ["external_mod_required"] = true,
                ["required_mod"] = "PassengerHelicopters",
                ["standalone_runtime_loaded"] = OptionalHelicopterRuntime.Loaded,
                ["route_previews"] = ReadHelicopterRoutePreviews(world),
                ["airway_connection_repairs"] = OptionalHelicopterRuntime.SystemValue(world,"HelipadAirwayConnectionSystem","RepairsApplied",0),
                ["imported_model_state"] = OptionalHelicopterRuntime.SystemValue(world,"HelicopterModels.Mi26ModelSystem","State"),
                ["imported_model_error"] = OptionalHelicopterRuntime.SystemValue(world,"HelicopterModels.Mi26ModelSystem","Error"),
                ["airport_admission"] = new JObject
                {
                    ["active_airports"] = OptionalHelicopterRuntime.SystemValue(world,"PassengerHelicopterAirportSystem","ActiveAirports",0),
                    ["held_approaches"] = OptionalHelicopterRuntime.SystemValue(world,"PassengerHelicopterAirportSystem","HeldApproaches",0),
                    ["scope"] = "Incoming CityWeaver helicopters only; outgoing and existing ground occupants drain normally. Counters describe the last simulation update."
                },
                ["line_safety"] = new JObject
                {
                    ["invalid_lines"] = OptionalHelicopterRuntime.SystemValue(world,"PassengerHelicopterLineSafetySystem","InvalidLines",0),
                    ["stop_requests"] = OptionalHelicopterRuntime.SystemValue(world,"PassengerHelicopterLineSafetySystem","StopRequests",0),
                    ["grace_frames"] = OptionalHelicopterRuntime.GraceFrames,
                    ["behavior"] = "CityWeaver routes with persistent missing stops are stopped through the native policy. Repair stops and explicitly reactivate; no automatic resume. Counters describe the last update."
                },
                ["hangar_doors"] = OptionalHelicopterRuntime.Invoke(OptionalHelicopterRuntime.System(world,"PassengerHelicopterHangarSystem"),"Status") as JArray ?? new JArray(),
                ["model_origin"] = "Passenger Helicopters standalone runtime: imported airport, helipad and Mil Mi-26TC",
                ["airport_prefab"] = OptionalHelicopterRuntime.Airport,
                ["station_prefab"] = OptionalHelicopterRuntime.Station,
                ["line_prefab"] = OptionalHelicopterRuntime.Line,
                ["vehicle_prefab"] = OptionalHelicopterRuntime.Vehicle,
                ["facilities"] = new JArray(((JArray)ListTransportFacilities(new JObject(), world)["items"])
                    .Where(x => IsPassengerHelicopterAirport(FacilityPrefab(x,world)))),
                ["lines"] = new JArray(((JArray)ListTransportLines(new JObject(), world)["items"])
                    .Where(x => (string)x["prefab"] == OptionalHelicopterRuntime.Line)),
                ["workflow"] = "Place roadside airports using plan_transport_facility_site / preview_transport_facility_placement. At least one airport depot is required. List Helicopter stops, then preview_passenger_helicopter_line; poll/apply with the transport line operation tools. Save normally."
            };
        }

        internal static bool IsPassengerHelicopterAirport(string name) =>
            name == OptionalHelicopterRuntime.Airport || name == OptionalHelicopterRuntime.Station || name == OptionalHelicopterRuntime.ImportedStation;

        private static bool IsPassengerHelicopterAirport(PrefabBase p)
        {
            if(p==null)return false;
            if(IsPassengerHelicopterAirport(p.name))return true;
            return p is BuildingPrefab && OptionalHelicopterRuntime.HasComponent(p,"CityWeaver.ImportedPassengerHeliport")
                && p.asset!=null && AssetImportPolicy.OwnedModel(p.name,p.asset.subPath);
        }

        private PrefabBase FacilityPrefab(JToken row,World world)
        {
            // Imported PrefabIDs include an asset hash. Use the actual entity reference,
            // never reconstruct a hashless ID from its display name.
            var e=ResolveTransportFacility(new JObject{["facility_id"]=row["facility_id"]},world);
            return world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(
                world.EntityManager.GetComponentData<PrefabRef>(e),out var p)?p:null;
        }

        private JObject PreviewPassengerHelicopterLine(JObject args, World world)
        {
            if(!OptionalHelicopterRuntime.Loaded)throw new QueryException("HELICOPTER_MOD_REQUIRED","Enable the Passenger Helicopters mod before creating helicopter lines.");
            if (!(args["stop_ids"] is JArray ids) || ids.Count < 2 || ids.Count > 64)
                throw new QueryException("INVALID_ARGUMENT", "Provide 2..64 CityWeaver helicopter stop IDs.");
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            var airports = new System.Collections.Generic.List<Entity>();
            var roads = new System.Collections.Generic.List<bool>();
            foreach (var token in ids)
            {
                var s = ResolveStopToken((string)token, world);
                if (!em.HasComponent<PrefabRef>(s) || !ps.TryGetPrefab<PrefabBase>(em.GetComponentData<PrefabRef>(s), out var p) || p.name != OptionalHelicopterRuntime.Stop)
                    throw new QueryException("INCOMPATIBLE_TRANSPORT_STOP", "Use CityWeaver helicopter airport stops; reference-mod stops are not independent.");
                var owner = s;
                for (int depth = 0; depth < 16 && em.HasComponent<Owner>(owner); depth++)
                    owner = em.GetComponentData<Owner>(owner).m_Owner;
                if (!em.HasComponent<PrefabRef>(owner) || !ps.TryGetPrefab<PrefabBase>(em.GetComponentData<PrefabRef>(owner), out var airport) || !IsPassengerHelicopterAirport(airport))
                    throw new QueryException("INCOMPATIBLE_TRANSPORT_STOP", "Stop must belong to a CityWeaver airport.");
                airports.Add(owner);
                roads.Add(em.HasComponent<Game.Buildings.Building>(owner) && em.GetComponentData<Game.Buildings.Building>(owner).m_RoadEdge != Entity.Null);
            }
            var facilities = (JArray)ListTransportFacilities(new JObject(), world)["items"];
            bool depot = facilities.Any(x => {
                var facility=FacilityPrefab(x,world);
                return IsPassengerHelicopterAirport(facility) && facility.GetComponent<Game.Prefabs.TransportDepot>()!=null
                    && (bool)x["active"] && x["road_edge_id"]?.Type == JTokenType.String;
            });
            string error = OptionalHelicopterRuntime.ValidateAirports(airports, roads, depot);
            if (error != null) throw new QueryException(error, "Connect at least two distinct roadside airports and provide an active road-connected CityWeaver airport depot.");
            var request = (JObject)args.DeepClone(); request["line_prefab"] = OptionalHelicopterRuntime.Line;
            return PreviewTransportLine(request, world, "create").Json();
        }
    }

}
