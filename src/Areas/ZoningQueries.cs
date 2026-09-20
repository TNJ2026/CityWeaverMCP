using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Game.Zones;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed class ZoningCellChange
    {
        public Entity Edge, Block;
        public int CellIndex, GridX, GridY, Depth;
        public string Side;
        public float3 Position;
        public Cell Before, After;
    }

    public sealed class ZoningOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint, ZoneName;
        public ushort ZoneIndex;
        public string Side;
        public int DepthCells;
        public bool Overwrite, IncludeOccupied;
        public string State = "preview_ready", Error, CommitRequestId;
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public readonly List<Entity> Edges = new List<Entity>();
        public readonly List<ZoningCellChange> Changes = new List<ZoningCellChange>();
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired";
        public string EntityId(Entity e) => e == Entity.Null ? null : Session + ":" + e.Index + ":" + e.Version;
        public JObject Json() => new JObject {
            ["operation_id"] = Id, ["session_id"] = Session, ["request_id"] = RequestId, ["state"] = State,
            ["zone"] = ZoneName, ["zone_index"] = ZoneIndex, ["mode"] = ZoneIndex == 0 ? "clear" : "assign",
            ["road_side"] = Side, ["depth_cells"] = DepthCells, ["overwrite"] = Overwrite,
            ["include_occupied"] = IncludeOccupied, ["target_edge_ids"] = new JArray(Edges.Select(EntityId)),
            ["changed_cell_count"] = Changes.Count,
            ["changes_by_side"] = new JObject { ["left"] = Changes.Count(c => c.Side == "left"), ["right"] = Changes.Count(c => c.Side == "right") },
            ["changes_by_previous_zone"] = new JObject(Changes.GroupBy(c => c.Before.m_Zone.m_Index.ToString()).Select(g => new JProperty(g.Key, g.Count()))),
            ["sample_cells"] = new JArray(Changes.Take(32).Select(c => new JObject {
                ["block_id"] = EntityId(c.Block), ["cell_index"] = c.CellIndex, ["grid_x"] = c.GridX, ["grid_y"] = c.GridY,
                ["depth"] = c.Depth, ["side"] = c.Side, ["position"] = new JObject { ["x"] = c.Position.x, ["y"] = c.Position.y, ["z"] = c.Position.z },
                ["before_zone_index"] = c.Before.m_Zone.m_Index, ["after_zone_index"] = c.After.m_Zone.m_Index,
                ["occupied"] = (c.Before.m_State & CellFlags.Occupied) != 0
            })),
            ["error"] = Error, ["expires_at_utc"] = Expires.ToString("O"),
            ["can_commit"] = State == "preview_ready",
            ["note"] = "This is an atomic cell snapshot. Apply rejects the whole operation if any target cell changed after preview."
        };
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, ZoningOperation> m_ZoningOperations = new Dictionary<string, ZoningOperation>();
        private readonly Dictionary<string, string> m_ZoningRequestIds = new Dictionary<string, string>();

        private void ResetZoningOperations() { m_ZoningOperations.Clear(); m_ZoningRequestIds.Clear(); }
        private static bool SameCell(Cell a, Cell b) => a.m_State == b.m_State && a.m_Zone.m_Index == b.m_Zone.m_Index && a.m_Height == b.m_Height;
        private static bool PermanentRoad(EntityManager em, Entity e) => em.Exists(e) && em.HasComponent<Edge>(e) && em.HasComponent<Road>(e) && !em.HasComponent<Temp>(e) && !em.HasComponent<Deleted>(e);

        private JObject ListZoneTypes(JObject args, World world)
        {
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            var search = (string)args["search"] ?? ""; var unlockedOnly = args["unlocked_only"] == null || (bool)args["unlocked_only"];
            var rows = new List<JObject>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<ZoneData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp))
            {
                foreach (var entity in entities)
                {
                    if (!prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) || !(prefab is ZonePrefab) || prefab.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    var locked = RoadOperation.IsLocked(em, entity); if (unlockedOnly && locked) continue;
                    var data = em.GetComponentData<ZoneData>(entity);
                    rows.Add(new JObject { ["name"] = prefab.name, ["zone_index"] = data.m_ZoneType.m_Index, ["area_type"] = data.m_AreaType.ToString(),
                        ["office"] = data.IsOffice(), ["flags"] = data.m_ZoneFlags.ToString(), ["supports_narrow_lots"] = (data.m_ZoneFlags & ZoneFlags.SupportNarrow) != 0,
                        ["min_odd_height"] = data.m_MinOddHeight, ["min_even_height"] = data.m_MinEvenHeight, ["max_height"] = data.m_MaxHeight, ["locked"] = locked });
                }
            }
            rows = rows.OrderBy(r => (int)r["zone_index"]).ToList();
            return new JObject { ["total"] = rows.Count, ["items"] = new JArray(rows), ["clear_zone"] = "none" };
        }

        private Dictionary<ushort, string> ZoneNames(World world)
        {
            var result = new Dictionary<ushort, string> { [0] = "none" }; var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<ZoneData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
                if (prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab)) result[em.GetComponentData<ZoneData>(entity).m_ZoneType.m_Index] = prefab.name;
            return result;
        }

        private Entity ResolveZone(string name, World world, out ZoneData data)
        {
            data = default(ZoneData); if (string.Equals(name, "none", StringComparison.OrdinalIgnoreCase) || string.Equals(name, "clear", StringComparison.OrdinalIgnoreCase)) return Entity.Null;
            var em = world.EntityManager; var prefabs = world.GetExistingSystemManaged<PrefabSystem>();
            using (var query = em.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(), ComponentType.ReadOnly<ZoneData>()))
            using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
                if (prefabs.TryGetPrefab<PrefabBase>(entity, out var prefab) && prefab is ZonePrefab && string.Equals(prefab.name, name, StringComparison.OrdinalIgnoreCase))
                { if (RoadOperation.IsLocked(em, entity)) throw new QueryException("ZONE_LOCKED", "The selected zone type is locked."); data = em.GetComponentData<ZoneData>(entity); return entity; }
            throw new QueryException("UNKNOWN_ZONE", "Use an exact unlocked zone name from list_zone_types, or none to clear zoning.");
        }

        private static Tuple<float, float> ClosestRoad(Bezier4x3 curve, float2 point)
        {
            float best = float.MaxValue, bestT = 0;
            for (int i = 0; i <= 32; i++) { float t = i / 32f; float2 p = Colossal.Mathematics.MathUtils.Position(curve, t).xz; float d = math.distancesq(p, point); if (d < best) { best = d; bestT = t; } }
            float radius = 1f / 32f;
            for (int pass = 0; pass < 4; pass++) { float a = math.max(0, bestT - radius), b = math.min(1, bestT + radius); for (int i = 0; i <= 8; i++) { float t = math.lerp(a, b, i / 8f); float d = math.distancesq(Colossal.Mathematics.MathUtils.Position(curve, t).xz, point); if (d < best) { best = d; bestT = t; } } radius *= .25f; }
            return Tuple.Create(bestT, math.sqrt(best));
        }

        private static string CellSide(Bezier4x3 curve, float2 point, float t)
        {
            float a = math.max(0, t - .002f), b = math.min(1, t + .002f); float2 road = Colossal.Mathematics.MathUtils.Position(curve, t).xz;
            float2 tangent = math.normalizesafe(Colossal.Mathematics.MathUtils.Position(curve, b).xz - Colossal.Mathematics.MathUtils.Position(curve, a).xz, new float2(1, 0));
            float2 delta = point - road; return tangent.x * delta.y - tangent.y * delta.x >= 0 ? "left" : "right";
        }

        private List<ZoningCellChange> SelectZoningCells(JArray edgeIds, string side, int depth, bool overwrite, bool includeOccupied, ushort targetZone, World world, bool includeUnchanged, bool includeInvalid = false)
        {
            if (edgeIds == null || edgeIds.Count < 1 || edgeIds.Count > 64) throw new QueryException("INVALID_ARGUMENT", "edge_ids must contain 1..64 permanent road edge IDs.");
            var em = world.EntityManager; var result = new List<ZoningCellChange>(); var unique = new HashSet<Entity>(); var uniqueCells = new HashSet<string>();
            foreach (var token in edgeIds)
            {
                var edge = ParseEntity((string)token, em); if (!unique.Add(edge)) throw new QueryException("DUPLICATE_ROAD_EDGE", "edge_ids must not contain duplicates.");
                if (!PermanentRoad(em, edge)) throw new QueryException("INVALID_ROAD_EDGE", "Every edge_id must identify an existing permanent road edge.");
                if (!em.HasBuffer<SubBlock>(edge)) continue; var curve = em.GetComponentData<Curve>(edge).m_Bezier; var blocks = em.GetBuffer<SubBlock>(edge, true);
                for (int bi = 0; bi < blocks.Length; bi++)
                {
                    var blockEntity = blocks[bi].m_SubBlock; if (!em.Exists(blockEntity) || em.HasComponent<Deleted>(blockEntity) || !em.HasComponent<Block>(blockEntity) || !em.HasBuffer<Cell>(blockEntity)) continue;
                    var block = em.GetComponentData<Block>(blockEntity); var cells = em.GetBuffer<Cell>(blockEntity, true); var candidates = new List<Tuple<int, float, float3, string>>();
                    for (int i = 0; i < cells.Length; i++) { int x = i % block.m_Size.x, y = i / block.m_Size.x; var pos = ZoneUtils.GetCellPosition(block, new int2(x, y)); var closest = ClosestRoad(curve, pos.xz); var cellSide = CellSide(curve, pos.xz, closest.Item1); candidates.Add(Tuple.Create(i, closest.Item2, pos, cellSide)); }
                    foreach (var sideGroup in candidates.GroupBy(c => c.Item4))
                    {
                        float nearest = sideGroup.Min(c => c.Item2);
                        foreach (var candidate in sideGroup)
                        {
                            int cellDepth = 1 + (int)math.round(math.max(0, candidate.Item2 - nearest) / 8f); if (cellDepth > depth || (side != "both" && candidate.Item4 != side)) continue;
                            var key = blockEntity.Index + ":" + blockEntity.Version + ":" + candidate.Item1; if (!uniqueCells.Add(key)) continue;
                            var before = cells[candidate.Item1]; var invalid = (before.m_State & (CellFlags.Blocked | CellFlags.Shared | CellFlags.Redundant)) != 0;
                            if ((!includeInvalid && invalid) || (!includeOccupied && (before.m_State & CellFlags.Occupied) != 0)) continue;
                            if (!overwrite && targetZone != 0 && before.m_Zone.m_Index != 0) continue;
                            if (!includeUnchanged && before.m_Zone.m_Index == targetZone) continue;
                            var after = before; after.m_Zone = new ZoneType { m_Index = targetZone };
                            result.Add(new ZoningCellChange { Edge = edge, Block = blockEntity, CellIndex = candidate.Item1, GridX = candidate.Item1 % block.m_Size.x, GridY = candidate.Item1 / block.m_Size.x,
                                Depth = cellDepth, Side = candidate.Item4, Position = candidate.Item3, Before = before, After = after });
                        }
                    }
                }
            }
            return result;
        }

        private JObject AnalyzeZoningCells(JObject args, World world)
        {
            var side = ((string)args["road_side"] ?? "both").ToLowerInvariant(); int depth = ComponentInspector.Int(args, "depth_cells", 6, 1, 6);
            if (side != "left" && side != "right" && side != "both") throw new QueryException("INVALID_ARGUMENT", "road_side must be left, right, or both.");
            var changes = SelectZoningCells(args["edge_ids"] as JArray, side, depth, true, true, ushort.MaxValue, world, true, true); var names = ZoneNames(world);
            var items = new JArray(changes.Take(4096).Select(c => new JObject { ["edge_id"] = m_Session + ":" + c.Edge.Index + ":" + c.Edge.Version,
                ["block_id"] = m_Session + ":" + c.Block.Index + ":" + c.Block.Version, ["cell_index"] = c.CellIndex, ["grid_x"] = c.GridX, ["grid_y"] = c.GridY,
                ["depth"] = c.Depth, ["side"] = c.Side, ["position"] = new JObject { ["x"] = c.Position.x, ["y"] = c.Position.y, ["z"] = c.Position.z },
                ["zone_index"] = c.Before.m_Zone.m_Index, ["zone"] = names.TryGetValue(c.Before.m_Zone.m_Index, out var n) ? n : null, ["state"] = c.Before.m_State.ToString(),
                ["height_limit"] = c.Before.m_Height, ["occupied"] = (c.Before.m_State & CellFlags.Occupied) != 0 }));
            return new JObject { ["cell_count"] = changes.Count, ["modifiable_cell_count"] = changes.Count(c => (c.Before.m_State & (CellFlags.Blocked | CellFlags.Shared | CellFlags.Redundant)) == 0),
                ["blocked_cell_count"] = changes.Count(c => (c.Before.m_State & CellFlags.Blocked) != 0), ["shared_cell_count"] = changes.Count(c => (c.Before.m_State & CellFlags.Shared) != 0),
                ["occupied_cell_count"] = changes.Count(c => (c.Before.m_State & CellFlags.Occupied) != 0), ["redundant_cell_count"] = changes.Count(c => (c.Before.m_State & CellFlags.Redundant) != 0),
                ["items_truncated"] = changes.Count > 4096, ["items"] = items,
                ["counts_by_zone"] = new JObject(changes.GroupBy(c => names.TryGetValue(c.Before.m_Zone.m_Index, out var n) ? n : "index_" + c.Before.m_Zone.m_Index).Select(g => new JProperty(g.Key, g.Count()))) };
        }

        private ZoningOperation PreviewZoning(JObject args, World world)
        {
            var key = RequestKey(args); var fingerprint = args.ToString(Formatting.None);
            if (m_ZoningRequestIds.TryGetValue(key, out var existingId)) { var existing = m_ZoningOperations[existingId]; if (existing.Fingerprint != fingerprint) throw new QueryException("REQUEST_ID_CONFLICT", "request_id was already used with different zoning arguments."); return existing; }
            if (m_ZoningOperations.Count >= 4096) throw new QueryException("TOO_MANY_OPERATIONS", "This city session already contains 4096 zoning operations.");
            var side = ((string)args["road_side"] ?? "both").ToLowerInvariant(); if (side != "left" && side != "right" && side != "both") throw new QueryException("INVALID_ARGUMENT", "road_side must be left, right, or both.");
            int depth = ComponentInspector.Int(args, "depth_cells", 6, 1, 6); bool overwrite = args["overwrite"] != null && (bool)args["overwrite"];
            bool includeOccupied = args["include_occupied"] != null && (bool)args["include_occupied"]; var zoneName = (string)args["zone"] ?? ""; ResolveZone(zoneName, world, out var zoneData);
            ushort targetZone = string.Equals(zoneName, "none", StringComparison.OrdinalIgnoreCase) || string.Equals(zoneName, "clear", StringComparison.OrdinalIgnoreCase) ? (ushort)0 : zoneData.m_ZoneType.m_Index;
            var changes = SelectZoningCells(args["edge_ids"] as JArray, side, depth, overwrite, includeOccupied, targetZone, world, false);
            if (changes.Count == 0) throw new QueryException("NO_ZONING_CHANGES", "No eligible zoning cells would change. Inspect cells, enable road zoning, increase depth, allow overwrite, or select different roads.");
            if (changes.Count > 4096) throw new QueryException("TOO_MANY_CELLS", "One zoning operation may change at most 4096 cells.");
            var op = new ZoningOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, ZoneName = targetZone == 0 ? "none" : zoneName,
                ZoneIndex = targetZone, Side = side, DepthCells = depth, Overwrite = overwrite, IncludeOccupied = includeOccupied };
            op.Edges.AddRange(changes.Select(c => c.Edge).Distinct()); op.Changes.AddRange(changes); m_ZoningOperations.Add(op.Id, op); m_ZoningRequestIds.Add(key, op.Id); return op;
        }

        private ZoningOperation ZoningOperationById(JObject args)
        {
            var id = (string)args["operation_id"]; if (id == null || !m_ZoningOperations.TryGetValue(id, out var op)) throw new QueryException("UNKNOWN_OPERATION", "Unknown zoning operation for this city session.");
            if (op.State == "preview_ready" && DateTime.UtcNow > op.Expires) op.State = "expired"; return op;
        }

        private JObject ApplyZoning(JObject args, World world)
        {
            var op = ZoningOperationById(args); var key = RequestKey(args); if (op.RequestId != key) throw new QueryException("REQUEST_ID_CONFLICT", "Use the same request_id as preview_zoning.");
            if (op.State == "completed") return op.Json(); if (op.State != "preview_ready") throw new QueryException("INVALID_OPERATION_STATE", "Only a preview_ready zoning operation can be applied.");
            var sim = world.GetExistingSystemManaged<Game.Simulation.SimulationSystem>(); if (sim == null || sim.selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before applying zoning.");
            var em = world.EntityManager; SyncReads(world);
            foreach (var c in op.Changes) if (!em.Exists(c.Block) || !em.HasBuffer<Cell>(c.Block) || c.CellIndex >= em.GetBuffer<Cell>(c.Block, true).Length || !SameCell(em.GetBuffer<Cell>(c.Block, true)[c.CellIndex], c.Before))
                throw new QueryException("ZONING_CONFLICT", "At least one target cell changed after preview; nothing was applied. Create a new preview.");
            var applied = new List<ZoningCellChange>();
            try
            {
                foreach (var group in op.Changes.GroupBy(c => c.Block))
                {
                    var buffer = em.GetBuffer<Cell>(group.Key); foreach (var c in group) { buffer[c.CellIndex] = c.After; applied.Add(c); }
                    if (!em.HasComponent<Updated>(group.Key)) em.AddComponent<Updated>(group.Key);
                }
                op.State = "completed"; op.CommitRequestId = key;
            }
            catch (Exception ex)
            {
                foreach (var group in applied.GroupBy(c => c.Block)) if (em.Exists(group.Key) && em.HasBuffer<Cell>(group.Key)) { var buffer = em.GetBuffer<Cell>(group.Key); foreach (var c in group) if (c.CellIndex < buffer.Length) buffer[c.CellIndex] = c.Before; }
                op.State = "failed"; op.Error = ex.GetType().Name + ": " + ex.Message; throw new QueryException("ZONING_APPLY_FAILED", "Zoning write failed and modified cells were restored: " + ex.Message);
            }
            return op.Json();
        }

        private JObject CancelZoning(JObject args)
        {
            var op = ZoningOperationById(args); if (op.State == "completed") throw new QueryException("ALREADY_COMMITTED", "Completed zoning cannot be cancelled. Create an inverse zoning operation if needed.");
            if (!op.Terminal) op.State = "cancelled"; return op.Json();
        }
    }
}
