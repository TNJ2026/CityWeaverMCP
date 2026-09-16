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
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed partial class GameQueryService
    {
        private Entity StableCitizen(string id, World world) { var e = ParseEntity(id, world.EntityManager); if (!world.EntityManager.HasComponent<Citizen>(e) || world.EntityManager.HasComponent<Deleted>(e)) throw new QueryException("CITIZEN_NOT_FOUND", "citizen_id must identify a permanent citizen."); return e; }
        private Entity StableHousehold(string id, World world) { var e = ParseEntity(id, world.EntityManager); if (!world.EntityManager.HasComponent<Household>(e) || world.EntityManager.HasComponent<Deleted>(e)) throw new QueryException("HOUSEHOLD_NOT_FOUND", "household_id must identify a permanent household."); return e; }
        private Entity StableCompany(string id, World world) { var e = ParseEntity(id, world.EntityManager); if (!world.EntityManager.HasComponent<CompanyData>(e) || world.EntityManager.HasComponent<Deleted>(e)) throw new QueryException("COMPANY_NOT_FOUND", "company_id must identify a permanent company."); return e; }

        private JObject ListCitizenPrefabs(JObject args, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<CitizenData>(), ComponentType.ReadOnly<ArchetypeData>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (ps.TryGetPrefab<PrefabBase>(e, out var p)) rows.Add(new JObject { ["name"] = p.name, ["male"] = em.GetComponentData<CitizenData>(e).m_Male });
            return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows.OrderBy(x => (string)x["name"])) };
        }

        private Entity ResolveDataPrefab<T>(string name, World world) where T : unmanaged, IComponentData
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<T>(), ComponentType.ReadOnly<ArchetypeData>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (ps.TryGetPrefab<PrefabBase>(e, out var p) && string.Equals(p.name, name, StringComparison.OrdinalIgnoreCase)) return e;
            throw new QueryException("PREFAB_NOT_FOUND", "Use an exact prefab name returned by the corresponding list prefabs tool.");
        }

        private static void RemoveHouseholdCitizen(EntityManager em, Entity household, Entity citizen)
        {
            if (!em.Exists(household) || !em.HasBuffer<HouseholdCitizen>(household)) return; var b = em.GetBuffer<HouseholdCitizen>(household); for (int i = b.Length - 1; i >= 0; i--) if (b[i].m_Citizen == citizen) b.RemoveAt(i);
        }
        private static void AddHouseholdCitizen(EntityManager em, Entity household, Entity citizen)
        {
            if (!em.HasBuffer<HouseholdCitizen>(household)) em.AddBuffer<HouseholdCitizen>(household); var b = em.GetBuffer<HouseholdCitizen>(household); for (int i = 0; i < b.Length; i++) if (b[i].m_Citizen == citizen) return; b.Add(new HouseholdCitizen(citizen));
        }
        private static void RemoveEmployee(EntityManager em, Entity workplace, Entity citizen)
        {
            if (!em.Exists(workplace) || !em.HasBuffer<Employee>(workplace)) return; var b = em.GetBuffer<Employee>(workplace); for (int i = b.Length - 1; i >= 0; i--) if (b[i].m_Worker == citizen) b.RemoveAt(i);
        }
        private static void AddEmployee(EntityManager em, Entity workplace, Entity citizen, byte level)
        {
            if (!em.HasBuffer<Employee>(workplace)) em.AddBuffer<Employee>(workplace); var b = em.GetBuffer<Employee>(workplace); for (int i = 0; i < b.Length; i++) if (b[i].m_Worker == citizen) { b[i] = new Employee { m_Worker = citizen, m_Level = level }; return; } b.Add(new Employee { m_Worker = citizen, m_Level = level });
        }
        private static void RemoveStudent(EntityManager em, Entity school, Entity citizen)
        {
            if (!em.Exists(school) || !em.HasBuffer<Game.Buildings.Student>(school)) return; var b = em.GetBuffer<Game.Buildings.Student>(school); for (int i = b.Length - 1; i >= 0; i--) if (b[i].m_Student == citizen) b.RemoveAt(i);
        }
        private static void AddStudent(EntityManager em, Entity school, Entity citizen)
        {
            if (!em.HasBuffer<Game.Buildings.Student>(school)) throw new QueryException("SCHOOL_UNSUPPORTED", "school_id must identify a school with a Student buffer."); var b = em.GetBuffer<Game.Buildings.Student>(school); for (int i = 0; i < b.Length; i++) if (b[i].m_Student == citizen) return; b.Add(new Game.Buildings.Student(citizen));
        }
        private static void RemoveOccupant(EntityManager em, Entity building, Entity citizen)
        {
            if (!em.Exists(building) || !em.HasBuffer<Occupant>(building)) return; var b = em.GetBuffer<Occupant>(building); for (int i = b.Length - 1; i >= 0; i--) if (b[i].m_Occupant == citizen) b.RemoveAt(i);
        }
        private static void AddOccupant(EntityManager em, Entity building, Entity citizen)
        {
            if (!em.HasBuffer<Occupant>(building)) em.AddBuffer<Occupant>(building); var b = em.GetBuffer<Occupant>(building); for (int i = 0; i < b.Length; i++) if (b[i].m_Occupant == citizen) return; b.Add(new Occupant(citizen));
        }
        private static void RemoveRenter(EntityManager em, Entity property, Entity renter)
        {
            if (!em.Exists(property) || !em.HasBuffer<Renter>(property)) return; var b = em.GetBuffer<Renter>(property); for (int i = b.Length - 1; i >= 0; i--) if (b[i].m_Renter == renter) b.RemoveAt(i);
        }
        private static void AddRenter(EntityManager em, Entity property, Entity renter)
        {
            if (!em.HasBuffer<Renter>(property)) em.AddBuffer<Renter>(property); var b = em.GetBuffer<Renter>(property); for (int i = 0; i < b.Length; i++) if (b[i].m_Renter == renter) return; b.Add(new Renter { m_Renter = renter });
        }

        private static CitizenAge ParseAge(string text) { if (!Enum.TryParse(text, true, out CitizenAge value)) throw new QueryException("INVALID_AGE", "Use child, teen, adult, or elderly."); return value; }
        private static short BirthDayForAge(CitizenAge age, World world)
        {
            int days = age == CitizenAge.Child ? Math.Max(1, AgingSystem.GetTeenAgeLimitInDays() / 2) : age == CitizenAge.Teen ? (AgingSystem.GetTeenAgeLimitInDays() + AgingSystem.GetAdultAgeLimitInDays()) / 2 : age == CitizenAge.Adult ? (AgingSystem.GetAdultAgeLimitInDays() + AgingSystem.GetElderAgeLimitInDays()) / 2 : AgingSystem.GetElderAgeLimitInDays() + 2;
            var sim = world.GetExistingSystemManaged<SimulationSystem>(); using (var q = world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<TimeData>())) { int day = (int)TimeSystem.GetDay(sim.frameIndex, q.GetSingleton<TimeData>()); return (short)(day - days); }
        }

        private JObject CreateCitizen(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var household = StableHousehold((string)args["household_id"], world); var prefab = ResolveDataPrefab<CitizenData>((string)args["prefab"], world); var archetype = em.GetComponentData<ArchetypeData>(prefab).m_Archetype; var array = em.CreateEntity(archetype, 1, Allocator.Temp); var e = array[0]; array.Dispose();
            if (!em.HasComponent<PrefabRef>(e)) em.AddComponentData(e, new PrefabRef(prefab)); else em.SetComponentData(e, new PrefabRef(prefab)); if (!em.HasComponent<HouseholdMember>(e)) em.AddComponentData(e, new HouseholdMember { m_Household = household }); else em.SetComponentData(e, new HouseholdMember { m_Household = household });
            var age = ParseAge((string)args["age"] ?? "adult"); bool male = em.GetComponentData<CitizenData>(prefab).m_Male; var c = new Citizen { m_Health = (byte)((int?)args["health"] ?? 50), m_WellBeing = (byte)((int?)args["wellbeing"] ?? 50), m_PseudoRandom = (ushort)(e.Index & 65535), m_State = CitizenFlags.ValidCitizen, m_BirthDay = BirthDayForAge(age, world) }; c.SetAge(age); c.SetEducationLevel((int?)args["education_level"] ?? 0); if (male) c.m_State |= CitizenFlags.Male; em.SetComponentData(e, c); if (em.HasComponent<Created>(e)) em.RemoveComponent<Created>(e); AddHouseholdCitizen(em, household, e);
            if (em.HasComponent<PropertyRenter>(household)) { var property = em.GetComponentData<PropertyRenter>(household).m_Property; if (em.Exists(property)) { if (!em.HasComponent<CurrentBuilding>(e)) em.AddComponentData(e, new CurrentBuilding(property)); else em.SetComponentData(e, new CurrentBuilding(property)); AddOccupant(em, property, e); } }
            if (!string.IsNullOrWhiteSpace((string)args["name"])) world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(e, ((string)args["name"]).Trim()); return CitizenJson(e, world);
        }

        private JObject SetCitizenName(JObject args, World world) { var e = StableCitizen((string)args["citizen_id"], world); string name = ((string)args["name"] ?? "").Trim(); world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(e, name); return new JObject { ["citizen_id"] = EntityId(e), ["custom_name"] = name.Length == 0 ? null : new JValue(name) }; }
        private JObject SetCitizenProfile(JObject args, World world)
        {
            RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); var em = world.EntityManager; var c = em.GetComponentData<Citizen>(e); var before = CitizenJson(e, world); if (args["health"] != null) c.m_Health = (byte)(int)args["health"]; if (args["wellbeing"] != null) c.m_WellBeing = (byte)(int)args["wellbeing"]; if (args["education_level"] != null) c.SetEducationLevel((int)args["education_level"]); if (args["failed_education_count"] != null) c.SetFailedEducationCount((int)args["failed_education_count"]); if (args["age"] != null) { var age = ParseAge((string)args["age"]); c.SetAge(age); c.m_BirthDay = BirthDayForAge(age, world); } if (args["male"] != null) { if ((bool)args["male"]) c.m_State |= CitizenFlags.Male; else c.m_State &= ~CitizenFlags.Male; } if (args["leisure_counter"] != null) c.m_LeisureCounter = (byte)(int)args["leisure_counter"]; if (args["penalty_counter"] != null) c.m_PenaltyCounter = (byte)(int)args["penalty_counter"]; if (args["unemployment_counter"] != null) c.m_UnemploymentCounter = (int)args["unemployment_counter"]; if (args["unemployment_time"] != null) c.m_UnemploymentTimeCounter = (float)args["unemployment_time"]; if (args["sickness_penalty"] != null) c.m_SicknessPenalty = (int)args["sickness_penalty"]; em.SetComponentData(e, c); return new JObject { ["before"] = before, ["after"] = CitizenJson(e, world) };
        }

        private JObject SetCitizenHousehold(JObject args, World world)
        {
            RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); var target = StableHousehold((string)args["household_id"], world); var em = world.EntityManager; Entity before = em.HasComponent<HouseholdMember>(e) ? em.GetComponentData<HouseholdMember>(e).m_Household : Entity.Null; RemoveHouseholdCitizen(em, before, e); if (!em.HasComponent<HouseholdMember>(e)) em.AddComponentData(e, new HouseholdMember { m_Household = target }); else em.SetComponentData(e, new HouseholdMember { m_Household = target }); AddHouseholdCitizen(em, target, e); return new JObject { ["citizen_id"] = EntityId(e), ["household_before"] = OptionalEntity(m_Session, before), ["household_id"] = EntityId(target) };
        }
        private JObject SetCitizenWorkplace(JObject args, World world)
        {
            RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); var em = world.EntityManager; Entity before = em.HasComponent<Worker>(e) ? em.GetComponentData<Worker>(e).m_Workplace : Entity.Null; RemoveEmployee(em, before, e); if ((bool?)args["remove"] == true) { if (em.HasComponent<Worker>(e)) em.RemoveComponent<Worker>(e); return new JObject { ["citizen_id"] = EntityId(e), ["workplace_before"] = OptionalEntity(m_Session, before), ["removed"] = true }; } var company = StableCompany((string)args["company_id"], world); if (!em.HasComponent<WorkProvider>(company)) throw new QueryException("WORKPLACE_UNSUPPORTED", "company_id must identify a company with WorkProvider."); byte level = (byte)((int?)args["job_level"] ?? 0); var shift = (Workshift)Enum.Parse(typeof(Workshift), (string)args["shift"] ?? "Day", true); var worker = new Worker { m_Workplace = company, m_Level = level, m_Shift = shift, m_LastCommuteTime = (float?)args["last_commute_time"] ?? 0 }; if (!em.HasComponent<Worker>(e)) em.AddComponentData(e, worker); else em.SetComponentData(e, worker); if (em.HasComponent<Game.Citizens.Student>(e)) { var old = em.GetComponentData<Game.Citizens.Student>(e).m_School; RemoveStudent(em, old, e); em.RemoveComponent<Game.Citizens.Student>(e); } AddEmployee(em, company, e, level); return new JObject { ["citizen_id"] = EntityId(e), ["workplace_before"] = OptionalEntity(m_Session, before), ["worker"] = CitizenJson(e, world)["worker"] };
        }
        private JObject SetCitizenSchool(JObject args, World world)
        {
            RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); var em = world.EntityManager; Entity before = em.HasComponent<Game.Citizens.Student>(e) ? em.GetComponentData<Game.Citizens.Student>(e).m_School : Entity.Null; RemoveStudent(em, before, e); if ((bool?)args["remove"] == true) { if (em.HasComponent<Game.Citizens.Student>(e)) em.RemoveComponent<Game.Citizens.Student>(e); return new JObject { ["citizen_id"] = EntityId(e), ["school_before"] = OptionalEntity(m_Session, before), ["removed"] = true }; } var school = ParseEntity((string)args["school_id"], em); AddStudent(em, school, e); if (em.HasComponent<Worker>(e)) { var old = em.GetComponentData<Worker>(e).m_Workplace; RemoveEmployee(em, old, e); em.RemoveComponent<Worker>(e); } var value = new Game.Citizens.Student { m_School = school, m_Level = (byte)((int?)args["education_level"] ?? 1), m_LastCommuteTime = (float?)args["last_commute_time"] ?? 0 }; if (!em.HasComponent<Game.Citizens.Student>(e)) em.AddComponentData(e, value); else em.SetComponentData(e, value); return new JObject { ["citizen_id"] = EntityId(e), ["school_before"] = OptionalEntity(m_Session, before), ["student"] = CitizenJson(e, world)["student"] };
        }
        private JObject SetCitizenLocation(JObject args, World world)
        {
            RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); var em = world.EntityManager; Entity before = em.HasComponent<CurrentBuilding>(e) ? em.GetComponentData<CurrentBuilding>(e).m_CurrentBuilding : Entity.Null; RemoveOccupant(em, before, e); if ((bool?)args["clear"] == true) { if (em.HasComponent<CurrentBuilding>(e)) em.RemoveComponent<CurrentBuilding>(e); return new JObject { ["citizen_id"] = EntityId(e), ["building_before"] = OptionalEntity(m_Session, before), ["cleared"] = true }; } var building = ParseEntity((string)args["building_id"], em); if (!em.HasComponent<Building>(building)) throw new QueryException("BUILDING_NOT_FOUND", "building_id must identify a building."); if (!em.HasComponent<CurrentBuilding>(e)) em.AddComponentData(e, new CurrentBuilding(building)); else em.SetComponentData(e, new CurrentBuilding(building)); AddOccupant(em, building, e); return new JObject { ["citizen_id"] = EntityId(e), ["building_before"] = OptionalEntity(m_Session, before), ["building_id"] = EntityId(building) };
        }
        private JObject SetCitizenHealthProblem(JObject args, World world)
        {
            RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); var em = world.EntityManager; if ((bool?)args["clear"] == true) { if (em.HasComponent<HealthProblem>(e)) em.RemoveComponent<HealthProblem>(e); return new JObject { ["citizen_id"] = EntityId(e), ["cleared"] = true }; } if (!Enum.TryParse((string)args["flags"], true, out HealthProblemFlags flags)) throw new QueryException("INVALID_HEALTH_FLAGS", "Use a HealthProblemFlags name or comma-separated combination."); var h = new HealthProblem(Entity.Null, flags) { m_Timer = (byte)((int?)args["timer"] ?? 0) }; if (!em.HasComponent<HealthProblem>(e)) em.AddComponentData(e, h); else em.SetComponentData(e, h); return new JObject { ["citizen_id"] = EntityId(e), ["flags"] = flags.ToString(), ["timer"] = h.m_Timer };
        }
        private JObject DeleteCitizen(JObject args, World world) { RequirePaused(world); var e = StableCitizen((string)args["citizen_id"], world); if (!world.EntityManager.HasComponent<Deleted>(e)) world.EntityManager.AddComponent<Deleted>(e); return new JObject { ["citizen_id"] = EntityId(e), ["deleted"] = true, ["native_cleanup_queued"] = true }; }

        private JObject ListHouseholdPrefabs(JObject args, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var rows = new List<JObject>(); using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<HouseholdData>(), ComponentType.ReadOnly<ArchetypeData>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) if (ps.TryGetPrefab<PrefabBase>(e, out var p)) { var d = em.GetComponentData<HouseholdData>(e); rows.Add(new JObject { ["name"] = p.name, ["adults"] = d.m_AdultCount, ["children_max"] = d.m_ChildCount, ["elders"] = d.m_ElderCount, ["students"] = d.m_StudentCount, ["weight"] = d.m_Weight }); } return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows.OrderBy(x => (string)x["name"])) };
        }
        private JObject CreateHousehold(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var prefab = ResolveDataPrefab<HouseholdData>((string)args["prefab"], world); var array = em.CreateEntity(em.GetComponentData<ArchetypeData>(prefab).m_Archetype, 1, Allocator.Temp); var e = array[0]; array.Dispose(); if (!em.HasComponent<PrefabRef>(e)) em.AddComponentData(e, new PrefabRef(prefab)); else em.SetComponentData(e, new PrefabRef(prefab)); if (em.HasComponent<CurrentBuilding>(e)) em.RemoveComponent<CurrentBuilding>(e); if (em.HasComponent<Created>(e)) em.RemoveComponent<Created>(e); em.SetComponentData(e, new Household { m_Flags = HouseholdFlags.MovedIn }); if (!em.HasBuffer<HouseholdCitizen>(e)) em.AddBuffer<HouseholdCitizen>(e); else em.GetBuffer<HouseholdCitizen>(e).Clear(); if (!em.HasBuffer<Resources>(e)) em.AddBuffer<Resources>(e); EconomyUtils.SetResources(Resource.Money, em.GetBuffer<Resources>(e), (int?)args["money"] ?? 0); if ((bool?)args["homeless"] == true && !em.HasComponent<HomelessHousehold>(e)) em.AddComponent<HomelessHousehold>(e); if (!string.IsNullOrWhiteSpace((string)args["name"])) world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(e, ((string)args["name"]).Trim()); return HouseholdJson(e, world);
        }
        private JObject SetHouseholdName(JObject args, World world) { var e = StableHousehold((string)args["household_id"], world); string name = ((string)args["name"] ?? "").Trim(); world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(e, name); return new JObject { ["household_id"] = EntityId(e), ["custom_name"] = name.Length == 0 ? null : new JValue(name) }; }
        private JObject SetHouseholdProfile(JObject args, World world)
        {
            RequirePaused(world); var e = StableHousehold((string)args["household_id"], world); var em = world.EntityManager; var h = em.GetComponentData<Household>(e); var before = HouseholdJson(e, world); if (args["income_last_day"] != null && args["salary_last_day"] != null) throw new QueryException("INVALID_ARGUMENT", "Use income_last_day; salary_last_day is only a deprecated compatibility alias."); if (args["consumable_resources"] != null) h.m_Resources = (int)args["consumable_resources"]; if (args["consumption_per_day"] != null) h.m_ConsumptionPerDay = (short)(int)args["consumption_per_day"]; if (args["shopping_today"] != null) h.m_ShoppedValuePerDay = (uint)args["shopping_today"]; if (args["shopping_last_day"] != null) h.m_ShoppedValueLastDay = (uint)args["shopping_last_day"]; if (args["income_last_day"] != null) h.m_Income = (int)args["income_last_day"]; else if (args["salary_last_day"] != null) h.m_Income = (int)args["salary_last_day"]; if (args["leveling_spend_last_day"] != null) h.m_MoneySpendOnBuildingLevelingLastDay = (int)args["leveling_spend_last_day"]; em.SetComponentData(e, h); return new JObject { ["before"] = before, ["after"] = HouseholdJson(e, world) };
        }
        private JObject SetHouseholdHousing(JObject args, World world)
        {
            RequirePaused(world); var e = StableHousehold((string)args["household_id"], world); var em = world.EntityManager; Entity before = em.HasComponent<PropertyRenter>(e) ? em.GetComponentData<PropertyRenter>(e).m_Property : Entity.Null; RemoveRenter(em, before, e); if ((bool?)args["remove"] == true) { if (em.HasComponent<PropertyRenter>(e)) em.RemoveComponent<PropertyRenter>(e); if (!em.HasComponent<HomelessHousehold>(e)) em.AddComponent<HomelessHousehold>(e); return new JObject { ["household_id"] = EntityId(e), ["property_before"] = OptionalEntity(m_Session, before), ["homeless"] = true }; } var property = ParseEntity((string)args["property_id"], em); if (!em.HasComponent<Building>(property)) throw new QueryException("PROPERTY_NOT_FOUND", "property_id must identify a building."); var pr = new PropertyRenter { m_Property = property, m_Rent = (int?)args["rent"] ?? 0 }; if (!em.HasComponent<PropertyRenter>(e)) em.AddComponentData(e, pr); else em.SetComponentData(e, pr); if (em.HasComponent<HomelessHousehold>(e)) em.RemoveComponent<HomelessHousehold>(e); AddRenter(em, property, e); return new JObject { ["household_id"] = EntityId(e), ["property_before"] = OptionalEntity(m_Session, before), ["housing"] = HouseholdJson(e, world)["housing"] };
        }
        private JObject SetHouseholdNeed(JObject args, World world)
        {
            RequirePaused(world); var e = StableHousehold((string)args["household_id"], world); var em = world.EntityManager; if ((bool?)args["clear"] == true) { if (em.HasComponent<HouseholdNeed>(e)) em.RemoveComponent<HouseholdNeed>(e); return new JObject { ["household_id"] = EntityId(e), ["cleared"] = true }; } if (!Enum.TryParse((string)args["resource"], true, out Resource resource) || resource == Resource.NoResource || resource == Resource.Money) throw new QueryException("INVALID_RESOURCE", "Use a non-money resource name."); var n = new HouseholdNeed { m_Resource = resource, m_Amount = (int)args["amount"] }; if (!em.HasComponent<HouseholdNeed>(e)) em.AddComponentData(e, n); else em.SetComponentData(e, n); return new JObject { ["household_id"] = EntityId(e), ["resource"] = resource.ToString(), ["amount"] = n.m_Amount };
        }
        private JObject DeleteHousehold(JObject args, World world) { RequirePaused(world); var e = StableHousehold((string)args["household_id"], world); if (!world.EntityManager.HasComponent<Deleted>(e)) world.EntityManager.AddComponent<Deleted>(e); return new JObject { ["household_id"] = EntityId(e), ["deleted"] = true, ["members_cleanup_queued"] = true }; }

        private JObject ListCompanyPrefabs(JObject args, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var seen = new HashSet<Entity>(); var rows = new List<JObject>(); using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<CompanyData>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Game.Tools.Temp>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var company in es) { var prefab = em.GetComponentData<PrefabRef>(company).m_Prefab; if (!seen.Add(prefab) || !em.HasComponent<ArchetypeData>(prefab) || !ps.TryGetPrefab<PrefabBase>(prefab, out var p)) continue; rows.Add(new JObject { ["name"] = p.name, ["kind"] = CompanyKind(em, company), ["instances"] = 0 }); } foreach (var row in rows) { string name = (string)row["name"]; row["instances"] = esCount(name, world); } return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows.OrderBy(x => (string)x["kind"]).ThenBy(x => (string)x["name"])) };
        }
        private int esCount(string prefabName, World world) { var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); int count = 0; using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<CompanyData>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Game.Tools.Temp>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var p = em.GetComponentData<PrefabRef>(e).m_Prefab; if (ps.TryGetPrefab<PrefabBase>(p, out var pb) && pb.name == prefabName) count++; } return count; }
        private Entity ResolveCompanyPrefab(string name, World world, out Entity prototype)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<CompanyData>(), ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Game.Tools.Temp>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab; if (em.HasComponent<ArchetypeData>(prefab) && ps.TryGetPrefab<PrefabBase>(prefab, out var p) && string.Equals(p.name, name, StringComparison.OrdinalIgnoreCase)) { prototype = e; return prefab; } } prototype = Entity.Null; throw new QueryException("COMPANY_PREFAB_NOT_FOUND", "Use an exact currently instantiated prefab from list_company_prefabs.");
        }
        private JObject CreateCompany(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var prefab = ResolveCompanyPrefab((string)args["prefab"], world, out var prototype); var property = ParseEntity((string)args["property_id"], em); if (!em.HasComponent<Building>(property)) throw new QueryException("PROPERTY_NOT_FOUND", "property_id must identify a building."); var array = em.CreateEntity(em.GetComponentData<ArchetypeData>(prefab).m_Archetype, 1, Allocator.Temp); var e = array[0]; array.Dispose(); if (!em.HasComponent<PrefabRef>(e)) em.AddComponentData(e, new PrefabRef(prefab)); else em.SetComponentData(e, new PrefabRef(prefab)); if (em.HasComponent<Created>(e)) em.RemoveComponent<Created>(e); var data = em.GetComponentData<CompanyData>(prototype); data.m_RandomSeed = new Unity.Mathematics.Random((uint)Math.Max(1, e.Index)); em.SetComponentData(e, data); if (em.HasComponent<Profitability>(e)) em.SetComponentData(e, new Profitability { m_Profitability = (byte)((int?)args["profitability"] ?? 127), m_LastTotalWorth = (int?)args["last_total_worth"] ?? 0 }); if (!em.HasBuffer<Resources>(e)) em.AddBuffer<Resources>(e); else em.GetBuffer<Resources>(e).Clear(); if (!em.HasBuffer<Employee>(e)) em.AddBuffer<Employee>(e); var pr = new PropertyRenter { m_Property = property, m_Rent = (int?)args["rent"] ?? 0 }; if (!em.HasComponent<PropertyRenter>(e)) em.AddComponentData(e, pr); else em.SetComponentData(e, pr); AddRenter(em, property, e); if (!string.IsNullOrWhiteSpace((string)args["name"])) world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(e, ((string)args["name"]).Trim()); return CompanyJson(e, world);
        }
        private JObject SetCompanyName(JObject args, World world) { var e = StableCompany((string)args["company_id"], world); string name = ((string)args["name"] ?? "").Trim(); world.GetOrCreateSystemManaged<Game.UI.NameSystem>().SetCustomName(e, name); return new JObject { ["company_id"] = EntityId(e), ["custom_name"] = name.Length == 0 ? null : new JValue(name) }; }
        private JObject SetCompanyFinancials(JObject args, World world)
        {
            RequirePaused(world); var e = StableCompany((string)args["company_id"], world); var em = world.EntityManager; if (args["profitability"] != null || args["last_total_worth"] != null) { if (!em.HasComponent<Profitability>(e)) throw new QueryException("COMPANY_PROFITABILITY_UNAVAILABLE", "The company has no Profitability component."); var p = em.GetComponentData<Profitability>(e); if (args["profitability"] != null) p.m_Profitability = (byte)(int)args["profitability"]; if (args["last_total_worth"] != null) p.m_LastTotalWorth = (int)args["last_total_worth"]; em.SetComponentData(e, p); } if (args["rent"] != null) { if (!em.HasComponent<PropertyRenter>(e)) throw new QueryException("COMPANY_PROPERTY_UNAVAILABLE", "The company has no rented property."); var pr = em.GetComponentData<PropertyRenter>(e); pr.m_Rent = (int)args["rent"]; em.SetComponentData(e, pr); } return CompanyJson(e, world);
        }
        private JObject SetCompanyWorkforce(JObject args, World world) { RequirePaused(world); var e = StableCompany((string)args["company_id"], world); var em = world.EntityManager; if (!em.HasComponent<WorkProvider>(e)) throw new QueryException("WORKPLACE_UNSUPPORTED", "The company has no WorkProvider."); var w = em.GetComponentData<WorkProvider>(e); int before = w.m_MaxWorkers; w.m_MaxWorkers = (int)args["maximum_workers"]; em.SetComponentData(e, w); return new JObject { ["company_id"] = EntityId(e), ["maximum_workers_before"] = before, ["maximum_workers"] = w.m_MaxWorkers, ["current_employees"] = em.HasBuffer<Employee>(e) ? em.GetBuffer<Employee>(e, true).Length : 0 }; }
        private JObject SetCompanyProperty(JObject args, World world)
        {
            RequirePaused(world); var e = StableCompany((string)args["company_id"], world); var em = world.EntityManager; Entity before = em.HasComponent<PropertyRenter>(e) ? em.GetComponentData<PropertyRenter>(e).m_Property : Entity.Null; RemoveRenter(em, before, e); if ((bool?)args["remove"] == true) { if (em.HasComponent<PropertyRenter>(e)) em.RemoveComponent<PropertyRenter>(e); return new JObject { ["company_id"] = EntityId(e), ["property_before"] = OptionalEntity(m_Session, before), ["removed"] = true }; } var property = ParseEntity((string)args["property_id"], em); if (!em.HasComponent<Building>(property)) throw new QueryException("PROPERTY_NOT_FOUND", "property_id must identify a building."); var pr = new PropertyRenter { m_Property = property, m_Rent = (int?)args["rent"] ?? 0 }; if (!em.HasComponent<PropertyRenter>(e)) em.AddComponentData(e, pr); else em.SetComponentData(e, pr); AddRenter(em, property, e); return new JObject { ["company_id"] = EntityId(e), ["property_before"] = OptionalEntity(m_Session, before), ["property"] = CompanyJson(e, world)["property"] };
        }
        private JObject SetCompanyTradeCost(JObject args, World world)
        {
            RequirePaused(world); var e = StableCompany((string)args["company_id"], world); var em = world.EntityManager; if (!Enum.TryParse((string)args["resource"], true, out Resource resource) || resource == Resource.NoResource) throw new QueryException("INVALID_RESOURCE", "Use an exact resource name."); if (!em.HasBuffer<TradeCost>(e)) em.AddBuffer<TradeCost>(e); var b = em.GetBuffer<TradeCost>(e); int index = -1; for (int i = 0; i < b.Length; i++) if (b[i].m_Resource == resource) { index = i; break; } JObject before = index >= 0 ? new JObject { ["buy_cost"] = b[index].m_BuyCost, ["sell_cost"] = b[index].m_SellCost, ["last_transfer_request_time"] = b[index].m_LastTransferRequestTime } : null; if ((bool?)args["remove"] == true) { if (index >= 0) b.RemoveAt(index); return new JObject { ["company_id"] = EntityId(e), ["resource"] = resource.ToString(), ["before"] = before, ["removed"] = index >= 0 }; } var value = index >= 0 ? b[index] : new TradeCost { m_Resource = resource }; if (args["buy_cost"] != null) value.m_BuyCost = (float)args["buy_cost"]; if (args["sell_cost"] != null) value.m_SellCost = (float)args["sell_cost"]; if (index >= 0) b[index] = value; else b.Add(value); return new JObject { ["company_id"] = EntityId(e), ["resource"] = resource.ToString(), ["before"] = before, ["created"] = index < 0, ["buy_cost"] = value.m_BuyCost, ["sell_cost"] = value.m_SellCost };
        }
        private JObject DeleteCompany(JObject args, World world) { RequirePaused(world); var e = StableCompany((string)args["company_id"], world); if (!world.EntityManager.HasComponent<Deleted>(e)) world.EntityManager.AddComponent<Deleted>(e); return new JObject { ["company_id"] = EntityId(e), ["deleted"] = true, ["native_cleanup_queued"] = true }; }
    }
}
