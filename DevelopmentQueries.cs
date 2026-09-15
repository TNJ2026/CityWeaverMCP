using System;
using System.Linq;
using System.Reflection;
using Game.City;
using Game.Companies;
using Game.Economy;
using Game.Prefabs;
using Game.Simulation;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;

namespace CitiesSkylines2Mod
{
    public sealed partial class GameQueryService
    {
        private static readonly string[] DemandFactorNames = {
            "storage_levels", "uneducated_workforce", "educated_workforce", "company_wealth", "local_demand",
            "unemployment", "free_workplaces", "happiness", "homelessness", "tourist_demand", "local_inputs",
            "taxes", "students", "empty_buildings", "empty_zones", "poor_zone_location", "petrol_local_demand",
            "warehouses", "building_demand"
        };
        private static JObject WorkplacesJson(Workplaces value) => new JObject {
            ["total"] = value.TotalCount, ["uneducated"] = value.m_Uneducated,
            ["poorly_educated"] = value.m_PoorlyEducated, ["educated"] = value.m_Educated,
            ["well_educated"] = value.m_WellEducated, ["highly_educated"] = value.m_HighlyEducated,
            ["simple"] = value.SimpleWorkplacesCount, ["complex"] = value.ComplexWorkplacesCount
        };

        private static JObject DensityJson(Unity.Mathematics.int3 value) => new JObject {
            ["low"] = value.x, ["medium"] = value.y, ["high"] = value.z, ["total"] = value.x + value.y + value.z
        };

        private static JArray DemandFactors(NativeArray<int> values, JobHandle dependency)
        {
            dependency.Complete();
            var result = new JArray();
            int count = Math.Min(values.Length, (int)DemandFactor.Count);
            for (int i = 0; i < count; i++) result.Add(new JObject {
                ["factor"] = DemandFactorNames[i], ["value"] = values[i]
            });
            return result;
        }

        private static bool UnlimitedDemand(object system)
        {
            var field = system.GetType().GetField("m_UnlimitedDemand", BindingFlags.Instance | BindingFlags.NonPublic);
            return field != null && (bool)field.GetValue(system);
        }

        private JObject DemandOverrideSettings(World world)
        {
            var residential = world.GetExistingSystemManaged<ResidentialDemandSystem>();
            var commercial = world.GetExistingSystemManaged<CommercialDemandSystem>();
            var industrial = world.GetExistingSystemManaged<IndustrialDemandSystem>();
            return new JObject {
                ["residential"] = UnlimitedDemand(residential),
                ["commercial"] = UnlimitedDemand(commercial),
                ["industrial_office"] = UnlimitedDemand(industrial),
                ["session_only"] = true
            };
        }

        private JObject GetZoneDemand(World world)
        {
            var residential = world.GetExistingSystemManaged<ResidentialDemandSystem>();
            var commercial = world.GetExistingSystemManaged<CommercialDemandSystem>();
            var industrial = world.GetExistingSystemManaged<IndustrialDemandSystem>();
            JobHandle lowDep, mediumDep, highDep, commercialDep, industrialDep, officeDep;
            var low = DemandFactors(residential.GetLowDensityDemandFactors(out lowDep), lowDep);
            var medium = DemandFactors(residential.GetMediumDensityDemandFactors(out mediumDep), mediumDep);
            var high = DemandFactors(residential.GetHighDensityDemandFactors(out highDep), highDep);
            var commercialFactors = DemandFactors(commercial.GetDemandFactors(out commercialDep), commercialDep);
            var industrialFactors = DemandFactors(industrial.GetIndustrialDemandFactors(out industrialDep), industrialDep);
            var officeFactors = DemandFactors(industrial.GetOfficeDemandFactors(out officeDep), officeDep);
            return new JObject {
                ["residential"] = new JObject {
                    ["household_demand"] = residential.householdDemand,
                    ["building_demand"] = DensityJson(residential.buildingDemand),
                    ["factors"] = new JObject { ["low"] = low, ["medium"] = medium, ["high"] = high }
                },
                ["commercial"] = new JObject { ["company_demand"] = commercial.companyDemand, ["building_demand"] = commercial.buildingDemand, ["factors"] = commercialFactors },
                ["industrial"] = new JObject { ["company_demand"] = industrial.industrialCompanyDemand, ["building_demand"] = industrial.industrialBuildingDemand, ["factors"] = industrialFactors },
                ["office"] = new JObject { ["company_demand"] = industrial.officeCompanyDemand, ["building_demand"] = industrial.officeBuildingDemand, ["factors"] = officeFactors },
                ["storage"] = new JObject { ["company_demand"] = industrial.storageCompanyDemand, ["building_demand"] = industrial.storageBuildingDemand },
                ["unlimited_demand"] = DemandOverrideSettings(world),
                ["factor_scale_note"] = "Signed native factor contributions; positive values raise demand and negative values reduce it."
            };
        }

