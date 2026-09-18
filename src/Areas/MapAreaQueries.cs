using System;
using System.Collections.Generic;
using System.Linq;
using Game.Areas;
using Game.City;
using Game.Common;
using Game.Prefabs;
using Game.Simulation;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;
using UnityEngine;

namespace CityWeaver
{
    public sealed class MapTileOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint, State = "preview_ready", Error;
        public readonly List<Entity> Tiles = new List<Entity>();
        public int OwnedBefore, PermitsBefore, MoneyBefore, Cost, UpkeepChange;
        public DateTime Expires = DateTime.UtcNow.AddMinutes(5);
        public bool Terminal => State == "completed" || State == "cancelled" || State == "failed" || State == "expired";
        private string EntityId(Entity e) => Session + ":" + e.Index + ":" + e.Version;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["request_id"] = RequestId, ["state"] = State,
            ["tile_ids"] = new JArray(Tiles.Select(EntityId)), ["tile_count"] = Tiles.Count,
            ["owned_before"] = OwnedBefore, ["owned_after"] = State == "completed" ? OwnedBefore + Tiles.Count : (int?)null,
            ["permits_before"] = PermitsBefore, ["permits_after"] = State == "completed" ? PermitsBefore - Tiles.Count : (int?)null,
            ["money_before"] = MoneyBefore, ["cost"] = Cost, ["estimated_upkeep_change"] = UpkeepChange,
            ["can_apply"] = State == "preview_ready", ["expires_at_utc"] = Expires.ToString("O"), ["error"] = Error
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, MapTileOperation> m_MapTileOperations = new Dictionary<string, MapTileOperation>();
        private readonly Dictionary<string, string> m_MapTileRequestIds = new Dictionary<string, string>();
        private void ResetMapTileOperations() { m_MapTileOperations.Clear(); m_MapTileRequestIds.Clear(); }

