using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Colossal.Entities;
using Game.City;
using Game.Common;
using Game.Policies;
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
        private Entity ManagementCity(World world)
        {
            var system = world.GetExistingSystemManaged<CitySystem>();
            if (system == null || system.City == Entity.Null || !world.EntityManager.Exists(system.City)) throw new QueryException("CITY_UNAVAILABLE", "The loaded city entity is unavailable.");
            return system.City;
        }

        private JObject GetCityConfiguration(World world)
        {
            var config = world.GetExistingSystemManaged<CityConfigurationSystem>(); var em = world.EntityManager; var city = ManagementCity(world); var themeName = JValue.CreateNull();
            if (config.defaultTheme != Entity.Null && world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<PrefabBase>(config.defaultTheme, out var theme)) themeName = new JValue(theme.name);
            bool playerUnlimited = em.HasComponent<PlayerMoney>(city) && em.GetComponentData<PlayerMoney>(city).m_Unlimited;
            return new JObject { ["city_id"] = EntityId(city), ["city_name"] = config.cityName ?? "", ["theme"] = themeName, ["left_hand_traffic"] = config.leftHandTraffic, ["natural_disasters"] = config.naturalDisasters, ["unlimited_money"] = config.unlimitedMoney, ["player_money_unlimited"] = playerUnlimited, ["unlock_all"] = config.unlockAll, ["unlock_map_tiles"] = config.unlockMapTiles, ["loaded_mod_count"] = config.usedMods.Count };
        }

        private JObject SetCityName(JObject args, World world)
        {
            string name = ((string)args["name"] ?? "").Trim(); if (name.Length == 0) throw new QueryException("INVALID_CITY_NAME", "name must contain at least one non-whitespace character."); var config = world.GetExistingSystemManaged<CityConfigurationSystem>(); string before = config.cityName; config.cityName = name; return new JObject { ["before"] = before, ["city_name"] = config.cityName };
        }

        private JObject SetCityMoney(JObject args, World world)
        {
            RequirePaused(world); var em = world.EntityManager; var city = ManagementCity(world); if (!em.HasComponent<PlayerMoney>(city)) throw new QueryException("MONEY_UNAVAILABLE", "The city has no PlayerMoney component."); var before = em.GetComponentData<PlayerMoney>(city); int amount = (int)args["amount"]; var value = new PlayerMoney(amount) { m_Unlimited = before.m_Unlimited }; em.SetComponentData(city, value); return new JObject { ["before"] = before.money, ["amount"] = value.money, ["stored_amount"] = amount, ["unlimited_money"] = value.m_Unlimited };
        }

        private JObject SetCityConfiguration(JObject args, World world)
        {
            RequirePaused(world); if (args["unlimited_money"] == null && args["natural_disasters"] == null) throw new QueryException("INVALID_ARGUMENT", "Provide unlimited_money and/or natural_disasters."); var em = world.EntityManager; var city = ManagementCity(world); var config = world.GetExistingSystemManaged<CityConfigurationSystem>(); var before = GetCityConfiguration(world);
            if (args["unlimited_money"] != null) { bool enabled = (bool)args["unlimited_money"]; var loaded = typeof(CityConfigurationSystem).GetField("m_LoadedUnlimitedMoney", BindingFlags.Instance | BindingFlags.NonPublic); if (loaded == null) throw new QueryException("CONFIGURATION_LAYOUT_UNAVAILABLE", "The native unlimited-money latch field is unavailable in this game version."); loaded.SetValue(config, false); config.unlimitedMoney = enabled; if (em.HasComponent<PlayerMoney>(city)) { var money = em.GetComponentData<PlayerMoney>(city); money.m_Unlimited = enabled; em.SetComponentData(city, money); } }
            if (args["natural_disasters"] != null) config.naturalDisasters = (bool)args["natural_disasters"];
            return new JObject { ["before"] = before, ["after"] = GetCityConfiguration(world) };
        }

        private IEnumerable<JObject> ReadCityPolicies(World world)
        {
            var em = world.EntityManager; var city = ManagementCity(world); var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); DynamicBuffer<Policy> current = default; bool hasCurrent = em.TryGetBuffer<Policy>(city, true, out current);
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>())) using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var policyEntity in entities)
            {
                bool applies = em.HasComponent<CityOptionData>(policyEntity) || em.HasBuffer<CityModifierData>(policyEntity); if (!applies || !prefabs.TryGetPrefab<PrefabBase>(policyEntity, out var prefab)) continue; bool active = false; float adjustment = em.HasComponent<PolicySliderData>(policyEntity) ? em.GetComponentData<PolicySliderData>(policyEntity).m_Default : 0;
                if (hasCurrent) for (int i = 0; i < current.Length; i++) if (current[i].m_Policy == policyEntity) { active = (current[i].m_Flags & PolicyFlags.Active) != 0; adjustment = current[i].m_Adjustment; break; }
                var row = new JObject { ["name"] = prefab.name, ["active"] = active, ["adjustment"] = adjustment, ["locked"] = RoadOperation.IsLocked(em, policyEntity) };
                if (em.HasComponent<CityOptionData>(policyEntity)) row["option_mask"] = em.GetComponentData<CityOptionData>(policyEntity).m_OptionMask;
                if (em.HasBuffer<CityModifierData>(policyEntity)) { var modifiers = new JArray(); var buffer = em.GetBuffer<CityModifierData>(policyEntity, true); for (int i = 0; i < buffer.Length; i++) modifiers.Add(new JObject { ["type"] = buffer[i].m_Type.ToString(), ["mode"] = buffer[i].m_Mode.ToString(), ["range_min"] = buffer[i].m_Range.min, ["range_max"] = buffer[i].m_Range.max }); row["modifiers"] = modifiers; }
                if (em.HasComponent<PolicySliderData>(policyEntity)) { var slider = em.GetComponentData<PolicySliderData>(policyEntity); row["slider"] = new JObject { ["min"] = slider.m_Range.min, ["max"] = slider.m_Range.max, ["default"] = slider.m_Default, ["step"] = slider.m_Step, ["unit"] = slider.m_Unit }; }
                yield return row;
            }
        }

        private JObject ListCityPolicies(World world) { var items = ReadCityPolicies(world).OrderBy(row => (string)row["name"]).ToArray(); return new JObject { ["total"] = items.Length, ["active"] = items.Count(row => (bool)row["active"]), ["items"] = new JArray(items) }; }

        private JObject SetCityPolicy(JObject args, World world)
        {
            RequirePaused(world); string wanted = ((string)args["policy"] ?? "").Trim(); var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>(); Entity selected = Entity.Null; PrefabBase definition = null;
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PolicyData>())) using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) if ((em.HasComponent<CityOptionData>(entity) || em.HasBuffer<CityModifierData>(entity)) && prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) && string.Equals(prefab.name, wanted, StringComparison.OrdinalIgnoreCase)) { selected = entity; definition = prefab; break; }
            if (selected == Entity.Null) throw new QueryException("CITY_POLICY_NOT_FOUND", "Use an exact name from list_city_policies."); if (RoadOperation.IsLocked(em, selected)) throw new QueryException("CITY_POLICY_LOCKED", "The selected city policy is locked."); bool active = (bool)args["active"]; float adjustment = (float?)args["adjustment"] ?? (em.HasComponent<PolicySliderData>(selected) ? em.GetComponentData<PolicySliderData>(selected).m_Default : 0);
            if (em.HasComponent<PolicySliderData>(selected)) { var slider = em.GetComponentData<PolicySliderData>(selected); if (adjustment < slider.m_Range.min || adjustment > slider.m_Range.max) throw new QueryException("INVALID_ARGUMENT", "adjustment is outside the policy slider range."); } else if (math.abs(adjustment) > .0001f) throw new QueryException("INVALID_ARGUMENT", "This policy has no adjustment slider.");
            world.GetOrCreateSystemManaged<Game.UI.InGame.PoliciesUISystem>().SetCityPolicy(selected, active, adjustment); return new JObject { ["policy"] = definition.name, ["requested_active"] = active, ["requested_adjustment"] = adjustment, ["change_queued"] = true };
        }

        private JObject ListCityModifiers(World world)
        {
            var em = world.EntityManager; var city = ManagementCity(world); var items = new JArray(); if (!em.HasBuffer<CityModifier>(city)) return new JObject { ["total"] = 0, ["items"] = items }; var buffer = em.GetBuffer<CityModifier>(city, true);
            foreach (CityModifierType type in Enum.GetValues(typeof(CityModifierType))) { int index = (int)type; if (index < 0 || index >= buffer.Length) continue; var delta = buffer[index].m_Delta; items.Add(new JObject { ["type"] = type.ToString(), ["index"] = index, ["delta_x"] = delta.x, ["delta_y"] = delta.y, ["active"] = math.abs(delta.x) > .000001f || math.abs(delta.y) > .000001f }); }
            return new JObject { ["buffer_length"] = buffer.Length, ["total"] = items.Count, ["active"] = items.Count(token => (bool)token["active"]), ["items"] = items };
        }

        private StatisticType ParseStatistic(JObject args)
        {
            if (!Enum.TryParse((string)args["statistic"], true, out StatisticType type) || type == StatisticType.Invalid || type == StatisticType.Count) throw new QueryException("INVALID_STATISTIC", "Use an exact statistic returned by list_city_statistics."); return type;
        }

        private JObject ListCityStatistics(JObject args, World world)
        {
            string search = ((string)args["search"] ?? "").Trim(); int parameter = (int?)args["parameter"] ?? 0; var statistics = world.GetExistingSystemManaged<CityStatisticsSystem>(); statistics.CompleteWriters(); var lookup = statistics.GetLookup(); var items = new JArray();
            foreach (StatisticType type in Enum.GetValues(typeof(StatisticType))) { if (type == StatisticType.Invalid || type == StatisticType.Count || search.Length > 0 && type.ToString().IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue; var key = new CityStatisticsSystem.StatisticsKey(type, parameter); bool available = lookup.ContainsKey(key); items.Add(new JObject { ["statistic"] = type.ToString(), ["parameter"] = parameter, ["available"] = available, ["current_total"] = available ? new JValue(statistics.GetStatisticValueLong(type, parameter)) : JValue.CreateNull() }); }
            return new JObject { ["sample_count"] = statistics.sampleCount, ["parameter"] = parameter, ["total"] = items.Count, ["items"] = items };
        }

        private JObject GetCityStatisticHistory(JObject args, World world)
        {
            var type = ParseStatistic(args); int parameter = (int?)args["parameter"] ?? 0, offset = (int?)args["offset"] ?? 0, limit = (int?)args["limit"] ?? 100; var statistics = world.GetExistingSystemManaged<CityStatisticsSystem>(); statistics.CompleteWriters(); var lookup = statistics.GetLookup(); var key = new CityStatisticsSystem.StatisticsKey(type, parameter); if (!lookup.ContainsKey(key)) throw new QueryException("STATISTIC_UNAVAILABLE", "This statistic and parameter combination has no collected data."); var entity = lookup[key]; var buffer = world.EntityManager.GetBuffer<CityStatistic>(entity, true); if (offset > buffer.Length) throw new QueryException("INVALID_ARGUMENT", "offset exceeds the history size."); int end = Math.Min(buffer.Length, offset + limit), sampleStart = Math.Max(0, statistics.sampleCount - buffer.Length); var items = new JArray();
            for (int i = offset; i < end; i++) { var sample = buffer[i]; int sampleIndex = sampleStart + i; items.Add(new JObject { ["index"] = i, ["sample_index"] = sampleIndex, ["simulation_frame"] = statistics.GetSampleFrameIndex(sampleIndex), ["value"] = sample.m_Value, ["total_value"] = sample.m_TotalValue }); }
            return new JObject { ["statistic"] = type.ToString(), ["parameter"] = parameter, ["sample_count"] = buffer.Length, ["offset"] = offset, ["limit"] = limit, ["next_offset"] = end < buffer.Length ? new JValue(end) : JValue.CreateNull(), ["items"] = items };
        }

        private JObject GetCityManagementOverview(World world)
        {
            var em = world.EntityManager; var city = ManagementCity(world); var population = em.HasComponent<Population>(city) ? em.GetComponentData<Population>(city) : default; var config = GetCityConfiguration(world); var policies = ListCityPolicies(world); var modifiers = ListCityModifiers(world); var economy = GetCityEconomy(world); var progression = GetCityProgression(world);
            return new JObject { ["configuration"] = config, ["population"] = new JObject { ["population"] = population.m_Population, ["population_with_move_in"] = population.m_PopulationWithMoveIn, ["average_happiness"] = population.m_AverageHappiness, ["average_health"] = population.m_AverageHealth }, ["economy"] = economy, ["progression"] = progression, ["policy_summary"] = new JObject { ["total"] = policies["total"], ["active"] = policies["active"] }, ["modifier_summary"] = new JObject { ["total"] = modifiers["total"], ["active"] = modifiers["active"] } };
        }
    }
}
