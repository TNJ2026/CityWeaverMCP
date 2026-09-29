using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Notifications;
using Game.Prefabs;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CityWeaver
{
    // Every definition is temporary. Permanent objects are created only by native ToolApplySystem.
    public sealed partial class McpEditorAssetToolSystem : ObjectToolBaseSystem
    {
        private EditorAssetOperation m_Operation;
        private EntityQuery m_TempQuery,m_WarningQuery;
        private NativeList<ControlPoint> m_Points;
        private readonly List<Entity> m_Definitions=new List<Entity>(),m_Candidates=new List<Entity>();
        private readonly Dictionary<Entity,Entity> m_ResultPrefabs=new Dictionary<Entity,Entity>();
        private readonly Dictionary<Entity,float3> m_ResultPositions=new Dictionary<Entity,float3>();
        private readonly Dictionary<Entity,quaternion> m_ResultRotations=new Dictionary<Entity,quaternion>();
        private readonly Dictionary<Entity,Bezier4x3> m_ResultCurves=new Dictionary<Entity,Bezier4x3>();
        private readonly Dictionary<Entity,float3[]> m_ResultPolygons=new Dictionary<Entity,float3[]>();
        private int m_Phase,m_Ticks,m_Stable;private string m_Signature;
        private Entity m_ParentPrefab;private Game.Objects.Transform? m_ParentTransform;
        public override string toolID=>"McpEditorAsset";
        public override PrefabBase GetPrefab()=>m_Operation==null?null:m_PrefabSystem.GetPrefab<PrefabBase>(m_Operation.Prefab);
        public override bool TrySetPrefab(PrefabBase prefab)=>false;
        protected override void OnCreate()
        {
            base.OnCreate();m_Points=new NativeList<ControlPoint>(1,Allocator.Persistent);
            m_TempQuery=GetEntityQuery(ComponentType.ReadOnly<Temp>(),ComponentType.Exclude<Deleted>());
            m_WarningQuery=GetEntityQuery(ComponentType.ReadOnly<Warning>());
        }
        protected override void OnDestroy(){if(m_Points.IsCreated)m_Points.Dispose();base.OnDestroy();}
        public void Begin(EditorAssetOperation op)
        {
            if(Game.SceneFlow.GameManager.instance.gameMode!=Game.GameMode.Editor)throw new QueryException("MAP_EDITOR_REQUIRED","Editor asset transactions cannot run in a city.");
            if(m_Operation!=null||!m_TempQuery.IsEmptyIgnoreFilter||!(m_ToolSystem.activeTool is DefaultToolSystem))throw new QueryException("TOOL_BUSY","Finish current native preview first.");
            m_ParentPrefab=Entity.Null;m_ParentTransform=null;
            if(op.Parent!=Entity.Null){if(EntityManager.HasComponent<PrefabRef>(op.Parent))m_ParentPrefab=EntityManager.GetComponentData<PrefabRef>(op.Parent).m_Prefab;if(EntityManager.HasComponent<Game.Objects.Transform>(op.Parent))m_ParentTransform=EntityManager.GetComponentData<Game.Objects.Transform>(op.Parent);}
            m_Operation=op;m_Phase=m_Ticks=m_Stable=0;m_Signature=null;m_Candidates.Clear();
            m_ResultPrefabs.Clear();m_ResultPositions.Clear();m_ResultRotations.Clear();m_ResultCurves.Clear();m_ResultPolygons.Clear();
            applyMode=ApplyMode.Clear;m_ToolSystem.activeTool=this;
        }
        public void AbortForLoading(){if(m_Operation!=null&&!m_Operation.Terminal){m_Operation.State=m_Operation.ApplyDispatched?"outcome_unknown":"cancelled";m_Operation.Error="CITY_SESSION_CHANGED";}Finish();}
        protected override void OnStopRunning(){if(m_Operation!=null&&!m_Operation.Terminal){m_Operation.State=m_Operation.ApplyDispatched?"outcome_unknown":"cancelled";m_Operation.Error="USER_CHANGED_TOOL";}ClearDefinitions();m_Operation=null;applyMode=ApplyMode.Clear;base.OnStopRunning();}
        protected override JobHandle OnUpdate(JobHandle deps)
        {
            deps.Complete();EntityManager.CompleteAllTrackedJobs();if(m_Operation==null){applyMode=ApplyMode.Clear;return default;}
            try{Tick();}catch(Exception ex){Mod.log.Error(ex,"Editor asset transaction failed");Fail(m_Operation!=null&&m_Operation.ApplyDispatched?"APPLY_OUTCOME_UNKNOWN":"EDITOR_ASSET_INTERNAL_ERROR");}return default;
        }
        private bool Valid()
        {
            var op=m_Operation;
            if(Game.SceneFlow.GameManager.instance.gameMode!=Game.GameMode.Editor||!EntityManager.Exists(op.Prefab)||EntityManager.HasComponent<Deleted>(op.Prefab))return false;
            if(op.Parent!=Entity.Null){if(!EntityManager.Exists(op.Parent)||EntityManager.HasComponent<Deleted>(op.Parent)||EntityManager.HasComponent<Temp>(op.Parent))return false;
                if(m_ParentPrefab!=Entity.Null&&(!EntityManager.HasComponent<PrefabRef>(op.Parent)||EntityManager.GetComponentData<PrefabRef>(op.Parent).m_Prefab!=m_ParentPrefab))return false;
                if(m_ParentTransform.HasValue){if(!EntityManager.HasComponent<Game.Objects.Transform>(op.Parent))return false;var t=EntityManager.GetComponentData<Game.Objects.Transform>(op.Parent);if(math.distance(t.m_Position,m_ParentTransform.Value.m_Position)>.01f||math.distance(t.m_Rotation.value,m_ParentTransform.Value.m_Rotation.value)>.001f)return false;}}
            foreach(var s in op.Segments)foreach(var pair in new[]{Tuple.Create(s.StartTarget,s.Start),Tuple.Create(s.EndTarget,s.End)})
                if(pair.Item1!=Entity.Null&&(!EntityManager.Exists(pair.Item1)||EntityManager.HasComponent<Deleted>(pair.Item1)||EntityManager.HasComponent<Temp>(pair.Item1)||!EntityManager.HasComponent<Node>(pair.Item1)||math.distance(EntityManager.GetComponentData<Node>(pair.Item1).m_Position,pair.Item2)>.1f))return false;
            return true;
        }
        private void Tick()
        {
            var op=m_Operation;++m_Ticks;
            if(!op.ApplyDispatched&&(op.CancelRequested||DateTime.UtcNow>=op.Expires)){op.State=op.CancelRequested?"cancelled":"expired";Finish();return;}
            if(m_Phase==0){applyMode=ApplyMode.Clear;if(m_Ticks<3)return;if(!m_TempQuery.IsEmptyIgnoreFilter){if(m_Ticks>120)Fail("PREVIEW_CLEANUP_TIMEOUT");return;}if(!Valid()){Fail("TARGET_CHANGED");return;}Generate();applyMode=ApplyMode.None;op.State="generating_preview";m_Phase=1;m_Ticks=0;return;}
            if(m_Phase==1){ClearDefinitions();applyMode=ApplyMode.None;m_Phase=2;m_Ticks=0;return;}
            if(m_Phase==2){if(m_Ticks<5)return;if(!ReadPreview(out var signature)){if(m_Ticks>120)Fail("NO_GENERATED_ASSET");return;}m_Stable=signature==m_Signature?m_Stable+1:0;m_Signature=signature;if(m_Stable<3)return;
                if(op.Errors.Count>0||op.Warnings.Count>0||!m_ErrorQuery.IsEmptyIgnoreFilter||!GetAllowApply()){Fail("GAME_REJECTED_EDITOR_ASSET");return;}
                op.State="preview_ready";m_Phase=3;m_Ticks=0;return;}
            if(m_Phase==3){applyMode=ApplyMode.None;if(!op.CommitRequested)return;if(!Valid()){Fail("TARGET_CHANGED");return;}
                if(!ReadPreview(out var signature)||signature!=m_Signature||op.Errors.Count>0||op.Warnings.Count>0||!m_ErrorQuery.IsEmptyIgnoreFilter||!GetAllowApply()){Fail("PREVIEW_NO_LONGER_VALID");return;}
                if(op.Cost>op.MaxCost){Fail("COST_LIMIT");return;}if(World.GetExistingSystemManaged<Game.Simulation.SimulationSystem>().selectedSpeed!=0){Fail("CITY_MUST_BE_PAUSED");return;}
                CaptureResults();op.ApplyDispatched=true;op.State="applying";applyMode=ApplyMode.Apply;m_Phase=4;m_Ticks=0;return;}
            if(m_Phase==4){applyMode=ApplyMode.None;if(m_Ticks<8)return;if(Verify()){op.State="completed";Finish();return;}if(m_Ticks>=120)Fail("APPLY_OUTCOME_UNKNOWN");}
        }
        private void Generate()
        {
            var op=m_Operation;
            if(op.Kind=="object"||op.Kind=="stamp"){
                m_Points.Clear();m_Points.Add(new ControlPoint{m_Position=op.Position,m_HitPosition=op.Position,m_Rotation=op.Rotation,m_OriginalEntity=op.Parent,m_Elevation=op.Elevation,m_ElementIndex=new int2(-1)});
                var config=World.GetExistingSystemManaged<Game.City.CityConfigurationSystem>();
                CreateDefinitions(op.TransformPrefab?Entity.Null:op.Prefab,op.TransformPrefab?op.Prefab:Entity.Null,Entity.Null,Entity.Null,Entity.Null,Entity.Null,config?.defaultTheme??Entity.Null,m_Points,default(NativeReference<AttachmentData>),true,config?.leftHandTraffic??false,false,op.Kind=="stamp",100,0,.5f,0,0,RandomSeed.Next(),Snap.All,Game.Tools.AgeMask.Sapling,false,default,default);
                return;
            }
            if(op.Kind=="area"){
                var def=EntityManager.CreateEntity();m_Definitions.Add(def);EntityManager.AddComponentData(def,new CreationDefinition{m_Prefab=op.Prefab,m_Owner=op.Parent});
                var nodes=EntityManager.AddBuffer<Game.Areas.Node>(def);foreach(var p in op.Points)nodes.Add(new Game.Areas.Node(p,float.MinValue));nodes.Add(new Game.Areas.Node(op.Points[0],float.MinValue));EntityManager.AddComponent<Updated>(def);return;
            }
            foreach(var s in op.Segments){
                CoursePos Point(bool first)=>new CoursePos{m_Entity=first?s.StartTarget:s.EndTarget,m_Position=first?s.Start:s.End,m_Rotation=NetUtils.GetNodeRotation(first?MathUtils.StartTangent(s.Curve):MathUtils.EndTangent(s.Curve)),m_Elevation=new float2(first?s.StartElevation:s.EndElevation),m_CourseDelta=first?0:1,m_ParentMesh=-1,m_Flags=(first?CoursePosFlags.IsFirst:CoursePosFlags.IsLast)|CoursePosFlags.IsLeft|CoursePosFlags.IsRight|((first?s.StartElevation:s.EndElevation)>=8?CoursePosFlags.ForceElevatedNode|CoursePosFlags.ForceElevatedEdge:0)};
                var def=EntityManager.CreateEntity();m_Definitions.Add(def);EntityManager.AddComponentData(def,new CreationDefinition{m_Prefab=op.Prefab,m_Flags=CreationFlags.SubElevation,m_RandomSeed=1});
                EntityManager.AddComponentData(def,new NetCourse{m_Curve=s.Curve,m_StartPosition=Point(true),m_EndPosition=Point(false),m_Length=MathUtils.Length(s.Curve),m_FixedIndex=-1});EntityManager.AddComponent<Updated>(def);
            }
        }
        private void Messages(EntityQuery query,JArray messages,string fallback)
        {
            using(var es=query.ToEntityArray(Allocator.Temp))foreach(var e in es){bool found=false;
                if(EntityManager.HasBuffer<IconElement>(e))foreach(var i in EntityManager.GetBuffer<IconElement>(e,true)){
                    if(!EntityManager.Exists(i.m_Icon)||!EntityManager.HasComponent<PrefabRef>(i.m_Icon))continue;var p=EntityManager.GetComponentData<PrefabRef>(i.m_Icon).m_Prefab;
                    if(!EntityManager.Exists(p)||!EntityManager.HasComponent<ToolErrorData>(p))continue;string code=EntityManager.GetComponentData<ToolErrorData>(p).m_Error.ToString();if(!messages.Any(v=>(string)v==code))messages.Add(code);found=true;}
                if(!found&&!messages.Any(v=>(string)v==fallback))messages.Add(fallback);
            }
        }
        private Entity Original(Entity e)=>e!=Entity.Null&&EntityManager.Exists(e)&&EntityManager.HasComponent<Temp>(e)?EntityManager.GetComponentData<Temp>(e).m_Original:e;
        private bool RoadBound(Entity e)
        {
            var op=m_Operation;if(!op.RoadSide)return true;
            if(!EntityManager.HasComponent<Game.Buildings.Building>(e))return EntityManager.HasComponent<Game.Objects.Attached>(e)&&Original(EntityManager.GetComponentData<Game.Objects.Attached>(e).m_Parent)==op.Parent;
            return Original(EntityManager.GetComponentData<Game.Buildings.Building>(e).m_RoadEdge)==op.Parent;
        }
        private bool ReadPreview(out string signature)
        {
            var op=m_Operation;op.Errors.Clear();op.Warnings.Clear();op.Cost=0;m_Candidates.Clear();Messages(m_ErrorQuery,op.Errors,"NATIVE_ERROR");Messages(m_WarningQuery,op.Warnings,"NATIVE_WARNING");
            var records=new List<string>();bool primary=false;
            using(var es=m_TempQuery.ToEntityArray(Allocator.Temp))foreach(var e in es){var t=EntityManager.GetComponentData<Temp>(e);if((t.m_Flags&TempFlags.Cancel)!=0)continue;op.Cost+=t.m_Cost;
                if(t.m_Original!=Entity.Null&&(t.m_Flags&TempFlags.Delete)!=0)op.Errors.Add("WOULD_DELETE_EXISTING_ENTITY");
                bool geometry=EntityManager.HasComponent<Game.Objects.Transform>(e)||EntityManager.HasComponent<Edge>(e)||EntityManager.HasComponent<Game.Areas.Area>(e);
                if(!geometry||!EntityManager.HasComponent<PrefabRef>(e))continue;
                var prefab=EntityManager.GetComponentData<PrefabRef>(e).m_Prefab;
                if(t.m_Original==Entity.Null && (t.m_Flags&TempFlags.Delete)==0)m_Candidates.Add(e);
                var row=new JObject{["id"]=op.EntityId(e),["prefab"]=op.EntityId(prefab),["original"]=op.EntityId(t.m_Original),["flags"]=(int)t.m_Flags};
                if(EntityManager.HasComponent<Game.Objects.Transform>(e)){var transform=EntityManager.GetComponentData<Game.Objects.Transform>(e);row["position"]=new JArray(transform.m_Position.x,transform.m_Position.y,transform.m_Position.z);row["rotation"]=new JArray(transform.m_Rotation.value.x,transform.m_Rotation.value.y,transform.m_Rotation.value.z,transform.m_Rotation.value.w);}
                if(EntityManager.HasComponent<Curve>(e)){var c=EntityManager.GetComponentData<Curve>(e).m_Bezier;row["curve"]=new JArray(c.a.x,c.a.y,c.a.z,c.b.x,c.b.y,c.b.z,c.c.x,c.c.y,c.c.z,c.d.x,c.d.y,c.d.z);}
                if(EntityManager.HasBuffer<Game.Areas.Node>(e)){var ns=new JArray();foreach(var n in EntityManager.GetBuffer<Game.Areas.Node>(e,true))ns.Add(new JArray(n.m_Position.x,n.m_Position.y,n.m_Position.z));row["polygon"]=ns;}
                records.Add(row.ToString(Newtonsoft.Json.Formatting.None));
                if(prefab==op.Prefab && t.m_Original==Entity.Null){primary=true;if(!RoadBound(e))op.Errors.Add("ROAD_PARENT_NOT_BOUND");
                    if(op.Kind=="object"&&EntityManager.HasComponent<Game.Objects.Transform>(e)){
                        var actual=EntityManager.GetComponentData<Game.Objects.Transform>(e);if(math.distance(actual.m_Position,op.Position)>.5f)op.Errors.Add("PLACEMENT_POSITION_CHANGED");
                        if(op.Floating||op.Hovering){float elevation=EntityManager.HasComponent<Game.Objects.Elevation>(e)?EntityManager.GetComponentData<Game.Objects.Elevation>(e).m_Elevation:0;if(!FloatingPlacement.Matches(actual.m_Position.y,elevation,op.Position.y,op.Elevation))op.Errors.Add("FLOATING_ELEVATION_MISMATCH");}
                    }
                }
            }
            if(!primary&&op.Kind!="stamp")op.Errors.Add("PRIMARY_ASSET_NOT_GENERATED");
            m_Candidates.Sort((a,b)=>a.Index.CompareTo(b.Index));records.Sort(StringComparer.Ordinal);signature=string.Join("|",records)+":"+op.Cost+":"+op.Errors+":"+op.Warnings;
            return m_Candidates.Count>0;
        }
        private void CaptureResults()
        {
            m_ResultPrefabs.Clear();m_ResultPositions.Clear();m_ResultRotations.Clear();m_ResultCurves.Clear();m_ResultPolygons.Clear();
            foreach(var e in m_Candidates){m_ResultPrefabs[e]=EntityManager.GetComponentData<PrefabRef>(e).m_Prefab;
                if(EntityManager.HasComponent<Game.Objects.Transform>(e)){var t=EntityManager.GetComponentData<Game.Objects.Transform>(e);m_ResultPositions[e]=t.m_Position;m_ResultRotations[e]=t.m_Rotation;}
                if(EntityManager.HasComponent<Curve>(e))m_ResultCurves[e]=EntityManager.GetComponentData<Curve>(e).m_Bezier;
                if(EntityManager.HasBuffer<Game.Areas.Node>(e)){var nodes=EntityManager.GetBuffer<Game.Areas.Node>(e,true);var polygon=new float3[nodes.Length];for(int i=0;i<nodes.Length;i++)polygon[i]=nodes[i].m_Position;m_ResultPolygons[e]=polygon;}
            }
        }
        private bool Verify()
        {
            var op=m_Operation;op.Results.Clear();if(m_ResultPrefabs.Count==0)return false;
            foreach(var pair in m_ResultPrefabs){var e=pair.Key;
                if(!EntityManager.Exists(e)||EntityManager.HasComponent<Temp>(e)||EntityManager.HasComponent<Deleted>(e)||!EntityManager.HasComponent<PrefabRef>(e)||EntityManager.GetComponentData<PrefabRef>(e).m_Prefab!=pair.Value)return false;
                if(m_ResultPositions.TryGetValue(e,out var position)){
                    if(!EntityManager.HasComponent<Game.Objects.Transform>(e))return false;var t=EntityManager.GetComponentData<Game.Objects.Transform>(e);if(math.distance(t.m_Position,position)>.5f||math.abs(math.dot(t.m_Rotation.value,m_ResultRotations[e].value))<.999f)return false;
                }
                if(m_ResultCurves.TryGetValue(e,out var expected)){
                    if(!EntityManager.HasComponent<Curve>(e)||!EntityManager.HasComponent<Edge>(e))return false;var c=EntityManager.GetComponentData<Curve>(e).m_Bezier;
                    if(math.distance(c.a,expected.a)>.25f||math.distance(c.b,expected.b)>.25f||math.distance(c.c,expected.c)>.25f||math.distance(c.d,expected.d)>.25f)return false;
                    var edge=EntityManager.GetComponentData<Edge>(e);foreach(var node in new[]{edge.m_Start,edge.m_End}){if(!EntityManager.Exists(node)||EntityManager.HasComponent<Temp>(node)||!EntityManager.HasBuffer<ConnectedEdge>(node))return false;bool found=false;foreach(var ce in EntityManager.GetBuffer<ConnectedEdge>(node,true))if(ce.m_Edge==e)found=true;if(!found)return false;}
                }
                if(m_ResultPolygons.TryGetValue(e,out var polygon)){
                    if(!EntityManager.HasBuffer<Game.Areas.Node>(e))return false;var nodes=EntityManager.GetBuffer<Game.Areas.Node>(e,true);if(nodes.Length!=polygon.Length)return false;for(int i=0;i<nodes.Length;i++)if(math.distance(nodes[i].m_Position,polygon[i])>.25f)return false;
                }
                if(pair.Value==op.Prefab){if(!RoadBound(e))return false;if(op.OutsideConnection){if(!EntityManager.HasComponent<Game.Objects.OutsideConnection>(e))return false;if(EntityManager.HasComponent<TransportStopData>(op.Prefab)&&(!EntityManager.HasComponent<Game.Routes.TransportStop>(e)||!EntityManager.HasBuffer<Game.Routes.ConnectedRoute>(e)))return false;}
                    if(op.Floating||op.Hovering){float elevation=EntityManager.HasComponent<Game.Objects.Elevation>(e)?EntityManager.GetComponentData<Game.Objects.Elevation>(e).m_Elevation:0;if(!FloatingPlacement.Matches(EntityManager.GetComponentData<Game.Objects.Transform>(e).m_Position.y,elevation,op.Position.y,op.Elevation))return false;}}
                op.Results.Add(e);
            }
            return true;
        }
        private void ClearDefinitions(){foreach(var e in m_Definitions)if(EntityManager.Exists(e))EntityManager.DestroyEntity(e);m_Definitions.Clear();}
        private void Fail(string error){if(m_Operation==null)return;m_Operation.Error=error;m_Operation.State=m_Operation.ApplyDispatched?"outcome_unknown":"failed";Finish();}
        private void Finish(){ClearDefinitions();applyMode=ApplyMode.Clear;m_Operation=null;if(m_ToolSystem.activeTool==this)m_ToolSystem.activeTool=m_DefaultToolSystem;}
    }
}