        private JObject GetResourceDemand(JObject args, World world)
        {
            bool includeZero = (bool?)args["include_zero"] ?? false;
            var commercial = world.GetExistingSystemManaged<CommercialDemandSystem>();
            var industrial = world.GetExistingSystemManaged<IndustrialDemandSystem>();
            JobHandle aDep, bDep, cDep, dDep, eDep, fDep, gDep, hDep;
            var commercialCompany = commercial.GetResourceDemands(out aDep); aDep.Complete();
            var commercialBuilding = commercial.GetBuildingDemands(out bDep); bDep.Complete();
            var commercialConsumption = commercial.GetConsumption(out cDep); cDep.Complete();
            var industrialCompany = industrial.GetResourceDemands(out dDep); dDep.Complete();
            var industrialBuilding = industrial.GetBuildingDemands(out eDep); eDep.Complete();
            var industrialConsumption = industrial.GetIndustrialResourceDemands(out fDep); fDep.Complete();
            var storageCompany = industrial.GetStorageCompanyDemands(out gDep); gDep.Complete();
            var storageBuilding = industrial.GetStorageBuildingDemands(out hDep); hDep.Complete();
            int count = new[] { commercialCompany.Length, commercialBuilding.Length, commercialConsumption.Length, industrialCompany.Length, industrialBuilding.Length, industrialConsumption.Length, storageCompany.Length, storageBuilding.Length, EconomyUtils.ResourceCount }.Min();
            var rows = new JArray();
            for (int i = 0; i < count; i++) {
                int[] values = { commercialCompany[i], commercialBuilding[i], commercialConsumption[i], industrialCompany[i], industrialBuilding[i], industrialConsumption[i], storageCompany[i], storageBuilding[i] };
                if (!includeZero && Array.TrueForAll(values, x => x == 0)) continue;
                rows.Add(new JObject {
                    ["resource"] = EconomyUtils.GetResource(i).ToString(),
                    ["commercial_company"] = values[0], ["commercial_building"] = values[1], ["commercial_consumption"] = values[2],
                    ["industrial_company"] = values[3], ["industrial_building"] = values[4], ["industrial_consumption"] = values[5],
                    ["storage_company"] = values[6], ["storage_building"] = values[7]
                });
            }
            return new JObject { ["items"] = rows, ["total"] = rows.Count, ["include_zero"] = includeZero };
        }

        private JObject GetPopulationDemographics(World world)
        {
            var system = world.GetExistingSystemManaged<CountHouseholdDataSystem>();
            var city = world.GetExistingSystemManaged<CitySystem>().City;
            var population = world.EntityManager.GetComponentData<Population>(city);
            return new JObject {
                ["population"] = population.m_Population, ["population_with_move_in"] = population.m_PopulationWithMoveIn,
                ["average_happiness"] = system.AverageCitizenHappiness, ["average_health"] = system.AverageCitizenHealth,
                ["ages"] = new JObject { ["children"] = system.ChildrenCount, ["teens"] = system.TeenCount, ["adults"] = system.AdultCount, ["seniors"] = system.SeniorCount },
                ["education"] = new JObject { ["uneducated"] = system.UneducatedCount, ["poorly_educated"] = system.PoorlyEducatedCount, ["educated"] = system.EducatedCount, ["well_educated"] = system.WellEducatedCount, ["highly_educated"] = system.HighlyEducatedCount },
                ["students"] = system.StudentCount, ["dead_citizens"] = system.DeadCitizenCount,
                ["migration"] = new JObject { ["moving_in_households"] = system.MovingInHouseholdCount, ["moving_in_citizens"] = system.MovingInCitizenCount, ["moving_away_households"] = system.MovingAwayHouseholdCount, ["moved_in_households"] = system.MovedInHouseholdCount, ["moved_in_citizens"] = system.MovedInCitizenCount },
                ["visitors"] = new JObject { ["commuter_households"] = system.CommuterHouseholdCount, ["tourist_citizens"] = system.TouristCitizenCount },
                ["homeless"] = new JObject { ["households"] = system.HomelessHouseholdCount, ["citizens"] = system.HomelessCitizenCount, ["rate"] = system.HomelessnessRate }
            };
        }

