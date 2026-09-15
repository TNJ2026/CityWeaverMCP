using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.Mathematics;
using Game.Common;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Unity.Collections;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;
using UnityEngine;

namespace CitiesSkylines2Mod
{
    public sealed partial class McpTerrainToolSystem : ToolBaseSystem
    {
        private TerrainOperation m_Operation;
        private EntityQuery m_BrushQuery, m_TerraformQuery, m_TempBrushQuery, m_WaterSourceQuery;
        private BrushPrefab m_BrushPrefab;
        private readonly List<Entity> m_Definitions = new List<Entity>();
        private int m_Phase, m_Ticks;
        public override string toolID => "McpTerrain";
        public override bool brushing => true;
        public bool Busy => m_Operation != null;
        public override PrefabBase GetPrefab() => null;
        public override bool TrySetPrefab(PrefabBase prefab) => false;

        protected override void OnCreate()
        {
            base.OnCreate();
            m_BrushQuery = GetBrushQuery();
            m_TerraformQuery = GetEntityQuery(ComponentType.ReadOnly<TerraformingData>(), ComponentType.ReadOnly<PrefabData>());
            m_TempBrushQuery = GetEntityQuery(ComponentType.ReadOnly<Brush>(), ComponentType.ReadOnly<Temp>());
            m_WaterSourceQuery = GetEntityQuery(ComponentType.ReadOnly<Game.Simulation.WaterSourceData>(), ComponentType.Exclude<Temp>(), ComponentType.Exclude<Deleted>());
        }

        public void Begin(TerrainOperation operation)
        {
            if (Busy) throw new QueryException("TOOL_BUSY", "Another terrain operation is active.");
            m_Operation = operation; m_Phase = 0; m_Ticks = 0; applyMode = ApplyMode.Clear;
            m_ToolSystem.activeTool = this;
            Mod.log.Info("Terrain apply queued: " + operation.Id + " mode=" + operation.Mode);
        }

        public void AbortForLoading()
        {
            if (m_Operation != null && !m_Operation.Terminal) { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "CITY_SESSION_CHANGED"; }
            DestroyDefinitions(); m_Operation = null; applyMode = ApplyMode.Clear;
            if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem;
        }

        protected override void OnStopRunning()
        {
            if (m_Operation != null)
            {
                if (!m_Operation.Terminal) { m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "cancelled"; m_Operation.Error = "USER_CHANGED_TOOL"; }
                DestroyDefinitions(); m_Operation = null;
            }
            applyMode = ApplyMode.Clear; base.OnStopRunning();
        }

        protected override JobHandle OnUpdate(JobHandle inputDeps)
        {
            inputDeps.Complete(); EntityManager.CompleteAllTrackedJobs();
            if (m_Operation == null) { applyMode = ApplyMode.Clear; return default; }
            try { Tick(); }
            catch (Exception e) { Mod.log.Error(e, "Terrain operation failed: " + m_Operation?.Id); Fail(m_Operation != null && m_Operation.ApplyDispatched ? "APPLY_OUTCOME_UNKNOWN" : "TERRAIN_INTERNAL_ERROR"); }
            return default;
        }

