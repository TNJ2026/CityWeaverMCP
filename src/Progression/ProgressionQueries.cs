using System;
using System.Collections.Generic;
using System.Linq;
using Game.Areas;
using Game.City;
using Game.Common;
using Game.Prefabs;
using Game.Simulation;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CitiesSkylines2Mod
{
    public sealed partial class GameQueryService
    {
        private static void RequirePaused(World world)
        {
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0)
                throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before changing progression or unlock state.");
        }

        private static string PrefabName(PrefabSystem system, Entity entity)
        {
            return system.TryGetPrefab<PrefabBase>(entity, out var prefab) ? prefab.name : null;
        }

        private static JObject MilestoneJson(EntityManager em, PrefabSystem prefabs, Entity entity, MilestoneData data, int achieved)
        {
            return new JObject {
                ["name"] = PrefabName(prefabs, entity), ["index"] = data.m_Index,
                ["xp_required"] = data.m_XpRequried, ["money_reward"] = data.m_Reward,
                ["development_points_reward"] = data.m_DevTreePoints, ["map_tile_permits_reward"] = data.m_MapTiles,
                ["loan_limit_reward"] = data.m_LoanLimit, ["major"] = data.m_Major, ["victory"] = data.m_IsVictory,
                ["achieved"] = data.m_Index <= achieved, ["locked"] = PrefabLocked(em, entity)
            };
        }

        private JObject GetCityProgression(World world)
        {
            var em = world.EntityManager; var city = world.GetExistingSystemManaged<CitySystem>().City;
            var xp = em.GetComponentData<XP>(city); var level = em.GetComponentData<MilestoneLevel>(city);
            int lastThreshold = 0, nextThreshold = 0, maxIndex = 0;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<MilestoneData>())) using (var data = q.ToComponentDataArray<MilestoneData>(Allocator.Temp)) for (int i = 0; i < data.Length; i++) {
                maxIndex = Math.Max(maxIndex, data[i].m_Index);
                if (data[i].m_Index == level.m_AchievedMilestone) lastThreshold = data[i].m_XpRequried;
                if (data[i].m_Index == level.m_AchievedMilestone + 1) nextThreshold = data[i].m_XpRequried;
            }
            bool completed = level.m_AchievedMilestone >= maxIndex; int currentProgress = Math.Max(0, xp.m_XP - lastThreshold), requiredProgress = completed ? 0 : Math.Max(0, nextThreshold - lastThreshold);
            int points = world.GetExistingSystemManaged<DevTreeSystem>().points;
            int ownedTiles; using (var q = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<MapTile>() }, None = new[] { ComponentType.ReadOnly<Native>() } })) ownedTiles = q.CalculateEntityCount();
            var tileSystem = world.GetExistingSystemManaged<MapTilePurchaseSystem>();
            return new JObject {
                ["experience"] = new JObject { ["total"] = xp.m_XP, ["maximum_population_record"] = xp.m_MaximumPopulation, ["maximum_income_record"] = xp.m_MaximumIncome, ["reward_flags"] = xp.m_XPRewardRecord.ToString() },
                ["milestone"] = new JObject { ["achieved_index"] = level.m_AchievedMilestone, ["maximum_index"] = maxIndex, ["completed"] = completed, ["next_index"] = completed ? null : (JToken)(level.m_AchievedMilestone + 1), ["last_total_xp"] = lastThreshold, ["next_total_xp"] = completed ? null : (JToken)nextThreshold, ["current_progress_xp"] = currentProgress, ["required_progress_xp"] = requiredProgress, ["progress"] = completed ? 1f : requiredProgress == 0 ? 0f : Math.Min(1f, (float)currentProgress / requiredProgress) },
                ["development_points"] = points,
                ["map_tiles"] = new JObject { ["owned"] = ownedTiles, ["available_permits"] = tileSystem.GetAvailableTiles(), ["upkeep_enabled"] = tileSystem.GetMapTileUpkeepEnabled() },
                ["paused"] = world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed == 0
            };
        }

        private JObject ListMilestones(World world)
        {
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            int achieved = em.GetComponentData<MilestoneLevel>(world.GetExistingSystemManaged<CitySystem>().City).m_AchievedMilestone;
            var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<MilestoneData>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) rows.Add(MilestoneJson(em, prefabs, entity, em.GetComponentData<MilestoneData>(entity), achieved));
            return new JObject { ["achieved_index"] = achieved, ["total"] = rows.Count, ["items"] = new JArray(rows.OrderBy(x => (int)x["index"])) };
        }

        private JObject DevNodeJson(EntityManager em, PrefabSystem prefabs, Entity entity)
        {
            var data = em.GetComponentData<DevTreeNodeData>(entity); bool locked = PrefabLocked(em, entity);
            var requirements = new JArray(); bool requirementMet = false, hasRequirement = false;
            if (em.HasBuffer<DevTreeNodeRequirement>(entity)) {
                var buffer = em.GetBuffer<DevTreeNodeRequirement>(entity, true);
                for (int i = 0; i < buffer.Length; i++) { var required = buffer[i].m_Node; if (required == Entity.Null) continue; hasRequirement = true; bool unlocked = !PrefabLocked(em, required); requirementMet |= unlocked; requirements.Add(new JObject { ["name"] = PrefabName(prefabs, required), ["unlocked"] = unlocked }); }
            }
            bool serviceUnlocked = data.m_Service == Entity.Null || !PrefabLocked(em, data.m_Service);
            return new JObject {
                ["name"] = PrefabName(prefabs, entity), ["cost"] = data.m_Cost, ["locked"] = locked,
                ["service"] = data.m_Service == Entity.Null ? null : PrefabName(prefabs, data.m_Service), ["service_unlocked"] = serviceUnlocked,
                ["requirements"] = requirements, ["requirements_met"] = !hasRequirement || requirementMet,
                ["purchasable"] = locked && serviceUnlocked && (!hasRequirement || requirementMet)
            };
        }

        private JObject ListDevelopmentTree(JObject args, World world)
        {
            string search = ((string)args["search"] ?? "").Trim(); string state = ((string)args["state"] ?? "all").ToLowerInvariant();
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 100000), limit = ComponentInspector.Int(args, "limit", 100, 1, 500);
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<DevTreeNodeData>()))
            using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) {
                var row = DevNodeJson(em, prefabs, entity); string name = (string)row["name"] ?? ""; bool locked = (bool)row["locked"];
                if (!string.IsNullOrEmpty(search) && name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (state == "locked" && !locked || state == "unlocked" && locked || state != "all" && state != "locked" && state != "unlocked") { if (state != "all" && state != "locked" && state != "unlocked") throw new QueryException("INVALID_ARGUMENT", "state must be all, locked, or unlocked."); continue; }
                rows.Add(row);
            }
            var ordered = rows.OrderBy(x => (string)x["service"]).ThenBy(x => (string)x["name"]).ToList();
            return new JObject { ["development_points"] = world.GetExistingSystemManaged<DevTreeSystem>().points, ["total"] = ordered.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < ordered.Count, ["items"] = new JArray(ordered.Skip(offset).Take(limit)) };
        }

        private JObject GetUnlockSummary(World world)
        {
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var groups = new Dictionary<string, int[]>(); int total = 0, locked = 0;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>())) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) {
                if (!em.HasComponent<Locked>(entity) || !prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab)) continue;
                bool isLocked = PrefabLocked(em, entity); string type = prefab.GetType().FullName; if (!groups.TryGetValue(type, out var counts)) groups[type] = counts = new int[2];
                counts[0]++; if (isLocked) { counts[1]++; locked++; } total++;
            }
            var byType = new JArray(groups.OrderBy(x => x.Key).Select(x => new JObject { ["prefab_type"] = x.Key, ["total"] = x.Value[0], ["locked"] = x.Value[1], ["unlocked"] = x.Value[0] - x.Value[1] }));
            return new JObject { ["total"] = total, ["locked"] = locked, ["unlocked"] = total - locked, ["by_prefab_type"] = byType };
        }

        private JObject ListUnlockablePrefabs(JObject args, World world)
        {
            string search = ((string)args["search"] ?? "").Trim(), typeFilter = ((string)args["prefab_type"] ?? "").Trim(), state = ((string)args["state"] ?? "all").ToLowerInvariant();
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 100000), limit = ComponentInspector.Int(args, "limit", 100, 1, 500);
            if (state != "all" && state != "locked" && state != "unlocked") throw new QueryException("INVALID_ARGUMENT", "state must be all, locked, or unlocked.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>())) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) {
                if (!em.HasComponent<Locked>(entity) || !prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab)) continue; bool locked = PrefabLocked(em, entity); string type = prefab.GetType().FullName;
                if (!string.IsNullOrEmpty(search) && prefab.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0 || !string.IsNullOrEmpty(typeFilter) && type.IndexOf(typeFilter, StringComparison.OrdinalIgnoreCase) < 0 || state == "locked" && !locked || state == "unlocked" && locked) continue;
                var requirements = new JArray(); if (em.HasBuffer<UnlockRequirement>(entity)) { var buffer = em.GetBuffer<UnlockRequirement>(entity, true); for (int i = 0; i < buffer.Length; i++) requirements.Add(new JObject { ["name"] = PrefabName(prefabs, buffer[i].m_Prefab), ["flags"] = buffer[i].m_Flags.ToString(), ["unlocked"] = !PrefabLocked(em, buffer[i].m_Prefab) }); }
                rows.Add(new JObject { ["name"] = prefab.name, ["prefab_type"] = type, ["locked"] = locked, ["requirements"] = requirements });
            }
            var ordered = rows.OrderBy(x => (string)x["prefab_type"]).ThenBy(x => (string)x["name"]).ToList();
            return new JObject { ["total"] = ordered.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < ordered.Count, ["items"] = new JArray(ordered.Skip(offset).Take(limit)) };
        }

        private Entity ResolveUnlockablePrefab(string name, string typeFilter, World world)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new QueryException("INVALID_ARGUMENT", "prefab is required.");
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var matches = new List<Entity>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>())) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) {
                if (!em.HasComponent<Locked>(entity) || !prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab)) continue;
                if (string.Equals(prefab.name, name, StringComparison.OrdinalIgnoreCase) && (string.IsNullOrEmpty(typeFilter) || prefab.GetType().FullName.IndexOf(typeFilter, StringComparison.OrdinalIgnoreCase) >= 0)) matches.Add(entity);
            }
            if (matches.Count == 0) throw new QueryException("PREFAB_NOT_FOUND", "Use an exact name and optional prefab_type returned by list_unlockable_prefabs.");
            if (matches.Count > 1) throw new QueryException("AMBIGUOUS_PREFAB", "More than one prefab has this name; provide prefab_type from list_unlockable_prefabs.");
            return matches[0];
        }

        private JObject SetExperiencePoints(JObject args, World world)
        {
            RequirePaused(world); int value = ComponentInspector.Int(args, "total_xp", -1, 0, 2000000000); var em = world.EntityManager; var city = world.GetExistingSystemManaged<CitySystem>().City; var xp = em.GetComponentData<XP>(city); int before = xp.m_XP; xp.m_XP = value; em.SetComponentData(city, xp);
            return new JObject { ["total_xp_before"] = before, ["total_xp"] = value, ["milestone_processing_pending"] = true, ["note"] = "Increasing XP across a milestone threshold grants native rewards when simulation processing advances. Lowering XP does not revoke achieved milestones or rewards." };
        }

        private JObject SetDevelopmentPoints(JObject args, World world)
        {
            RequirePaused(world); int value = ComponentInspector.Int(args, "points", -1, 0, 1000000); var system = world.GetExistingSystemManaged<DevTreeSystem>(); int before = system.points; system.points = value;
            return new JObject { ["points_before"] = before, ["points"] = system.points };
        }

        private JObject PurchaseDevelopmentNode(JObject args, World world)
        {
            RequirePaused(world); string name = ((string)args["node"] ?? "").Trim(); var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity selected = Entity.Null;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<DevTreeNodeData>())) using (var entities = q.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) if (string.Equals(PrefabName(prefabs, entity), name, StringComparison.OrdinalIgnoreCase)) { if (selected != Entity.Null) throw new QueryException("AMBIGUOUS_NODE", "More than one development node has this name."); selected = entity; }
            if (selected == Entity.Null) throw new QueryException("DEVELOPMENT_NODE_NOT_FOUND", "Use an exact node name returned by list_development_tree."); var before = DevNodeJson(em, prefabs, selected); if (!(bool)before["locked"]) return new JObject { ["node"] = name, ["already_unlocked"] = true, ["development_points"] = world.GetExistingSystemManaged<DevTreeSystem>().points };
            if (!(bool)before["purchasable"]) throw new QueryException("DEVELOPMENT_NODE_REQUIREMENTS_NOT_MET", "The service or prerequisite node is still locked."); var system = world.GetExistingSystemManaged<DevTreeSystem>(); int oldPoints = system.points, cost = (int)before["cost"]; if (oldPoints < cost) throw new QueryException("INSUFFICIENT_DEVELOPMENT_POINTS", "The city does not have enough development points."); system.Purchase(selected);
            return new JObject { ["node"] = name, ["cost"] = cost, ["points_before"] = oldPoints, ["points_after"] = system.points, ["unlock_dispatched"] = true };
        }

        private JObject UnlockPrefab(JObject args, World world)
        {
            RequirePaused(world); string name = ((string)args["prefab"] ?? "").Trim(), type = ((string)args["prefab_type"] ?? "").Trim(); var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); var target = ResolveUnlockablePrefab(name, type, world);
            if (em.HasComponent<MilestoneData>(target)) throw new QueryException("USE_EXPERIENCE_FOR_MILESTONE", "Milestones must be reached with set_experience_points or the native unlock-all operation."); if (!PrefabLocked(em, target)) return new JObject { ["prefab"] = name, ["prefab_type"] = prefabs.GetPrefab<PrefabBase>(target).GetType().FullName, ["already_unlocked"] = true };
            var evt = em.CreateEntity(ComponentType.ReadWrite<Game.Common.Event>(), ComponentType.ReadWrite<Unlock>()); em.SetComponentData(evt, new Unlock(target));
            return new JObject { ["prefab"] = name, ["prefab_type"] = prefabs.GetPrefab<PrefabBase>(target).GetType().FullName, ["unlock_dispatched"] = true, ["native_dependencies_may_unlock"] = true };
        }

        private JObject UnlockAllProgression(JObject args, World world)
        {
            RequirePaused(world); if (!((bool?)args["confirm_irreversible"] ?? false)) throw new QueryException("CONFIRMATION_REQUIRED", "Set confirm_irreversible=true; this grants all milestones, rewards, development nodes, services and other unlockable content and cannot be automatically rolled back.");
            var system = world.GetExistingSystemManaged<UnlockAllSystem>(); system.Enabled = true;
            return new JObject { ["unlock_all_dispatched"] = true, ["includes_milestones_and_rewards"] = true, ["includes_all_unlockable_prefabs"] = true, ["processing_pending"] = true };
        }
    }
}
