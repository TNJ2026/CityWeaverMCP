using System;
using System.Collections.Generic;
using System.Linq;
using Game.Areas;
using Game.Common;
using Game.Prefabs;
using Game.Tools;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CitiesSkylines2Mod
{
    public sealed partial class McpDistrictToolSystem : ToolBaseSystem
    {
        private DistrictOperation m_Operation;
        private readonly List<Entity> m_Definitions = new List<Entity>(), m_Candidates = new List<Entity>();
        private EntityQuery m_TempQuery, m_DistrictTempQuery, m_WarningQuery;
        private int m_Phase, m_Ticks, m_StableTicks; private string m_LastSignature;
        public override string toolID => "McpDistrict";
        public bool Busy => m_Operation != null;
        public override PrefabBase GetPrefab() => m_Operation == null ? null : m_PrefabSystem.GetPrefab<PrefabBase>(m_Operation.Prefab);
        public override bool TrySetPrefab(PrefabBase prefab) => false;
        protected override void OnCreate()
        {
            base.OnCreate();
            m_TempQuery=GetEntityQuery(new EntityQueryDesc{All=new[]{ComponentType.ReadOnly<Temp>()},None=new[]{ComponentType.ReadOnly<Deleted>()}});
            m_DistrictTempQuery=GetEntityQuery(new EntityQueryDesc{All=new[]{ComponentType.ReadOnly<Temp>(),ComponentType.ReadOnly<District>(),ComponentType.ReadOnly<Game.Areas.Node>()},None=new[]{ComponentType.ReadOnly<Deleted>()}});
            m_WarningQuery=GetEntityQuery(ComponentType.ReadOnly<Warning>());
        }
        public void Begin(DistrictOperation op)
        {
            if(Busy||!m_TempQuery.IsEmptyIgnoreFilter)throw new QueryException("TOOL_BUSY","Another tool preview is active.");m_Operation=op;m_Phase=m_Ticks=m_StableTicks=0;m_LastSignature=null;m_Candidates.Clear();applyMode=ApplyMode.Clear;m_ToolSystem.activeTool=this;Mod.log.Info("District preview queued: "+op.Id+" type="+op.Type);
        }
        public void AbortForLoading(){if(m_Operation!=null&&!m_Operation.Terminal){m_Operation.State=m_Operation.ApplyDispatched?"outcome_unknown":"cancelled";m_Operation.Error="CITY_SESSION_CHANGED";}Finish();}
        protected override void OnStopRunning(){if(m_Operation!=null&&!m_Operation.Terminal){m_Operation.State=m_Operation.ApplyDispatched?"outcome_unknown":"cancelled";m_Operation.Error="USER_CHANGED_TOOL";}DestroyDefinitions();m_Operation=null;applyMode=ApplyMode.Clear;base.OnStopRunning();}
        protected override JobHandle OnUpdate(JobHandle deps){deps.Complete();EntityManager.CompleteAllTrackedJobs();if(m_Operation==null){applyMode=ApplyMode.Clear;return default;}try{Tick();}catch(Exception e){Mod.log.Error(e,"District operation failed: "+m_Operation?.Id);Fail(m_Operation!=null&&m_Operation.ApplyDispatched?"APPLY_OUTCOME_UNKNOWN":"DISTRICT_INTERNAL_ERROR");}return default;}
        private bool SnapshotValid()
        {
            var op=m_Operation;if(op.Target==Entity.Null)return EntityManager.Exists(op.Prefab);if(!EntityManager.Exists(op.Target)||EntityManager.HasComponent<Deleted>(op.Target)||EntityManager.HasComponent<Temp>(op.Target)||!EntityManager.HasBuffer<Game.Areas.Node>(op.Target))return false;var b=EntityManager.GetBuffer<Game.Areas.Node>(op.Target,true);if(b.Length!=op.OriginalPoints.Count)return false;for(int i=0;i<b.Length;i++)if(math.distance(b[i].m_Position,op.OriginalPoints[i])>.01f)return false;return true;
        }
        private void Tick()
        {
            var op=m_Operation;++m_Ticks;if(!op.ApplyDispatched&&(op.CancelRequested||DateTime.UtcNow>=op.Expires)){op.State=op.CancelRequested?"cancelled":"expired";Finish();return;}
            if(m_Phase==0){if(m_Ticks<3)return;if(!SnapshotValid()){Fail("TARGET_CHANGED");return;}CreateDefinition();op.State="generating_preview";applyMode=ApplyMode.None;m_Phase=1;m_Ticks=0;return;}
            if(m_Phase==1){DestroyDefinitions();applyMode=ApplyMode.None;m_Phase=2;m_Ticks=0;return;}
            if(m_Phase==2){if(m_Ticks<5)return;if(!ReadPreview(out var sig)){if(m_Ticks<120)return;Fail("NO_GENERATED_DISTRICT");return;}m_StableTicks=sig==m_LastSignature?m_StableTicks+1:0;m_LastSignature=sig;if(m_StableTicks<3)return;if(op.Errors.Count>0||!m_ErrorQuery.IsEmptyIgnoreFilter||!GetAllowApply()){Fail("GAME_REJECTED_DISTRICT");return;}op.State="preview_ready";m_Phase=3;m_Ticks=0;Mod.log.Info("District preview ready: "+op.Id);return;}
            if(m_Phase==3){applyMode=ApplyMode.None;if(!op.CommitRequested)return;if(!SnapshotValid()){Fail("TARGET_CHANGED");return;}if(!ReadPreview(out var sig)||sig!=m_LastSignature||op.Errors.Count>0||!m_ErrorQuery.IsEmptyIgnoreFilter||!GetAllowApply()){Fail("PREVIEW_NO_LONGER_VALID");return;}if(World.GetExistingSystemManaged<Game.Simulation.SimulationSystem>().selectedSpeed!=0){Fail("CITY_MUST_BE_PAUSED");return;}op.ApplyDispatched=true;op.State="applying";applyMode=ApplyMode.Apply;m_Phase=4;m_Ticks=0;return;}
            if(m_Phase==4){applyMode=ApplyMode.None;if(m_Ticks<8)return;if(Verify()){op.State="completed";Finish();return;}if(m_Ticks>=120)Fail("APPLY_OUTCOME_UNKNOWN");}
        }
        private void CreateDefinition()
        {
            var op=m_Operation;var e=EntityManager.CreateEntity();m_Definitions.Add(e);var flags=op.Type=="delete"?CreationFlags.Delete:op.Type=="boundary"?CreationFlags.Relocate:0;EntityManager.AddComponentData(e,new CreationDefinition{m_Prefab=op.Prefab,m_Original=op.Target,m_Flags=flags});var nodes=EntityManager.AddBuffer<Game.Areas.Node>(e);
            var source=op.Type=="delete"?op.OriginalPoints:op.Points;foreach(var p in source)nodes.Add(new Game.Areas.Node(p,float.MinValue));if(op.Type!="delete"&&source.Count>0)nodes.Add(new Game.Areas.Node(source[0],float.MinValue));EntityManager.AddComponent<Updated>(e);
        }
        private bool ReadPreview(out string signature)
        {
            var op=m_Operation;op.Errors.Clear();op.Warnings.Clear();m_Candidates.Clear();void Read(EntityQuery q,JArray dest,string fallback){using(var es=q.ToEntityArray(Allocator.Temp))foreach(var e in es)if(!dest.Any(x=>(string)x==fallback))dest.Add(fallback);}Read(m_ErrorQuery,op.Errors,"GAME_VALIDATION_ERROR");Read(m_WarningQuery,op.Warnings,"GAME_VALIDATION_WARNING");using(var es=m_DistrictTempQuery.ToEntityArray(Allocator.Temp))foreach(var e in es){var t=EntityManager.GetComponentData<Temp>(e);if((t.m_Flags&TempFlags.Cancel)!=0)continue;if(op.Type=="create"?t.m_Original==Entity.Null:t.m_Original==op.Target)m_Candidates.Add(e);}m_Candidates.Sort((a,b)=>a.Index.CompareTo(b.Index));signature=string.Join(",",m_Candidates.Select(e=>{var n=EntityManager.GetBuffer<Game.Areas.Node>(e,true);return e.Index+":"+e.Version+":"+n.Length+":"+(int)EntityManager.GetComponentData<Temp>(e).m_Flags;}))+":"+op.Errors+":"+op.Warnings;return m_Candidates.Count>0;
        }
        private bool Verify()
        {
            var op=m_Operation;if(op.Type=="delete")return !EntityManager.Exists(op.Target)||EntityManager.HasComponent<Deleted>(op.Target);if(op.Type=="boundary"){if(!EntityManager.Exists(op.Target)||EntityManager.HasComponent<Temp>(op.Target)||EntityManager.HasComponent<Deleted>(op.Target)||!EntityManager.HasBuffer<Game.Areas.Node>(op.Target))return false;var n=EntityManager.GetBuffer<Game.Areas.Node>(op.Target,true);if(n.Length!=op.Points.Count)return false;for(int i=0;i<n.Length;i++)if(math.distance(n[i].m_Position.xz,op.Points[i].xz)>.25f)return false;op.Result=op.Target;return true;}foreach(var e in m_Candidates)if(EntityManager.Exists(e)&&!EntityManager.HasComponent<Temp>(e)&&!EntityManager.HasComponent<Deleted>(e)&&EntityManager.HasComponent<District>(e)){op.Result=e;return true;}return false;
        }
        private void DestroyDefinitions(){foreach(var e in m_Definitions)if(EntityManager.Exists(e))EntityManager.DestroyEntity(e);m_Definitions.Clear();}
        private void Fail(string reason){if(m_Operation==null)return;m_Operation.State=m_Operation.ApplyDispatched?"outcome_unknown":"failed";m_Operation.Error=reason;Mod.log.Warn("District operation "+m_Operation.Id+": "+reason);Finish();}
        private void Finish(){DestroyDefinitions();applyMode=ApplyMode.Clear;m_Operation=null;if(m_ToolSystem.activeTool==this)m_ToolSystem.activeTool=m_DefaultToolSystem;}
    }
}
