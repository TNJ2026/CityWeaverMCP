using System.Collections.Generic;
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
        private bool IsNetworkCopy => m_Operation.CurveMode == "network_copy";

        // Run against both Temp edges and permanent readback. A copy is only successful if
        // the native pipeline kept its directed curves, prefabs, upgrades and graph intact.
        private bool NetworkCopyMatches(List<Entity> candidates)
        {
            var op = m_Operation;
            if (op.CopyConnectionTargets.Count>0) return NetworkCopyConnectionsMatch(candidates);
            if (op.CopyNodeCourses) return NetworkCopyCoursesMatch(candidates);
            if (candidates.Count != op.Segments.Count) return false;
            var used = new HashSet<Entity>(); var copiedNodes = new HashSet<Entity>();
            var forward = new Dictionary<Entity, Entity>(); var reverse = new Dictionary<Entity, Entity>();
            foreach (var segment in op.Segments)
            {
                Entity match = Entity.Null;
                foreach (var candidate in candidates)
                {
                    if (used.Contains(candidate) || !EntityManager.Exists(candidate) || !EntityManager.HasComponent<Curve>(candidate) ||
                        !EntityManager.HasComponent<Edge>(candidate) || !EntityManager.HasComponent<PrefabRef>(candidate)) continue;
                    if (EntityManager.GetComponentData<PrefabRef>(candidate).m_Prefab != segment.Prefab) continue;
                    var actual = EntityManager.GetComponentData<Curve>(candidate).m_Bezier; var expected = segment.Curve;
                    if (!(math.distance(actual.a, expected.a) <= .1f && math.distance(actual.b, expected.b) <= .1f &&
                        math.distance(actual.c, expected.c) <= .1f && math.distance(actual.d, expected.d) <= .1f)) continue;
                    var flags = EntityManager.HasComponent<Upgraded>(candidate) ? EntityManager.GetComponentData<Upgraded>(candidate).m_Flags : default(CompositionFlags);
                    if (!flags.Equals(segment.UpgradeFlags)) continue;
                    match = candidate; break;
                }
                if (match == Entity.Null) return false;
                used.Add(match);
                var edge = EntityManager.GetComponentData<Edge>(match);
                if (!RoadCopyGeometry.BindNode(forward, reverse, segment.CopySourceStart, edge.m_Start) ||
                    !RoadCopyGeometry.BindNode(forward, reverse, segment.CopySourceEnd, edge.m_End)) return false;
                copiedNodes.Add(edge.m_Start); copiedNodes.Add(edge.m_End);
            }
            // Copying onto an existing junction silently changes the destination graph.
            foreach (var node in copiedNodes)
            {
                if (!EntityManager.Exists(node) || !EntityManager.HasBuffer<ConnectedEdge>(node)) return false;
                if (EntityManager.HasComponent<Temp>(node) && EntityManager.GetComponentData<Temp>(node).m_Original != Entity.Null) return false;
                foreach (var connected in EntityManager.GetBuffer<ConnectedEdge>(node, true))
                    if (!used.Contains(connected.m_Edge) && EntityManager.Exists(connected.m_Edge) &&
                        !EntityManager.HasComponent<Deleted>(connected.m_Edge)) return false;
            }
            return copiedNodes.Count == op.CopySourceNodeCount;
        }
    }
}
