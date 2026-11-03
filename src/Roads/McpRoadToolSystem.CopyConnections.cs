using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class McpRoadToolSystem
    {
        internal bool ProtectCopyEndpoint(Entity original) =>
            m_Operation != null && !m_Operation.Terminal && !m_Operation.ApplyDispatched &&
            m_Operation.CurveMode == "network_copy" && original != Entity.Null &&
            m_Operation.CopyConnectionTargets.Any(t => t.StartNode == original || t.EndNode == original);

        private Entity CopyCanonical(Entity e)
        {
            if(!EntityManager.HasComponent<Temp>(e)) return e;
            var original=EntityManager.GetComponentData<Temp>(e).m_Original;
            // An inserted junction's Temp.m_Original may be the EDGE it splits. It is
            // not an alias for that edge, and must keep its own node identity.
            if(original==Entity.Null || !EntityManager.Exists(original) ||
                EntityManager.HasComponent<Node>(e)!=EntityManager.HasComponent<Node>(original) ||
                EntityManager.HasComponent<Edge>(e)!=EntityManager.HasComponent<Edge>(original)) return e;
            return original;
        }
        private bool CopyFlagsMatch(Entity e,CompositionFlags flags) =>
            (EntityManager.HasComponent<Upgraded>(e) ? EntityManager.GetComponentData<Upgraded>(e).m_Flags : default(CompositionFlags)).Equals(flags);
        private bool CopyTargetsUnchanged()
        {
            foreach(var target in m_Operation.CopyConnectionTargets)
            {
                var e=target.Edge;
                if(!EntityManager.Exists(e) || EntityManager.HasComponent<Deleted>(e) || !EntityManager.HasComponent<Edge>(e) ||
                    !EntityManager.HasComponent<Curve>(e) || !EntityManager.HasComponent<PrefabRef>(e) ||
                    EntityManager.GetComponentData<PrefabRef>(e).m_Prefab!=target.Prefab || !CopyFlagsMatch(e,target.Flags)) return false;
                var edge=EntityManager.GetComponentData<Edge>(e); var actual=EntityManager.GetComponentData<Curve>(e).m_Bezier; var saved=target.OriginalCurve;
                if(!EntityManager.HasComponent<Node>(target.StartNode) || !EntityManager.HasComponent<Node>(target.EndNode) ||
                    !(math.distance(EntityManager.GetComponentData<Node>(target.StartNode).m_Position,target.Start)<=.1f &&
                      math.distance(EntityManager.GetComponentData<Node>(target.EndNode).m_Position,target.End)<=.1f)) return false;
                if(edge.m_Start!=target.StartNode || edge.m_End!=target.EndNode || !(math.distance(actual.a,saved.a)<=.1f && math.distance(actual.b,saved.b)<=.1f &&
                    math.distance(actual.c,saved.c)<=.1f && math.distance(actual.d,saved.d)<=.1f)) return false;
            }
            return true;
        }

        private RoadCopyTarget CopyRemnantTarget(Entity entity,out float2 interval)
        {
            interval=default;
            if(!EntityManager.Exists(entity) || !EntityManager.HasComponent<Edge>(entity) || !EntityManager.HasComponent<Curve>(entity) || !EntityManager.HasComponent<PrefabRef>(entity)) return null;
            var edge=EntityManager.GetComponentData<Edge>(entity);
            if(!EntityManager.HasComponent<Node>(edge.m_Start) || !EntityManager.HasComponent<Node>(edge.m_End)) return null;
            var start=EntityManager.GetComponentData<Node>(edge.m_Start).m_Position; var end=EntityManager.GetComponentData<Node>(edge.m_End).m_Position;
            var prefab=EntityManager.GetComponentData<PrefabRef>(entity).m_Prefab;
            var original=EntityManager.HasComponent<Temp>(entity) ? EntityManager.GetComponentData<Temp>(entity).m_Original : Entity.Null;
            RoadCopyTarget found=null;
            foreach(var target in m_Operation.CopyConnectionTargets)
            {
                if(prefab!=target.Prefab || original!=Entity.Null && original!=target.Edge || !CopyFlagsMatch(entity,target.Flags)) continue;
                if(MathUtils.Distance(target.Curve.xz,start.xz,out float a)>.35f || MathUtils.Distance(target.Curve.xz,end.xz,out float b)>.35f ||
                    b<=a || math.abs(start.y-MathUtils.Position(target.Curve,a).y)>.5f || math.abs(end.y-MathUtils.Position(target.Curve,b).y)>.5f ||
                    !RoadCopyCurveRules.OnCurve(target.Curve,EntityManager.GetComponentData<Curve>(entity).m_Bezier,.5f)) continue;
                if(found!=null) return null; // Ambiguous overlapping allowlist corridors are never inferred.
                found=target; interval=new float2(a,b);
            }
            return found;
        }

        private bool CopyTargetPathsMatch(Dictionary<Entity,Entity> nodeMap,bool preview)
        {
            foreach(var target in m_Operation.CopyConnectionTargets)
            {
                var pieces=new List<KeyValuePair<float2,Entity>>();
                foreach(var remnant in m_SplitRemnants)
                {
                    // Apply may update the original edge in place and delete its
                    // temporary replacement. Verify the surviving corridor below.
                    if(!EntityManager.Exists(remnant) || EntityManager.HasComponent<Deleted>(remnant)) continue;
                    if(CopyRemnantTarget(remnant,out var interval)==target) pieces.Add(new KeyValuePair<float2,Entity>(interval,remnant));
                }
                bool changed=false;
                if(preview)
                using(var temps=m_RoadQuery.ToEntityArray(Allocator.Temp))
                    foreach(var temp in temps)
                        if(EntityManager.GetComponentData<Temp>(temp).m_Original==target.Edge) { changed=true; break; }
                if(!changed && EntityManager.Exists(target.Edge) && !EntityManager.HasComponent<Deleted>(target.Edge) &&
                    CopyRemnantTarget(target.Edge,out var originalInterval)==target && !pieces.Any(p=>p.Value==target.Edge) &&
                    !pieces.Any(p=>math.min(p.Key.y,originalInterval.y)-math.max(p.Key.x,originalInterval.x)>.002f))
                    pieces.Add(new KeyValuePair<float2,Entity>(originalInterval,target.Edge));
                pieces.Sort((a,b)=>a.Key.x.CompareTo(b.Key.x));
                if(!RoadCopyCurveRules.Covers(pieces.Select(p=>p.Key).ToList()))
                { m_Operation.CopyValidationFailure="connection_coverage: pieces="+pieces.Count; return false; }
                Entity previous=Entity.Null; var pathNodes=new HashSet<Entity>();
                foreach(var piece in pieces)
                {
                    var edge=EntityManager.GetComponentData<Edge>(piece.Value);
                    var a=CopyCanonical(edge.m_Start); var b=CopyCanonical(edge.m_End);
                    if(previous==Entity.Null ? a!=target.StartNode : a!=previous)
                    { m_Operation.CopyValidationFailure="connection_path_node_identity"; return false; }
                    previous=b; pathNodes.Add(a); pathNodes.Add(b);
                }
                if(previous!=target.EndNode) { m_Operation.CopyValidationFailure="connection_end_node_identity"; return false; }
                foreach(var binding in m_Operation.CopyBindings)
                    if(binding.Value.Edge==target.Edge && (!nodeMap.TryGetValue(binding.Key,out var copied) || !pathNodes.Contains(CopyCanonical(copied))))
                    { m_Operation.CopyValidationFailure="connection_binding_node"; return false; }
            }
            return true;
        }

        private bool NetworkCopyConnectionsMatch(List<Entity> candidates) => NetworkCopyCoursesMatch(candidates);
    }
}
