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
    public sealed partial class McpBuildingAreaToolSystem : ToolBaseSystem
    {
        private BuildingAreaOperation m_Operation;
        private readonly List<Entity> m_Definitions = new List<Entity>(), m_Candidates = new List<Entity>();
        private EntityQuery m_TempQuery, m_AreaTempQuery, m_WarningQuery;
        private int m_Phase, m_Ticks, m_StableTicks;
        private string m_LastSignature;

        public override string toolID => "McpBuildingArea";
        public bool Busy => m_Operation != null;
        public override PrefabBase GetPrefab() => m_Operation == null ? null : m_PrefabSystem.GetPrefab<PrefabBase>(m_Operation.Prefab);
        public override bool TrySetPrefab(PrefabBase prefab) => false;

        protected override void OnCreate()
        {
            base.OnCreate();
            m_TempQuery = GetEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Temp>() }, None = new[] { ComponentType.ReadOnly<Deleted>() } });
            m_AreaTempQuery = GetEntityQuery(new EntityQueryDesc { All = new[] { ComponentType.ReadOnly<Temp>(), ComponentType.ReadOnly<Area>(), ComponentType.ReadOnly<Game.Areas.Node>(), ComponentType.ReadOnly<Owner>(), ComponentType.ReadOnly<PrefabRef>() }, None = new[] { ComponentType.ReadOnly<Deleted>() } });
            m_WarningQuery = GetEntityQuery(ComponentType.ReadOnly<Warning>());
        }

        public void Begin(BuildingAreaOperation operation)
        {
            if (Busy || !m_TempQuery.IsEmptyIgnoreFilter) throw new QueryException("TOOL_BUSY", "Another native tool preview is active.");
            m_Operation = operation; m_Phase = m_Ticks = m_StableTicks = 0; m_LastSignature = null; m_Candidates.Clear();
            applyMode = ApplyMode.Clear; m_ToolSystem.activeTool = this; Mod.log.Info("Building-area preview queued: " + operation.Id + " type=" + operation.Type);
        }

        public void AbortForLoading()
        {
            if (m_Operation != null && !m_Operation.Terminal) { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "CITY_SESSION_CHANGED"; }
            Finish();
        }

        protected override void OnStopRunning()
        {
            if (m_Operation != null && !m_Operation.Terminal) { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "USER_CHANGED_TOOL"; }
            DestroyDefinitions(); m_Operation = null; applyMode = ApplyMode.Clear; base.OnStopRunning();
        }

        protected override JobHandle OnUpdate(JobHandle deps)
        {
            deps.Complete(); EntityManager.CompleteAllTrackedJobs();
            if (m_Operation == null) { applyMode = ApplyMode.Clear; return default; }
            try { Tick(); }
            catch (Exception exception)
            {
                Mod.log.Error(exception, "Building-area operation failed: " + m_Operation?.Id);
                Fail(m_Operation != null && m_Operation.ApplyDispatched ? "APPLY_OUTCOME_UNKNOWN" : "BUILDING_AREA_INTERNAL_ERROR");
            }
            return default;
        }

        private bool SnapshotValid()
        {
            var operation = m_Operation;
            if (!EntityManager.Exists(operation.Owner) || EntityManager.HasComponent<Deleted>(operation.Owner) || EntityManager.HasComponent<Temp>(operation.Owner) || !EntityManager.HasComponent<Game.Buildings.Building>(operation.Owner) || !EntityManager.HasComponent<PrefabRef>(operation.Owner) || !EntityManager.HasBuffer<Game.Areas.SubArea>(operation.Owner)) return false;
            if (EntityManager.GetComponentData<PrefabRef>(operation.Owner).m_Prefab != operation.OwnerPrefab || !EntityManager.HasBuffer<Game.Prefabs.SubArea>(operation.OwnerPrefab)) return false;
            var allowed = EntityManager.GetBuffer<Game.Prefabs.SubArea>(operation.OwnerPrefab, true); bool compatible = false;
            for (int i = 0; i < allowed.Length; i++) if (allowed[i].m_Prefab == operation.Prefab) { compatible = true; break; }
            if (!compatible || operation.Target == Entity.Null) return compatible;
            if (!GameQueryService.PermanentBuildingArea(EntityManager, operation.Target) || EntityManager.GetComponentData<Owner>(operation.Target).m_Owner != operation.Owner || EntityManager.GetComponentData<PrefabRef>(operation.Target).m_Prefab != operation.Prefab) return false;
            var nodes = EntityManager.GetBuffer<Game.Areas.Node>(operation.Target, true);
            if (nodes.Length != operation.OriginalPoints.Count) return false;
            for (int i = 0; i < nodes.Length; i++) if (math.distance(nodes[i].m_Position, operation.OriginalPoints[i]) > .01f) return false;
            return true;
        }

        private void Tick()
        {
            var operation = m_Operation; ++m_Ticks;
            if (!operation.ApplyDispatched && (operation.CancelRequested || DateTime.UtcNow >= operation.Expires)) { operation.State = operation.CancelRequested ? "cancelled" : "expired"; Finish(); return; }
            if (m_Phase == 0)
            {
                if (m_Ticks < 3) return;
                if (!SnapshotValid()) { Fail("TARGET_CHANGED"); return; }
                CreateDefinition(); operation.State = "generating_preview"; applyMode = ApplyMode.None; m_Phase = 1; m_Ticks = 0; return;
            }
            if (m_Phase == 1) { DestroyDefinitions(); applyMode = ApplyMode.None; m_Phase = 2; m_Ticks = 0; return; }
            if (m_Phase == 2)
            {
                if (m_Ticks < 5) return;
                if (!ReadPreview(out var signature)) { if (m_Ticks < 120) return; Fail("NO_GENERATED_BUILDING_AREA"); return; }
                m_StableTicks = signature == m_LastSignature ? m_StableTicks + 1 : 0; m_LastSignature = signature;
                if (m_StableTicks < 3) return;
                if (operation.Errors.Count > 0 || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply()) { Fail("GAME_REJECTED_BUILDING_AREA"); return; }
                operation.State = "preview_ready"; m_Phase = 3; m_Ticks = 0; Mod.log.Info("Building-area preview ready: " + operation.Id); return;
            }
            if (m_Phase == 3)
            {
                applyMode = ApplyMode.None; if (!operation.CommitRequested) return;
                if (!SnapshotValid()) { Fail("TARGET_CHANGED"); return; }
                if (!ReadPreview(out var signature) || signature != m_LastSignature || operation.Errors.Count > 0 || !m_ErrorQuery.IsEmptyIgnoreFilter || !GetAllowApply()) { Fail("PREVIEW_NO_LONGER_VALID"); return; }
                if (World.GetExistingSystemManaged<Game.Simulation.SimulationSystem>().selectedSpeed != 0) { Fail("CITY_MUST_BE_PAUSED"); return; }
                operation.ApplyDispatched = true; operation.State = "applying"; applyMode = ApplyMode.Apply; m_Phase = 4; m_Ticks = 0; return;
            }
            if (m_Phase == 4)
            {
                applyMode = ApplyMode.None; if (m_Ticks < 8) return;
                if (Verify()) { operation.State = "completed"; Finish(); return; }
                if (m_Ticks >= 120) Fail("APPLY_OUTCOME_UNKNOWN");
            }
        }

        private void CreateDefinition()
        {
            var operation = m_Operation; var definition = EntityManager.CreateEntity(); m_Definitions.Add(definition);
            var flags = operation.Type == "delete" ? CreationFlags.Delete : operation.Type == "boundary" ? CreationFlags.Relocate : 0;
            EntityManager.AddComponentData(definition, new CreationDefinition { m_Prefab = operation.Prefab, m_Original = operation.Target, m_Owner = operation.Owner, m_Flags = flags });
            var nodes = EntityManager.AddBuffer<Game.Areas.Node>(definition); var source = operation.Type == "delete" ? operation.OriginalPoints : operation.Points;
            foreach (var point in source) nodes.Add(new Game.Areas.Node(point, float.MinValue));
            if (operation.Type == "create" && source.Count > 0) nodes.Add(new Game.Areas.Node(source[0], float.MinValue));
            EntityManager.AddComponent<Updated>(definition);
        }

        private bool ReadPreview(out string signature)
        {
            var operation = m_Operation; operation.Errors.Clear(); operation.Warnings.Clear(); operation.Cost = 0; m_Candidates.Clear();
            void ReadMessages(EntityQuery query, JArray destination, string fallback)
            {
                using (var entities = query.ToEntityArray(Allocator.Temp)) foreach (var entity in entities) if (!destination.Any(token => (string)token == fallback)) destination.Add(fallback);
            }
            ReadMessages(m_ErrorQuery, operation.Errors, "GAME_VALIDATION_ERROR"); ReadMessages(m_WarningQuery, operation.Warnings, "GAME_VALIDATION_WARNING");
            using (var entities = m_AreaTempQuery.ToEntityArray(Allocator.Temp)) foreach (var entity in entities)
            {
                var temp = EntityManager.GetComponentData<Temp>(entity); if ((temp.m_Flags & TempFlags.Cancel) != 0) continue;
                if (EntityManager.GetComponentData<PrefabRef>(entity).m_Prefab != operation.Prefab || EntityManager.GetComponentData<Owner>(entity).m_Owner != operation.Owner) continue;
                if (operation.Type == "create" ? temp.m_Original != Entity.Null : temp.m_Original != operation.Target) continue;
                m_Candidates.Add(entity); operation.Cost += temp.m_Cost;
            }
            m_Candidates.Sort((a, b) => a.Index.CompareTo(b.Index));
            signature = string.Join(",", m_Candidates.Select(entity => { var nodes = EntityManager.GetBuffer<Game.Areas.Node>(entity, true); var temp = EntityManager.GetComponentData<Temp>(entity); return entity.Index + ":" + entity.Version + ":" + nodes.Length + ":" + (int)temp.m_Flags; })) + ":" + operation.Cost + ":" + operation.Errors + ":" + operation.Warnings;
            return m_Candidates.Count > 0;
        }

        private bool Verify()
        {
            var operation = m_Operation;
            if (operation.Type == "delete") return !EntityManager.Exists(operation.Target) || EntityManager.HasComponent<Deleted>(operation.Target);
            if (operation.Type == "boundary")
            {
                if (!GameQueryService.PermanentBuildingArea(EntityManager, operation.Target) || EntityManager.GetComponentData<Owner>(operation.Target).m_Owner != operation.Owner || EntityManager.GetComponentData<PrefabRef>(operation.Target).m_Prefab != operation.Prefab) return false;
                var nodes = EntityManager.GetBuffer<Game.Areas.Node>(operation.Target, true); if (nodes.Length != operation.Points.Count) return false;
                for (int i = 0; i < nodes.Length; i++) if (math.distance(nodes[i].m_Position.xz, operation.Points[i].xz) > .25f) return false;
                operation.Result = operation.Target; return true;
            }
            foreach (var entity in m_Candidates)
                if (GameQueryService.PermanentBuildingArea(EntityManager, entity) && EntityManager.GetComponentData<Owner>(entity).m_Owner == operation.Owner && EntityManager.GetComponentData<PrefabRef>(entity).m_Prefab == operation.Prefab) { operation.Result = entity; return true; }
            return false;
        }

        private void DestroyDefinitions()
        {
            foreach (var entity in m_Definitions) if (EntityManager.Exists(entity)) EntityManager.DestroyEntity(entity);
            m_Definitions.Clear();
        }

        private void Fail(string reason)
        {
            if (m_Operation == null) return;
            m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "failed"; m_Operation.Error = reason;
            Mod.log.Warn("Building-area operation " + m_Operation.Id + ": " + reason); Finish();
        }

        private void Finish()
        {
            DestroyDefinitions(); applyMode = ApplyMode.Clear; m_Operation = null;
            if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem;
        }
    }
}
