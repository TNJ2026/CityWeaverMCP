using System;
using System.Collections.Generic;
using System.Linq;
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
    public sealed class RoadCopyTarget
    {
        public Entity Edge, Prefab, StartNode, EndNode;
        public Bezier4x3 Curve, OriginalCurve;
        public float3 Start, End;
        public CompositionFlags Flags;
    }
    public sealed class RoadCopyBinding
    {
        public Entity Target, Edge;
        public float Split, Adjustment;
        public float3 Position;
        public HashSet<Entity> ExternalEdges = new HashSet<Entity>();
    }

    public sealed partial class GameQueryService
    {
        private void PlanRoadCopyConnections(RoadOperation op, JObject args, World world, Func<float3,float3> transform)
        {
            var ids = args["connection_edge_ids"] as JArray;
            if (ids == null || ids.Count < 1 || ids.Count > 16 || ids.Any(t => t.Type != JTokenType.String))
                throw new QueryException("INVALID_ARGUMENT", "connection_edge_ids must contain 1..16 unique permanent target roads.");
            var em = world.EntityManager;
            foreach (var id in ids)
            {
                var entity = ParseEntity((string)id, em);
                if (op.Segments.Any(s => s.SourceEdge == entity) || op.CopyConnectionTargets.Any(t => t.Edge == entity))
                    throw new QueryException("INVALID_ARGUMENT", "Connection roads must be unique and must not belong to the source selection.");
                if (!em.HasComponent<Road>(entity) || !em.HasComponent<Edge>(entity) || !em.HasComponent<Curve>(entity) ||
                    !em.HasComponent<PrefabRef>(entity) || em.HasComponent<Owner>(entity))
                    throw new QueryException("INVALID_ROAD_EDGE", "Connection targets must be independently placeable permanent roads.");
                var edge = em.GetComponentData<Edge>(entity);
                var original = em.GetComponentData<Curve>(entity).m_Bezier;
                var start = em.GetComponentData<Node>(edge.m_Start).m_Position;
                var end = em.GetComponentData<Node>(edge.m_End).m_Position;
                op.CopyConnectionTargets.Add(new RoadCopyTarget { Edge = entity, Prefab = em.GetComponentData<PrefabRef>(entity).m_Prefab,
                    StartNode = edge.m_Start, EndNode = edge.m_End, Start = start, End = end, Curve = CopyCourse(original,start,end), OriginalCurve=original,
                    Flags = em.HasComponent<Upgraded>(entity) ? em.GetComponentData<Upgraded>(entity).m_Flags : default(CompositionFlags) });
            }
            var positions = new Dictionary<Entity,float3>();
            bool ProtectedSeam(RoadCopyTarget target,Entity node)
            {
                if(em.HasComponent<Owner>(node) || !em.HasBuffer<ConnectedEdge>(node)) return false;
                var edges=em.GetBuffer<ConnectedEdge>(node,true);
                if(edges.Length!=2) return false;
                foreach(var connected in edges)
                {
                    var e=connected.m_Edge;
                    if(!em.Exists(e) || em.HasComponent<Deleted>(e) || em.HasComponent<Temp>(e) || em.HasComponent<Owner>(e) ||
                        !em.HasComponent<Road>(e) || !em.HasComponent<PrefabRef>(e) ||
                        em.GetComponentData<PrefabRef>(e).m_Prefab!=target.Prefab ||
                        !(em.HasComponent<Upgraded>(e) ? em.GetComponentData<Upgraded>(e).m_Flags : default(CompositionFlags)).Equals(target.Flags)) return false;
                }
                return true;
            }
            foreach (var node in op.Segments.SelectMany(s => new[] {s.CopySourceStart,s.CopySourceEnd}).Distinct())
            {
                var point = transform(em.GetComponentData<Node>(node).m_Position);
                RoadCopyTarget chosen = null; float chosenT = 0; float3 chosenPosition = default;
                bool unsafeApproach=false;
                var best = op.CopyConnectionTolerance + .001f;
                foreach (var target in op.CopyConnectionTargets)
                {
                    MathUtils.Distance(target.OriginalCurve.xz,point.xz,out float t);
                    var projected = MathUtils.Position(target.OriginalCurve,t);
                    if(math.distance(projected.xz,point.xz)>op.CopyConnectionTolerance || math.abs(projected.y-point.y)>1) continue;
                    var incoming=op.Segments.Where(s=>(s.CopySourceStart==node || s.CopySourceEnd==node) && s.Prefab!=target.Prefab).ToList();
                    if(incoming.Count==0) incoming=op.Segments.Where(s=>s.CopySourceStart==node || s.CopySourceEnd==node).ToList();
                    var sourceWidth=incoming.Max(s=>em.GetComponentData<NetGeometryData>(s.Prefab).m_DefaultWidth);
                    var targetWidth=em.GetComponentData<NetGeometryData>(target.Prefab).m_DefaultWidth;
                    var clearance=math.max(8,(sourceWidth+targetWidth)*.5f+4);
                    var endpoint=RoadCopyCurveRules.ConnectionEndpoint(math.distance(projected.xz,target.Start.xz),math.distance(projected.xz,target.End.xz),
                        math.distance(point.xz,target.Start.xz),math.distance(point.xz,target.End.xz),op.CopyConnectionTolerance,clearance,
                        ProtectedSeam(target,target.StartNode),ProtectedSeam(target,target.EndNode));
                    if(endpoint==2) { unsafeApproach=true; continue; }
                    if(endpoint==-1) { t=0; projected=target.Start; }
                    else if(endpoint==1) { t=1; projected=target.End; }
                    var distance = math.distance(projected.xz,point.xz);
                    if (distance > op.CopyConnectionTolerance || math.abs(projected.y-point.y) > 1) continue;
                    if (distance < best) { chosen=target; chosenT=t; chosenPosition=projected; best=distance; }
                }
                if(chosen==null && unsafeApproach)
                    throw new QueryException("ROAD_COPY_CONNECTION_TOO_CLOSE", "A new junction would be too close to an existing road endpoint and could move that endpoint. Increase connection_tolerance_m (up to 32m) to reuse the existing junction, or change placement.");
                if (chosen != null)
                {
                    if (op.CopyBindings.Values.Any(b => math.distance(b.Position,chosenPosition) < .25f))
                        throw new QueryException("ROAD_COPY_NODE_MERGE", "Two distinct source junctions would merge at the target road; reduce the connection tolerance or change placement.");
                    var binding = new RoadCopyBinding { Edge=chosen.Edge, Target=chosenT==0 ? chosen.StartNode : chosenT==1 ? chosen.EndNode : chosen.Edge,
                        Split=chosenT==0 || chosenT==1 ? 0 : chosenT, Position=chosenPosition, Adjustment=math.distance(point,chosenPosition) };
                    if (binding.Target != chosen.Edge && em.HasBuffer<ConnectedEdge>(binding.Target))
                        foreach (var connected in em.GetBuffer<ConnectedEdge>(binding.Target,true)) binding.ExternalEdges.Add(connected.m_Edge);
                    op.CopyBindings.Add(node,binding); point=chosenPosition;
                }
                positions.Add(node,point);
            }
            if (op.CopyBindings.Count == 0) throw new QueryException("ROAD_COPY_NO_CONNECTION", "No source junction lies within the requested target road connection tolerance.");
            foreach (var segment in op.Segments)
            {
                segment.CopyStartTrimLimit=math.max(segment.CopyStartTrimLimit,math.distance(segment.Curve.a,transform(em.GetComponentData<Node>(segment.CopySourceStart).m_Position))+1)+
                    (op.CopyBindings.TryGetValue(segment.CopySourceStart,out var startBinding) ? startBinding.Adjustment : 0);
                segment.CopyEndTrimLimit=math.max(segment.CopyEndTrimLimit,math.distance(segment.Curve.d,transform(em.GetComponentData<Node>(segment.CopySourceEnd).m_Position))+1)+
                    (op.CopyBindings.TryGetValue(segment.CopySourceEnd,out var endBinding) ? endBinding.Adjustment : 0);
                segment.Start=positions[segment.CopySourceStart]; segment.End=positions[segment.CopySourceEnd];
                segment.Curve=CopyCourse(segment.Curve,segment.Start,segment.End);
                void Attach(Entity node, bool start)
                {
                    if (!op.CopyBindings.TryGetValue(node,out var binding)) return;
                    if (start) { segment.StartTarget=binding.Target; segment.StartSplit=binding.Split; }
                    else { segment.EndTarget=binding.Target; segment.EndSplit=binding.Split; }
                }
                Attach(segment.CopySourceStart,true); Attach(segment.CopySourceEnd,false);
                if (op.CopyBindings.TryGetValue(segment.CopySourceStart,out var a) && op.CopyBindings.TryGetValue(segment.CopySourceEnd,out var b) && a.Edge==b.Edge)
                {
                    var target=op.CopyConnectionTargets.First(t => t.Edge==a.Edge);
                    if (segment.Prefab!=target.Prefab || !segment.UpgradeFlags.Equals(target.Flags) ||
                        !RoadCopyCurveRules.OnCurve(target.Curve,segment.Curve,op.CopyConnectionTolerance+1))
                        throw new QueryException("ROAD_COPY_REUSE_CONFLICT", "A copied edge would overlap a connection road with incompatible prefab, upgrades or geometry.");
                    segment.Role="reused_connection_road"; op.CopyReusedSegments.Add(segment);
                }
                // Node heights, not clipped lane/edge endpoints, drive the native course.
                var heights=world.GetExistingSystemManaged<Game.Simulation.TerrainSystem>().GetHeightData(true);
                float SurfaceElevation(float height) => height < 0 && height >= -.25f ? 0 : height;
                segment.StartElevation=SurfaceElevation(segment.Start.y-Game.Simulation.TerrainUtils.SampleHeight(ref heights,segment.Start));
                segment.EndElevation=SurfaceElevation(segment.End.y-Game.Simulation.TerrainUtils.SampleHeight(ref heights,segment.End));
            }
            op.Segments.RemoveAll(s => op.CopyReusedSegments.Contains(s));
            if (op.Segments.Count==0) throw new QueryException("ROAD_COPY_NOTHING_TO_CREATE", "The selected roads are already represented by the target corridor.");
            foreach(var reused in op.CopyReusedSegments)
                foreach(var node in new[] {reused.CopySourceStart,reused.CopySourceEnd})
                    if(!op.Segments.Any(s=>s.CopySourceStart==node || s.CopySourceEnd==node))
                        throw new QueryException("ROAD_COPY_UNATTACHED_REUSE", "Both ends of a reused road must join newly copied streets; otherwise no native split can materialize the copied junction.");
            foreach (var segment in op.Segments) ValidateRoadReplacementElevation(world,segment.Prefab,segment.Curve,new float2(segment.StartElevation,segment.EndElevation));
        }

        private static Bezier4x3 CopyCourse(Bezier4x3 curve,float3 start,float3 end)
        {
            // This is the stock NetToolSystem's reconstruction of an existing edge course.
            if (math.distance(curve.a,start)<.001f && math.distance(curve.d,end)<.001f) return curve;
            var fitted=NetUtils.FitCurve(start,MathUtils.Normalize(MathUtils.StartTangent(curve),MathUtils.StartTangent(curve).xz),
                MathUtils.Normalize(MathUtils.EndTangent(curve),MathUtils.EndTangent(curve).xz),end);
            fitted.b.y=curve.b.y; fitted.c.y=curve.c.y; return fitted;
        }
    }
}
