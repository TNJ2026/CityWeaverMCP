using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Game.Common;
using Game.Objects;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed partial class GameQueryService
    {
        private static string LandscapeKind(EntityManager em, Entity prefab) => em.HasComponent<TreeData>(prefab) ? "tree" : em.HasComponent<PlantData>(prefab) ? "plant" : null;
        private Entity ResolveLandscapePrefab(string name, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<Game.Prefabs.ObjectData>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
            {
                if (LandscapeKind(em, e) == null || !ps.TryGetPrefab<PrefabBase>(e, out var p)) continue;
                if (string.Equals(p.name, name, StringComparison.OrdinalIgnoreCase)) return e;
            }
            throw new QueryException("LANDSCAPE_PREFAB_NOT_FOUND", "Use an exact tree or plant name from list_landscape_prefabs.");
        }
        private JObject ListLandscapePrefabs(JObject args, World world)
        {
            string search = ((string)args["search"] ?? "").Trim(), kind = ((string)args["kind"] ?? "all").ToLowerInvariant();
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 100000), limit = ComponentInspector.Int(args, "limit", 50, 1, 500);
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var rows = new List<JObject>();
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<Game.Prefabs.ObjectData>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
            {
                var k = LandscapeKind(em, e); if (k == null || kind != "all" && kind != k || !ps.TryGetPrefab<PrefabBase>(e, out var p) || search.Length > 0 && p.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue;
                var row = new JObject { ["name"] = p.name, ["kind"] = k, ["locked"] = RoadOperation.IsLocked(em, e) };
                if (em.HasComponent<ObjectGeometryData>(e)) { var d = em.GetComponentData<ObjectGeometryData>(e); row["size_m"] = new JObject { ["x"] = d.m_Size.x, ["y"] = d.m_Size.y, ["z"] = d.m_Size.z }; row["geometry_flags"] = d.m_Flags.ToString(); }
                if (em.HasComponent<PlaceableObjectData>(e)) { var d = em.GetComponentData<PlaceableObjectData>(e); row["construction_cost"] = d.m_ConstructionCost; row["placement_flags"] = d.m_Flags.ToString(); }
                if (em.HasComponent<TreeData>(e)) row["wood_amount"] = em.GetComponentData<TreeData>(e).m_WoodAmount;
                rows.Add(row);
            }
            rows = rows.OrderBy(x => (string)x["kind"]).ThenBy(x => (string)x["name"]).ToList();
            return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : null, ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }
        private Entity ResolveLandscapeObject(JObject args, World world)
        {
            var e = ParseEntity((string)args["object_id"], world.EntityManager); var em = world.EntityManager;
            if (!em.Exists(e) || !em.HasComponent<PrefabRef>(e) || !em.HasComponent<Game.Objects.Transform>(e) || em.HasComponent<Deleted>(e) || em.HasComponent<Temp>(e) || LandscapeKind(em, em.GetComponentData<PrefabRef>(e).m_Prefab) == null)
                throw new QueryException("LANDSCAPE_OBJECT_NOT_FOUND", "object_id must identify a permanent tree or plant.");
            return e;
        }
        private JObject LandscapeRow(Entity e, World world)
        {
            var em = world.EntityManager; var ps = world.GetExistingSystemManaged<PrefabSystem>(); var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab; ps.TryGetPrefab<PrefabBase>(prefab, out var p); var t = em.GetComponentData<Game.Objects.Transform>(e);
            var row = new JObject { ["object_id"] = EntityId(e), ["prefab"] = p?.name, ["kind"] = LandscapeKind(em, prefab), ["position"] = PointJson(t.m_Position), ["rotation_degrees"] = math.degrees(math.atan2(2f * (t.m_Rotation.value.w * t.m_Rotation.value.y + t.m_Rotation.value.x * t.m_Rotation.value.z), 1f - 2f * (t.m_Rotation.value.y * t.m_Rotation.value.y + t.m_Rotation.value.z * t.m_Rotation.value.z))), ["natural"] = em.HasComponent<Native>(e) };
            if (em.HasComponent<Tree>(e)) { var tree = em.GetComponentData<Tree>(e); row["tree_state"] = tree.m_State.ToString(); row["growth"] = tree.m_Growth; }
            if (em.HasComponent<Plant>(e)) row["pollution"] = em.GetComponentData<Plant>(e).m_Pollution;
            return row;
        }
        private JObject ListLandscapeObjects(JObject args, World world)
        {
            string kind = ((string)args["kind"] ?? "all").ToLowerInvariant(), search = ((string)args["search"] ?? "").Trim(); float x = (float?)args["x"] ?? 0, z = (float?)args["z"] ?? 0, radius = (float?)args["radius_m"] ?? 100000;
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 1000000), limit = ComponentInspector.Int(args, "limit", 100, 1, 1000); var rows = new List<JObject>(); var em = world.EntityManager;
            using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabRef>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>()))
            using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es)
            {
                var prefab = em.GetComponentData<PrefabRef>(e).m_Prefab; var k = LandscapeKind(em, prefab); if (k == null || kind != "all" && kind != k) continue;
                var t = em.GetComponentData<Game.Objects.Transform>(e); if (math.distance(t.m_Position.xz, new float2(x, z)) > radius) continue; var row = LandscapeRow(e, world); if (search.Length > 0 && ((string)row["prefab"] ?? "").IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue; rows.Add(row);
            }
            rows = rows.OrderBy(r => math.distancesq(new float2((float)r["position"]["x"], (float)r["position"]["z"]), new float2(x, z))).ToList();
            return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["next_offset"] = offset + limit < rows.Count ? new JValue(offset + limit) : null, ["items"] = new JArray(rows.Skip(offset).Take(limit)) };
        }
        private JObject AnalyzeLandscapeArea(JObject args, World world)
        {
            var copy = (JObject)args.DeepClone(); copy["offset"] = 0; copy["limit"] = 1000; var data = ListLandscapeObjects(copy, world); var items = (JArray)data["items"];
            return new JObject { ["matched_count"] = (int)data["total"], ["returned_count"] = items.Count, ["by_kind"] = new JObject(items.GroupBy(x => (string)x["kind"]).Select(g => new JProperty(g.Key, g.Count()))), ["by_prefab"] = new JObject(items.GroupBy(x => (string)x["prefab"]).OrderByDescending(g => g.Count()).Take(100).Select(g => new JProperty(g.Key, g.Count()))), ["truncated"] = (int)data["total"] > items.Count };
        }
        private float3 LandscapePoint(JToken token, TerrainHeightData terrain)
        {
            var p = token as JObject ?? throw new QueryException("INVALID_ARGUMENT", "Each position requires x and z."); var result = new float3((float)p["x"], 0, (float)p["z"]); result.y = p["y"] != null ? (float)p["y"] : TerrainUtils.SampleHeight(ref terrain, result); return result;
        }
        private Entity CreateLandscapeInstance(Entity prefab, float3 position, float rotation, float age, bool natural, World world)
        {
            var em = world.EntityManager;
            var archetype = em.GetComponentData<Game.Prefabs.ObjectData>(prefab).m_Archetype;
            var entities = em.CreateEntity(archetype, 1, Allocator.Temp);
            var e = entities[0]; entities.Dispose();
            em.SetComponentData(e, new PrefabRef(prefab));
            em.SetComponentData(e, new Game.Objects.Transform(position, quaternion.RotateY(math.radians(rotation))));
            if (em.HasComponent<Tree>(e)) { byte growth = (byte)math.clamp(math.round(age * 255f), 0, 255); var state = age < .34f ? TreeState.Teen : age < .84f ? TreeState.Adult : TreeState.Elderly; em.SetComponentData(e, new Tree { m_Growth = growth, m_State = state }); if (em.HasComponent<Decoration>(e)) em.SetComponentEnabled<Decoration>(e, false); }
            if (natural && !em.HasComponent<Native>(e)) em.AddComponent<Native>(e); if (!natural && em.HasComponent<Native>(e)) em.RemoveComponent<Native>(e); if (!em.HasComponent<Created>(e)) em.AddComponent<Created>(e); if (!em.HasComponent<Updated>(e)) em.AddComponent<Updated>(e); return e;
        }
        private JObject PlaceLandscapeObjects(JObject args, World world)
        {
            RequirePaused(world); var prefab = ResolveLandscapePrefab((string)args["prefab"], world); if (RoadOperation.IsLocked(world.EntityManager, prefab)) throw new QueryException("LANDSCAPE_PREFAB_LOCKED", "The selected landscape prefab is locked.");
            var positions = args["positions"] as JArray ?? throw new QueryException("INVALID_ARGUMENT", "positions must contain 1..256 points."); if (positions.Count < 1 || positions.Count > 256) throw new QueryException("INVALID_ARGUMENT", "positions must contain 1..256 points.");
            float rotation = (float?)args["rotation_degrees"] ?? 0, age = (float?)args["age"] ?? 1; bool natural = (bool?)args["natural"] ?? false; var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true); var ids = new JArray();
            foreach (var token in positions) ids.Add(EntityId(CreateLandscapeInstance(prefab, LandscapePoint(token, terrain), rotation, age, natural, world)));
            return new JObject { ["created_count"] = ids.Count, ["object_ids"] = ids, ["prefab"] = (string)args["prefab"], ["native_object_pipeline"] = true };
        }
        private JObject PlantLandscapePattern(JObject args, World world)
        {
            int count = ComponentInspector.Int(args, "count", 1, 1, 1000), seed = ComponentInspector.Int(args, "seed", 1, 1, int.MaxValue); float cx = (float)args["center"]["x"], cz = (float)args["center"]["z"], radius = (float)args["radius_m"], spacing = (float?)args["minimum_spacing_m"] ?? 0; string pattern = ((string)args["pattern"] ?? "random").ToLowerInvariant(); var points = new JArray(); var random = new Unity.Mathematics.Random((uint)seed); var accepted = new List<float2>(); int attempts = 0;
            while (accepted.Count < count && attempts++ < count * 100) { float2 p; if (pattern == "ring") { float a = 2 * math.PI * accepted.Count / count; p = new float2(cx + math.cos(a) * radius, cz + math.sin(a) * radius); } else { float a = random.NextFloat(0, 2 * math.PI), r = math.sqrt(random.NextFloat()) * radius; p = new float2(cx + math.cos(a) * r, cz + math.sin(a) * r); } if (spacing > 0 && accepted.Any(v => math.distance(v, p) < spacing)) continue; accepted.Add(p); points.Add(new JObject { ["x"] = p.x, ["z"] = p.y }); }
            if (accepted.Count < count) throw new QueryException("LANDSCAPE_SPACING_UNSATISFIED", "Could not fit the requested count at the selected radius and minimum spacing."); var copy = (JObject)args.DeepClone(); copy["positions"] = points; return PlaceLandscapeObjects(copy, world);
        }
        private JObject MoveLandscapeObject(JObject args, World world) { RequirePaused(world); var e = ResolveLandscapeObject(args, world); var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true); var before = LandscapeRow(e, world); var t = world.EntityManager.GetComponentData<Game.Objects.Transform>(e); t.m_Position = LandscapePoint(args["position"], terrain); if (args["rotation_degrees"] != null) t.m_Rotation = quaternion.RotateY(math.radians((float)args["rotation_degrees"])); world.EntityManager.SetComponentData(e, t); if (!world.EntityManager.HasComponent<Updated>(e)) world.EntityManager.AddComponent<Updated>(e); return new JObject { ["object_id"] = EntityId(e), ["before"] = before, ["after"] = LandscapeRow(e, world) }; }
        private JObject SetTreeState(JObject args, World world) { RequirePaused(world); var e = ResolveLandscapeObject(args, world); var em = world.EntityManager; if (!em.HasComponent<Tree>(e)) throw new QueryException("NOT_A_TREE", "object_id must identify a tree."); var t = em.GetComponentData<Tree>(e); var before = t; if (args["growth"] != null) t.m_Growth = (byte)(int)args["growth"]; if (args["state"] != null && !Enum.TryParse((string)args["state"], true, out t.m_State)) throw new QueryException("INVALID_TREE_STATE", "Use teen, adult, elderly, dead, stump, or collected."); em.SetComponentData(e, t); if (!em.HasComponent<Updated>(e)) em.AddComponent<Updated>(e); return new JObject { ["object_id"] = EntityId(e), ["state_before"] = before.m_State.ToString(), ["growth_before"] = before.m_Growth, ["state"] = t.m_State.ToString(), ["growth"] = t.m_Growth }; }
        private JObject RemoveLandscapeObjects(JObject args, World world) { RequirePaused(world); var ids = args["object_ids"] as JArray ?? new JArray(); if (ids.Count < 1 || ids.Count > 1000) throw new QueryException("INVALID_ARGUMENT", "object_ids must contain 1..1000 IDs."); var em = world.EntityManager; int removed = 0; foreach (var id in ids) { var e = ResolveLandscapeObject(new JObject { ["object_id"] = id }, world); if (!em.HasComponent<Deleted>(e)) { em.AddComponent<Deleted>(e); removed++; } } return new JObject { ["removed_count"] = removed, ["cleanup_queued"] = true }; }
        private JObject ClearLandscapeArea(JObject args, World world) { RequirePaused(world); var copy = (JObject)args.DeepClone(); copy["offset"] = 0; copy["limit"] = 1000; var objects = (JArray)ListLandscapeObjects(copy, world)["items"]; var ids = new JArray(objects.Select(x => x["object_id"])); if (ids.Count == 0) return new JObject { ["removed_count"] = 0, ["cleanup_queued"] = false }; return RemoveLandscapeObjects(new JObject { ["object_ids"] = ids }, world); }

        private JObject ListWaterSources(JObject args, World world)
        {
            var rows = new JArray(); var em = world.EntityManager; using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Simulation.WaterSourceData>(), ComponentType.ReadOnly<Game.Objects.Transform>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Temp>())) using (var es = q.ToEntityArray(Allocator.Temp)) foreach (var e in es) { var d = em.GetComponentData<Game.Simulation.WaterSourceData>(e); var t = em.GetComponentData<Game.Objects.Transform>(e); rows.Add(new JObject { ["water_source_id"] = EntityId(e), ["position"] = PointJson(t.m_Position), ["radius_m"] = d.m_Radius, ["height_m"] = d.m_Height, ["constant_depth"] = d.m_ConstantDepth != 0, ["multiplier"] = d.m_Multiplier, ["polluted"] = d.m_Polluted, ["native_id"] = d.m_Id }); } return new JObject { ["total"] = rows.Count, ["items"] = rows };
        }
        private Entity ResolveWaterSource(JObject args, World world) { var e = ParseEntity((string)args["water_source_id"], world.EntityManager); if (!world.EntityManager.HasComponent<Game.Simulation.WaterSourceData>(e) || world.EntityManager.HasComponent<Deleted>(e) || world.EntityManager.HasComponent<Temp>(e)) throw new QueryException("WATER_SOURCE_NOT_FOUND", "water_source_id must identify a permanent water source."); return e; }
        private JObject CreateWaterSource(JObject args, World world) { RequirePaused(world); var em = world.EntityManager; var p = args["position"]; var e = em.CreateEntity(typeof(Game.Simulation.WaterSourceData), typeof(Game.Objects.Transform), typeof(Created), typeof(Updated)); var d = new Game.Simulation.WaterSourceData { m_Radius = (float)args["radius_m"], m_Height = (float)args["height_m"], m_ConstantDepth = (bool?)args["constant_depth"] == true ? 1 : 0, m_Multiplier = (float?)args["multiplier"] ?? 1, m_Polluted = (float?)args["polluted"] ?? 0, m_Id = world.GetExistingSystemManaged<WaterSystem>().GetNextSourceId(), m_Modifier = 1 }; em.SetComponentData(e, d); em.SetComponentData(e, new Game.Objects.Transform(new float3((float)p["x"], (float?)p["y"] ?? d.m_Height, (float)p["z"]), quaternion.identity)); return new JObject { ["water_source_id"] = EntityId(e), ["created"] = true, ["native_water_system_id"] = d.m_Id }; }
        private JObject UpdateWaterSource(JObject args, World world) { RequirePaused(world); var e = ResolveWaterSource(args, world); var em = world.EntityManager; var d = em.GetComponentData<Game.Simulation.WaterSourceData>(e); var t = em.GetComponentData<Game.Objects.Transform>(e); var before = new JObject { ["radius_m"] = d.m_Radius, ["height_m"] = d.m_Height, ["polluted"] = d.m_Polluted }; if (args["position"] != null) { var p = args["position"]; t.m_Position = new float3((float)p["x"], (float?)p["y"] ?? t.m_Position.y, (float)p["z"]); } if (args["radius_m"] != null) d.m_Radius = (float)args["radius_m"]; if (args["height_m"] != null) d.m_Height = (float)args["height_m"]; if (args["constant_depth"] != null) d.m_ConstantDepth = (bool)args["constant_depth"] ? 1 : 0; if (args["multiplier"] != null) d.m_Multiplier = (float)args["multiplier"]; if (args["polluted"] != null) d.m_Polluted = (float)args["polluted"]; em.SetComponentData(e, d); em.SetComponentData(e, t); if (!em.HasComponent<Updated>(e)) em.AddComponent<Updated>(e); return new JObject { ["water_source_id"] = EntityId(e), ["before"] = before, ["updated"] = true }; }
        private JObject DeleteWaterSource(JObject args, World world) { RequirePaused(world); var e = ResolveWaterSource(args, world); if (!world.EntityManager.HasComponent<Deleted>(e)) world.EntityManager.AddComponent<Deleted>(e); return new JObject { ["water_source_id"] = EntityId(e), ["deleted"] = true }; }

        private JObject SamplePollution(JObject args, World world)
        {
            SyncReads(world); var points = (JArray)args["points"]; var airSystem = world.GetExistingSystemManaged<AirPollutionSystem>(); var groundSystem = world.GetExistingSystemManaged<GroundPollutionSystem>(); var noiseSystem = world.GetExistingSystemManaged<NoisePollutionSystem>(); JobHandle da, dg, dn; var air = airSystem.GetMap(true, out da); var ground = groundSystem.GetMap(true, out dg); var noise = noiseSystem.GetMap(true, out dn); JobHandle.CombineDependencies(da, dg, dn).Complete(); var rows = new JArray(); foreach (var p in points) { var pos = new float3((float)p["x"], 0, (float)p["z"]); rows.Add(new JObject { ["position"] = new JObject { ["x"] = pos.x, ["z"] = pos.z }, ["air"] = AirPollutionSystem.GetPollution(pos, air).m_Pollution, ["ground"] = GroundPollutionSystem.GetPollution(pos, ground).m_Pollution, ["noise"] = NoisePollutionSystem.GetPollution(pos, noise).m_Pollution }); } return new JObject { ["items"] = rows, ["units"] = "raw game pollution units (0..32767)" };
        }
        private JObject SetPollutionArea(JObject args, World world)
        {
            RequirePaused(world); string type = ((string)args["type"]).ToLowerInvariant(); float x = (float)args["center"]["x"], z = (float)args["center"]["z"], radius = (float)args["radius_m"]; short value = (short)(int)args["value"]; int changed = 0; float cell = 14336f / 256f;
            if (type == "air") { var s = world.GetExistingSystemManaged<AirPollutionSystem>(); JobHandle d; var map = s.GetMap(false, out d); d.Complete(); for (int i = 0; i < map.Length; i++) { var p = CellMapSystem<AirPollution>.GetCellCenter(i, 256); if (math.distance(p.xz, new float2(x, z)) <= radius) { map[i] = new AirPollution { m_Pollution = value }; changed++; } } s.AddWriter(default(JobHandle)); }
            else if (type == "ground") { var s = world.GetExistingSystemManaged<GroundPollutionSystem>(); JobHandle d; var map = s.GetMap(false, out d); d.Complete(); for (int i = 0; i < map.Length; i++) { var p = CellMapSystem<GroundPollution>.GetCellCenter(i, 256); if (math.distance(p.xz, new float2(x, z)) <= radius) { map[i] = new GroundPollution { m_Pollution = value }; changed++; } } s.AddWriter(default(JobHandle)); }
            else if (type == "noise") { var s = world.GetExistingSystemManaged<NoisePollutionSystem>(); JobHandle d; var map = s.GetMap(false, out d); d.Complete(); for (int i = 0; i < map.Length; i++) { var p = CellMapSystem<NoisePollution>.GetCellCenter(i, 256); if (math.distance(p.xz, new float2(x, z)) <= radius) { map[i] = new NoisePollution { m_Pollution = value, m_PollutionTemp = value }; changed++; } } s.AddWriter(default(JobHandle)); }
            else throw new QueryException("INVALID_POLLUTION_TYPE", "Use air, ground, or noise."); return new JObject { ["type"] = type, ["changed_cells"] = changed, ["cell_size_m"] = cell, ["value"] = value };
        }

        private static JObject OverrideState(Game.OverridableProperty<float> property) => new JObject
        {
            ["value"] = (float)property,
            ["base_value"] = property.value,
            ["override_value"] = property.overrideValue,
            ["overridden"] = property.overrideState
        };

        private static float WindPressure(WindSimulationSystem system)
        {
            var property = typeof(WindSimulationSystem).GetProperty("m_ConstantPressure", BindingFlags.Instance | BindingFlags.NonPublic);
            return property == null ? 40f : (float)property.GetValue(system, null);
        }

        private JObject GetClimateState(JObject args, World world)
        {
            var climate = world.GetExistingSystemManaged<ClimateSystem>();
            var windSystem = world.GetExistingSystemManaged<WindSimulationSystem>();
            var wind = windSystem.constantWind;
            return new JObject
            {
                ["climate_entity_id"] = EntityId(climate.currentClimate),
                ["season_entity_id"] = climate.currentSeason == Entity.Null ? null : new JValue(EntityId(climate.currentSeason)),
                ["season_name"] = climate.currentSeasonName,
                ["classification"] = climate.classification.ToString(),
                ["temperature"] = OverrideState(climate.temperature),
                ["precipitation"] = OverrideState(climate.precipitation),
                ["cloudiness"] = OverrideState(climate.cloudiness),
                ["fog"] = OverrideState(climate.fog),
                ["aurora"] = OverrideState(climate.aurora),
                ["thunder"] = OverrideState(climate.thunder),
                ["date"] = OverrideState(climate.currentDate),
                ["hail"] = climate.hail,
                ["rainbow"] = climate.rainbow,
                ["season_temperature"] = climate.seasonTemperature,
                ["season_precipitation"] = climate.seasonPrecipitation,
                ["season_cloudiness"] = climate.seasonCloudiness,
                ["average_temperature"] = climate.averageTemperature,
                ["freezing_temperature"] = climate.freezingTemperature,
                ["is_raining"] = climate.isRaining,
                ["is_snowing"] = climate.isSnowing,
                ["is_precipitating"] = climate.isPrecipitating,
                ["wind"] = new JObject { ["x"] = wind.x, ["z"] = wind.y, ["pressure"] = WindPressure(windSystem) }
            };
        }

        private static void SetOverride(JObject args, string name, Game.OverridableProperty<float> property, bool clear)
        {
            if (clear) property.overrideState = false;
            if (args[name] != null) property.overrideValue = (float)args[name];
        }

        private JObject SetWeatherOverride(JObject args, World world)
        {
            RequirePaused(world);
            var climate = world.GetExistingSystemManaged<ClimateSystem>();
            bool clear = (bool?)args["clear"] ?? false;
            SetOverride(args, "temperature", climate.temperature, clear);
            SetOverride(args, "precipitation", climate.precipitation, clear);
            SetOverride(args, "cloudiness", climate.cloudiness, clear);
            SetOverride(args, "fog", climate.fog, clear);
            SetOverride(args, "aurora", climate.aurora, clear);
            SetOverride(args, "thunder", climate.thunder, clear);
            SetOverride(args, "date", climate.currentDate, clear);
            if (args["hail"] != null) climate.hail = (float)args["hail"];
            if (args["rainbow"] != null) climate.rainbow = (float)args["rainbow"];
            return GetClimateState(new JObject(), world);
        }

        private JObject SetWind(JObject args, World world)
        {
            RequirePaused(world);
            var system = world.GetExistingSystemManaged<WindSimulationSystem>();
            var before = system.constantWind;
            float beforePressure = WindPressure(system);
            system.SetWind(new float2((float)args["x"], (float)args["z"]), (float)args["pressure"]);
            return new JObject
            {
                ["before"] = new JObject { ["x"] = before.x, ["z"] = before.y, ["pressure"] = beforePressure },
                ["after"] = new JObject { ["x"] = system.constantWind.x, ["z"] = system.constantWind.y, ["pressure"] = WindPressure(system) }
            };
        }

        private JObject SampleWind(JObject args, World world)
        {
            SyncReads(world);
            var system = world.GetExistingSystemManaged<WindSystem>();
            JobHandle dependency;
            var map = system.GetMap(true, out dependency);
            dependency.Complete();
            var rows = new JArray();
            foreach (var p in (JArray)args["points"])
            {
                var position = new float3((float)p["x"], 0, (float)p["z"]);
                var wind = WindSystem.GetWind(position, map).m_Wind;
                rows.Add(new JObject { ["position"] = new JObject { ["x"] = position.x, ["z"] = position.z }, ["x"] = wind.x, ["z"] = wind.y, ["speed"] = math.length(wind) });
            }
            return new JObject { ["items"] = rows, ["units"] = "native wind velocity" };
        }

        private JObject SampleSoilWater(JObject args, World world)
        {
            SyncReads(world);
            var system = world.GetExistingSystemManaged<SoilWaterSystem>();
            JobHandle dependency;
            var map = system.GetMap(true, out dependency);
            dependency.Complete();
            var rows = new JArray();
            foreach (var p in (JArray)args["points"])
            {
                var position = new float3((float)p["x"], 0, (float)p["z"]);
                var interpolated = SoilWaterSystem.GetSoilWater(position, map);
                int2 cell = CellMapSystem<SoilWater>.GetCell(position, CellMapSystem<SoilWater>.kMapSize, SoilWaterSystem.kTextureSize);
                var row = new JObject { ["position"] = new JObject { ["x"] = position.x, ["z"] = position.z }, ["amount"] = interpolated.m_Amount, ["inside_map"] = cell.x >= 0 && cell.x < SoilWaterSystem.kTextureSize && cell.y >= 0 && cell.y < SoilWaterSystem.kTextureSize };
                if ((bool)row["inside_map"])
                {
                    var nearest = map[cell.x + SoilWaterSystem.kTextureSize * cell.y];
                    row["nearest_cell"] = new JObject { ["x"] = cell.x, ["z"] = cell.y, ["amount"] = nearest.m_Amount, ["maximum"] = nearest.m_Max, ["surface_height"] = nearest.m_Surface, ["saturation"] = nearest.m_Max == 0 ? 0 : (float)nearest.m_Amount / nearest.m_Max };
                }
                rows.Add(row);
            }
            return new JObject { ["resolution"] = SoilWaterSystem.kTextureSize, ["items"] = rows, ["units"] = "raw game soil-water units" };
        }

        private JObject ReadSurfaceWaterMask(JObject args, World world)
        {
            SyncReads(world);
            var tiles = MapTileEntities(world.EntityManager);
            if (tiles.Count == 0) throw new QueryException("MAP_BOUNDS_UNAVAILABLE", "No map tiles are loaded.");
            float2 min = new float2(float.MaxValue), max = new float2(float.MinValue);
            foreach (var tile in tiles)
            {
                var points = MapTilePoints(world.EntityManager, tile);
                MapTileBounds(points, out var tileMin, out var tileMax);
                min = math.min(min, tileMin); max = math.max(max, tileMax);
            }
            if (args["bounds"] is JObject requested)
            {
                var clipped = ReadPlanningBounds(new JObject { ["bounds"] = requested });
                min = math.max(min, new float2(clipped.MinX, clipped.MinZ));
                max = math.min(max, new float2(clipped.MaxX, clipped.MaxZ));
                if (min.x >= max.x || min.y >= max.y) throw new QueryException("INVALID_ARGUMENT", "bounds does not intersect the loaded map.");
            }
            float cellSize = (float?)args["cell_size_m"] ?? 16f;
            float threshold = (float?)args["water_threshold_m"] ?? 0.01f;
            if (cellSize < 1 || cellSize > 256 || threshold < 0 || threshold > 1000) throw new QueryException("INVALID_ARGUMENT", "cell_size_m must be 1..256 and water_threshold_m must be 0..1000.");
            int columns = math.max(1, (int)math.ceil((max.x - min.x) / cellSize));
            int rowsCount = math.max(1, (int)math.ceil((max.y - min.y) / cellSize));
            int total = checked(columns * rowsCount);
            int offset = ComponentInspector.Int(args, "offset", 0, 0, total);
            int limit = ComponentInspector.Int(args, "limit", 256, 1, 1024);
            var surface = world.GetExistingSystemManaged<WaterSystem>().GetSurfaceData(out var deps); deps.Complete();
            if (!surface.isCreated) throw new QueryException("WATER_UNAVAILABLE", "Water surface data is unavailable.");
            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!terrain.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height data is unavailable.");
            var cells = new JArray();
            int end = math.min(total, offset + limit);
            for (int index = offset; index < end; index++)
            {
                int x = index % columns, z = index / columns;
                var p = new float3(min.x + (x + 0.5f) * cellSize, 0, min.y + (z + 0.5f) * cellSize);
                float depth = WaterUtils.SampleDepth(ref surface, p);
                bool hasWater; float surfaceHeight = WaterUtils.SampleHeight(ref surface, ref terrain, p, out hasWater);
                cells.Add(new JObject {
                    ["index"] = index, ["grid_x"] = x, ["grid_z"] = z,
                    ["x"] = p.x, ["z"] = p.z, ["water"] = depth > threshold,
                    ["water_depth_m"] = depth, ["has_surface_height"] = hasWater,
                    ["surface_height_m"] = hasWater ? surfaceHeight : JValue.CreateNull()
                });
            }
            return new JObject {
                ["resolution"] = new JObject { ["x"] = columns, ["z"] = rowsCount },
                ["world_bounds"] = new JObject { ["min_x"] = min.x, ["min_z"] = min.y, ["max_x"] = max.x, ["max_z"] = max.y },
                ["cell_size_m"] = cellSize, ["water_threshold_m"] = threshold,
                ["total_cells"] = total, ["cells"] = cells,
                ["next_offset"] = end < total ? end : JValue.CreateNull(),
                ["classification"] = "water=true when native WaterUtils.SampleDepth exceeds water_threshold_m; water=false is dry/land.",
                ["units"] = "water_depth_m and surface_height_m are metres"
            };
        }
    }
}