        private static List<Entity> MapTileEntities(EntityManager em)
        {
            var result = new List<Entity>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<MapTile>(), ComponentType.ReadOnly<Area>(), ComponentType.ReadOnly<Game.Areas.Node>(), ComponentType.Exclude<Game.Tools.Temp>(), ComponentType.Exclude<Deleted>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) result.Add(entity);
            result.Sort((a, b) => a.Index.CompareTo(b.Index)); return result;
        }

        private static List<float3> MapTilePoints(EntityManager em, Entity tile)
        {
            var result = new List<float3>(); var buffer = em.GetBuffer<Game.Areas.Node>(tile, true);
            for (int i = 0; i < buffer.Length; i++) result.Add(buffer[i].m_Position); return result;
        }

        private static void MapTileBounds(IList<float3> points, out float2 min, out float2 max)
        {
            min = new float2(float.MaxValue); max = new float2(float.MinValue);
            foreach (var point in points) { min = math.min(min, point.xz); max = math.max(max, point.xz); }
        }

        private static bool NeighborBounds(float2 amin, float2 amax, float2 bmin, float2 bmax)
        {
            const float tolerance = 1f;
            float xOverlap = math.min(amax.x, bmax.x) - math.max(amin.x, bmin.x), zOverlap = math.min(amax.y, bmax.y) - math.max(amin.y, bmin.y);
            return math.abs(amax.x - bmin.x) <= tolerance && zOverlap > tolerance || math.abs(bmax.x - amin.x) <= tolerance && zOverlap > tolerance || math.abs(amax.y - bmin.y) <= tolerance && xOverlap > tolerance || math.abs(bmax.y - amin.y) <= tolerance && xOverlap > tolerance;
        }

        private static Dictionary<Entity, List<Entity>> MapTileNeighbors(EntityManager em, IList<Entity> tiles)
        {
            var bounds = new Dictionary<Entity, Tuple<float2, float2>>();
            foreach (var tile in tiles) { MapTileBounds(MapTilePoints(em, tile), out var min, out var max); bounds[tile] = Tuple.Create(min, max); }
            var result = tiles.ToDictionary(x => x, x => new List<Entity>());
            for (int i = 0; i < tiles.Count; i++) for (int j = i + 1; j < tiles.Count; j++) if (NeighborBounds(bounds[tiles[i]].Item1, bounds[tiles[i]].Item2, bounds[tiles[j]].Item1, bounds[tiles[j]].Item2)) { result[tiles[i]].Add(tiles[j]); result[tiles[j]].Add(tiles[i]); }
            return result;
        }

        private static JArray MapFeatures(EntityManager em, Entity tile)
        {
            var result = new JArray(); if (!em.HasBuffer<MapFeatureElement>(tile)) return result; var buffer = em.GetBuffer<MapFeatureElement>(tile, true);
            for (int i = 0; i < buffer.Length && i < (int)MapFeature.Count; i++) result.Add(new JObject { ["feature"] = ((MapFeature)i).ToString(), ["amount"] = buffer[i].m_Amount, ["renewal_rate"] = buffer[i].m_RenewalRate });
            return result;
        }

        private JObject MapTileJson(World world, Entity tile, Dictionary<Entity, List<Entity>> neighbors, bool boundary)
        {
            var em = world.EntityManager; var points = MapTilePoints(em, tile); MapTileBounds(points, out var min, out var max); bool owned = !em.HasComponent<Native>(tile); var start = world.GetExistingSystemManaged<MapTileSystem>().GetStartTiles();
            var row = new JObject {
                ["tile_id"] = EntityId(tile), ["owned"] = owned, ["native_locked"] = !owned, ["starting_tile"] = start.Contains(tile),
                ["center"] = new JObject { ["x"] = (min.x + max.x) * .5f, ["z"] = (min.y + max.y) * .5f },
                ["bounds"] = new JObject { ["min_x"] = min.x, ["min_z"] = min.y, ["max_x"] = max.x, ["max_z"] = max.y },
                ["surface_area_m2"] = PolygonArea(points), ["area_flags"] = em.GetComponentData<Area>(tile).m_Flags.ToString(), ["features"] = MapFeatures(em, tile)
            };
            if (neighbors != null && neighbors.TryGetValue(tile, out var adjacent)) { row["neighbor_ids"] = new JArray(adjacent.Select(EntityId)); row["owned_neighbor_count"] = adjacent.Count(x => !em.HasComponent<Native>(x)); row["purchasable_by_adjacency"] = !owned && adjacent.Any(x => !em.HasComponent<Native>(x)); }
            if (boundary) row["boundary"] = new JArray(points.Select(PointJson)); return row;
        }

        private Entity ResolveMapTile(JObject args, World world)
        {
            var tile = ParseEntity((string)args["tile_id"], world.EntityManager);
            if (!world.EntityManager.HasComponent<MapTile>(tile) || !world.EntityManager.HasBuffer<Game.Areas.Node>(tile)) throw new QueryException("MAP_TILE_NOT_FOUND", "tile_id must identify a live map tile in this city session."); return tile;
        }

        private JObject GetMapOverview(World world)
        {
            var em = world.EntityManager; var tiles = MapTileEntities(em); int owned = tiles.Count(x => !em.HasComponent<Native>(x)); float2 min = new float2(float.MaxValue), max = new float2(float.MinValue); double ownedArea = 0, totalArea = 0;
            foreach (var tile in tiles) { var points = MapTilePoints(em, tile); MapTileBounds(points, out var a, out var b); min = math.min(min, a); max = math.max(max, b); var area = PolygonArea(points); totalArea += area; if (!em.HasComponent<Native>(tile)) ownedArea += area; }
            int districts; using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<District>(), ComponentType.Exclude<Game.Tools.Temp>(), ComponentType.Exclude<Deleted>())) districts = q.CalculateEntityCount();
            int zonedCells; using (var q = em.CreateEntityQuery(ComponentType.ReadOnly<Game.Zones.Cell>(), ComponentType.Exclude<Game.Tools.Temp>(), ComponentType.Exclude<Deleted>())) zonedCells = q.CalculateEntityCount();
            var purchase = world.GetExistingSystemManaged<MapTilePurchaseSystem>(); var climate = world.GetExistingSystemManaged<ClimateSystem>();
            return new JObject {
                ["city_name"] = world.GetExistingSystemManaged<CityConfigurationSystem>()?.cityName,
                ["world_bounds"] = new JObject { ["min_x"] = min.x, ["min_z"] = min.y, ["max_x"] = max.x, ["max_z"] = max.y, ["width_m"] = max.x - min.x, ["depth_m"] = max.y - min.y },
                ["map_tiles"] = new JObject { ["total"] = tiles.Count, ["owned"] = owned, ["unowned"] = tiles.Count - owned, ["available_permits"] = purchase.GetAvailableTiles(), ["owned_area_m2"] = ownedArea, ["total_area_m2"] = totalArea, ["upkeep"] = purchase.CalculateOwnedTilesUpkeep(), ["upkeep_enabled"] = purchase.GetMapTileUpkeepEnabled() },
                ["areas"] = new JObject { ["districts"] = districts, ["zoned_cells"] = zonedCells }, ["sea_level_m"] = world.GetExistingSystemManaged<WaterSystem>().SeaLevel,
                ["climate"] = new JObject { ["season"] = climate.currentSeasonName, ["classification"] = climate.classification.ToString(), ["temperature_c"] = (float)climate.temperature, ["precipitation"] = (float)climate.precipitation, ["cloudiness"] = (float)climate.cloudiness, ["wind"] = new JArray(climate.wind.x, climate.wind.y), ["raining"] = climate.isRaining, ["snowing"] = climate.isSnowing }
            };
        }

        private JObject ListMapTiles(JObject args, World world)
        {
            string state = ((string)args["state"] ?? "all").ToLowerInvariant(); if (state != "all" && state != "owned" && state != "unowned" && state != "purchasable") throw new QueryException("INVALID_ARGUMENT", "state must be all, owned, unowned, or purchasable.");
            int offset = ComponentInspector.Int(args, "offset", 0, 0, 100000), limit = ComponentInspector.Int(args, "limit", 100, 1, 529); var em = world.EntityManager; var all = MapTileEntities(em); var neighbors = MapTileNeighbors(em, all); var rows = new List<Entity>();
            foreach (var tile in all) { bool owned = !em.HasComponent<Native>(tile), purchasable = !owned && neighbors[tile].Any(x => !em.HasComponent<Native>(x)); if (state == "owned" && !owned || state == "unowned" && owned || state == "purchasable" && !purchasable) continue; rows.Add(tile); }
            return new JObject { ["total"] = rows.Count, ["offset"] = offset, ["limit"] = limit, ["truncated"] = offset + limit < rows.Count, ["items"] = new JArray(rows.Skip(offset).Take(limit).Select(x => MapTileJson(world, x, neighbors, false))) };
        }

        private JObject GetMapTile(JObject args, World world) { var all = MapTileEntities(world.EntityManager); return MapTileJson(world, ResolveMapTile(args, world), MapTileNeighbors(world.EntityManager, all), true); }

        private JObject FindMapTileAt(JObject args, World world)
        {
            float2 point = new float2((float)args["x"], (float)args["z"]); var em = world.EntityManager; var all = MapTileEntities(em); var neighbors = MapTileNeighbors(em, all);
            foreach (var tile in all) if (Contains(MapTilePoints(em, tile), point)) return new JObject { ["found"] = true, ["position"] = new JObject { ["x"] = point.x, ["z"] = point.y }, ["tile"] = MapTileJson(world, tile, neighbors, false) };
            return new JObject { ["found"] = false, ["position"] = new JObject { ["x"] = point.x, ["z"] = point.y }, ["tile"] = null };
        }

        private JObject GetMapTileNeighbors(JObject args, World world)
        {
            var tile = ResolveMapTile(args, world); var all = MapTileEntities(world.EntityManager); var neighbors = MapTileNeighbors(world.EntityManager, all); return new JObject { ["tile_id"] = EntityId(tile), ["total"] = neighbors[tile].Count, ["items"] = new JArray(neighbors[tile].Select(x => MapTileJson(world, x, null, false))) };
        }

        private JObject AnalyzeMapTileFeatures(JObject args, World world)
        {
            string state = ((string)args["state"] ?? "all").ToLowerInvariant(); if (state != "all" && state != "owned" && state != "unowned") throw new QueryException("INVALID_ARGUMENT", "state must be all, owned, or unowned."); int limit = ComponentInspector.Int(args, "limit", 20, 1, 100); var em = world.EntityManager; var totals = new double[(int)MapFeature.Count]; var tiles = new List<JObject>();
            foreach (var tile in MapTileEntities(em)) { bool owned = !em.HasComponent<Native>(tile); if (state == "owned" && !owned || state == "unowned" && owned) continue; var values = new double[(int)MapFeature.Count]; if (em.HasBuffer<MapFeatureElement>(tile)) { var buffer = em.GetBuffer<MapFeatureElement>(tile, true); for (int i = 0; i < buffer.Length && i < values.Length; i++) totals[i] += values[i] = buffer[i].m_Amount; } tiles.Add(new JObject { ["tile_id"] = EntityId(tile), ["owned"] = owned, ["buildable_land"] = values[(int)MapFeature.BuildableLand], ["total_natural_resource_weight"] = values.Skip((int)MapFeature.FertileLand).Sum() }); }
            var features = new JArray(); for (int i = 0; i < totals.Length; i++) features.Add(new JObject { ["feature"] = ((MapFeature)i).ToString(), ["amount"] = totals[i] });
            return new JObject { ["state"] = state, ["tile_count"] = tiles.Count, ["features"] = features, ["best_buildable_tiles"] = new JArray(tiles.OrderByDescending(x => (double)x["buildable_land"]).Take(limit)), ["richest_resource_tiles"] = new JArray(tiles.OrderByDescending(x => (double)x["total_natural_resource_weight"]).Take(limit)), ["units"] = "Native MapFeatureElement amounts; BuildableLand/Area are area-like values, other features retain native weights or volumes." };
        }

        private JObject AnalyzeBuildableArea(JObject args, World world)
        {
            string state = ((string)args["state"] ?? "owned").ToLowerInvariant(); if (state != "all" && state != "owned" && state != "unowned") throw new QueryException("INVALID_ARGUMENT", "state must be all, owned, or unowned."); var em = world.EntityManager; double surface = 0, buildable = 0; int count = 0;
            foreach (var tile in MapTileEntities(em)) { bool owned = !em.HasComponent<Native>(tile); if (state == "owned" && !owned || state == "unowned" && owned) continue; count++; surface += PolygonArea(MapTilePoints(em, tile)); if (em.HasBuffer<MapFeatureElement>(tile)) { var b = em.GetBuffer<MapFeatureElement>(tile, true); if (b.Length > (int)MapFeature.BuildableLand) buildable += b[(int)MapFeature.BuildableLand].m_Amount; } }
            return new JObject { ["state"] = state, ["tile_count"] = count, ["tile_surface_area_m2"] = surface, ["native_buildable_land_amount"] = buildable, ["buildable_share_of_tile_surface"] = surface > 0 ? buildable / surface : 0, ["note"] = "BuildableLand is the native map-feature measure. Zoning availability still depends on terrain, roads, water, objects and lot rules." };
        }

        private static float TileBaseCost(EntityManager em, Entity tile)
        {
            if (!em.HasComponent<PrefabRef>(tile) || !em.HasBuffer<MapFeatureElement>(tile)) return 0; var prefab = em.GetComponentData<PrefabRef>(tile).m_Prefab; if (!em.HasComponent<TilePurchaseCostFactor>(prefab) || !em.HasBuffer<MapFeatureData>(prefab)) return 0; var amounts = em.GetBuffer<MapFeatureElement>(tile, true); var costs = em.GetBuffer<MapFeatureData>(prefab, true); double result = 0, sizeModifier = 1.0 / Math.Pow(623.304347826087, 2.0), resourceModifier = 8.0718994140625E-07;
            for (int i = 0; i < amounts.Length && i < costs.Length; i++) { double modifier = i == (int)MapFeature.Area || i == (int)MapFeature.BuildableLand ? sizeModifier : i >= 0 && i < 8 ? resourceModifier : 1; result += amounts[i].m_Amount * modifier * 10.0 * costs[i].m_Cost * em.GetComponentData<TilePurchaseCostFactor>(prefab).m_Amount; } return (float)result;
        }

        private static void QuoteMapTiles(World world, IList<Entity> selected, out int cost, out int upkeep)
        {
            var em = world.EntityManager; var purchase = world.GetExistingSystemManaged<MapTilePurchaseSystem>(); int owned = MapTileEntities(em).Count(x => !em.HasComponent<Native>(x)); var values = selected.Select(x => TileBaseCost(em, x)).OrderByDescending(x => x).ToArray(); double raw = 0; for (int i = 0; i < values.Length; i++) raw += values[i] * (owned + i); cost = Mathf.RoundToInt((float)raw); double selectedTotal = values.Sum(x => (double)x); upkeep = Mathf.RoundToInt((float)(2 * selectedTotal * purchase.GetMapTileUpkeepCostMultiplier(owned + values.Length) - selectedTotal * purchase.GetMapTileUpkeepCostMultiplier(owned)));
        }

        private MapTileOperation PreviewMapTilePurchase(JObject args, World world)
        {
            RequirePaused(world); string key = RequestKey(args); var ids = args["tile_ids"] as JArray; if (ids == null || ids.Count < 1 || ids.Count > 64) throw new QueryException("INVALID_ARGUMENT", "tile_ids must contain 1..64 map tile IDs."); string fingerprint = ids.ToString(Formatting.None);
            if (m_MapTileRequestIds.TryGetValue(key, out var existing)) { var prior = m_MapTileOperations[existing]; if (prior.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another map-tile selection."); return prior; }
            if (m_MapTileOperations.Count >= 128) throw new QueryException("MAP_TILE_OPERATION_LIMIT", "This city session has reached 128 map-tile operations."); var em = world.EntityManager; var selected = new List<Entity>();
            foreach (var token in ids) { var tile = ParseEntity((string)token, em); if (!em.HasComponent<MapTile>(tile)) throw new QueryException("MAP_TILE_NOT_FOUND", "Every tile_id must identify a map tile."); if (!em.HasComponent<Native>(tile)) throw new QueryException("MAP_TILE_ALREADY_OWNED", "Every selected tile must still be unowned."); if (selected.Contains(tile)) throw new QueryException("DUPLICATE_MAP_TILE", "tile_ids must not contain duplicates."); selected.Add(tile); }
            var all = MapTileEntities(em); var neighbors = MapTileNeighbors(em, all); var connected = new HashSet<Entity>(selected.Where(x => neighbors[x].Any(n => !em.HasComponent<Native>(n)))); bool changed; do { changed = false; foreach (var tile in selected) if (!connected.Contains(tile) && neighbors[tile].Any(connected.Contains)) { connected.Add(tile); changed = true; } } while (changed);
            if (connected.Count != selected.Count) throw new QueryException("MAP_TILE_NOT_CONNECTED", "Every selected tile must connect by an edge to owned land or another selected tile connected to owned land."); var purchase = world.GetExistingSystemManaged<MapTilePurchaseSystem>(); int permits = purchase.GetAvailableTiles(); if (selected.Count > permits) throw new QueryException("INSUFFICIENT_MAP_TILE_PERMITS", "The selection exceeds currently available expansion permits."); QuoteMapTiles(world, selected, out var cost, out var upkeep); int money = world.GetExistingSystemManaged<CitySystem>().moneyAmount; if (cost > money) throw new QueryException("INSUFFICIENT_FUNDS", "The city does not have enough money for this map-tile selection.");
            var op = new MapTileOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, OwnedBefore = all.Count(x => !em.HasComponent<Native>(x)), PermitsBefore = permits, MoneyBefore = money, Cost = cost, UpkeepChange = upkeep }; op.Tiles.AddRange(selected); m_MapTileOperations.Add(op.Id, op); m_MapTileRequestIds.Add(key, op.Id); return op;
        }

        private MapTileOperation MapTileOperationById(JObject args)
        {
            if (!m_MapTileOperations.TryGetValue((string)args["operation_id"] ?? "", out var op) || op.Session != m_Session) throw new QueryException("MAP_TILE_OPERATION_NOT_FOUND", "Unknown map-tile operation in this city session."); if (!op.Terminal && DateTime.UtcNow > op.Expires) op.State = "expired"; return op;
        }

        private JObject GetMapTileOperation(JObject args) => MapTileOperationById(args).Json();

        private JObject ApplyMapTilePurchase(JObject args, World world)
        {
            RequirePaused(world); var op = MapTileOperationById(args); if (RequestKey(args) != op.RequestId) throw new QueryException("IDEMPOTENCY_CONFLICT", "Use the same request_id as preview_map_tile_purchase."); if (op.State == "completed") return op.Json(); if (op.State != "preview_ready") throw new QueryException("INVALID_OPERATION_STATE", "Only a preview_ready map-tile operation can be applied."); var em = world.EntityManager; var all = MapTileEntities(em); int owned = all.Count(x => !em.HasComponent<Native>(x)); var purchase = world.GetExistingSystemManaged<MapTilePurchaseSystem>();
            if (owned != op.OwnedBefore || purchase.GetAvailableTiles() != op.PermitsBefore || op.Tiles.Any(x => !em.Exists(x) || !em.HasComponent<MapTile>(x) || !em.HasComponent<Native>(x))) throw new QueryException("MAP_TILE_CONFLICT", "Map ownership or permits changed after preview; nothing was applied."); QuoteMapTiles(world, op.Tiles, out var cost, out var upkeep); if (cost != op.Cost) throw new QueryException("MAP_TILE_PRICE_CHANGED", "The native map-tile price changed after preview; nothing was applied."); var city = world.GetExistingSystemManaged<CitySystem>().City; var money = em.GetComponentData<PlayerMoney>(city); if (world.GetExistingSystemManaged<CitySystem>().moneyAmount < cost) throw new QueryException("INSUFFICIENT_FUNDS", "The city no longer has enough money."); var unlocked = new List<Entity>();
            try { money.Subtract(cost); em.SetComponentData(city, money); foreach (var tile in op.Tiles) { MapTilePurchaseSystem.UnlockTile(em, tile); unlocked.Add(tile); } }
            catch (Exception error) { foreach (var tile in unlocked) if (!em.HasComponent<Native>(tile)) em.AddComponent<Native>(tile); var rollback = em.GetComponentData<PlayerMoney>(city); rollback.Add(cost); em.SetComponentData(city, rollback); op.State = "failed"; op.Error = error.GetType().Name + ": " + error.Message; throw new QueryException("MAP_TILE_APPLY_FAILED", "Map-tile purchase failed and money/ownership were rolled back."); }
            op.State = "completed"; return op.Json();
        }

        private JObject CancelMapTilePurchase(JObject args) { var op = MapTileOperationById(args); if (!op.Terminal) op.State = "cancelled"; return op.Json(); }

        private JObject UnlockAllMapTiles(JObject args, World world)
        {
            RequirePaused(world); if (!((bool?)args["confirm_irreversible"] ?? false)) throw new QueryException("CONFIRMATION_REQUIRED", "Set confirm_irreversible=true; map ownership cannot be automatically restored."); var em = world.EntityManager; var all = MapTileEntities(em); int before = all.Count(x => !em.HasComponent<Native>(x)); world.GetExistingSystemManaged<MapTilePurchaseSystem>().UnlockMapTiles(); int after = MapTileEntities(em).Count(x => !em.HasComponent<Native>(x)); return new JObject { ["owned_before"] = before, ["owned_after"] = after, ["unlocked"] = after - before, ["all_map_tiles_owned"] = after == all.Count, ["cost"] = 0 };
        }
    }
}
