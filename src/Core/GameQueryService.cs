using System;
using System.Collections.Generic;
using System.Linq;
using Game;
using Game.Buildings;
using Game.City;
using Game.Common;
using Game.Prefabs;
using Game.SceneFlow;
using Game.Simulation;
using Game.Tools;
using Game.UI;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CitiesSkylines2Mod
{
    public sealed class QueryException : Exception
    {
        public string Code { get; }
        public QueryException(string code, string message) : base(message) { Code = code; }
    }

    // All methods, including lifecycle notifications, run on the game main thread.
    public sealed partial class GameQueryService : IDisposable
    {
        private sealed class Snapshot
        {
            public string Id = Guid.NewGuid().ToString("N");
            public string Type;
            public Entity[] Entities;
            public DateTime Created = DateTime.UtcNow;
        }
        private string m_Session = Guid.NewGuid().ToString("N");
        private bool m_Loaded;
        private readonly Dictionary<string, Snapshot> m_Snapshots = new Dictionary<string, Snapshot>();
        private readonly GameManager.EventGamePreload m_Preload;
        private readonly GameManager.EventGamePreload m_LoadComplete;

        public GameQueryService()
        {
            m_Preload = (purpose, mode) => { ResetRoadOperations(); ResetTerrainOperations(); ResetBuildingOperations(); ResetBuildingAreaOperations(); ResetZoningOperations(); ResetDistrictOperations(); ResetTransportOperations(); ResetEconomyOperations(); ResetMapTileOperations(); ResetDisasterOperations(); m_Loaded = false; m_Session = Guid.NewGuid().ToString("N"); m_Snapshots.Clear(); };
            m_LoadComplete = (purpose, mode) => { m_Loaded = mode == GameMode.Game; };
            GameManager.instance.onGamePreload += m_Preload;
            GameManager.instance.onGameLoadingComplete += m_LoadComplete;
            m_Loaded = GameManager.instance.gameMode == GameMode.Game && !GameManager.instance.isGameLoading;
        }

        public JObject Execute(JObject request)
        {
            var tool = (string)request["tool"];
            var args = request["arguments"] as JObject ?? new JObject();
            if (tool == "get_query_capabilities") return Wrap(Capabilities());
            if (tool == "get_game_status") return Wrap(Status());
            if (tool == "list_component_types") return Wrap(Inspector.Catalog(args));
            if (tool == "get_component_schema") return Wrap(Inspector.Schema((string)args["component"]));
            if (!IsReady()) throw new QueryException("CITY_NOT_READY", "Load a playable city and wait for loading to finish.");
            var world = World.DefaultGameObjectInjectionWorld;
            var em = world.EntityManager;
            if (tool == "get_entity_components" || tool == "query_entities" || tool == "find_roads_by_name" || tool == "get_city_data" || tool == "inspect_road_zoning" || tool == "analyze_zoning_cells") SyncReads(world);
            switch (tool)
            {
                case "list_road_prefabs": return Wrap(ListRoadPrefabs(args, world));
                case "find_roads_by_name": return Wrap(FindRoadsByName(args, world, em));
                case "inspect_road_lanes": return Wrap(InspectRoadLanes(args, world));
                case "analyze_road_traffic": return Wrap(AnalyzeRoadTraffic(args, world));
                case "set_simulation_speed": return Wrap(SetSimulationSpeed(args, world));
                case "inspect_road_zoning": return Wrap(InspectRoadZoning(args, world));
                case "preview_road": return Wrap(PreviewRoad(args, world));
                case "preview_road_route": return Wrap(PreviewRoadRoute(args, world));
                case "preview_road_ring": return Wrap(PreviewRoadRing(args, world));
                case "preview_road_grid": return Wrap(PreviewRoadGrid(args, world));
                case "preview_road_parallel": return Wrap(PreviewRoadParallel(args, world));
                case "preview_road_interchange": return Wrap(PreviewRoadInterchange(args, world));
                case "preview_road_autoroute": return Wrap(PreviewRoadAutoroute(args, world));
                case "preview_road_reverse": return Wrap(PreviewRoadReverse(args, world));
                case "preview_road_batch_reverse": return Wrap(PreviewRoadReverse(args, world, true));
                case "preview_road_upgrade": return Wrap(PreviewRoadUpgrade(args, world));
                case "preview_road_demolition": return Wrap(PreviewRoadDemolition(args, world));
                case "preview_road_batch_upgrade": return Wrap(PreviewRoadBatchUpgrade(args, world));
                case "preview_road_batch_demolition": return Wrap(PreviewRoadBatchDemolition(args, world));
                case "preview_road_elevation": return Wrap(PreviewRoadElevation(args, world));
                case "preview_road_zoning": return Wrap(PreviewRoadZoning(args, world));
                case "preview_road_features": return Wrap(PreviewRoadFeatures(args, world));
                case "preview_road_parking": return Wrap(PreviewRoadParking(args, world));
                case "preview_intersection_control": return Wrap(PreviewIntersectionControl(args, world));
                case "preview_intersection_roundabout": return Wrap(PreviewIntersectionRoundabout(args, world));
                case "preview_intersection_rules": return Wrap(PreviewIntersectionRules(args, world));
                case "preview_road_policies": return Wrap(PreviewRoadPolicies(args, world));
                case "preview_road_undo": return Wrap(PreviewRoadUndo(args, world));
                case "get_road_operation": return Wrap(RoadOperationById(args).Json());
                case "build_road": return Wrap(CommitRoad(args));
                case "cancel_road_preview": return Wrap(CancelRoad(args));
                case "sample_terrain": return Wrap(SampleTerrain(args, world));
                case "preview_terrain": return Wrap(PreviewTerrain(args, world));
                case "get_terrain_operation": return Wrap(TerrainOperationById(args).Json());
                case "apply_terrain": return Wrap(ApplyTerrain(args, world));
                case "cancel_terrain_preview": return Wrap(CancelTerrain(args));
                case "list_landscape_prefabs": return Wrap(ListLandscapePrefabs(args, world));
                case "list_landscape_objects": return Wrap(ListLandscapeObjects(args, world));
                case "get_landscape_object": return Wrap(LandscapeRow(ResolveLandscapeObject(args, world), world));
                case "analyze_landscape_area": return Wrap(AnalyzeLandscapeArea(args, world));
                case "place_landscape_objects": return Wrap(PlaceLandscapeObjects(args, world));
                case "plant_landscape_pattern": return Wrap(PlantLandscapePattern(args, world));
                case "move_landscape_object": return Wrap(MoveLandscapeObject(args, world));
                case "set_tree_state": return Wrap(SetTreeState(args, world));
                case "remove_landscape_objects": return Wrap(RemoveLandscapeObjects(args, world));
                case "clear_landscape_area": return Wrap(ClearLandscapeArea(args, world));
                case "list_water_sources": return Wrap(ListWaterSources(args, world));
                case "create_water_source": return Wrap(CreateWaterSource(args, world));
                case "update_water_source": return Wrap(UpdateWaterSource(args, world));
                case "delete_water_source": return Wrap(DeleteWaterSource(args, world));
                case "sample_pollution": return Wrap(SamplePollution(args, world));
                case "set_pollution_area": return Wrap(SetPollutionArea(args, world));
                case "get_climate_state": return Wrap(GetClimateState(args, world));
                case "set_weather_override": return Wrap(SetWeatherOverride(args, world));
                case "set_wind": return Wrap(SetWind(args, world));
                case "sample_wind": return Wrap(SampleWind(args, world));
                case "sample_soil_water": return Wrap(SampleSoilWater(args, world));
                case "read_surface_water_mask": return Wrap(ReadSurfaceWaterMask(args, world));
                case "list_disaster_prefabs": return Wrap(ListDisasterPrefabs(args, world));
                case "get_disaster_prefab": return Wrap(GetDisasterPrefab(args, world));
                case "list_active_disasters": return Wrap(ListActiveDisasters(args, world));
                case "get_active_disaster": return Wrap(GetActiveDisaster(args, world));
                case "get_disaster_readiness": return Wrap(GetDisasterReadiness(world));
                case "get_disaster_impacts": return Wrap(GetDisasterImpacts(args, world));
                case "preview_disaster": return Wrap(PreviewDisaster(args, world).Json(EntityId));
                case "get_disaster_operation": return Wrap(DisasterOperationById(args).Json(EntityId));
                case "apply_disaster_operation": return Wrap(ApplyDisasterOperation(args, world));
                case "cancel_disaster_preview": return Wrap(CancelDisasterPreview(args));
                case "update_disaster": return Wrap(UpdateDisaster(args, world));
                case "stop_disaster": return Wrap(StopDisaster(args, world));
                case "clear_disaster_effects": return Wrap(ClearDisasterEffects(args, world));
                case "list_building_prefabs": return Wrap(ListBuildingPrefabs(args, world));
                case "list_building_upgrades": return Wrap(ListBuildingUpgrades(args, world));
                case "get_building_state": return Wrap(GetBuildingState(args, world));
                case "set_building_name": return Wrap(SetBuildingName(args, world));
                case "set_building_active": return Wrap(SetBuildingActive(args, world));
                case "list_building_policies": return Wrap(ListBuildingPolicies(args, world));
                case "set_building_policy": return Wrap(SetBuildingPolicy(args, world));
                case "plan_building_site": return Wrap(PlanBuildingSite(args, world));
                case "plan_building_row": return Wrap(PlanBuildingRow(args, world));
                case "plan_special_building_site": return Wrap(PlanSpecialBuildingSite(args, world));
                case "preview_building_placement": return Wrap(PreviewBuildingOperation(args, world, "place").Json());
                case "preview_special_building_placement": return Wrap(PreviewBuildingOperation(args, world, "place").Json());
                case "preview_building_batch_placement": return Wrap(PreviewBuildingBatchPlacement(args, world).Json());
                case "preview_building_move": return Wrap(PreviewBuildingOperation(args, world, "move").Json());
                case "preview_building_replacement": return Wrap(PreviewBuildingOperation(args, world, "replace").Json());
                case "preview_building_upgrade": return Wrap(PreviewBuildingOperation(args, world, "upgrade").Json());
                case "preview_building_rebuild": return Wrap(PreviewBuildingOperation(args, world, "rebuild").Json());
                case "preview_building_demolition": return Wrap(PreviewBuildingOperation(args, world, "demolish").Json());
                case "preview_building_upgrade_removal": return Wrap(PreviewBuildingOperation(args, world, "remove_upgrade").Json());
                case "get_building_operation": return Wrap(BuildingOperationById(args).Json());
                case "apply_building_operation": return Wrap(ApplyBuildingOperation(args, world));
                case "cancel_building_preview": return Wrap(CancelBuildingOperation(args));
                case "list_building_areas": return Wrap(ListBuildingAreas(args, world));
                case "preview_building_area": return Wrap(PreviewBuildingArea(args, world).Json());
                case "get_building_area_operation": return Wrap(GetBuildingAreaOperation(args));
                case "apply_building_area_operation": return Wrap(ApplyBuildingAreaOperation(args, world));
                case "cancel_building_area_preview": return Wrap(CancelBuildingAreaPreview(args));
                case "list_zone_types": return Wrap(ListZoneTypes(args, world));
                case "analyze_zoning_cells": return Wrap(AnalyzeZoningCells(args, world));
                case "preview_zoning": return Wrap(PreviewZoning(args, world).Json());
                case "get_zoning_operation": return Wrap(ZoningOperationById(args).Json());
                case "apply_zoning": return Wrap(ApplyZoning(args, world));
                case "cancel_zoning_preview": return Wrap(CancelZoning(args));
                case "list_districts": return Wrap(ListDistricts(args, world));
                case "get_district": return Wrap(GetDistrict(args, world));
                case "find_district_at": return Wrap(FindDistrictAt(args, world));
                case "get_district_coverage": return Wrap(GetDistrictCoverage(args, world));
                case "preview_district_create": return Wrap(PreviewDistrict(args, world, "create").Json());
                case "preview_district_boundary": return Wrap(PreviewDistrict(args, world, "boundary").Json());
                case "preview_district_delete": return Wrap(PreviewDistrict(args, world, "delete").Json());
                case "get_district_operation": return Wrap(GetDistrictOperation(args, world));
                case "apply_district_operation": return Wrap(ApplyDistrict(args, world));
                case "cancel_district_preview": return Wrap(CancelDistrict(args));
                case "set_district_name": return Wrap(SetDistrictName(args, world));
                case "list_district_policies": return Wrap(ListDistrictPolicies(args, world));
                case "set_district_policy": return Wrap(SetDistrictPolicy(args, world));
                case "get_service_districts": return Wrap(GetServiceDistricts(args, world));
                case "set_service_districts": return Wrap(SetServiceDistricts(args, world));
                case "list_transport_line_prefabs": return Wrap(ListTransportLinePrefabs(args, world));
                case "list_transport_stops": return Wrap(ListTransportStops(args, world));
                case "list_transport_lines": return Wrap(ListTransportLines(args, world));
                case "get_transport_line": return Wrap(GetTransportLine(args, world));
                case "preview_transport_line": return Wrap(PreviewTransportLine(args, world, "create").Json());
                case "preview_transport_line_stops": return Wrap(PreviewTransportLine(args, world, "stops").Json());
                case "preview_transport_line_delete": return Wrap(PreviewTransportLine(args, world, "delete").Json());
                case "get_transport_line_operation": return Wrap(GetTransportOperation(args, world));
                case "apply_transport_line_operation": return Wrap(ApplyTransportOperation(args, world));
                case "cancel_transport_line_preview": return Wrap(CancelTransportOperation(args));
                case "set_transport_line_name": return Wrap(SetTransportLineName(args, world));
                case "set_transport_line_active": return Wrap(SetTransportLineActive(args, world));
                case "set_transport_line_color": return Wrap(SetTransportLineColor(args, world));
                case "set_transport_line_schedule": return Wrap(SetTransportLineSchedule(args, world));
                case "set_transport_line_ticket_price": return Wrap(SetTransportLineTicketPrice(args, world));
                case "set_transport_line_vehicle_count": return Wrap(SetTransportLineVehicleCount(args, world));
                case "set_transport_line_number": return Wrap(SetTransportLineNumber(args, world));
                case "set_transport_line_unbunching": return Wrap(SetTransportLineUnbunching(args, world));
                case "set_transport_stop_name": return Wrap(SetTransportStopName(args, world));
                case "list_transport_vehicle_requests": return Wrap(ListTransportVehicleRequests(args, world));
                case "request_transport_line_vehicle": return Wrap(RequestTransportLineVehicle(args, world));
                case "cancel_transport_line_vehicle_requests": return Wrap(CancelTransportLineVehicleRequests(args, world));
                case "release_transport_line_vehicle": return Wrap(ReleaseTransportLineVehicle(args, world));
                case "list_transport_line_policies": return Wrap(ListTransportLinePolicies(args, world));
                case "set_transport_line_policy": return Wrap(SetTransportLinePolicy(args, world));
                case "list_transport_facility_prefabs": return Wrap(ListTransportFacilityPrefabs(args, world));
                case "list_transport_facilities": return Wrap(ListTransportFacilities(args, world));
                case "get_transport_facility": return Wrap(GetTransportFacility(args, world));
                case "list_transport_facility_upgrades": return Wrap(ListTransportFacilityUpgrades(args, world));
                case "set_transport_facility_name": return Wrap(SetTransportFacilityName(args, world));
                case "set_transport_facility_active": return Wrap(SetTransportFacilityActive(args, world));
                case "list_transport_facility_policies": return Wrap(ListTransportFacilityPolicies(args, world));
                case "set_transport_facility_policy": return Wrap(SetTransportFacilityPolicy(args, world));
                case "plan_transport_facility_site": return Wrap(PlanTransportFacilitySite(args, world));
                case "preview_transport_facility_placement": return Wrap(PreviewTransportFacility(args, world, "place"));
                case "preview_transport_facility_move": return Wrap(PreviewTransportFacility(args, world, "move"));
                case "preview_transport_facility_delete": return Wrap(PreviewTransportFacility(args, world, "demolish"));
                case "preview_transport_facility_upgrade": return Wrap(PreviewTransportFacilityUpgrade(args, world));
                case "preview_transport_facility_upgrade_removal": return Wrap(PreviewTransportFacilityUpgradeRemoval(args, world));
                case "get_transport_facility_operation": return Wrap(GetTransportFacilityOperation(args, world));
                case "apply_transport_facility_operation": return Wrap(ApplyTransportFacilityOperation(args, world));
                case "cancel_transport_facility_preview": return Wrap(CancelTransportFacilityOperation(args, world));
                case "list_transport_track_prefabs": return Wrap(ListTransportTrackPrefabs(args, world));
                case "list_transport_tracks": return Wrap(ListTransportTracks(args, world));
                case "get_transport_track": return Wrap(GetTransportTrack(args, world));
                case "preview_transport_track": return Wrap(PreviewTransportTrack(args, world));
                case "preview_transport_track_delete": return Wrap(PreviewTransportTrackDelete(args, world));
                case "get_transport_track_operation": return Wrap(GetTransportTrackOperation(args));
                case "apply_transport_track_operation": return Wrap(ApplyTransportTrackOperation(args));
                case "cancel_transport_track_preview": return Wrap(CancelTransportTrackOperation(args));
                case "list_utility_facility_prefabs": return Wrap(ListUtilityFacilityPrefabs(args, world));
                case "list_utility_facilities": return Wrap(ListUtilityFacilities(args, world));
                case "get_utility_facility": return Wrap(GetUtilityFacility(args, world));
                case "plan_utility_facility_site": return Wrap(PlanUtilityFacilitySite(args, world));
                case "preview_utility_facility_placement": return Wrap(PreviewUtilityFacility(args, world, "place"));
                case "preview_utility_facility_move": return Wrap(PreviewUtilityFacility(args, world, "move"));
                case "preview_utility_facility_delete": return Wrap(PreviewUtilityFacility(args, world, "demolish"));
                case "get_utility_facility_operation": return Wrap(GetUtilityFacilityOperation(args, world));
                case "apply_utility_facility_operation": return Wrap(ApplyUtilityFacilityOperation(args, world));
                case "cancel_utility_facility_preview": return Wrap(CancelUtilityFacilityOperation(args, world));
                case "list_utility_network_prefabs": return Wrap(ListUtilityNetworkPrefabs(args, world));
                case "list_utility_networks": return Wrap(ListUtilityNetworks(args, world));
                case "get_utility_network": return Wrap(GetUtilityNetwork(args, world));
                case "preview_utility_network": return Wrap(PreviewUtilityNetwork(args, world));
                case "preview_utility_network_upgrade": return Wrap(PreviewUtilityExisting(args, world, true));
                case "preview_utility_network_delete": return Wrap(PreviewUtilityExisting(args, world, false));
                case "get_utility_operation": return Wrap(GetUtilityOperation(args));
                case "apply_utility_operation": return Wrap(ApplyUtilityOperation(args));
                case "cancel_utility_preview": return Wrap(CancelUtilityOperation(args));
                case "list_city_service_prefabs": return Wrap(ListCityServicePrefabs(args, world));
                case "list_city_service_facilities": return Wrap(ListCityServiceFacilities(args, world));
                case "get_city_service_facility": return Wrap(GetCityServiceFacility(args, world));
                case "analyze_service_coverage": return Wrap(AnalyzeServiceCoverage(args, world));
                case "analyze_transport_catchment": return Wrap(AnalyzeTransportCatchment(args, world));
                case "analyze_education_demand": return Wrap(AnalyzeEducationDemand(args, world));
                case "analyze_attraction_impact": return Wrap(AnalyzeAttractionImpact(args, world));
                case "plan_city_service_site": return Wrap(PlanCityServiceSite(args, world));
                case "preview_city_service_placement": return Wrap(PreviewCityService(args, world, "place"));
                case "preview_city_service_move": return Wrap(PreviewCityService(args, world, "move"));
                case "preview_city_service_upgrade": return Wrap(PreviewCityService(args, world, "upgrade"));
                case "preview_city_service_upgrade_removal": return Wrap(PreviewCityService(args, world, "remove_upgrade"));
                case "preview_city_service_delete": return Wrap(PreviewCityService(args, world, "demolish"));
                case "get_city_service_operation": return Wrap(GetCityServiceOperation(args, world));
                case "apply_city_service_operation": return Wrap(ApplyCityServiceOperation(args, world));
                case "cancel_city_service_preview": return Wrap(CancelCityServiceOperation(args, world));
                case "get_city_economy": return Wrap(GetCityEconomy(world));
                case "get_tax_settings": return Wrap(GetTaxSettings(world));
                case "preview_tax_change": return Wrap(PreviewTaxChange(args, world));
                case "list_service_budgets": return Wrap(ListServiceBudgets(world));
                case "preview_service_budget": return Wrap(PreviewServiceBudget(args, world));
                case "list_service_fees": return Wrap(ListServiceFees(world));
                case "preview_service_fee": return Wrap(PreviewServiceFee(args, world));
                case "get_loan_status": return Wrap(GetLoanStatus(world));
                case "preview_loan_change": return Wrap(PreviewLoanChange(args, world));
                case "get_economy_operation": return Wrap(GetEconomyOperation(args, world));
                case "apply_economy_operation": return Wrap(ApplyEconomyOperation(args, world));
                case "cancel_economy_preview": return Wrap(CancelEconomyOperation(args));
                case "get_zone_demand": return Wrap(GetZoneDemand(world));
                case "get_resource_demand": return Wrap(GetResourceDemand(args, world));
                case "get_population_demographics": return Wrap(GetPopulationDemographics(world));
                case "get_housing_statistics": return Wrap(GetHousingStatistics(world));
                case "get_employment_statistics": return Wrap(GetEmploymentStatistics(world));
                case "get_education_statistics": return Wrap(GetEducationStatistics(world));
                case "set_unlimited_demand": return Wrap(SetUnlimitedDemand(args, world));
                case "get_city_progression": return Wrap(GetCityProgression(world));
                case "list_milestones": return Wrap(ListMilestones(world));
                case "list_development_tree": return Wrap(ListDevelopmentTree(args, world));
                case "get_unlock_summary": return Wrap(GetUnlockSummary(world));
                case "list_unlockable_prefabs": return Wrap(ListUnlockablePrefabs(args, world));
                case "set_experience_points": return Wrap(SetExperiencePoints(args, world));
                case "set_development_points": return Wrap(SetDevelopmentPoints(args, world));
                case "purchase_development_node": return Wrap(PurchaseDevelopmentNode(args, world));
                case "unlock_prefab": return Wrap(UnlockPrefab(args, world));
                case "unlock_all_progression": return Wrap(UnlockAllProgression(args, world));
                case "get_city_management_overview": return Wrap(GetCityManagementOverview(world));
                case "get_city_configuration": return Wrap(GetCityConfiguration(world));
                case "set_city_name": return Wrap(SetCityName(args, world));
                case "set_city_money": return Wrap(SetCityMoney(args, world));
                case "set_city_configuration": return Wrap(SetCityConfiguration(args, world));
                case "list_city_policies": return Wrap(ListCityPolicies(world));
                case "set_city_policy": return Wrap(SetCityPolicy(args, world));
                case "list_city_modifiers": return Wrap(ListCityModifiers(world));
                case "list_city_statistics": return Wrap(ListCityStatistics(args, world));
                case "get_city_statistic_history": return Wrap(GetCityStatisticHistory(args, world));
                case "list_citizens": return Wrap(ListCitizens(args, world));
                case "get_citizen": return Wrap(GetCitizen(args, world));
                case "list_households": return Wrap(ListHouseholds(args, world));
                case "get_household": return Wrap(GetHousehold(args, world));
                case "list_companies": return Wrap(ListCompanies(args, world));
                case "get_company": return Wrap(GetCompany(args, world));
                case "get_resource_economy": return Wrap(GetResourceEconomy(args, world));
                case "list_resource_holders": return Wrap(ListResourceHolders(args, world));
                case "set_citizen_attributes": return Wrap(SetCitizenAttributes(args, world));
                case "set_household_money": return Wrap(SetHouseholdMoney(args, world));
                case "set_company_profitability": return Wrap(SetCompanyProfitability(args, world));
                case "set_resource_amount": return Wrap(SetResourceAmount(args, world));
                case "list_citizen_prefabs": return Wrap(ListCitizenPrefabs(args, world));
                case "create_citizen": return Wrap(CreateCitizen(args, world));
                case "set_citizen_name": return Wrap(SetCitizenName(args, world));
                case "set_citizen_profile": return Wrap(SetCitizenProfile(args, world));
                case "set_citizen_household": return Wrap(SetCitizenHousehold(args, world));
                case "set_citizen_workplace": return Wrap(SetCitizenWorkplace(args, world));
                case "set_citizen_school": return Wrap(SetCitizenSchool(args, world));
                case "set_citizen_location": return Wrap(SetCitizenLocation(args, world));
                case "set_citizen_health_problem": return Wrap(SetCitizenHealthProblem(args, world));
                case "delete_citizen": return Wrap(DeleteCitizen(args, world));
                case "list_household_prefabs": return Wrap(ListHouseholdPrefabs(args, world));
                case "create_household": return Wrap(CreateHousehold(args, world));
                case "set_household_name": return Wrap(SetHouseholdName(args, world));
                case "set_household_profile": return Wrap(SetHouseholdProfile(args, world));
                case "set_household_housing": return Wrap(SetHouseholdHousing(args, world));
                case "set_household_need": return Wrap(SetHouseholdNeed(args, world));
                case "delete_household": return Wrap(DeleteHousehold(args, world));
                case "list_company_prefabs": return Wrap(ListCompanyPrefabs(args, world));
                case "create_company": return Wrap(CreateCompany(args, world));
                case "set_company_name": return Wrap(SetCompanyName(args, world));
                case "set_company_financials": return Wrap(SetCompanyFinancials(args, world));
                case "set_company_workforce": return Wrap(SetCompanyWorkforce(args, world));
                case "set_company_property": return Wrap(SetCompanyProperty(args, world));
                case "set_company_trade_cost": return Wrap(SetCompanyTradeCost(args, world));
                case "delete_company": return Wrap(DeleteCompany(args, world));
                case "list_vehicles": return Wrap(ListVehicles(args, world));
                case "get_vehicle": return Wrap(GetVehicle(args, world));
                case "get_vehicle_path": return Wrap(GetVehiclePath(args, world));
                case "list_travelers": return Wrap(ListTravelers(args, world));
                case "get_traveler": return Wrap(GetTraveler(args, world));
                case "get_traveler_path": return Wrap(GetTravelerPath(args, world));
                case "list_citizen_trips": return Wrap(ListCitizenTrips(args, world));
                case "inspect_lane_connections": return Wrap(InspectLaneConnections(args, world));
                case "analyze_traffic_flow": return Wrap(AnalyzeTrafficFlow(args, world));
                case "analyze_parking": return Wrap(AnalyzeParking(args, world));
                case "request_vehicle_reroute": return Wrap(RequestVehicleReroute(args, world));
                case "set_vehicle_target": return Wrap(SetVehicleTarget(args, world));
                case "set_vehicle_behavior": return Wrap(SetVehicleBehavior(args, world));
                case "remove_vehicle": return Wrap(RemoveVehicle(args, world));
                case "request_traveler_reroute": return Wrap(RequestTravelerReroute(args, world));
                case "set_traveler_target": return Wrap(SetTravelerTarget(args, world));
                case "set_traveler_speed": return Wrap(SetTravelerSpeed(args, world));
                case "request_citizen_trip": return Wrap(RequestCitizenTrip(args, world));
                case "cancel_citizen_trips": return Wrap(CancelCitizenTrips(args, world));
                case "manage_traffic": return Wrap(ManageTraffic(args, world));
                case "get_map_overview": return Wrap(GetMapOverview(world));
                case "list_map_tiles": return Wrap(ListMapTiles(args, world));
                case "get_map_tile": return Wrap(GetMapTile(args, world));
                case "find_map_tile_at": return Wrap(FindMapTileAt(args, world));
                case "get_map_tile_neighbors": return Wrap(GetMapTileNeighbors(args, world));
                case "analyze_map_tile_features": return Wrap(AnalyzeMapTileFeatures(args, world));
                case "analyze_buildable_area": return Wrap(AnalyzeBuildableArea(args, world));
                case "preview_map_tile_purchase": return Wrap(PreviewMapTilePurchase(args, world).Json());
                case "get_map_tile_operation": return Wrap(GetMapTileOperation(args));
                case "apply_map_tile_purchase": return Wrap(ApplyMapTilePurchase(args, world));
                case "cancel_map_tile_purchase": return Wrap(CancelMapTilePurchase(args));
                case "unlock_all_map_tiles": return Wrap(UnlockAllMapTiles(args, world));
                case "read_entity_field": return Wrap(ReadEntityField(args, world));
                case "list_game_systems": return Wrap(ListSystems(args, world, false));
                case "get_system_schema": return Wrap(SystemSchema(args, world));
                case "read_system_data": return Wrap(ReadSystem(args, world));
                case "list_environment_layers": return Wrap(ListSystems(args, world, true));
                case "read_environment_grid": return Wrap(ReadGrid(args, world));
                case "get_city_summary": return Wrap(Summary(world, em));
                case "query_buildings": return Wrap(Buildings(args, world, em));
                case "get_entity_details": return Wrap(Details(args, world, em));
                case "query_entities": return Wrap(QueryEntities(args, world, em));
                case "count_entities": return Wrap(CountEntities(args, em));
                case "get_entity_components": return Wrap(ReadEntityComponents(args, em));
                case "get_city_data": return Wrap(CityData(args, world, em));
                default: throw new QueryException("UNKNOWN_TOOL", "Unsupported bridge operation.");
            }
        }

        private bool IsReady() => m_Loaded && !GameManager.instance.isGameLoading &&
            GameManager.instance.gameMode == GameMode.Game && World.DefaultGameObjectInjectionWorld != null && World.DefaultGameObjectInjectionWorld.IsCreated;

        private JObject Wrap(JObject data)
        {
            var metadata = new JObject { ["session_id"] = m_Session, ["queried_at_utc"] = DateTime.UtcNow.ToString("O"), ["game_version"] = Game.Version.current.fullVersion, ["protocol_version"] = 1 };
            if (IsReady())
            {
                var world = World.DefaultGameObjectInjectionWorld;
                var sim = world.GetExistingSystemManaged<SimulationSystem>();
                var time = world.GetExistingSystemManaged<TimeSystem>();
                metadata["simulation_frame"] = sim == null ? JValue.CreateNull() : new JValue(sim.frameIndex);
                metadata["simulation_date"] = time == null ? JValue.CreateNull() : new JValue(time.GetCurrentDateTime().ToString("O"));
            }
            return new JObject { ["ok"] = true, ["meta"] = metadata, ["data"] = data };
        }

        private JObject Status()
        {
            var ready = IsReady();
            var result = new JObject { ["connected"] = true, ["city_loaded"] = ready, ["loading"] = GameManager.instance.isGameLoading,
                ["game_mode"] = GameManager.instance.gameMode.ToString(), ["bridge_version"] = "1.20.0", ["read_only"] = false };
            result["paused"] = JValue.CreateNull();
            if (ready)
            {
                var world = World.DefaultGameObjectInjectionWorld;
                var sim = world.GetExistingSystemManaged<SimulationSystem>();
                if (sim != null) { result["paused"] = sim.selectedSpeed == 0; result["selected_speed"] = sim.selectedSpeed; }
                result["city_name"] = world.GetExistingSystemManaged<CityConfigurationSystem>()?.cityName;
            }
            return result;
        }

        private JObject Capabilities()
        {
            var result = new JObject {
            ["tools"] = new JArray("get_game_status", "set_simulation_speed", "list_disaster_prefabs", "get_disaster_prefab", "list_active_disasters", "get_active_disaster", "get_disaster_readiness", "get_disaster_impacts", "preview_disaster", "get_disaster_operation", "apply_disaster_operation", "cancel_disaster_preview", "update_disaster", "stop_disaster", "clear_disaster_effects", "get_city_summary", "get_city_management_overview", "get_city_configuration", "set_city_name", "set_city_money", "set_city_configuration", "list_city_policies", "set_city_policy", "list_city_modifiers", "list_city_statistics", "get_city_statistic_history", "query_buildings", "get_entity_details", "get_query_capabilities", "list_component_types", "get_component_schema", "query_entities", "count_entities", "get_entity_components", "get_city_data", "list_game_systems", "get_system_schema", "read_system_data", "list_environment_layers", "read_environment_grid", "read_entity_field", "list_road_prefabs", "inspect_road_lanes", "analyze_road_traffic", "inspect_road_zoning", "preview_road", "preview_road_route", "preview_road_ring", "preview_road_grid", "preview_road_parallel", "preview_road_interchange", "preview_road_autoroute", "preview_road_reverse", "preview_road_batch_reverse", "preview_road_upgrade", "preview_road_demolition", "preview_road_batch_upgrade", "preview_road_batch_demolition", "preview_road_elevation", "preview_road_zoning", "preview_road_features", "preview_road_parking", "preview_intersection_control", "preview_intersection_roundabout", "preview_intersection_rules", "preview_road_policies", "preview_road_undo", "get_road_operation", "build_road", "cancel_road_preview", "sample_terrain", "preview_terrain", "get_terrain_operation", "apply_terrain", "cancel_terrain_preview", "list_building_prefabs", "list_building_upgrades", "get_building_state", "set_building_name", "set_building_active", "list_building_policies", "set_building_policy", "plan_building_site", "plan_building_row", "plan_special_building_site", "preview_building_placement", "preview_special_building_placement", "preview_building_batch_placement", "preview_building_move", "preview_building_replacement", "preview_building_upgrade", "preview_building_rebuild", "preview_building_demolition", "preview_building_upgrade_removal", "get_building_operation", "apply_building_operation", "cancel_building_preview", "list_zone_types", "analyze_zoning_cells", "preview_zoning", "get_zoning_operation", "apply_zoning", "cancel_zoning_preview", "list_districts", "get_district", "find_district_at", "get_district_coverage", "preview_district_create", "preview_district_boundary", "preview_district_delete", "get_district_operation", "apply_district_operation", "cancel_district_preview", "set_district_name", "list_district_policies", "set_district_policy", "get_service_districts", "set_service_districts", "list_transport_line_prefabs", "list_transport_stops", "list_transport_lines", "get_transport_line", "preview_transport_line", "preview_transport_line_stops", "preview_transport_line_delete", "get_transport_line_operation", "apply_transport_line_operation", "cancel_transport_line_preview", "set_transport_line_name", "set_transport_line_active", "set_transport_line_color", "list_transport_line_policies", "set_transport_line_policy", "list_transport_facility_prefabs", "list_transport_facilities", "plan_transport_facility_site", "preview_transport_facility_placement", "preview_transport_facility_move", "preview_transport_facility_delete", "get_transport_facility_operation", "apply_transport_facility_operation", "cancel_transport_facility_preview", "list_transport_track_prefabs", "list_transport_tracks", "preview_transport_track", "preview_transport_track_delete", "get_transport_track_operation", "apply_transport_track_operation", "cancel_transport_track_preview", "list_utility_facility_prefabs", "list_utility_facilities", "get_utility_facility", "plan_utility_facility_site", "preview_utility_facility_placement", "preview_utility_facility_move", "preview_utility_facility_delete", "get_utility_facility_operation", "apply_utility_facility_operation", "cancel_utility_facility_preview", "list_utility_network_prefabs", "list_utility_networks", "get_utility_network", "preview_utility_network", "preview_utility_network_upgrade", "preview_utility_network_delete", "get_utility_operation", "apply_utility_operation", "cancel_utility_preview", "list_city_service_prefabs", "list_city_service_facilities", "get_city_service_facility", "analyze_service_coverage", "plan_city_service_site", "preview_city_service_placement", "preview_city_service_move", "preview_city_service_upgrade", "preview_city_service_upgrade_removal", "preview_city_service_delete", "get_city_service_operation", "apply_city_service_operation", "cancel_city_service_preview", "get_city_economy", "get_tax_settings", "preview_tax_change", "list_service_budgets", "preview_service_budget", "list_service_fees", "preview_service_fee", "get_loan_status", "preview_loan_change", "get_economy_operation", "apply_economy_operation", "cancel_economy_preview", "get_zone_demand", "get_resource_demand", "get_population_demographics", "get_housing_statistics", "get_employment_statistics", "get_education_statistics", "set_unlimited_demand", "get_city_progression", "list_milestones", "list_development_tree", "get_unlock_summary", "list_unlockable_prefabs", "set_experience_points", "set_development_points", "purchase_development_node", "unlock_prefab", "unlock_all_progression", "list_citizens", "get_citizen", "list_households", "get_household", "list_companies", "get_company", "get_resource_economy", "list_resource_holders", "set_citizen_attributes", "set_household_money", "set_company_profitability", "set_resource_amount", "list_citizen_prefabs", "create_citizen", "set_citizen_name", "set_citizen_profile", "set_citizen_household", "set_citizen_workplace", "set_citizen_school", "set_citizen_location", "set_citizen_health_problem", "delete_citizen", "list_household_prefabs", "create_household", "set_household_name", "set_household_profile", "set_household_housing", "set_household_need", "delete_household", "list_company_prefabs", "create_company", "set_company_name", "set_company_financials", "set_company_workforce", "set_company_property", "set_company_trade_cost", "delete_company", "list_vehicles", "get_vehicle", "get_vehicle_path", "list_travelers", "get_traveler", "get_traveler_path", "list_citizen_trips", "inspect_lane_connections", "analyze_traffic_flow", "analyze_parking", "request_vehicle_reroute", "set_vehicle_target", "set_vehicle_behavior", "remove_vehicle", "request_traveler_reroute", "set_traveler_target", "set_traveler_speed", "request_citizen_trip", "cancel_citizen_trips", "manage_traffic", "get_map_overview", "list_map_tiles", "get_map_tile", "find_map_tile_at", "get_map_tile_neighbors", "analyze_map_tile_features", "analyze_buildable_area", "preview_map_tile_purchase", "get_map_tile_operation", "apply_map_tile_purchase", "cancel_map_tile_purchase", "unlock_all_map_tiles", "cancel_transport_line_vehicle_requests", "list_transport_facility_policies", "list_transport_facility_upgrades", "list_transport_vehicle_requests", "preview_transport_facility_upgrade", "preview_transport_facility_upgrade_removal", "release_transport_line_vehicle", "request_transport_line_vehicle", "set_transport_facility_active", "set_transport_facility_name", "set_transport_facility_policy", "set_transport_line_number", "set_transport_line_schedule", "set_transport_line_ticket_price", "set_transport_line_unbunching", "set_transport_line_vehicle_count", "set_transport_stop_name", "list_landscape_prefabs", "list_landscape_objects", "get_landscape_object", "analyze_landscape_area", "place_landscape_objects", "plant_landscape_pattern", "move_landscape_object", "set_tree_state", "remove_landscape_objects", "clear_landscape_area", "list_water_sources", "create_water_source", "update_water_source", "delete_water_source", "sample_pollution", "set_pollution_area", "get_climate_state", "set_weather_override", "set_wind", "sample_wind", "sample_soil_water"),
            ["economy_operations"] = new JObject { ["modes"] = new JArray("tax", "service_budget", "service_fee", "loan"), ["tax_scopes"] = new JArray("main", "area", "residential_education", "resource"), ["requires_paused_city"] = true, ["preview_ttl_seconds"] = 300, ["max_operations_per_session"] = 256, ["workflow"] = "read current settings -> preview -> apply -> get operation(completed)", ["validation"] = "Native ranges, exact old-value conflict snapshot, request idempotency and native TaxSystem, CityServiceBudgetSystem, ServiceFee and LoanSystem write paths." },
            ["city_management"] = new JObject { ["entities"] = new JArray("city configuration", "city policies", "city modifiers", "city statistics"), ["mutations"] = new JArray("city name", "stored money", "unlimited money", "natural disasters", "city policies"), ["statistics"] = new JObject { ["types"] = (int)StatisticType.Count, ["parameterized"] = true, ["history_pagination"] = true }, ["requires_paused_city"] = new JArray("money", "configuration", "policies"), ["immutable_while_loaded"] = new JArray("theme", "traffic handedness") },
            ["disaster_operations"] = new JObject { ["event_family"] = new JArray("WeatherPhenomenon", "Fire", "Destruction", "WaterLevelChange"), ["queries"] = new JArray("prefabs", "active events", "readiness", "linked impacts"), ["mutations"] = new JArray("preview/apply/cancel trigger", "move", "resize", "intensity", "remaining duration", "stop", "clear effects"), ["requires_paused_city"] = true, ["preview_ttl_seconds"] = 300, ["max_operations_per_session"] = 128, ["impact_types"] = new JArray("FacingWeather", "InDanger", "OnFire", "Flooded", "Destroyed"), ["native_behavior"] = "The native initializer, warning systems, hotspot motion, damage simulation, emergency response and event cleanup remain authoritative." },
            ["development_metrics"] = new JObject { ["demand_scopes"] = new JArray("residential", "commercial", "industrial", "office", "storage"), ["demand_factor_count"] = (int)DemandFactor.Count, ["resource_count"] = Game.Economy.EconomyUtils.ResourceCount, ["education_levels"] = 5, ["housing_densities"] = new JArray("low", "medium", "high"), ["unlimited_demand_requires_paused_city"] = true, ["unlimited_demand_session_only"] = true },
            ["progression_operations"] = new JObject { ["queries"] = new JArray("city_progression", "milestones", "development_tree", "unlock_summary", "unlockable_prefabs"), ["mutations"] = new JArray("set_experience_points", "set_development_points", "purchase_development_node", "unlock_prefab", "unlock_all_progression"), ["requires_paused_city"] = true, ["unlock_path"] = "Native DevTreeSystem.Purchase, Unlock events and UnlockAllSystem", ["rollback_boundary"] = "Exact XP and development-point values can be restored; achieved milestones, rewards and unlocked prefabs are not automatically revoked." },
            ["population_economy"] = new JObject { ["entities"] = new JArray("citizens", "households", "companies", "resource_holders"), ["resource_count"] = Game.Economy.EconomyUtils.ResourceCount, ["mutations"] = new JArray("set_citizen_attributes", "set_household_money", "set_company_profitability", "set_resource_amount"), ["requires_paused_city"] = true, ["resource_metrics"] = new JArray("stored", "production", "sellable", "demand", "companies", "workers", "citizen_usage", "service_usage", "industrial_usage", "import_export") },
            ["district_operations"] = new JObject { ["modes"] = new JArray("create", "boundary", "delete"), ["max_points"] = 64, ["requires_paused_city_to_apply"] = true, ["workflow"] = "preview district operation -> get_district_operation(preview_ready) -> apply_district_operation -> get_district_operation(completed)", ["coverage"] = "CurrentDistrict membership plus mutable ServiceDistrict assignments", ["validation"] = "Simple polygon validation, target snapshots, native temporary-area errors and one-shot native apply." },
            ["transport_line_operations"] = new JObject { ["modes"] = new JArray("create", "replace_stops", "delete"), ["max_stops"] = 64, ["requires_paused_city_to_apply"] = true, ["workflow"] = "list_transport_line_prefabs + list_transport_stops -> preview -> get operation(preview_ready) -> apply -> get operation(completed)", ["validation"] = "Transport type and passenger/cargo compatibility, target stop snapshot, native route pathfinding and game validation." },
            ["utility_infrastructure_operations"] = new JObject { ["facility_modes"] = new JArray("place", "move", "delete"), ["network_modes"] = new JArray("create_polyline", "upgrade", "delete"), ["network_types"] = new JArray("electricity", "water", "sewage", "water_sewage", "stormwater", "resource"), ["requires_paused_city"] = true, ["max_points"] = 16, ["max_existing_edges"] = 64, ["workflow"] = "discover/plan -> preview -> get operation(preview_ready) -> apply -> get operation(completed)", ["validation"] = "Native building and NetCourse pipelines, prefab elevation/length/slope limits, compatible endpoint family, cost, game errors and permanent-entity verification." },
            ["city_service_operations"] = new JObject { ["modes"] = new JArray("place", "move", "upgrade", "remove_upgrade", "delete"), ["kinds"] = new JArray(CityServiceKinds.Skip(1)), ["requires_paused_city"] = true, ["workflow"] = "list/plan -> preview -> get operation(preview_ready) -> apply -> get operation(completed)", ["coverage"] = "Healthcare, fire, police, education, garbage, deathcare, maintenance, parks, post, parking, welfare, research and emergency facilities.", ["analysis_tools"] = new JArray("analyze_service_coverage", "analyze_education_demand", "analyze_attraction_impact"), ["validation"] = "Native building preview, placement and upgrade compatibility, cost, game errors and permanent entity verification." },
            ["transport_facility_operations"] = new JObject { ["modes"] = new JArray("place", "move", "delete"), ["requires_paused_city"] = true, ["workflow"] = "list/plan -> preview -> get operation(preview_ready) -> apply -> get operation(completed)", ["coverage"] = "Passenger and cargo stations, depots, airports, harbors and transport terminals exposed by the loaded game prefabs.", ["analysis_tools"] = new JArray("analyze_transport_catchment"), ["validation"] = "Uses the native building/object preview pipeline, placement errors, access/snap validation, cost and permanent-entity verification." },
            ["traffic_mobility"] = new JObject { ["entities"] = new JArray("vehicles", "human travelers", "citizen trip queues", "paths", "lane connections", "parking lanes"), ["vehicle_classes"] = new JArray("car", "bicycle", "train", "watercraft", "aircraft"), ["vehicle_roles"] = new JArray("personal", "taxi", "public_transport", "cargo_transport", "delivery", "service"), ["mutations"] = new JArray("reroute", "retarget", "navigation behavior", "native citizen trip queue", "cancel queued trips", "delete vehicle group", "batch traffic management"), ["requires_paused_city"] = true, ["spawn_semantics"] = "request_citizen_trip adds a native TripNeeded request; the game selects walking, private vehicle or public transport and performs vehicle initialization.", ["physical_safety"] = "No incomplete vehicle physics entity is fabricated and no vehicle transform is teleported." },
            ["map_area_operations"] = new JObject { ["entities"] = new JArray("map tiles", "districts", "zones", "terrain", "climate"), ["map_tile_states"] = new JArray("owned", "unowned", "purchasable"), ["features"] = new JArray(Enum.GetNames(typeof(Game.Areas.MapFeature))), ["mutations"] = new JArray("preview/apply/cancel map tile purchase", "unlock all map tiles"), ["requires_paused_city"] = true, ["validation"] = "Tile existence, edge adjacency, connected selection, permits, money, exact native feature cost, ownership snapshot and rollback." },
            ["transport_track_operations"] = new JObject { ["modes"] = new JArray("create_polyline", "delete"), ["track_types"] = new JArray("train", "subway", "tram"), ["max_points"] = 16, ["max_delete_edges"] = 64, ["requires_paused_city"] = true, ["workflow"] = "list prefabs/tracks -> preview -> get operation(preview_ready) -> apply -> get operation(completed)", ["endpoint_targets"] = new JArray("new_node", "existing_track_node", "existing_track_edge_split"), ["validation"] = "Native NetCourse preview, track-prefab limits, slope/elevation, collision and permanent TrackData edge verification." },
            ["zoning_operations"] = new JObject { ["modes"] = new JArray("assign", "clear", "replace"), ["road_sides"] = new JArray("left", "right", "both"), ["depth_cells"] = "1..6", ["max_cells_per_operation"] = 4096, ["requires_paused_city_to_apply"] = true, ["workflow"] = "list_zone_types -> analyze_zoning_cells -> preview_zoning -> apply_zoning", ["validation"] = "Atomic per-cell snapshots with conflict rejection and rollback; native Updated markers trigger lot and building refresh." },
            ["terrain_modification"] = new JObject { ["modes"] = new JArray("raise", "lower", "level", "smooth", "slope", "raise_land", "flatten_map"), ["brush_size_m"] = "8..1000", ["strength"] = "0.01..1", ["passes"] = "1..32", ["requires_paused_city"] = true, ["cost"] = 0, ["workflow"] = "sample_terrain -> preview_terrain -> get_terrain_operation(preview_ready) -> apply_terrain -> get_terrain_operation(completed)", ["preview_semantics"] = "The game 1.6.0 PreviewBrush method is empty. Preview validates parameters and captures live baseline samples; terrain changes only after apply_terrain.", ["limitations"] = "Height readback samples verify path points. Brush falloff affects the surrounding footprint. raise_land uses the live native water-depth mask and shifts dry heightmap cells once. flatten_map overwrites the full native heightmap and can clear dynamic water and natural water sources. Terrain edits do not have a native undo journal." },
            ["building_operations"] = new JObject { ["modes"] = new JArray("place", "move", "replace", "upgrade", "rebuild", "demolish", "remove_upgrade"), ["requires_paused_city"] = true, ["preview_ttl_seconds"] = 300, ["max_operations_per_session"] = 128, ["workflow"] = "list_building_prefabs -> plan_building_site (optional) -> preview building operation -> get_building_operation(preview_ready) -> apply_building_operation -> get_building_operation(completed)", ["validation"] = "Native temporary entities, placement errors, warnings and cost are checked before commit." },
            ["building_area_operations"] = new JObject { ["modes"] = new JArray("create", "boundary", "delete"), ["area_kinds"] = new JArray("storage", "extractor", "other"), ["max_points"] = 64, ["requires_paused_city"] = true, ["preview_ttl_seconds"] = 300, ["max_operations_per_session"] = 128, ["workflow"] = "list_building_areas -> preview_building_area -> get_building_area_operation(preview_ready) -> apply_building_area_operation -> get_building_area_operation(completed)", ["validation"] = "Owner building snapshot, prefab-declared SubArea compatibility, simple polygon validation, native temporary-area errors, cost ceiling and permanent owner/prefab/boundary verification." },
            ["entity_categories"] = new JArray(Domains.Keys),
            ["road_building"] = new JObject { ["modes"] = new JArray("straight", "quadratic", "cubic", "elevated", "tunnel", "polyline"), ["min_length_m"] = 16, ["max_length_m"] = 256,
                ["requires_paused_city"] = true, ["preview_ttl_seconds"] = 300, ["max_operations_per_session"] = 128,
                ["workflow"] = "list_road_prefabs -> preview_road, preview_road_route, preview_road_ring, preview_road_grid, or preview_road_autoroute -> get_road_operation(preview_ready) -> build_road -> get_road_operation(completed)",
                ["endpoint_targets"] = new JArray("new_node", "existing_node", "existing_edge_split"),
                ["elevation_m"] = "New points accept -50..50 metres relative to terrain, further limited by the road prefab. >=8 forces elevated; <=-12 requests tunnel.",
                ["existing_road_workflow"] = "preview_road_upgrade, preview_road_demolition, preview_road_batch_upgrade, preview_road_batch_demolition, preview_road_zoning, preview_road_features, preview_road_parking, preview_road_policies, preview_intersection_control, preview_intersection_roundabout, or preview_intersection_rules -> get_road_operation(preview_ready) -> build_road -> get_road_operation(completed)",
                ["batch_max_edges"] = 64, ["zoning_sides"] = "left/right relative to each edge start-to-end direction",
                ["zoning_inspection"] = "inspect_road_zoning reads each edge's native SubBlock, Block, ValidArea and Cell data and reports alignment plus blocked/shared/occupied/redundant cells.",
                ["intersection_control_modes"] = new JArray("traffic_lights", "all_way_stop", "uncontrolled", "automatic"),
                ["intersection_rules"] = new JArray("left_turn", "right_turn", "straight", "crosswalk_enabled"),
                ["limitations"] = "Attached endpoints inherit existing height. Polyline route preview/build is one native apply operation. Reuse operation/request IDs after timeouts." },
            ["component_catalog"] = Inspector.Stats(),
            ["building_types"] = new JArray("all", "residential", "commercial", "industrial", "office"),
            ["building_fields"] = new JArray("entity_id", "name", "prefab_name", "categories", "position", "abandoned", "condemned", "destroyed"),
            ["summary_fields"] = new JArray("city_name", "population", "population_with_move_in", "average_happiness", "average_health", "money", "unlimited_money", "building_counts"),
            ["max_page_size"] = 100, ["snapshot_ttl_seconds"] = 60, ["max_membership_size"] = 200000,
            ["pagination_semantics"] = "snapshot_id freezes sorted entity membership for 60 seconds; row fields are live at each query. Deleted entities are skipped. Use next_offset, not returned row count.",
            ["count_semantics"] = "Building instances excluding Deleted and Temp. Includes abandoned/condemned/destroyed instances. Mixed-use categories can overlap. Residential buildings are not households or housing units.",
            ["entity_id_semantics"] = "Opaque session:index:version. Invalid after loading another city or restarting. Never invent IDs.",
                ["limitations"] = new JArray("Transactional construction and economy tools use explicit preview/apply workflows. Direct settings and progression mutations require a paused city. No historical data.", "Generic fields use original game names/units; do not infer meanings from names alone", "NativeArray, NativeList, NativeReference and NativeValue have typed readers; native queues/maps/sets use available enumerators; BlobAssetReference supports raw allocation bytes; other layouts report unavailable", "Private stored fields and CPU CellMap grids are available; GPU-only textures and arbitrary unbounded pointers have no reader", "Large buffers and nested values are explicitly bounded/truncated")
            };
            if (result["tools"] is JArray tools)
            {
                tools.Add("analyze_transport_catchment");
                tools.Add("analyze_education_demand");
                tools.Add("analyze_attraction_impact");
                tools.Add("list_building_areas");
                tools.Add("preview_building_area");
                tools.Add("get_building_area_operation");
                tools.Add("apply_building_area_operation");
                tools.Add("cancel_building_area_preview");
            }
            return result;
        }

        private JObject SetSimulationSpeed(JObject args, World world)
        {
            var value = ((string)args["speed"] ?? "").ToLowerInvariant();
            float speed;
            switch (value)
            {
                case "paused": speed = 0f; break;
                case "normal": speed = 1f; break;
                case "fast": speed = 2f; break;
                case "fastest": speed = 4f; break;
                default: throw new QueryException("INVALID_ARGUMENT", "speed must be paused, normal, fast, or fastest.");
            }
            var simulation = world.GetExistingSystemManaged<SimulationSystem>();
            if (simulation == null) throw new QueryException("SIMULATION_UNAVAILABLE", "The city simulation system is unavailable.");
            simulation.selectedSpeed = speed;
            return new JObject { ["speed"] = value, ["selected_speed"] = simulation.selectedSpeed, ["paused"] = simulation.selectedSpeed == 0f };
        }

        private EntityQuery BuildingQuery(EntityManager em, string type)
        {
            var all = new List<ComponentType> { ComponentType.ReadOnly<Building>() };
            switch (type)
            {
                case "all": break;
                case "residential": all.Add(ComponentType.ReadOnly<ResidentialProperty>()); break;
                case "commercial": all.Add(ComponentType.ReadOnly<CommercialProperty>()); break;
                case "industrial": all.Add(ComponentType.ReadOnly<IndustrialProperty>()); break;
                case "office": all.Add(ComponentType.ReadOnly<OfficeProperty>()); break;
                default: throw new QueryException("INVALID_ARGUMENT", "Unsupported building_type.");
            }
            return em.CreateEntityQuery(new EntityQueryDesc {
                All = all.ToArray(), None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Temp>() }
            });
        }

        private JObject Summary(World world, EntityManager em)
        {
            var counts = new JObject();
            foreach (var type in new[] { "all", "residential", "commercial", "industrial", "office" })
                using (var query = BuildingQuery(em, type)) counts[type] = query.CalculateEntityCount();
            var result = new JObject { ["city_name"] = world.GetExistingSystemManaged<CityConfigurationSystem>()?.cityName, ["building_counts"] = counts,
                ["population"] = JValue.CreateNull(), ["money"] = JValue.CreateNull() };
            var city = world.GetExistingSystemManaged<CitySystem>()?.City ?? Entity.Null;
            if (em.Exists(city) && em.HasComponent<Population>(city))
            {
                var population = em.GetComponentData<Population>(city);
                result["population"] = population.m_Population;
                result["population_with_move_in"] = population.m_PopulationWithMoveIn;
                result["average_happiness"] = population.m_AverageHappiness;
                result["average_health"] = population.m_AverageHealth;
            }
            if (em.Exists(city) && em.HasComponent<PlayerMoney>(city))
            {
                var money = em.GetComponentData<PlayerMoney>(city);
                result["money"] = money.money;
                result["unlimited_money"] = money.m_Unlimited;
            }
            result["metric_notes"] = "Counts are building entities, not housing units. Category counts may overlap. Population values come directly from Game.City.Population; money is game currency. Null means unavailable.";
            result["city_entity_id"] = city == Entity.Null ? null : EntityId(city);
            return result;
        }

        private static int Integer(JObject args, string name, int fallback, int min, int max)
        {
            var token = args[name];
            if (token == null) return fallback;
            if (token.Type != JTokenType.Integer || !long.TryParse(token.ToString(), out var number) || number < min || number > max)
                throw new QueryException("INVALID_ARGUMENT", name + " must be an integer in range.");
            return (int)number;
        }

        private JObject Buildings(JObject args, World world, EntityManager em)
        {
            var type = (string)args["building_type"] ?? "all";
            var offset = Integer(args, "offset", 0, 0, 200000);
            var limit = Integer(args, "limit", 20, 1, 100);
            foreach (var expired in m_Snapshots.Where(x => (DateTime.UtcNow - x.Value.Created).TotalSeconds >= 60).Select(x => x.Key).ToArray()) m_Snapshots.Remove(expired);
            var id = (string)args["snapshot_id"];
            Snapshot snapshot;
            if (id != null)
            {
                if (!m_Snapshots.TryGetValue(id, out snapshot)) throw new QueryException("SNAPSHOT_EXPIRED", "Snapshot expired or belongs to another city. Restart at offset 0 without snapshot_id.");
                if (snapshot.Type != type) throw new QueryException("INVALID_ARGUMENT", "building_type must match the snapshot.");
            }
            else
            {
                if (offset != 0) throw new QueryException("INVALID_ARGUMENT", "Pagination requires snapshot_id from the first page.");
                using (var query = BuildingQuery(em, type))
                {
                    if (query.CalculateEntityCount() > 200000) throw new QueryException("QUERY_TOO_LARGE", "Use a narrower building_type (maximum 200000 entities).");
                    using (var entities = query.ToEntityArray(Allocator.Temp))
                        snapshot = new Snapshot { Type = type, Entities = entities.ToArray() };
                }
                Array.Sort(snapshot.Entities, (a, b) => a.Index != b.Index ? a.Index.CompareTo(b.Index) : a.Version.CompareTo(b.Version));
                if (m_Snapshots.Count >= 8) m_Snapshots.Remove(m_Snapshots.OrderBy(x => x.Value.Created).First().Key);
                m_Snapshots[snapshot.Id] = snapshot;
            }
            if (offset > snapshot.Entities.Length) throw new QueryException("INVALID_ARGUMENT", "offset exceeds snapshot size.");
            var rows = new JArray();
            var end = Math.Min(offset + limit, snapshot.Entities.Length);
            var skipped = 0;
            for (var i = offset; i < end; i++)
            {
                var entity = snapshot.Entities[i];
                if (!em.Exists(entity) || em.HasComponent<Deleted>(entity) || em.HasComponent<Temp>(entity)) { skipped++; continue; }
                rows.Add(EntityRow(entity, world, em));
            }
            return new JObject { ["snapshot_id"] = snapshot.Id, ["membership_captured_at_utc"] = snapshot.Created.ToString("O"),
                ["row_values"] = "live_at_query_time", ["building_type"] = type, ["total"] = snapshot.Entities.Length,
                ["offset"] = offset, ["limit"] = limit, ["skipped_deleted"] = skipped,
                ["next_offset"] = end < snapshot.Entities.Length ? new JValue(end) : JValue.CreateNull(), ["items"] = rows };
        }

        private JObject EntityRow(Entity entity, World world, EntityManager em)
        {
            var row = new JObject { ["entity_id"] = m_Session + ":" + entity.Index + ":" + entity.Version };
            var names = world.GetExistingSystemManaged<NameSystem>();
            try { row["name"] = names?.GetRenderedLabelName(entity); }
            catch { row["name"] = JValue.CreateNull(); }
            if (em.HasComponent<PrefabRef>(entity))
            {
                var prefab = world.GetExistingSystemManaged<PrefabSystem>();
                if (prefab != null && prefab.TryGetPrefab<PrefabBase>(em.GetComponentData<PrefabRef>(entity), out var definition)) row["prefab_name"] = definition.name;
            }
            if (em.HasComponent<Game.Objects.Transform>(entity))
            {
                var p = em.GetComponentData<Game.Objects.Transform>(entity).m_Position;
                row["position"] = new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z };
            }
            if (em.HasComponent<Building>(entity))
            {
                var types = new JArray();
                if (em.HasComponent<ResidentialProperty>(entity)) types.Add("residential");
                if (em.HasComponent<CommercialProperty>(entity)) types.Add("commercial");
                if (em.HasComponent<IndustrialProperty>(entity)) types.Add("industrial");
                if (em.HasComponent<OfficeProperty>(entity)) types.Add("office");
                row["categories"] = types;
                row["abandoned"] = em.HasComponent<Abandoned>(entity);
                row["condemned"] = em.HasComponent<Condemned>(entity);
                row["destroyed"] = em.HasComponent<Game.Common.Destroyed>(entity);
            }
            return row;
        }

        private JObject Details(JObject args, World world, EntityManager em)
        {
            var parts = ((string)args["entity_id"] ?? "").Split(':');
            if (parts.Length != 3 || !int.TryParse(parts[1], out var index) || !int.TryParse(parts[2], out var version) || index < 0 || version < 0)
                throw new QueryException("INVALID_ARGUMENT", "Use an entity_id returned by query_buildings.");
            if (parts[0] != m_Session) throw new QueryException("STALE_ENTITY", "Entity ID belongs to another city session.");
            var entity = new Entity { Index = index, Version = version };
            if (!em.Exists(entity) || em.HasComponent<Deleted>(entity) || em.HasComponent<Temp>(entity)) throw new QueryException("ENTITY_NOT_FOUND", "Entity no longer exists.");
            var result = EntityRow(entity, world, em);
            using (var types = em.GetComponentTypes(entity, Allocator.Temp))
            {
                var names = new JArray();
                for (var i = 0; i < Math.Min(128, types.Length); i++) names.Add(types[i].GetManagedType()?.FullName ?? types[i].ToString());
                result["component_types"] = names;
                result["component_types_truncated"] = types.Length > 128;
            }
            return result;
        }

        public void Dispose()
        {
            ResetRoadOperations();
            ResetTerrainOperations();
            ResetBuildingOperations();
            ResetBuildingAreaOperations();
            ResetZoningOperations();
            ResetDistrictOperations();
            ResetTransportOperations();
            ResetEconomyOperations();
            ResetMapTileOperations();
            GameManager.instance.onGamePreload -= m_Preload;
            GameManager.instance.onGameLoadingComplete -= m_LoadComplete;
            m_Snapshots.Clear();
        }
    }
}















