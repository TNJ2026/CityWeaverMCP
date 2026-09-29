using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Tools;
using Game.Zones;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    // Cell selection of the in-game zoning tool modes (fill, marquee, paint), ported from
    // Game.Tools.ZoneToolSystem and GenerateZonesSystem. The selected cells go through the same atomic
    // preview_zoning / apply_zoning transaction as road-side zoning.
    public sealed partial class GameQueryService
    {
        private sealed class ZoneBlockIndex
        {
            private const float BucketSize = 128f;
            private readonly Dictionary<long, List<Entity>> m_Buckets = new Dictionary<long, List<Entity>>();
            public readonly Dictionary<Entity, Block> Blocks = new Dictionary<Entity, Block>();
            public readonly Dictionary<Entity, Quad2> Corners = new Dictionary<Entity, Quad2>();
            private static long Key(int x, int z) => ((long)x << 32) ^ (uint)z;

            public ZoneBlockIndex(EntityManager em)
            {
                using (var query = em.CreateEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Block>(), ComponentType.ReadOnly<Cell>() },
                    None = new[] { ComponentType.ReadOnly<Temp>(), ComponentType.ReadOnly<Deleted>() } }))
                using (var entities = query.ToEntityArray(Allocator.Temp))
                {
                    foreach (var entity in entities)
                    {
                        var block = em.GetComponentData<Block>(entity); var corners = ZoneUtils.CalculateCorners(block); var bounds = MathUtils.Bounds(corners);
                        Blocks[entity] = block; Corners[entity] = corners;
                        int x0 = (int)math.floor(bounds.min.x / BucketSize), x1 = (int)math.floor(bounds.max.x / BucketSize);
                        int z0 = (int)math.floor(bounds.min.y / BucketSize), z1 = (int)math.floor(bounds.max.y / BucketSize);
                        for (int x = x0; x <= x1; x++) for (int z = z0; z <= z1; z++)
                        {
                            if (!m_Buckets.TryGetValue(Key(x, z), out var list)) m_Buckets[Key(x, z)] = list = new List<Entity>();
                            list.Add(entity);
                        }
                    }
                }
            }

            public IEnumerable<Entity> Near(Bounds2 bounds)
            {
                var seen = new HashSet<Entity>();
                int x0 = (int)math.floor(bounds.min.x / BucketSize), x1 = (int)math.floor(bounds.max.x / BucketSize);
                int z0 = (int)math.floor(bounds.min.y / BucketSize), z1 = (int)math.floor(bounds.max.y / BucketSize);
                for (int x = x0; x <= x1; x++) for (int z = z0; z <= z1; z++)
                    if (m_Buckets.TryGetValue(Key(x, z), out var list)) foreach (var e in list) if (seen.Add(e)) yield return e;
            }
        }

        private static float2 ZoningToolPoint(JToken token, string name)
        {
            if (!(token is JObject point)) throw new QueryException("INVALID_ARGUMENT", name + " must contain x and z.");
            float Read(string axis)
            {
                var v = point[axis]; if (v == null || (v.Type != JTokenType.Float && v.Type != JTokenType.Integer)) throw new QueryException("INVALID_ARGUMENT", name + "." + axis + " must be a number.");
                var f = (float)v; if (!math.isfinite(f) || f < -7168 || f > 7168) throw new QueryException("INVALID_ARGUMENT", name + "." + axis + " must be within -7168..7168.");
                return f;
            }
            return new float2(Read("x"), Read("z"));
        }

        private ZoningOperation PreviewZoningTool(JObject args, World world)
        {
            var key = RequestKey(args); var fingerprint = args.ToString(Formatting.None);
            if (m_ZoningRequestIds.TryGetValue(key, out var existingId)) { var existing = m_ZoningOperations[existingId]; if (existing.Fingerprint != fingerprint) throw new QueryException("REQUEST_ID_CONFLICT", "request_id was already used with different zoning arguments."); return existing; }
            if (m_ZoningOperations.Count >= 4096) throw new QueryException("TOO_MANY_OPERATIONS", "This city session already contains 4096 zoning operations.");
            var mode = ((string)args["mode"] ?? "").ToLowerInvariant();
            if (mode != "fill" && mode != "marquee" && mode != "paint") throw new QueryException("INVALID_ARGUMENT", "mode must be fill, marquee or paint.");
            var zoneName = (string)args["zone"] ?? ""; ResolveZone(zoneName, world, out var zoneData);
            bool dezone = string.Equals(zoneName, "none", StringComparison.OrdinalIgnoreCase) || string.Equals(zoneName, "clear", StringComparison.OrdinalIgnoreCase);
            var newZone = dezone ? ZoneType.None : zoneData.m_ZoneType;
            // Native dezoning always carries the Overwrite flag.
            bool overwrite = dezone || (args["overwrite"] != null && (bool)args["overwrite"]);
            bool includeOccupied = args["include_occupied"] != null && (bool)args["include_occupied"];
            var em = world.EntityManager; SyncReads(world); var index = new ZoneBlockIndex(em);
            // block -> cell index -> zone the native tool would write
            var selected = new Dictionary<Entity, Dictionary<int, ZoneType>>();
            void Select(Entity block, int cellIndex, ZoneType zone)
            {
                if (!selected.TryGetValue(block, out var cells)) selected[block] = cells = new Dictionary<int, ZoneType>();
                cells[cellIndex] = zone;
            }
            // BaseLineIterator: every visible cell whose quad the segment touches.
            List<(Entity block, int2 location)> CellsOnLine(Line2.Segment line)
            {
                var result = new List<(Entity, int2)>();
                var bounds = new Bounds2(math.min(line.a, line.b), math.max(line.a, line.b));
                foreach (var entity in index.Near(bounds))
                {
                    var block = index.Blocks[entity]; var quad = index.Corners[entity];
                    if (!MathUtils.Intersect(MathUtils.Bounds(quad), bounds)) continue;
                    var cellsBuffer = em.GetBuffer<Cell>(entity, true);
                    int2 i0 = ZoneUtils.GetCellIndex(block, line.a), i1 = ZoneUtils.GetCellIndex(block, line.b);
                    int2 lo = math.max(math.min(i0, i1), 0), hi = math.min(math.max(i0, i1), block.m_Size - 1);
                    if (!math.all(hi >= lo)) continue;
                    var step = new float2(1f) / block.m_Size;
                    for (int y = lo.y; y <= hi.y; y++) for (int x = lo.x; x <= hi.x; x++)
                    {
                        var row0a = math.lerp(quad.a, quad.d, y * step.y); var row0b = math.lerp(quad.b, quad.c, y * step.y);
                        var row1a = math.lerp(quad.a, quad.d, (y + 1) * step.y); var row1b = math.lerp(quad.b, quad.c, (y + 1) * step.y);
                        var cell = new Quad2 { a = math.lerp(row0a, row0b, x * step.x), b = math.lerp(row0a, row0b, (x + 1) * step.x),
                            c = math.lerp(row1a, row1b, (x + 1) * step.x), d = math.lerp(row1a, row1b, x * step.x) };
                        if ((cellsBuffer[y * block.m_Size.x + x].m_State & CellFlags.Visible) != 0 && MathUtils.Intersect(cell, line, out _)) result.Add((entity, new int2(x, y)));
                    }
                }
                return result;
            }

            JObject geometry;
            if (mode == "marquee")
            {
                var start = ZoningToolPoint(args["start"], "start"); var end = ZoningToolPoint(args["end"], "end");
                float2 forward;
                var align = args["align"];
                if (align != null && (align.Type == JTokenType.Float || align.Type == JTokenType.Integer))
                {
                    var angle = math.radians((float)align); forward = new float2(math.cos(angle), math.sin(angle));
                }
                else
                {
                    var alignMode = ((string)align ?? "auto").ToLowerInvariant();
                    if (alignMode != "auto" && alignMode != "world") throw new QueryException("INVALID_ARGUMENT", "align must be auto, world or an angle in degrees.");
                    forward = new float2(1, 0);
                    // Like the native tool: take the direction of the zone block under the start point.
                    if (alignMode == "auto")
                        foreach (var entity in index.Near(new Bounds2(start, start)))
                            if (MathUtils.Intersect(index.Corners[entity], start)) { forward = index.Blocks[entity].m_Direction; break; }
                }
                var right = MathUtils.Right(forward); var delta = end - start;
                float along = math.dot(delta, forward), across = math.dot(delta, right);
                if (along < 0) { forward = -forward; along = -along; }
                if (across < 0) { right = -right; across = -across; }
                var quad = new Quad2 { a = start - (forward + right) * 4f, b = start - forward * 4f + right * (across + 4f),
                    c = start + forward * (along + 4f) + right * (across + 4f), d = start + forward * (along + 4f) - right * 4f };
                var bounds = MathUtils.Bounds(quad);
                foreach (var entity in index.Near(bounds))
                {
                    var block = index.Blocks[entity]; if (!MathUtils.Intersect(quad, index.Corners[entity])) continue;
                    var cells = em.GetBuffer<Cell>(entity, true);
                    for (int y = 0; y < block.m_Size.y; y++) for (int x = 0; x < block.m_Size.x; x++)
                    {
                        var cell = cells[y * block.m_Size.x + x]; if ((cell.m_State & CellFlags.Visible) == 0) continue;
                        if (MathUtils.Intersect(quad, ZoneUtils.GetCellPosition(block, new int2(x, y)).xz) && (overwrite || cell.m_Zone.Equals(ZoneType.None))) Select(entity, y * block.m_Size.x + x, newZone);
                    }
                }
                geometry = new JObject { ["quad"] = new JArray(new[] { quad.a, quad.b, quad.c, quad.d }.Select(p => new JObject { ["x"] = p.x, ["z"] = p.y })),
                    ["direction_degrees"] = math.degrees(math.atan2(forward.y, forward.x)) };
            }
            else if (mode == "paint")
            {
                if (!(args["path"] is JArray path) || path.Count < 1 || path.Count > 256) throw new QueryException("INVALID_ARGUMENT", "path must contain 1..256 points.");
                var points = path.Select((p, i) => ZoningToolPoint(p, "path[" + i + "]")).ToList();
                if (points.Count == 1) points.Add(points[0]);
                for (int i = 0; i + 1 < points.Count; i++)
                    foreach (var (entity, location) in CellsOnLine(new Line2.Segment(points[i], points[i + 1])))
                    {
                        var block = index.Blocks[entity]; var cellIndex = location.y * block.m_Size.x + location.x; var cell = em.GetBuffer<Cell>(entity, true)[cellIndex];
                        Select(entity, cellIndex, !overwrite && !cell.m_Zone.Equals(ZoneType.None) ? cell.m_Zone : newZone);
                    }
                geometry = new JObject { ["path_points"] = path.Count };
            }
            else
            {
                var seed = ZoningToolPoint(args["point"], "point");
                foreach (var (baseEntity, baseLocation) in CellsOnLine(new Line2.Segment(seed, seed)))
                {
                    var baseBlock = index.Blocks[baseEntity]; var baseCell = em.GetBuffer<Cell>(baseEntity, true)[baseLocation.y * baseBlock.m_Size.x + baseLocation.x];
                    var stateMask = baseCell.m_State & (CellFlags.Visible | CellFlags.Occupied); var oldZone = baseCell.m_Zone;
                    var visited = new HashSet<int2> { baseLocation }; var queue = new List<int2> { baseLocation }; int total = 0;
                    for (int q = 0; q < queue.Count; q++)
                    {
                        var location = queue[q]; var position = ZoneUtils.GetCellPosition(baseBlock, location).xz; int found = 0;
                        foreach (var entity in index.Near(new Bounds2(position, position)))
                        {
                            if (!MathUtils.Intersect(index.Corners[entity], position)) continue;
                            var block = index.Blocks[entity]; var cellLocation = ZoneUtils.GetCellIndex(block, position);
                            if (!math.all((cellLocation >= 0) & (cellLocation < block.m_Size))) continue;
                            var cellIndex = cellLocation.y * block.m_Size.x + cellLocation.x; var cell = em.GetBuffer<Cell>(entity, true)[cellIndex];
                            if ((cell.m_State & (CellFlags.Visible | CellFlags.Occupied)) != stateMask || !cell.m_Zone.Equals(oldZone) || !ZoneUtils.CanShareCells(baseBlock, block)) continue;
                            Select(entity, cellIndex, !overwrite && !cell.m_Zone.Equals(ZoneType.None) ? cell.m_Zone : newZone); found++;
                        }
                        if (found == 0) continue;
                        if (++total > MaxZoningCells) throw new QueryException("TOO_MANY_CELLS", "The fill region exceeds " + MaxZoningCells + " cells; use marquee or split the area.");
                        foreach (var next in new[] { location + new int2(-1, 0), location + new int2(0, -1), location + new int2(1, 0), location + new int2(0, 1) })
                            if (visited.Add(next)) queue.Add(next);
                    }
                }
                geometry = new JObject { ["seed"] = new JObject { ["x"] = seed.x, ["z"] = seed.y } };
            }

            var changes = new List<ZoningCellChange>();
            foreach (var pair in selected)
            {
                var block = index.Blocks[pair.Key]; var cells = em.GetBuffer<Cell>(pair.Key, true);
                var owner = em.HasComponent<Owner>(pair.Key) ? em.GetComponentData<Owner>(pair.Key).m_Owner : Entity.Null;
                foreach (var cellPair in pair.Value)
                {
                    var before = cells[cellPair.Key]; if (before.m_Zone.Equals(cellPair.Value)) continue;
                    if (!includeOccupied && (before.m_State & CellFlags.Occupied) != 0) continue;
                    var after = before; after.m_Zone = cellPair.Value; var location = new int2(cellPair.Key % block.m_Size.x, cellPair.Key / block.m_Size.x);
                    changes.Add(new ZoningCellChange { Edge = owner, Block = pair.Key, CellIndex = cellPair.Key, GridX = location.x, GridY = location.y, Depth = location.y + 1,
                        Side = mode, Position = ZoneUtils.GetCellPosition(block, location), Before = before, After = after });
                }
            }
            if (changes.Count == 0) throw new QueryException("NO_ZONING_CHANGES", "No zoning cell would change. Check the coordinates, allow overwrite, or choose another zone.");
            if (changes.Count > MaxZoningCells) throw new QueryException("TOO_MANY_CELLS", "One zoning operation may change at most " + MaxZoningCells + " cells.");
            var op = new ZoningOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, ZoneName = dezone ? "none" : zoneName,
                ZoneIndex = newZone.m_Index, Side = mode, DepthCells = 0, Overwrite = overwrite, IncludeOccupied = includeOccupied,
                ToolMode = mode, ToolGeometry = geometry, SampleLimit = ComponentInspector.Int(args, "sample_cells", 8, 0, 32) };
            op.Edges.AddRange(changes.Select(c => c.Edge).Where(e => e != Entity.Null).Distinct()); op.Changes.AddRange(changes);
            m_ZoningOperations.Add(op.Id, op); m_ZoningRequestIds.Add(key, op.Id); return op;
        }
    }
}
