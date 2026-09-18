using System;
using System.Collections.Generic;
using System.Linq;
using Game.City;
using Game.Common;
using Game.Economy;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    public sealed class EconomyOperation
    {
        public string Id = Guid.NewGuid().ToString("N");
        public string Session, RequestId, Fingerprint, Type, Target, State = "preview_ready", Error;
        public double OldValue, NewValue;
        public DateTime Created = DateTime.UtcNow;
        public bool Applied;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["operation_type"] = Type, ["target"] = Target, ["state"] = State,
            ["old_value"] = OldValue, ["new_value"] = NewValue, ["error"] = Error == null ? JValue.CreateNull() : new JValue(Error),
            ["created_at_utc"] = Created.ToString("O"), ["expires_at_utc"] = Created.AddMinutes(5).ToString("O"),
            ["can_apply"] = State == "preview_ready", ["applied"] = Applied
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, EconomyOperation> m_EconomyOperations = new Dictionary<string, EconomyOperation>();
        private readonly Dictionary<string, string> m_EconomyRequestIds = new Dictionary<string, string>();
        private void ResetEconomyOperations() { m_EconomyOperations.Clear(); m_EconomyRequestIds.Clear(); }

        private static JObject LoanJson(LoanInfo x) => new JObject { ["amount"] = x.m_Amount, ["daily_interest_rate"] = x.m_DailyInterestRate, ["daily_payment"] = x.m_DailyPayment };
        private static string LowerEnum<T>(T value) => value.ToString().ToLowerInvariant();
        private static EntityQuery SystemQuery(EntityManager em, ComponentType type) => em.CreateEntityQuery(new EntityQueryDesc { All = new[] { type }, Options = EntityQueryOptions.IncludeSystems });

        private JObject GetCityEconomy(World world)
        {
            var em = world.EntityManager; var city = world.GetExistingSystemManaged<CitySystem>().City;
            var budgets = world.GetExistingSystemManaged<CityServiceBudgetSystem>(); var loan = world.GetExistingSystemManaged<LoanSystem>();
            var income = new JArray(); for (int i = 0; i < (int)IncomeSource.Count; i++) income.Add(new JObject { ["source"] = LowerEnum((IncomeSource)i), ["amount"] = budgets.GetIncome((IncomeSource)i) });
            var expenses = new JArray(); for (int i = 0; i < (int)ExpenseSource.Count; i++) expenses.Add(new JObject { ["source"] = LowerEnum((ExpenseSource)i), ["amount"] = -budgets.GetExpense((ExpenseSource)i) });
            return new JObject {
                ["money"] = em.GetComponentData<PlayerMoney>(city).money, ["income_total"] = budgets.GetTotalIncome(),
                ["expense_total"] = budgets.GetTotalExpenses(), ["balance"] = budgets.GetBalance(), ["hourly_money_delta"] = budgets.GetMoneyDelta(),
                ["tax_income_total"] = budgets.GetTotalTaxIncome(), ["income"] = income, ["expenses"] = expenses,
                ["loan"] = LoanJson(loan.CurrentLoan), ["credit_limit"] = loan.Creditworthiness
            };
        }

        private static TaxAreaType TaxArea(string value, bool allowResidential = true)
        {
            TaxAreaType result;
            if (!Enum.TryParse(value ?? "", true, out result) || result == TaxAreaType.None || (!allowResidential && result == TaxAreaType.Residential))
                throw new QueryException("INVALID_TAX_AREA", allowResidential ? "area must be residential, commercial, industrial, or office." : "area must be commercial, industrial, or office.");
            return result;
        }
        private static Resource TaxResource(string value)
        {
            Resource resource;
            if (!Enum.TryParse(value ?? "", true, out resource) || resource == Resource.NoResource || resource == Resource.Money || resource == Resource.All || resource == Resource.Last)
                throw new QueryException("INVALID_TAX_RESOURCE", "Use an exact resource name returned by get_tax_settings.");
            return resource;
        }
        private static int TaxRateFor(TaxSystem taxes, string scope, string target)
        {
            if (scope == "main") return taxes.TaxRate;
            if (scope == "area") return taxes.GetTaxRate(TaxArea(target));
            if (scope == "residential_education") return taxes.GetResidentialTaxRate(int.Parse(target));
            var parts = target.Split(':'); var area = TaxArea(parts[0], false); var resource = TaxResource(parts[1]);
            return area == TaxAreaType.Commercial ? taxes.GetCommercialTaxRate(resource) : area == TaxAreaType.Industrial ? taxes.GetIndustrialTaxRate(resource) : taxes.GetOfficeTaxRate(resource);
        }
        private static void SetTaxRateFor(TaxSystem taxes, string scope, string target, int value)
        {
            taxes.Readers.Complete();
            if (scope == "main") taxes.TaxRate = value;
            else if (scope == "area") taxes.SetTaxRate(TaxArea(target), value);
            else if (scope == "residential_education") taxes.SetResidentialTaxRate(int.Parse(target), value);
            else { var parts = target.Split(':'); var area = TaxArea(parts[0], false); var resource = TaxResource(parts[1]); if (area == TaxAreaType.Commercial) taxes.SetCommercialTaxRate(resource, value); else if (area == TaxAreaType.Industrial) taxes.SetIndustrialTaxRate(resource, value); else taxes.SetOfficeTaxRate(resource, value); }
        }
        private static JObject RangeJson(Unity.Mathematics.int2 x) => new JObject { ["min"] = x.x, ["max"] = x.y };

        private JObject GetTaxSettings(World world)
        {
            var em = world.EntityManager; var taxes = world.GetExistingSystemManaged<TaxSystem>(); taxes.Readers.Complete(); var limits = taxes.GetTaxParameterData();
            var areas = new JArray();
            foreach (var area in new[] { TaxAreaType.Residential, TaxAreaType.Commercial, TaxAreaType.Industrial, TaxAreaType.Office }) {
                var range = area == TaxAreaType.Residential ? limits.m_ResidentialTaxLimits : area == TaxAreaType.Commercial ? limits.m_CommercialTaxLimits : area == TaxAreaType.Industrial ? limits.m_IndustrialTaxLimits : limits.m_OfficeTaxLimits;
                areas.Add(new JObject { ["area"] = LowerEnum(area), ["rate"] = taxes.GetTaxRate(area), ["range"] = RangeJson(range) });
            }
            var education = new JArray(); for (int i = 0; i < 5; i++) education.Add(new JObject { ["education_level"] = i, ["rate"] = taxes.GetResidentialTaxRate(i) });
            var resources = new JArray(); var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<ResourceData>(), ComponentType.ReadOnly<TaxableResourceData>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var e in entities) {
                if (!ps.TryGetPrefab<ResourcePrefab>(e, out var prefab)) continue; var r = EconomyUtils.GetResource(prefab.m_Resource); var taxable = em.GetComponentData<TaxableResourceData>(e);
                var row = new JObject { ["resource"] = r.ToString() };
                foreach (var area in new[] { TaxAreaType.Commercial, TaxAreaType.Industrial, TaxAreaType.Office }) if (taxable.Contains(area)) row[LowerEnum(area)] = area == TaxAreaType.Commercial ? taxes.GetCommercialTaxRate(r) : area == TaxAreaType.Industrial ? taxes.GetIndustrialTaxRate(r) : taxes.GetOfficeTaxRate(r);
                resources.Add(row);
            }
            return new JObject { ["main_rate"] = taxes.TaxRate, ["main_range"] = RangeJson(limits.m_TotalTaxLimits), ["areas"] = areas,
                ["residential_education"] = education, ["residential_education_range"] = RangeJson(limits.m_JobLevelTaxLimits),
                ["resources"] = new JArray(resources.OrderBy(x => (string)x["resource"])), ["resource_range"] = RangeJson(limits.m_ResourceTaxLimits) };
        }

        private Entity ResolveServicePrefab(string name, World world, bool requireAdjustable)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<ServiceData>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (ps.TryGetPrefab<PrefabBase>(e, out var p) && string.Equals(p.name, name, StringComparison.OrdinalIgnoreCase)) {
                if (requireAdjustable && !em.GetComponentData<ServiceData>(e).m_BudgetAdjustable) throw new QueryException("SERVICE_BUDGET_FIXED", "This service budget is not adjustable."); return e;
            }
            throw new QueryException("SERVICE_PREFAB_NOT_FOUND", "Use an exact service_prefab from list_service_budgets.");
        }
        private JObject ListServiceBudgets(World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var system = world.GetExistingSystemManaged<CityServiceBudgetSystem>(); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<ServiceData>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) {
                if (!ps.TryGetPrefab<PrefabBase>(e, out var p)) continue; var d = em.GetComponentData<ServiceData>(e); int budget = system.GetServiceBudget(e); system.GetEstimatedServiceBudget(e, out var upkeep);
                rows.Add(new JObject { ["service_prefab"] = p.name, ["city_service"] = LowerEnum(d.m_Service), ["locked"] = RoadOperation.IsLocked(em, e), ["adjustable"] = d.m_BudgetAdjustable,
                    ["budget_percent"] = budget, ["efficiency_percent"] = system.GetServiceEfficiency(e, budget), ["estimated_upkeep"] = -upkeep });
            }
            return new JObject { ["items"] = new JArray(rows.OrderBy(x => (string)x["service_prefab"])), ["total"] = rows.Count };
        }

        private Entity City(World world) => world.GetExistingSystemManaged<CitySystem>().City;
        private ServiceFeeParameterData FeeParameters(World world) { using (var q = SystemQuery(world.EntityManager, ComponentType.ReadOnly<ServiceFeeParameterData>())) return q.GetSingleton<ServiceFeeParameterData>(); }
        private JObject ListServiceFees(World world)
        {
            var em = world.EntityManager; var city = City(world); var parameters = FeeParameters(world); var fees = em.GetBuffer<ServiceFee>(city, true); var rows = new JArray();
            for (int i = 0; i < fees.Length; i++) { var f = fees[i]; var p = parameters.GetFeeParameters(f.m_Resource); rows.Add(new JObject { ["resource"] = LowerEnum(f.m_Resource), ["fee"] = f.m_Fee, ["default_fee"] = p.m_Default, ["maximum_fee"] = p.m_Max, ["adjustable"] = p.m_Adjustable }); }
            return new JObject { ["total"] = rows.Count, ["items"] = rows };
        }
        private static PlayerResource FeeResource(string value)
        {
            PlayerResource resource; if (!Enum.TryParse(value ?? "", true, out resource) || resource == PlayerResource.Count || resource == PlayerResource.Parking)
                throw new QueryException("INVALID_SERVICE_FEE", "Use an adjustable resource returned by list_service_fees; parking is managed by parking policies."); return resource;
        }
        private double CurrentFee(World world, string target) { var resource = FeeResource(target); var buffer = world.EntityManager.GetBuffer<ServiceFee>(City(world), true); if (!ServiceFeeSystem.TryGetFee(resource, buffer, out var fee)) throw new QueryException("SERVICE_FEE_NOT_FOUND", "The city has no fee entry for this resource."); return fee; }

        private JObject GetLoanStatus(World world)
        {
            var system = world.GetExistingSystemManaged<LoanSystem>(); var current = system.CurrentLoan;
            return new JObject { ["current"] = LoanJson(current), ["credit_limit"] = system.Creditworthiness,
                ["minimum_repayable_amount"] = system.RequestLoanOffer(0).m_Amount };
        }

        private EconomyOperation AddEconomyOperation(JObject args, string type, string target, double oldValue, double newValue)
        {
            string key = RequestKey(args), fp = new JObject { ["type"] = type, ["target"] = target, ["new_value"] = newValue }.ToString(Formatting.None);
            if (m_EconomyRequestIds.TryGetValue(key, out var existing)) { var prior = m_EconomyOperations[existing]; if (prior.Fingerprint != fp) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another economy operation."); return prior; }
            if (m_EconomyOperations.Count >= 256) throw new QueryException("TOO_MANY_OPERATIONS", "This city session already contains 256 economy operations.");
            var op = new EconomyOperation { Session = m_Session, RequestId = key, Fingerprint = fp, Type = type, Target = target, OldValue = oldValue, NewValue = newValue };
            m_EconomyOperations.Add(op.Id, op); m_EconomyRequestIds.Add(key, op.Id); return op;
        }
        private JObject PreviewTaxChange(JObject args, World world)
        {
            string scope = ((string)args["scope"] ?? "").ToLowerInvariant(), target;
            if (scope == "main") target = "main";
            else if (scope == "area") target = LowerEnum(TaxArea((string)args["area"]));
            else if (scope == "residential_education") { int level = ComponentInspector.Int(args, "education_level", -1, 0, 4); target = level.ToString(); }
            else if (scope == "resource") target = LowerEnum(TaxArea((string)args["area"], false)) + ":" + TaxResource((string)args["resource"]);
            else throw new QueryException("INVALID_ARGUMENT", "scope must be main, area, residential_education, or resource.");
            int rate = ComponentInspector.Int(args, "rate", -101, -100, 100); var taxes = world.GetExistingSystemManaged<TaxSystem>(); var settings = taxes.GetTaxParameterData(); Unity.Mathematics.int2 range;
            if (scope == "main") range = settings.m_TotalTaxLimits; else if (scope == "residential_education") range = settings.m_JobLevelTaxLimits; else if (scope == "resource") range = settings.m_ResourceTaxLimits; else { var a = TaxArea(target); range = a == TaxAreaType.Residential ? settings.m_ResidentialTaxLimits : a == TaxAreaType.Commercial ? settings.m_CommercialTaxLimits : a == TaxAreaType.Industrial ? settings.m_IndustrialTaxLimits : settings.m_OfficeTaxLimits; }
            if (rate < range.x || rate > range.y) throw new QueryException("TAX_RATE_OUT_OF_RANGE", "rate is outside the current native range " + range.x + ".." + range.y + ".");
            return AddEconomyOperation(args, "tax:" + scope, target, TaxRateFor(taxes, scope, target), rate).Json();
        }
        private JObject PreviewServiceBudget(JObject args, World world)
        {
            string name = ((string)args["service_prefab"] ?? "").Trim(); var e = ResolveServicePrefab(name, world, true); int value = ComponentInspector.Int(args, "budget_percent", -1, 50, 150);
            return AddEconomyOperation(args, "service_budget", name, world.GetExistingSystemManaged<CityServiceBudgetSystem>().GetServiceBudget(e), value).Json();
        }
        private JObject PreviewServiceFee(JObject args, World world)
        {
            string target = LowerEnum(FeeResource((string)args["resource"])); double value = (double?)args["fee"] ?? double.NaN; var p = FeeParameters(world).GetFeeParameters(FeeResource(target));
            if (!p.m_Adjustable) throw new QueryException("SERVICE_FEE_FIXED", "This fee is not adjustable."); if (double.IsNaN(value) || double.IsInfinity(value) || value < 0 || value > p.m_Max) throw new QueryException("SERVICE_FEE_OUT_OF_RANGE", "fee must be between 0 and the native maximum.");
            return AddEconomyOperation(args, "service_fee", target, CurrentFee(world, target), value).Json();
        }
        private JObject PreviewLoanChange(JObject args, World world)
        {
            int amount = ComponentInspector.Int(args, "amount", -1, 0, 1000000000); var system = world.GetExistingSystemManaged<LoanSystem>(); var offer = system.RequestLoanOffer(amount);
            if (offer.m_Amount != amount) throw new QueryException("LOAN_AMOUNT_UNAVAILABLE", "The requested amount is outside the current borrowing/repayment range.");
            return AddEconomyOperation(args, "loan", "city_loan", system.CurrentLoan.m_Amount, amount).Json();
        }
        private EconomyOperation EconomyOperationById(JObject args)
        {
            string id = ((string)args["operation_id"] ?? "").Trim(); if (!m_EconomyOperations.TryGetValue(id, out var op) || op.Session != m_Session) throw new QueryException("ECONOMY_OPERATION_NOT_FOUND", "Unknown economy operation for this city session.");
            if (op.State == "preview_ready" && DateTime.UtcNow > op.Created.AddMinutes(5)) { op.State = "expired"; op.Error = "Preview expired before application."; }
            return op;
        }
        private double CurrentEconomyValue(EconomyOperation op, World world)
        {
            if (op.Type.StartsWith("tax:")) return TaxRateFor(world.GetExistingSystemManaged<TaxSystem>(), op.Type.Substring(4), op.Target);
            if (op.Type == "service_budget") return world.GetExistingSystemManaged<CityServiceBudgetSystem>().GetServiceBudget(ResolveServicePrefab(op.Target, world, false));
            if (op.Type == "service_fee") return CurrentFee(world, op.Target);
            return world.GetExistingSystemManaged<LoanSystem>().CurrentLoan.m_Amount;
        }
        private JObject GetEconomyOperation(JObject args, World world)
        {
            var op = EconomyOperationById(args); if (op.State == "applying" && Math.Abs(CurrentEconomyValue(op, world) - op.NewValue) < .0001) { op.State = "completed"; op.Applied = true; }
            return op.Json();
        }
        private JObject ApplyEconomyOperation(JObject args, World world)
        {
            var op = EconomyOperationById(args); if (RequestKey(args) != op.RequestId) throw new QueryException("REQUEST_ID_CONFLICT", "Use the same request_id as the preview."); if (op.State == "completed") return op.Json();
            if (op.State != "preview_ready") throw new QueryException("INVALID_OPERATION_STATE", "Only a preview_ready economy operation can be applied.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before applying an economy operation.");
            double current = CurrentEconomyValue(op, world); if (Math.Abs(current - op.OldValue) > .0001) throw new QueryException("ECONOMY_CONFLICT", "The setting changed after preview; create a new preview.");
            if (op.Type.StartsWith("tax:")) SetTaxRateFor(world.GetExistingSystemManaged<TaxSystem>(), op.Type.Substring(4), op.Target, (int)op.NewValue);
            else if (op.Type == "service_budget") world.GetExistingSystemManaged<CityServiceBudgetSystem>().SetServiceBudget(ResolveServicePrefab(op.Target, world, true), (int)op.NewValue);
            else if (op.Type == "service_fee") { var em = world.EntityManager; em.CompleteAllTrackedJobs(); ServiceFeeSystem.SetFee(FeeResource(op.Target), em.GetBuffer<ServiceFee>(City(world)), (float)op.NewValue); }
            else world.GetExistingSystemManaged<LoanSystem>().ChangeLoan((int)op.NewValue);
            op.Applied = true; op.State = op.Type == "loan" ? "applying" : Math.Abs(CurrentEconomyValue(op, world) - op.NewValue) < .0001 ? "completed" : "outcome_unknown"; return op.Json();
        }
        private JObject CancelEconomyOperation(JObject args)
        {
            var op = EconomyOperationById(args); if (op.State != "preview_ready") throw new QueryException("INVALID_OPERATION_STATE", "Only an uncommitted preview can be cancelled."); op.State = "cancelled"; return op.Json();
        }
    }
}
