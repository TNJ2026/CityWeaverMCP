using System;
using System.Collections.Generic;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class McpRoadToolSystem
    {
        // Let CourseSplitSystem create the native crossing. A geometric intersection alone
        // must never be reported as a shared node, or used to suppress a bridge pillar.
        private JArray ReadWaterwayCrossings(List<Entity> roads, bool permanent)
        {
            var result = new JArray();
            if (m_Operation.TransactionKind != null || m_Operation.OperationType != "create") return result;
            var nodes = new HashSet<Entity>();
            foreach (var road in roads)
            {
                if (!CrossingEntityActive(road, permanent) || !EntityManager.HasComponent<Road>(road) || !EntityManager.HasComponent<Edge>(road)) continue;
                var edge = EntityManager.GetComponentData<Edge>(road);
                nodes.Add(edge.m_Start); nodes.Add(edge.m_End);
            }
            var sorted = new List<Entity>(nodes);
            sorted.Sort((a, b) => a.Index.CompareTo(b.Index));
            foreach (var node in sorted)
            {
                if (!CrossingEntityActive(node, permanent) || !EntityManager.HasComponent<Node>(node) || !EntityManager.HasBuffer<ConnectedEdge>(node)) continue;
                var roadIds = new SortedSet<string>(StringComparer.Ordinal);
                var waterwayIds = new SortedSet<string>(StringComparer.Ordinal);
                foreach (var edge in CrossingConnectedEdges(node, permanent))
                {
                    if (!EntityManager.HasComponent<PrefabRef>(edge)) continue;
                    var prefab = EntityManager.GetComponentData<PrefabRef>(edge).m_Prefab;
                    if (EntityManager.HasComponent<Game.Net.Waterway>(edge) && EntityManager.HasComponent<WaterwayData>(prefab)) waterwayIds.Add(m_Operation.EntityId(edge));
                    else if (EntityManager.HasComponent<Road>(edge)) roadIds.Add(m_Operation.EntityId(edge));
                }
                if (roadIds.Count < 2 || waterwayIds.Count < 1) continue;
                result.Add(new JObject {
                    ["node_id"] = m_Operation.EntityId(node),
                    ["position"] = RoadOperation.Point(EntityManager.GetComponentData<Node>(node).m_Position),
                    ["road_edge_ids"] = new JArray(roadIds), ["waterway_edge_ids"] = new JArray(waterwayIds),
                    ["permanent"] = permanent
                });
            }
            return result;
        }

        private IEnumerable<Entity> CrossingConnectedEdges(Entity node, bool permanent)
        {
            // Like native EdgeIterator, include surviving connections of a temporary
            // node's original, while excluding hidden replacement edges in the preview.
            var seenNodes = new HashSet<Entity>();
            var seenEdges = new HashSet<Entity>();
            bool previewNode = EntityManager.HasComponent<Temp>(node);
            while (node != Entity.Null && EntityManager.Exists(node) && seenNodes.Add(node) && EntityManager.HasBuffer<ConnectedEdge>(node))
            {
                foreach (var connected in EntityManager.GetBuffer<ConnectedEdge>(node, true))
                {
                    var edge = connected.m_Edge;
                    if (!CrossingEntityActive(edge, permanent) || !EntityManager.HasComponent<Edge>(edge) ||
                        (!permanent && previewNode && EntityManager.HasComponent<Hidden>(edge))) continue;
                    var ends = EntityManager.GetComponentData<Edge>(edge);
                    if ((ends.m_Start == node || ends.m_End == node) && seenEdges.Add(edge)) yield return edge;
                }
                if (permanent || !EntityManager.HasComponent<Temp>(node)) break;
                node = EntityManager.GetComponentData<Temp>(node).m_Original;
            }
        }

        private bool CrossingEntityActive(Entity entity, bool permanent)
        {
            if (entity == Entity.Null || !EntityManager.Exists(entity) || EntityManager.HasComponent<Deleted>(entity)) return false;
            if (!EntityManager.HasComponent<Temp>(entity)) return true;
            return !permanent && (EntityManager.GetComponentData<Temp>(entity).m_Flags & (TempFlags.Delete | TempFlags.Cancel)) == 0;
        }

        private bool VerifyWaterwayCrossings(List<Entity> roads)
        {
            var op = m_Operation;
            if (op.WaterwayCrossings.Count == 0) return true;
            var actual = ReadWaterwayCrossings(roads, true);
            // Native apply may remap entity IDs. Match positions one-to-one and verify the
            // full live adjacency, rather than accepting a road-only completed transaction.
            if (!WaterwayCrossingRules.Matches(op.WaterwayCrossings, actual)) return false;
            op.WaterwayCrossings = actual;
            op.WaterwayCrossingsVerified = true;
            return true;
        }

        private void ReadWaterwayCrossingDiagnostics()
        {
            var op = m_Operation;
            op.WaterwayCrossingDiagnostics.Clear();
            if (op.TransactionKind != null || !EntityManager.HasComponent<BridgeData>(op.Prefab) ||
                !EntityManager.HasComponent<NetGeometryData>(op.Prefab)) return;
            var bridge = EntityManager.GetComponentData<NetGeometryData>(op.Prefab);
            // Only explain waterways that the native validator actually flagged. This is
            // diagnostic evidence, not a new clearance limit or permission to ignore errors.
            foreach (JObject detail in op.ValidationEntities)
            {
                string id = (string)detail["entity_id"];
                var parts = id?.Split(':');
                if (parts == null || parts.Length != 3 || parts[0] != op.Session ||
                    !int.TryParse(parts[1], out var index) || !int.TryParse(parts[2], out var version)) continue;
                var waterway = new Entity { Index = index, Version = version };
                if (!EntityManager.Exists(waterway) || !EntityManager.HasComponent<Game.Net.Waterway>(waterway) ||
                    !EntityManager.HasComponent<Curve>(waterway) || !EntityManager.HasComponent<PrefabRef>(waterway)) continue;
                var prefab = EntityManager.GetComponentData<PrefabRef>(waterway).m_Prefab;
                if (!EntityManager.HasComponent<NetGeometryData>(prefab)) continue;
                var water = EntityManager.GetComponentData<NetGeometryData>(prefab);
                var curve = EntityManager.GetComponentData<Curve>(waterway).m_Bezier;
                float distance = float.MaxValue, deckY = 0, waterY = 0;
                foreach (var segment in op.Segments)
                for (int i = 0; i <= 64; i++)
                {
                    var point = MathUtils.Position(segment.Curve, i / 64f);
                    float d = MathUtils.Distance(curve.xz, point.xz, out float t);
                    if (d >= distance) continue;
                    distance = d; deckY = point.y; waterY = MathUtils.Position(curve, t).y;
                }
                if (distance > water.m_DefaultWidth * 0.5f + bridge.m_ElevatedWidth * 0.5f) continue;
                op.WaterwayCrossingDiagnostics.Add(new JObject {
                    ["waterway_edge_id"] = id, ["sampled_deck_height_m"] = deckY,
                    ["sampled_waterway_height_m"] = waterY,
                    ["waterway_height_range_max_m"] = water.m_DefaultHeightRange.max,
                    ["bridge_geometry_min_m"] = bridge.m_ElevatedHeightRange.min,
                    ["bridge_above_waterway_envelope"] = WaterwayCrossingRules.AboveEnvelope(deckY, waterY, bridge.m_ElevatedHeightRange.min, water.m_DefaultHeightRange.max),
                    ["note"] = "Native waterway collision. A high deck can pass above the waterway connection envelope while pillars still collide. Check crossing height and native preview; changing span length alone does not guarantee clearance. No automatic height adjustment was applied."
                });
            }
        }
    }

    internal static class WaterwayCrossingRules
    {
        internal static bool AboveEnvelope(float deck, float water, float bridgeMin, float waterMax) =>
            math.isfinite(deck) && math.isfinite(water) && math.isfinite(bridgeMin) && math.isfinite(waterMax) && deck + bridgeMin > water + waterMax;

        internal static bool Matches(JArray expected, JArray actual)
        {
            if (expected.Count != actual.Count) return false;
            var used = new HashSet<int>();
            foreach (JObject crossing in expected)
            {
                bool found = false;
                for (int i = 0; i < actual.Count; i++)
                {
                    if (used.Contains(i)) continue;
                    var candidate = (JObject)actual[i];
                    if ((bool?)candidate["permanent"] != true ||
                        !(candidate["road_edge_ids"] is JArray roads) || roads.Count < 2 ||
                        !(candidate["waterway_edge_ids"] is JArray waterways) || waterways.Count < 1) continue;
                    var a = crossing["position"]; var b = candidate["position"];
                    if (a == null || b == null) continue;
                    var delta = new float3((float)a["x"] - (float)b["x"], (float)a["y"] - (float)b["y"], (float)a["z"] - (float)b["z"]);
                    if (!math.all(math.isfinite(delta)) || math.lengthsq(delta) > 1) continue;
                    used.Add(i); found = true; break;
                }
                if (!found) return false;
            }
            return true;
        }
    }
}