        private void Tick()
        {
            var op = m_Operation; ++m_Ticks;
            if (!op.ApplyDispatched && (op.CancelRequested || DateTime.UtcNow >= op.Expires)) { op.State = op.CancelRequested ? "cancelled" : "expired"; Finish(); return; }
            if (m_Phase == 0)
            {
                if (m_Ticks < 3) return;
                if (op.Mode == "raise_land")
                {
                    ApplyLandShift(op);
                    op.ApplyDispatched = true; op.State = "applying"; m_Phase = 3; m_Ticks = 0;
                    Mod.log.Info("Terrain land-mask heightmap dispatched: " + op.Id + " land_cells=" + op.LandHeightCells + " water_cells=" + op.WaterHeightCells);
                    return;
                }
                if (op.Mode == "flatten_map")
                {
                    ApplyFlattenMap(op);
                    op.ApplyDispatched = true; op.State = "applying"; m_Phase = 3; m_Ticks = 0;
                    Mod.log.Info("Terrain flat heightmap dispatched: " + op.Id + " cells=" + op.LandHeightCells + " cleared_water_cells=" + op.ClearedWaterCells + " removed_sources=" + op.RemovedWaterSources);
                    return;
                }
                PreparePrefabs(op.Mode); CreateDefinitions(); EnsureCachedBrushData();
                op.State = "generating_brushes"; applyMode = ApplyMode.None; m_Phase = 1; m_Ticks = 0;
                Mod.log.Info("Terrain native brush definitions created: " + op.Id + " definitions=" + m_Definitions.Count); return;
            }
            if (m_Phase == 1)
            {
                DestroyDefinitions(); applyMode = ApplyMode.None;
                if (m_TempBrushQuery.IsEmptyIgnoreFilter) { if (m_Ticks < 120) return; Fail("NO_GENERATED_BRUSH"); return; }
                op.ApplyDispatched = true; op.State = "applying"; applyMode = ApplyMode.Apply; m_Phase = 2; m_Ticks = 0;
                Mod.log.Info("Terrain native brushes dispatched: " + op.Id + " brushes=" + m_TempBrushQuery.CalculateEntityCount()); return;
            }
            if (m_Phase == 2)
            {
                applyMode = ApplyMode.None; m_Phase = 3; m_Ticks = 0; return;
            }
            if (m_Phase == 3)
            {
                applyMode = ApplyMode.None; if (m_Ticks < 12) return;
                var terrain = World.GetExistingSystemManaged<TerrainSystem>(); var heights = terrain.GetHeightData(true);
                if (!heights.isCreated) { if (m_Ticks < 120) return; Fail("TERRAIN_READBACK_TIMEOUT"); return; }
                op.AfterHeights.Clear();
                for (int i = 0; i < op.Points.Count; i++) op.AfterHeights.Add(TerrainUtils.SampleHeight(ref heights, op.Points[i]));
                if (op.AfterHeights.Any(v => !math.isfinite(v))) { Fail("TERRAIN_READBACK_INVALID"); return; }
                op.VerificationAfter.Clear();
                for (int i = 0; i < op.VerificationPoints.Count; i++) op.VerificationAfter.Add(TerrainUtils.SampleHeight(ref heights, op.VerificationPoints[i]));
                if (op.VerificationAfter.Any(v => !math.isfinite(v))) { Fail("TERRAIN_READBACK_INVALID"); return; }
                bool changed = false;
                for (int i = 0; i < op.VerificationAfter.Count; i++) if (math.abs(op.VerificationAfter[i] - op.VerificationBefore[i]) >= 0.001f) { changed = true; break; }
                op.ChangeObserved = changed;
                op.State = "completed"; Mod.log.Info("Terrain operation completed: " + op.Id); Finish();
            }
        }

