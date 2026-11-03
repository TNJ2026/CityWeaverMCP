using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class McpRoadToolSystem
    {
        // A native road may become several edges. Verify one directed path per
        // source edge; added nodes may only subdivide that path, never branch.
        private bool NetworkCopyCoursesMatch(List<Entity> candidates)
        {
            var op = m_Operation;
            bool Reject(string reason) { op.CopyValidationFailure = reason; return false; }
            if (candidates.Count == 0 || candidates.Count < op.Segments.Count) return Reject("missing_copy_edges");
            var rawNodes = new Dictionary<Entity, Entity>();
            var outgoing = new Dictionary<Entity, List<Entity>>();
            var degree = new Dictionary<Entity, int>();
            foreach (var edge in candidates)
            {
                if (!EntityManager.Exists(edge) || EntityManager.HasComponent<Deleted>(edge) ||
                    !EntityManager.HasComponent<Edge>(edge) || !EntityManager.HasComponent<Curve>(edge) || !EntityManager.HasComponent<PrefabRef>(edge)) return Reject("invalid_copy_edge");
                var ends = EntityManager.GetComponentData<Edge>(edge);
                foreach (var node in new[] { ends.m_Start, ends.m_End })
                {
                    if (!EntityManager.HasComponent<Node>(node)) return Reject("missing_copy_node");
                    var key = CopyCanonical(node);
                    rawNodes[key] = node;
                    degree[key] = degree.TryGetValue(key, out int value) ? value + 1 : 1;
                }
                var start = CopyCanonical(ends.m_Start);
                if (!outgoing.TryGetValue(start, out var list)) outgoing[start] = list = new List<Entity>();
                list.Add(edge);
            }
            var expected = new Dictionary<Entity, float3>();
            foreach (var segment in op.Segments)
            {
                if (expected.TryGetValue(segment.CopySourceStart, out var a) && math.distance(a, segment.Start) > .1f ||
                    expected.TryGetValue(segment.CopySourceEnd, out var b) && math.distance(b, segment.End) > .1f) return Reject("inconsistent_source_node_position");
                expected[segment.CopySourceStart] = segment.Start; expected[segment.CopySourceEnd] = segment.End;
            }
            if (expected.Count != op.CopySourceNodeCount) return Reject("source_node_count");
            var forward = new Dictionary<Entity, Entity>(); var reverse = new Dictionary<Entity, Entity>();
            foreach (var source in expected)
            {
                Entity match = Entity.Null;
                foreach (var node in rawNodes)
                {
                    if (math.distance(EntityManager.GetComponentData<Node>(node.Value).m_Position, source.Value) > .35f) continue;
                    if (match != Entity.Null) return Reject("ambiguous_source_node");
                    match = node.Key;
                }
                if (match == Entity.Null || !RoadCopyGeometry.BindNode(forward, reverse, source.Key, match)) return Reject("source_node_mapping");
            }
            var used = new HashSet<Entity>();
            foreach (var segment in op.Segments)
            {
                var current = forward[segment.CopySourceStart]; var end = forward[segment.CopySourceEnd];
                int pieces = 0; float previousPosition = 0;
                do
                {
                    if (!outgoing.TryGetValue(current, out var edges)) return Reject("missing_path");
                    Entity chosen = Entity.Null;
                    foreach (var edge in edges)
                    {
                        if (used.Contains(edge) || EntityManager.GetComponentData<PrefabRef>(edge).m_Prefab != segment.Prefab || !CopyFlagsMatch(edge, segment.UpgradeFlags)) continue;
                        if (!RoadCopyCurveRules.OnCurve(segment.Curve, EntityManager.GetComponentData<Curve>(edge).m_Bezier, .5f)) continue;
                        if (chosen != Entity.Null) return Reject("ambiguous_copy_path");
                        chosen = edge;
                    }
                    if (chosen == Entity.Null) return Reject("path_geometry_or_prefab");
                    var actual = EntityManager.GetComponentData<Edge>(chosen);
                    var curve = EntityManager.GetComponentData<Curve>(chosen).m_Bezier;
                    var next = CopyCanonical(actual.m_End);
                    var position = EntityManager.GetComponentData<Node>(actual.m_End).m_Position;
                    if (MathUtils.Distance(segment.Curve.xz, position.xz, out float t) > .35f ||
                        math.abs(position.y - MathUtils.Position(segment.Curve, t).y) > .5f || t <= previousPosition + .00001f) return Reject("nonmonotonic_copy_path");
                    if (pieces == 0 && math.distance(curve.a, segment.Start) > segment.CopyStartTrimLimit + .35f ||
                        pieces > 0 && math.distance(curve.a, EntityManager.GetComponentData<Node>(actual.m_Start).m_Position) > .5f ||
                        next == end && math.distance(curve.d, segment.End) > segment.CopyEndTrimLimit + .35f ||
                        next != end && math.distance(curve.d, position) > .5f) return Reject("copy_path_trim");
                    used.Add(chosen); pieces++; previousPosition = t; current = next;
                    if (current != end && (reverse.ContainsKey(current) || degree[current] != 2 || CopyCanonical(actual.m_End) != actual.m_End)) return Reject("subdivision_is_a_junction");
                    if (pieces > candidates.Count) return Reject("copy_path_cycle");
                } while (current != end);
            }
            if (used.Count != candidates.Count) return Reject("extra_copy_edges");
            if (op.CopyConnectionTargets.Count > 0 && !CopyTargetPathsMatch(forward, candidates.Any(e => EntityManager.HasComponent<Temp>(e)))) return false;
            var remnants = new HashSet<Entity>(m_SplitRemnants.Where(e => EntityManager.Exists(e) && !EntityManager.HasComponent<Deleted>(e)).Select(CopyCanonical));
            foreach (var pair in rawNodes)
            {
                bool attached = reverse.TryGetValue(pair.Key, out var source) && op.CopyBindings.TryGetValue(source, out _);
                var node = pair.Value;
                if (!attached && CopyCanonical(node) != node) return Reject("unrequested_node_attachment");
                if (!EntityManager.HasBuffer<ConnectedEdge>(node)) return Reject("missing_node_adjacency");
                foreach (var connected in EntityManager.GetBuffer<ConnectedEdge>(node, true))
                {
                    var edge = connected.m_Edge;
                    if (!EntityManager.Exists(edge) || EntityManager.HasComponent<Deleted>(edge) || used.Contains(edge)) continue;
                    var original = CopyCanonical(edge);
                    if (!attached || (!remnants.Contains(original) && !op.CopyBindings[source].ExternalEdges.Contains(original) &&
                        !op.CopyConnectionTargets.Any(target => target.Edge == original))) return Reject("unrequested_edge_attachment");
                }
            }
            op.CopyValidationFailure = null;
            return true;
        }
    }
}