        private JObject GetHousingStatistics(World world)
        {
            var system = world.GetExistingSystemManaged<CountResidentialPropertySystem>();
            var data = system.GetResidentialPropertyData();
            var occupied = data.m_TotalProperties - data.m_FreeProperties;
            return new JObject {
                ["properties"] = new JObject { ["total"] = DensityJson(data.m_TotalProperties), ["free"] = DensityJson(data.m_FreeProperties), ["occupied"] = DensityJson(occupied) },
                ["shelter_capacity"] = new JObject { ["total"] = data.m_TotalShelterCapacity, ["free"] = data.m_FreeShelterCapacity, ["used"] = data.m_TotalShelterCapacity - data.m_FreeShelterCapacity },
                ["unit_note"] = "Property counts are rentable residential units grouped by native low, medium and high density, not building entity counts."
            };
        }

        private JObject GetEmploymentStatistics(World world)
        {
            var workplaces = world.GetExistingSystemManaged<CountWorkplacesSystem>();
            var households = world.GetExistingSystemManaged<CountHouseholdDataSystem>();
            return new JObject {
                ["workplaces"] = WorkplacesJson(workplaces.GetTotalWorkplaces()),
                ["free_workplaces"] = WorkplacesJson(workplaces.GetFreeWorkplaces()),
                ["accessible_free_workplaces_by_education"] = WorkplacesJson(workplaces.GetUnemployedWorkspaceByLevel()),
                ["workable_citizens"] = households.WorkableCitizenCount, ["city_workers"] = households.CityWorkerCount,
                ["unemployment_rate"] = households.UnemploymentRate,
                ["accessibility_note"] = "Each education level is cumulative and includes vacant jobs that citizens at that level can fill."
            };
        }

        private JObject GetEducationStatistics(World world)
        {
            var households = world.GetExistingSystemManaged<CountHouseholdDataSystem>();
            var studies = world.GetExistingSystemManaged<CountStudyPositionsSystem>();
            JobHandle studyDep, employableDep;
            var positions = studies.GetStudyPositionsByEducation(out studyDep); studyDep.Complete();
            var employable = households.GetEmployables(out employableDep); employableDep.Complete();
            string[] levels = { "uneducated", "poorly_educated", "educated", "well_educated", "highly_educated" };
            var rows = new JArray();
            for (int i = 0; i < Math.Min(5, Math.Min(positions.Length, employable.Length)); i++) rows.Add(new JObject {
                ["education_level"] = i, ["name"] = levels[i], ["citizens"] = i == 0 ? households.UneducatedCount : i == 1 ? households.PoorlyEducatedCount : i == 2 ? households.EducatedCount : i == 3 ? households.WellEducatedCount : households.HighlyEducatedCount,
                ["employable"] = employable[i], ["study_positions"] = positions[i]
            });
            return new JObject { ["levels"] = rows, ["students_total"] = households.StudentCount };
        }

        private JObject SetUnlimitedDemand(JObject args, World world)
        {
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing unlimited demand.");
            string scope = ((string)args["scope"] ?? "").ToLowerInvariant();
            bool enabled = (bool?)args["enabled"] ?? throw new QueryException("INVALID_ARGUMENT", "enabled is required.");
            var residential = world.GetExistingSystemManaged<ResidentialDemandSystem>();
            var commercial = world.GetExistingSystemManaged<CommercialDemandSystem>();
            var industrial = world.GetExistingSystemManaged<IndustrialDemandSystem>();
            if (scope == "residential" || scope == "all") residential.SetUnlimitedDemand(enabled);
            if (scope == "commercial" || scope == "all") commercial.SetUnlimitedDemand(enabled);
            if (scope == "industrial" || scope == "all") industrial.SetUnlimitedDemand(enabled);
            if (scope != "residential" && scope != "commercial" && scope != "industrial" && scope != "all") throw new QueryException("INVALID_ARGUMENT", "scope must be residential, commercial, industrial, or all.");
            return new JObject { ["scope"] = scope, ["enabled"] = enabled, ["settings"] = DemandOverrideSettings(world), ["takes_effect_on_next_demand_update"] = true };
        }
    }
}
