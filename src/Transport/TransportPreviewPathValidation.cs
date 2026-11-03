using Game.Common;
using Game.Pathfind;
using Game.Routes;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class McpTransportLineToolSystem
    {
        private bool PreviewPathReady(Entity route)
        {
            if (!EntityManager.HasBuffer<RouteSegment>(route)) return false;
            var segments = EntityManager.GetBuffer<RouteSegment>(route, true);
            var points = EntityManager.GetBuffer<RouteWaypoint>(route, true);
            if (points.Length < 2 || segments.Length != points.Length) return false;
            for (int i = 0; i < segments.Length; i++)
            {
                var segment = segments[i].m_Segment;
                var start = points[i].m_Waypoint;
                var end = points[(i + 1) % points.Length].m_Waypoint;
                if (!EntityManager.Exists(segment) || EntityManager.HasComponent<Deleted>(segment) ||
                    !EntityManager.HasComponent<PathInformation>(segment) || !EntityManager.HasComponent<PathTargets>(segment) ||
                    !EntityManager.HasBuffer<PathElement>(segment) ||
                    !EntityManager.HasComponent<RouteLane>(start) || !EntityManager.HasComponent<RouteLane>(end) ||
                    !EntityManager.HasComponent<Position>(start) || !EntityManager.HasComponent<Position>(end)) return false;
                var info = EntityManager.GetComponentData<PathInformation>(segment);
                var targets = EntityManager.GetComponentData<PathTargets>(segment);
                var a = EntityManager.GetComponentData<RouteLane>(start);
                var b = EntityManager.GetComponentData<RouteLane>(end);
                bool bindings = targets.m_StartLane != Entity.Null && targets.m_EndLane != Entity.Null &&
                    EntityManager.Exists(targets.m_StartLane) && EntityManager.Exists(targets.m_EndLane) &&
                    !EntityManager.HasComponent<Deleted>(targets.m_StartLane) && !EntityManager.HasComponent<Deleted>(targets.m_EndLane) &&
                    targets.m_StartLane == a.m_EndLane && targets.m_EndLane == b.m_StartLane &&
                    math.abs(targets.m_CurvePositions.x - a.m_EndCurvePos) < .001f &&
                    math.abs(targets.m_CurvePositions.y - b.m_StartCurvePos) < .001f;
                bool endpoints = math.distancesq(targets.m_ReadyStartPosition,
                        EntityManager.GetComponentData<Position>(start).m_Position) < 1f &&
                    math.distancesq(targets.m_ReadyEndPosition,
                        EntityManager.GetComponentData<Position>(end).m_Position) < 1f;
                if (!TransportPreviewPathRules.Ready(EntityManager.GetBuffer<PathElement>(segment, true).Length,
                    info.m_Distance, (int)info.m_State, bindings, endpoints)) return false;
            }
            return true;
        }
    }
}
