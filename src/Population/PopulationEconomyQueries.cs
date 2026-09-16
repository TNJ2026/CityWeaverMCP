using System;
using System.Collections.Generic;
using System.Linq;
using Game.Buildings;
using Game.Citizens;
using Game.Common;
using Game.Companies;
using Game.Economy;
using Game.Prefabs;
using Game.Simulation;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CitiesSkylines2Mod
{
    public sealed partial class GameQueryService
    {
        private static JToken OptionalEntity(string session, Entity entity) => entity == Entity.Null ? JValue.CreateNull() : new JValue(session + ":" + entity.Index + ":" + entity.Version);

        private JObject CitizenJson(Entity entity, World world)
        {
            var em = world.EntityManager; var data = em.GetComponentData<Citizen>(entity); var row = EntityRow(entity, world, em);
            row["age"] = data.GetAge().ToString().ToLowerInvariant(); row["male"] = (data.m_State & CitizenFlags.Male) != CitizenFlags.None; row["birth_day"] = data.m_BirthDay; row["education_level"] = data.GetEducationLevel(); row["failed_education_count"] = data.GetFailedEducationCount(); row["health"] = data.m_Health; row["wellbeing"] = data.m_WellBeing; row["happiness"] = data.Happiness;
            row["state_flags"] = data.m_State.ToString(); row["leisure_counter"] = data.m_LeisureCounter; row["penalty_counter"] = data.m_PenaltyCounter; row["unemployment_counter"] = data.m_UnemploymentCounter; row["unemployment_time_counter"] = data.m_UnemploymentTimeCounter; row["sickness_penalty"] = data.m_SicknessPenalty;
            row["household_id"] = em.HasComponent<HouseholdMember>(entity) ? OptionalEntity(m_Session, em.GetComponentData<HouseholdMember>(entity).m_Household) : JValue.CreateNull();
            if (em.HasComponent<Worker>(entity)) { var worker = em.GetComponentData<Worker>(entity); row["worker"] = new JObject { ["workplace_id"] = OptionalEntity(m_Session, worker.m_Workplace), ["job_level"] = worker.m_Level, ["shift"] = worker.m_Shift.ToString().ToLowerInvariant(), ["last_commute_time"] = worker.m_LastCommuteTime }; }
            if (em.HasComponent<Game.Citizens.Student>(entity)) { var student = em.GetComponentData<Game.Citizens.Student>(entity); row["student"] = new JObject { ["school_id"] = OptionalEntity(m_Session, student.m_School), ["education_level"] = student.m_Level, ["last_commute_time"] = student.m_LastCommuteTime }; }
            row["current_building_id"] = em.HasComponent<CurrentBuilding>(entity) ? OptionalEntity(m_Session, em.GetComponentData<CurrentBuilding>(entity).m_CurrentBuilding) : JValue.CreateNull();
            if (em.HasComponent<HealthProblem>(entity)) { var health = em.GetComponentData<HealthProblem>(entity); row["health_problem"] = new JObject { ["flags"] = health.m_Flags.ToString(), ["timer"] = health.m_Timer, ["event_id"] = OptionalEntity(m_Session, health.m_Event), ["healthcare_request_id"] = OptionalEntity(m_Session, health.m_HealthcareRequest) }; } else row["health_problem"] = JValue.CreateNull(); row["homeless_household_member"] = em.HasComponent<HouseholdMember>(entity) && em.Exists(em.GetComponentData<HouseholdMember>(entity).m_Household) && em.HasComponent<HomelessHousehold>(em.GetComponentData<HouseholdMember>(entity).m_Household);
            return row;
        }

        private JObject ListCitizens(JObject args, World world)
        {
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 50, 1, 500); string role = ((string)args["role"] ?? "all").ToLowerInvariant();
            if (role != "all" && role != "worker" && role != "student" && role != "unemployed") throw new QueryException("INVALID_ARGUMENT", "role must be all, worker, student, or unemployed.");
            var em = world.EntityManager; var rows = new List<Entity>(); using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Citizen>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) {
                bool worker = em.HasComponent<Worker>(entity), student = em.HasComponent<Game.Citizens.Student>(entity), unemployed = !worker && !student && em.GetComponentData<Citizen>(entity).GetAge() == CitizenAge.Adult; if (role == "worker" && !worker || role == "student" && !student || role == "unemployed" && !unemployed) continue; rows.Add(entity);
            }
            rows.Sort((a, b) => a.Index.CompareTo(b.Index)); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(e => CitizenJson(e, world))) };
        }

        private JObject GetCitizen(JObject args, World world)
        {
            var entity = ParseEntity((string)args["citizen_id"], world.EntityManager); if (!world.EntityManager.HasComponent<Citizen>(entity)) throw new QueryException("CITIZEN_NOT_FOUND", "citizen_id must identify a citizen in this city session."); return CitizenJson(entity, world);
        }

        private JObject HouseholdJson(Entity entity, World world)
        {
            var em = world.EntityManager; var data = em.GetComponentData<Household>(entity); var row = EntityRow(entity, world, em); var members = new JArray();
            if (em.HasBuffer<HouseholdCitizen>(entity)) { var buffer = em.GetBuffer<HouseholdCitizen>(entity, true); for (int i = 0; i < buffer.Length; i++) members.Add(OptionalEntity(m_Session, buffer[i].m_Citizen)); }
            var resources = em.HasBuffer<Resources>(entity) ? em.GetBuffer<Resources>(entity, true) : default(DynamicBuffer<Resources>); int money = resources.IsCreated ? EconomyUtils.GetResources(Resource.Money, resources) : 0;
            row["flags"] = data.m_Flags.ToString(); row["money"] = money; row["total_wealth"] = resources.IsCreated ? EconomyUtils.GetHouseholdTotalWealth(data, resources) : money; row["consumable_resource_units"] = data.m_Resources; row["consumption_per_day"] = data.m_ConsumptionPerDay; row["shopping_value_today"] = data.m_ShoppedValuePerDay; row["shopping_value_last_day"] = data.m_ShoppedValueLastDay; row["last_day_frame_index"] = data.m_LastDayFrameIndex; row["income_last_day"] = data.m_Income; row["building_leveling_spend_last_day"] = data.m_MoneySpendOnBuildingLevelingLastDay; row["member_count"] = members.Count; row["member_ids"] = members; row["homeless"] = em.HasComponent<HomelessHousehold>(entity);
            if (em.HasComponent<PropertyRenter>(entity)) { var renter = em.GetComponentData<PropertyRenter>(entity); row["housing"] = new JObject { ["property_id"] = OptionalEntity(m_Session, renter.m_Property), ["rent"] = renter.m_Rent }; }
            if (em.HasComponent<HouseholdNeed>(entity)) { var need = em.GetComponentData<HouseholdNeed>(entity); row["current_need"] = new JObject { ["resource"] = need.m_Resource.ToString(), ["amount"] = need.m_Amount }; }
            return row;
        }

        private JObject ListHouseholds(JObject args, World world)
        {
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 50, 1, 500); string housing = ((string)args["housing"] ?? "all").ToLowerInvariant();
            if (housing != "all" && housing != "housed" && housing != "homeless") throw new QueryException("INVALID_ARGUMENT", "housing must be all, housed, or homeless."); var em = world.EntityManager; var rows = new List<Entity>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Household>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) { bool homeless = em.HasComponent<HomelessHousehold>(entity); if (housing == "housed" && homeless || housing == "homeless" && !homeless) continue; rows.Add(entity); }
            rows.Sort((a, b) => a.Index.CompareTo(b.Index)); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(e => HouseholdJson(e, world))) };
        }

        private JObject GetHousehold(JObject args, World world)
        {
            var entity = ParseEntity((string)args["household_id"], world.EntityManager); if (!world.EntityManager.HasComponent<Household>(entity)) throw new QueryException("HOUSEHOLD_NOT_FOUND", "household_id must identify a household in this city session."); return HouseholdJson(entity, world);
        }

        private static string CompanyKind(EntityManager em, Entity entity)
        {
            if (em.HasComponent<Game.Companies.StorageCompany>(entity)) return "storage"; if (em.HasComponent<OfficeCompany>(entity)) return "office"; if (em.HasComponent<CommercialCompany>(entity)) return "commercial"; if (em.HasComponent<Game.Companies.ExtractorCompany>(entity)) return "extractor"; if (em.HasComponent<Game.Companies.ProcessingCompany>(entity)) return "processing"; if (em.HasComponent<IndustrialCompany>(entity)) return "industrial"; return "other";
        }

        private static JArray ResourcesJson(DynamicBuffer<Resources> buffer)
        {
            var rows = new JArray(); for (int i = 0; i < buffer.Length; i++) rows.Add(new JObject { ["resource"] = buffer[i].m_Resource.ToString(), ["amount"] = buffer[i].m_Amount }); return rows;
        }

        private JObject CompanyJson(Entity entity, World world)
        {
            var em = world.EntityManager; var row = EntityRow(entity, world, em); var data = em.GetComponentData<CompanyData>(entity); row["kind"] = CompanyKind(em, entity); row["industrial_sector"] = em.HasComponent<IndustrialCompany>(entity); row["brand_id"] = OptionalEntity(m_Session, data.m_Brand);
            if (em.HasComponent<PropertyRenter>(entity)) { var renter = em.GetComponentData<PropertyRenter>(entity); row["property"] = new JObject { ["property_id"] = OptionalEntity(m_Session, renter.m_Property), ["rent"] = renter.m_Rent }; }
            if (em.HasComponent<Profitability>(entity)) { var profit = em.GetComponentData<Profitability>(entity); row["profitability"] = profit.m_Profitability; row["last_total_worth"] = profit.m_LastTotalWorth; }
            int maxWorkers = em.HasComponent<WorkProvider>(entity) ? em.GetComponentData<WorkProvider>(entity).m_MaxWorkers : 0, employeeCount = 0; var employees = new JArray(); if (em.HasBuffer<Employee>(entity)) { var buffer = em.GetBuffer<Employee>(entity, true); employeeCount = buffer.Length; for (int i = 0; i < Math.Min(100, buffer.Length); i++) employees.Add(new JObject { ["citizen_id"] = OptionalEntity(m_Session, buffer[i].m_Worker), ["job_level"] = buffer[i].m_Level }); }
            row["employment"] = new JObject { ["employees"] = employeeCount, ["maximum_workers"] = maxWorkers, ["vacancies"] = Math.Max(0, maxWorkers - employeeCount), ["employee_records"] = employees, ["employee_records_truncated"] = employeeCount > employees.Count };
            if (em.HasBuffer<Resources>(entity)) row["resources"] = ResourcesJson(em.GetBuffer<Resources>(entity, true));
            if (em.HasBuffer<TradeCost>(entity)) { var costs = em.GetBuffer<TradeCost>(entity, true); var items = new JArray(); for (int i = 0; i < costs.Length; i++) items.Add(new JObject { ["resource"] = costs[i].m_Resource.ToString(), ["buy_cost"] = costs[i].m_BuyCost, ["sell_cost"] = costs[i].m_SellCost, ["last_transfer_request_time"] = costs[i].m_LastTransferRequestTime }); row["trade_costs"] = items; }
            if (em.HasBuffer<CurrentTrading>(entity)) { var trading = em.GetBuffer<CurrentTrading>(entity, true); var items = new JArray(); for (int i = 0; i < trading.Length; i++) items.Add(new JObject { ["resource"] = trading[i].m_TradingResource.ToString(), ["amount"] = trading[i].m_TradingResourceAmount, ["start_frame"] = trading[i].m_TradingStartFrameIndex, ["connection_type"] = trading[i].m_OutsideConnectionType.ToString() }); row["current_trading"] = items; }
            if (em.HasComponent<PrefabRef>(entity)) { var prefab = em.GetComponentData<PrefabRef>(entity).m_Prefab; if (em.HasComponent<IndustrialProcessData>(prefab)) { var process = em.GetComponentData<IndustrialProcessData>(prefab); row["process"] = new JObject { ["input_1"] = new JObject { ["resource"] = process.m_Input1.m_Resource.ToString(), ["amount"] = process.m_Input1.m_Amount }, ["input_2"] = new JObject { ["resource"] = process.m_Input2.m_Resource.ToString(), ["amount"] = process.m_Input2.m_Amount }, ["output"] = new JObject { ["resource"] = process.m_Output.m_Resource.ToString(), ["amount"] = process.m_Output.m_Amount }, ["work_per_unit"] = process.m_WorkPerUnit, ["importer"] = process.m_IsImport != 0 }; } }
            return row;
        }

        private JObject ListCompanies(JObject args, World world)
        {
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 50, 1, 100); string kind = ((string)args["kind"] ?? "all").ToLowerInvariant(); var allowed = new[] { "all", "commercial", "industrial", "office", "extractor", "processing", "storage", "other" }; if (!allowed.Contains(kind)) throw new QueryException("INVALID_ARGUMENT", "Unsupported company kind."); var em = world.EntityManager; var rows = new List<Entity>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<CompanyData>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>() } })) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) if (kind == "all" || kind == "industrial" && em.HasComponent<IndustrialCompany>(entity) || CompanyKind(em, entity) == kind) rows.Add(entity);
            rows.Sort((a, b) => a.Index.CompareTo(b.Index)); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(e => CompanyJson(e, world))) };
        }

        private JObject GetCompany(JObject args, World world)
        {
            var entity = ParseEntity((string)args["company_id"], world.EntityManager); if (!world.EntityManager.HasComponent<CompanyData>(entity)) throw new QueryException("COMPANY_NOT_FOUND", "company_id must identify a company in this city session."); return CompanyJson(entity, world);
        }

        private JObject GetResourceEconomy(JObject args, World world)
        {
            bool includeZero = (bool?)args["include_zero"] ?? false; var em = world.EntityManager; em.CompleteAllTrackedJobs(); var stored = world.GetExistingSystemManaged<CountCityStoredResourceSystem>().GetCityStoredResources(); var companies = world.GetExistingSystemManaged<CountCompanyDataSystem>(); Unity.Jobs.JobHandle commercialDep, industrialDep, productionDep, sellableDep; var commercial = companies.GetCommercialCompanyDatas(out commercialDep); var industrial = companies.GetIndustrialCompanyDatas(out industrialDep); var production = companies.GetProduction(out productionDep); var sellable = companies.GetTotalSellableInCity(out sellableDep); Unity.Jobs.JobHandle.CombineDependencies(Unity.Jobs.JobHandle.CombineDependencies(commercialDep, industrialDep), Unity.Jobs.JobHandle.CombineDependencies(productionDep, sellableDep)).Complete(); var usage = world.GetExistingSystemManaged<CityProductionStatisticSystem>(); var rows = new JArray();
            for (int i = 0; i < EconomyUtils.ResourceCount; i++) { var resource = EconomyUtils.GetResource(i); int stock = i < stored.Length ? stored[i] : 0, produced = i < production.Length ? production[i] : 0, available = i < sellable.Length ? sellable[i] : 0; int citizenUse = usage.GetCityResourceUsages(CityProductionStatisticSystem.CityResourceUsage.Consumer.Citizens, resource), importExport = usage.GetCityResourceUsages(CityProductionStatisticSystem.CityResourceUsage.Consumer.ImportExport, resource), industryUse = usage.GetCityResourceUsages(CityProductionStatisticSystem.CityResourceUsage.Consumer.Industrial, resource), serviceUse = usage.GetCityResourceUsages(CityProductionStatisticSystem.CityResourceUsage.Consumer.ServiceUpkeep, resource); int demand = i < industrial.m_Demand.Length ? industrial.m_Demand[i] : 0; if (!includeZero && stock == 0 && produced == 0 && available == 0 && citizenUse == 0 && importExport == 0 && industryUse == 0 && serviceUse == 0 && demand == 0) continue;
                rows.Add(new JObject { ["resource"] = resource.ToString(), ["stored"] = stock, ["production"] = produced, ["sellable_in_city"] = available, ["industrial_demand"] = demand, ["industrial_companies"] = i < industrial.m_ProductionCompanies.Length ? industrial.m_ProductionCompanies[i] : 0, ["commercial_companies"] = i < commercial.m_ServiceCompanies.Length ? commercial.m_ServiceCompanies[i] : 0, ["industrial_workers"] = i < industrial.m_CurrentProductionWorkers.Length ? industrial.m_CurrentProductionWorkers[i] : 0, ["industrial_worker_capacity"] = i < industrial.m_MaxProductionWorkers.Length ? industrial.m_MaxProductionWorkers[i] : 0, ["commercial_workers"] = i < commercial.m_CurrentServiceWorkers.Length ? commercial.m_CurrentServiceWorkers[i] : 0, ["commercial_worker_capacity"] = i < commercial.m_MaxServiceWorkers.Length ? commercial.m_MaxServiceWorkers[i] : 0, ["usage_per_day"] = new JObject { ["citizens"] = citizenUse, ["services"] = serviceUse, ["industrial"] = industryUse, ["import_export"] = importExport } });
            }
            return new JObject { ["total"] = rows.Count, ["resource_count"] = EconomyUtils.ResourceCount, ["include_zero"] = includeZero, ["items"] = rows, ["unit_note"] = "Native integer resource amounts and smoothed per-day usage values. import_export is signed." };
        }

        private JObject ResourceHolderJson(Entity entity, World world)
        {
            var em = world.EntityManager; var row = EntityRow(entity, world, em); row["holder_kind"] = em.HasComponent<CompanyData>(entity) ? "company" : em.HasComponent<Household>(entity) ? "household" : em.HasComponent<Building>(entity) ? "building" : em.HasComponent<Game.Objects.OutsideConnection>(entity) ? "outside_connection" : "other"; row["resources"] = ResourcesJson(em.GetBuffer<Resources>(entity, true)); return row;
        }

        private JObject ListResourceHolders(JObject args, World world)
        {
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 200000), limit = ComponentInspector.Int(args, "limit", 50, 1, 500); string resourceText = ((string)args["resource"] ?? "").Trim(); Resource selected = Resource.NoResource; if (!string.IsNullOrEmpty(resourceText) && (!Enum.TryParse(resourceText, true, out selected) || selected == Resource.NoResource)) throw new QueryException("INVALID_RESOURCE", "Use an exact resource name returned by get_resource_economy."); var em = world.EntityManager; var rows = new List<Entity>();
            using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Resources>() }, None = new[] { ComponentType.ReadOnly<Deleted>(), ComponentType.ReadOnly<Game.Tools.Temp>(), ComponentType.ReadOnly<PrefabData>() } })) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) { if (selected != Resource.NoResource && EconomyUtils.GetResources(selected, em.GetBuffer<Resources>(entity, true)) == 0) continue; rows.Add(entity); }
            rows.Sort((a, b) => a.Index.CompareTo(b.Index)); return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(e => ResourceHolderJson(e, world))) };
        }

        private JObject SetCitizenAttributes(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = ParseEntity((string)args["citizen_id"], em); if (!em.HasComponent<Citizen>(entity)) throw new QueryException("CITIZEN_NOT_FOUND", "citizen_id must identify a citizen."); if (args["health"] == null && args["wellbeing"] == null && args["education_level"] == null) throw new QueryException("INVALID_ARGUMENT", "Provide health, wellbeing, or education_level."); var value = em.GetComponentData<Citizen>(entity); var before = new JObject { ["health"] = value.m_Health, ["wellbeing"] = value.m_WellBeing, ["education_level"] = value.GetEducationLevel() }; if (args["health"] != null) value.m_Health = (byte)ComponentInspector.Int(args, "health", 0, 0, 100); if (args["wellbeing"] != null) value.m_WellBeing = (byte)ComponentInspector.Int(args, "wellbeing", 0, 0, 100); if (args["education_level"] != null) value.SetEducationLevel(ComponentInspector.Int(args, "education_level", 0, 0, 4)); em.SetComponentData(entity, value); return new JObject { ["citizen_id"] = EntityId(entity), ["before"] = before, ["after"] = new JObject { ["health"] = value.m_Health, ["wellbeing"] = value.m_WellBeing, ["education_level"] = value.GetEducationLevel() } };
        }

        private JObject SetHouseholdMoney(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = ParseEntity((string)args["household_id"], em); if (!em.HasComponent<Household>(entity) || !em.HasBuffer<Resources>(entity)) throw new QueryException("HOUSEHOLD_NOT_FOUND", "household_id must identify a household with a resource buffer."); int amount = ComponentInspector.Int(args, "money", -1, 0, 2000000000); var buffer = em.GetBuffer<Resources>(entity); int before = EconomyUtils.GetResources(Resource.Money, buffer); EconomyUtils.SetResources(Resource.Money, buffer, amount); return new JObject { ["household_id"] = EntityId(entity), ["money_before"] = before, ["money"] = EconomyUtils.GetResources(Resource.Money, buffer) };
        }

        private JObject SetCompanyProfitability(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = ParseEntity((string)args["company_id"], em); if (!em.HasComponent<CompanyData>(entity) || !em.HasComponent<Profitability>(entity)) throw new QueryException("COMPANY_PROFITABILITY_UNAVAILABLE", "company_id must identify a company with Profitability."); int amount = ComponentInspector.Int(args, "profitability", -1, 0, 255); var value = em.GetComponentData<Profitability>(entity); int before = value.m_Profitability; value.m_Profitability = (byte)amount; em.SetComponentData(entity, value); return new JObject { ["company_id"] = EntityId(entity), ["profitability_before"] = before, ["profitability"] = amount, ["simulation_may_recalculate"] = true };
        }

        private JObject SetResourceAmount(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var entity = ParseEntity((string)args["holder_id"], em); if (!em.HasBuffer<Resources>(entity)) throw new QueryException("RESOURCE_HOLDER_NOT_FOUND", "holder_id must identify an entity returned by list_resource_holders."); Resource resource; if (!Enum.TryParse((string)args["resource"] ?? "", true, out resource) || resource == Resource.NoResource || resource == Resource.All || resource == Resource.Last) throw new QueryException("INVALID_RESOURCE", "Use an exact resource name returned by get_resource_economy."); int amount = ComponentInspector.Int(args, "amount", -1, 0, 2000000000); var buffer = em.GetBuffer<Resources>(entity); int before = EconomyUtils.GetResources(resource, buffer); EconomyUtils.SetResources(resource, buffer, amount); return new JObject { ["holder_id"] = EntityId(entity), ["resource"] = resource.ToString(), ["amount_before"] = before, ["amount"] = EconomyUtils.GetResources(resource, buffer) };
        }
    }
}
