using Game.Net;
using Game.Prefabs;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class McpRoadToolSystem
    {
        // Retain bounded native evidence before failed preview entities are cleaned up.
        private void CaptureCopyDiagnostics()
        {
            var op=m_Operation; var rows=new JArray();
            JObject NodeRecord(Entity node)
            {
                var result=new JObject { ["id"]=op.EntityId(node), ["canonical_id"]=op.EntityId(CopyCanonical(node)) };
                if(EntityManager.HasComponent<Node>(node)) result["position"]=RoadOperation.Point(EntityManager.GetComponentData<Node>(node).m_Position);
                if(EntityManager.HasComponent<Temp>(node)) result["original_id"]=op.EntityId(EntityManager.GetComponentData<Temp>(node).m_Original);
                if(EntityManager.HasBuffer<ConnectedEdge>(node))
                {
                    var edges=new JArray();
                    foreach(var edge in EntityManager.GetBuffer<ConnectedEdge>(node,true)) if(edges.Count<16) edges.Add(op.EntityId(edge.m_Edge));
                    result["connected_edges"]=edges;
                }
                return result;
            }
            using(var roads=m_RoadQuery.ToEntityArray(Allocator.Temp))
                foreach(var e in roads)
                {
                    if(rows.Count>=128 || !EntityManager.HasComponent<Curve>(e)) continue;
                    var edge=EntityManager.GetComponentData<Edge>(e); var temp=EntityManager.GetComponentData<Temp>(e);
                    var curve=EntityManager.GetComponentData<Curve>(e).m_Bezier;
                    var prefab=EntityManager.GetComponentData<PrefabRef>(e).m_Prefab;
                    m_PrefabSystem.TryGetPrefab<PrefabBase>(prefab,out var asset);
                    var flags=EntityManager.HasComponent<Upgraded>(e) ? EntityManager.GetComponentData<Upgraded>(e).m_Flags : default(CompositionFlags);
                    rows.Add(new JObject { ["id"]=op.EntityId(e), ["original_id"]=op.EntityId(temp.m_Original), ["temp_flags"]=temp.m_Flags.ToString(),
                        ["prefab"]=asset?.name, ["start_node"]=NodeRecord(edge.m_Start), ["end_node"]=NodeRecord(edge.m_End),
                        ["curve"]=new JObject { ["a"]=RoadOperation.Point(curve.a),["b"]=RoadOperation.Point(curve.b),["c"]=RoadOperation.Point(curve.c),["d"]=RoadOperation.Point(curve.d) },
                        ["upgrade_general"]=flags.m_General.ToString(),["upgrade_left"]=flags.m_Left.ToString(),["upgrade_right"]=flags.m_Right.ToString() });
                }
            op.CopyValidationDiagnostics=new JObject { ["reason"]=op.CopyValidationFailure, ["candidate_count"]=m_Candidates.Count,
                ["split_remnant_count"]=m_SplitRemnants.Count,["preview_roads"]=rows };
        }
    }
}