        private void ApplyLandShift(TerrainOperation op)
        {
            var terrain = World.GetExistingSystemManaged<TerrainSystem>();
            var heights = terrain.GetHeightData(true);
            if (!heights.isCreated || heights.resolution.x <= 2 || heights.resolution.z <= 2)
                throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var waterSystem = World.GetExistingSystemManaged<WaterSystem>();
            var water = waterSystem.GetDepths(out var waterDeps); waterDeps.Complete();
            if (!water.IsCreated || water.Length == 0) throw new QueryException("WATER_UNAVAILABLE", "Water depth mask is not ready.");

            int width = heights.resolution.x, height = heights.resolution.z;
            int waterSize = (int)math.round(math.sqrt(water.Length));
            if (waterSize * waterSize != water.Length) throw new QueryException("WATER_LAYOUT_UNAVAILABLE", "Water depth mask is not square.");
            var output = new NativeArray<ushort>(heights.heights.Length, Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            long land = 0, wet = 0;
            int delta = math.max(1, (int)math.round(op.Amount * heights.scale.y));
            for (int z = 0; z < height; z++)
            {
                int wz = math.clamp((int)((long)z * waterSize / height), 0, waterSize - 1);
                for (int x = 0; x < width; x++)
                {
                    int index = z * width + x;
                    int wx = math.clamp((int)((long)x * waterSize / width), 0, waterSize - 1);
                    ushort value = heights.heights[index];
                    if (water[wz * waterSize + wx].m_Depth <= 0.001f)
                    {
                        output[index] = (ushort)math.min(ushort.MaxValue, value + delta); land++;
                    }
                    else { output[index] = value; wet++; }
                }
            }
            var texture = new Texture2D(width, height, TextureFormat.R16, false, true) { name = "McpLandShift" };
            texture.SetPixelData(output, 0); texture.Apply(false, false);
            terrain.ReplaceHeightmap(texture); terrain.TriggerAsyncChange();
            UnityEngine.Object.Destroy(texture); output.Dispose();
            op.LandHeightCells = land > int.MaxValue ? int.MaxValue : (int)land;
            op.WaterHeightCells = wet > int.MaxValue ? int.MaxValue : (int)wet;
        }

        private void ApplyFlattenMap(TerrainOperation op)
        {
            var terrain = World.GetExistingSystemManaged<TerrainSystem>();
            var heights = terrain.GetHeightData(true);
            if (!heights.isCreated || heights.resolution.x <= 2 || heights.resolution.z <= 2)
                throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");

            int width = heights.resolution.x, height = heights.resolution.z;
            int raw = (int)math.round((op.TargetHeight + heights.offset.y) * heights.scale.y);
            if (raw < 0 || raw > ushort.MaxValue)
                throw new QueryException("TARGET_OUT_OF_HEIGHTMAP_RANGE", "Target height cannot be represented by the current terrain height scale.");
            var output = new NativeArray<ushort>(heights.heights.Length, Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            ushort value = (ushort)raw;
            for (int i = 0; i < output.Length; i++) output[i] = value;
            var texture = new Texture2D(width, height, TextureFormat.R16, false, true) { name = "McpFlatMap" };
            texture.SetPixelData(output, 0); texture.Apply(false, false);
            terrain.ReplaceHeightmap(texture); terrain.TriggerAsyncChange();
            UnityEngine.Object.Destroy(texture); output.Dispose();
            op.LandHeightCells = heights.heights.Length;

            if (!op.ClearWater && !op.RemoveWaterSources) return;
            var waterSystem = World.GetExistingSystemManaged<WaterSystem>();
            if (op.RemoveWaterSources)
            {
                m_WaterSourceQuery.CompleteDependency();
                using (var sources = m_WaterSourceQuery.ToEntityArray(Allocator.Temp))
                {
                    op.RemovedWaterSources = sources.Length;
                    for (int i = 0; i < sources.Length; i++) EntityManager.DestroyEntity(sources[i]);
                }
            }
            if (op.ClearWater)
            {
                var depths = waterSystem.GetDepths(out var waterDeps); waterDeps.Complete();
                if (!depths.IsCreated) throw new QueryException("WATER_UNAVAILABLE", "Water depth data is not ready.");
                int cleared = 0;
                for (int i = 0; i < depths.Length; i++)
                {
                    if (depths[i].m_Depth > 0.001f) cleared++;
                    depths[i] = default;
                }
                op.ClearedWaterCells = cleared;
                waterSystem.Reset();
            }
        }

        private void PreparePrefabs(string mode)
        {
            if (m_BrushPrefab == null) m_BrushPrefab = FindDefaultBrush(m_BrushQuery);
            if (m_BrushPrefab == null) throw new QueryException("BRUSH_UNAVAILABLE", "No terrain brush prefab is available.");
            brushType = m_BrushPrefab;
            var wanted = mode == "level" ? TerraformingType.Level : mode == "smooth" ? TerraformingType.Soften : mode == "slope" ? TerraformingType.Slope : TerraformingType.Shift;
            Entity found = Entity.Null;
            using (var entities = m_TerraformQuery.ToEntityArray(Allocator.Temp))
                foreach (var entity in entities) { var data = EntityManager.GetComponentData<TerraformingData>(entity); if (data.m_Target == TerraformingTarget.Height && data.m_Type == wanted) { found = entity; break; } }
            if (found == Entity.Null) throw new QueryException("TERRAFORMING_PREFAB_UNAVAILABLE", "The requested native height tool is unavailable.");
            m_TerrainPrefab = found;
        }
        private Entity m_TerrainPrefab;

        private void CreateDefinitions()
        {
            var op = m_Operation; m_Definitions.Clear(); var brush = m_PrefabSystem.GetEntity(m_BrushPrefab);
            float strength = op.Strength;
            if (op.Mode == "raise" || op.Mode == "lower" || op.Mode == "smooth")
            {
                float t = math.clamp(op.BrushSize / 5000f, 0, 1); strength *= math.lerp(0.4f, 1f, EaseUtils.OutSine(t));
            }
            if (op.Mode == "lower") strength = -strength;
            var target = op.Points[op.Points.Count - 1]; target.y = op.TargetHeight;
            var startSlope = op.Points[0]; startSlope.y = op.StartHeight;
            for (int pass = 0; pass < op.Passes; pass++)
            {
                if (op.Points.Count == 1) Create(op.Points[0], op.Points[0]);
                else for (int i = 1; i < op.Points.Count; i++) Create(op.Points[i - 1], op.Points[i]);
            }
            void Create(float3 a, float3 b)
            {
                var entity = EntityManager.CreateEntity(); m_Definitions.Add(entity);
                EntityManager.AddComponentData(entity, new CreationDefinition { m_Prefab = brush });
                EntityManager.AddComponentData(entity, new BrushDefinition { m_Tool = m_TerrainPrefab, m_Line = new Line3.Segment(a, b), m_Angle = 0,
                    m_Size = op.BrushSize, m_Strength = strength, m_Time = 0.05f, m_Target = target, m_Start = startSlope });
                EntityManager.AddComponent<Updated>(entity);
            }
        }

        private void DestroyDefinitions()
        {
            foreach (var entity in m_Definitions) if (entity != Entity.Null && EntityManager.Exists(entity)) EntityManager.DestroyEntity(entity);
            m_Definitions.Clear();
        }
        private void Fail(string reason) { if (m_Operation == null) return; m_Operation.State = m_Operation.ApplyDispatched ? "outcome_unknown" : "failed"; m_Operation.Error = reason; Mod.log.Warn("Terrain operation " + m_Operation.Id + ": " + reason); Finish(); }
        private void Finish() { DestroyDefinitions(); applyMode = ApplyMode.Clear; m_Operation = null; if (m_ToolSystem.activeTool == this) m_ToolSystem.activeTool = m_DefaultToolSystem; }
    }
}
