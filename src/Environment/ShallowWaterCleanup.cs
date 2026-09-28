using System;
using System.Collections.Generic;
using Game.Simulation;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Mathematics;
using UnityEngine;
using UnityEngine.Rendering;

namespace CityWeaver
{
    // Uses bounded GPU texture copies, never WaterSystem.Reset or terrain brushes.
    internal static class ShallowWaterCleanup
    {
        internal static Color[] Read(RenderTexture source, RectInt rect)
        {
            var previous = RenderTexture.active;
            var copy = new Texture2D(rect.width, rect.height, TextureFormat.RGBAFloat, false, true);
            try
            {
                RenderTexture.active = source;
                copy.ReadPixels(new Rect(rect.x, rect.y, rect.width, rect.height), 0, 0, false);
                return copy.GetPixels();
            }
            finally { RenderTexture.active = previous; UnityEngine.Object.Destroy(copy); }
        }

        internal static RectInt Region(TerrainOperation op, WaterSystem water)
        {
            float2 min = new float2(float.MaxValue), max = new float2(float.MinValue);
            foreach (var p in op.Points) { min = math.min(min, p.xz); max = math.max(max, p.xz); }
            min -= op.BrushSize / 2; max += op.BrushSize / 2;
            if (math.any(max - min > 2048)) throw new QueryException("WATER_AREA_TOO_LARGE", "Local cleanup bounds must fit within 2048 x 2048 metres.");
            var size = water.TextureSize; float cell = water.CellSize;
            int2 lo = math.max(0, (int2)math.floor(min / cell + (float2)size / 2));
            int2 hi = math.min(size, (int2)math.ceil(max / cell + (float2)size / 2));
            if (math.any(hi <= lo)) throw new QueryException("INVALID_WATER_BOUNDS", "Cleanup region is outside the water grid.");
            return new RectInt(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y);
        }

        internal static bool Contains(TerrainOperation op, float2 point, float cell)
        {
            // Entire cell must fit in the swept brush, not just its centre.
            for (int i = 0; i < op.Points.Count; i++)
            {
                float2 a = op.Points[i].xz, b = op.Points[math.max(0, i - 1)].xz;
                if (ShallowWaterSelection.WithinSegment(point.x, point.y, a.x, a.y, b.x, b.y, op.BrushSize, cell)) return true;
            }
            return false;
        }

        internal static void Capture(TerrainOperation op, World world)
        {
            var water = world.GetExistingSystemManaged<WaterSystem>();
            if (water.UseLegacyWaterSources || !(water.WaterSimulation is WaterSimulation)) throw new QueryException("WATER_MODE_UNSUPPORTED", "Local cleanup requires the current water simulation.");
            var rect = Region(op, water); op.WaterRegion = rect;
            if (water.WaterTexture.graphicsFormat != UnityEngine.Experimental.Rendering.GraphicsFormat.R32G32B32A32_SFloat ||
                water.WaterRenderTexture.graphicsFormat != water.WaterTexture.graphicsFormat ||
                (SystemInfo.copyTextureSupport & CopyTextureSupport.DifferentTypes) == 0)
                throw new QueryException("WATER_TEXTURE_UNSUPPORTED", "Exact local water texture copies are unavailable.");
            var current = Read(water.WaterTexture, rect);
            float cell = water.CellSize; var size = water.TextureSize;
            for (int i = 0; i < current.Length; i++)
            {
                var p = (new float2(rect.x + i % rect.width + .5f, rect.y + i / rect.width + .5f) - (float2)size / 2) * cell;
                if (!Contains(op, p, cell)) continue;
                float depth = current[i].r;
                if (!ShallowWaterSelection.Eligible(depth, op.MaxWaterDepth)) continue;
                op.ShallowCells.Add(i); op.ShallowDepths.Add(depth);
                op.WaterVolume += depth * cell * cell;
            }
            op.WaterCellSize = cell;
        }

        internal static void Apply(TerrainOperation op, World world)
        {
            var water = world.GetExistingSystemManaged<WaterSystem>();
            var rect = Region(op, water);
            if (water.UseLegacyWaterSources || !rect.Equals(op.WaterRegion)) throw new QueryException("WATER_PREVIEW_STALE", "Water layout changed; create a new preview.");
            var current = Read(water.WaterTexture, rect);
            for (int j = 0; j < op.ShallowCells.Count; j++)
            {
                int i = op.ShallowCells[j];
                if (!math.isfinite(current[i].r) ||
                    math.abs(current[i].r - op.ShallowDepths[j]) > .001f ||
                    current[i].r > op.MaxWaterDepth)
                    throw new QueryException("WATER_PREVIEW_STALE", "Selected water depths changed; create a new preview.");
            }
            var depths = water.GetDepths(out var dependencies); dependencies.Complete();
            if (!depths.IsCreated || depths.Length != water.TextureSize.x * water.TextureSize.y)
                throw new QueryException("WATER_LAYOUT_UNAVAILABLE", "CPU and GPU water grids do not match.");
            var zero = new Texture2D(rect.width, 1, TextureFormat.RGBAFloat, false, true);
            try
            {
                zero.SetPixels(new Color[rect.width]); zero.Apply(false, false);
                op.ApplyDispatched = true;
                for (int j = 0; j < op.ShallowCells.Count;)
                {
                    int start = op.ShallowCells[j], count = 1;
                    while (j + count < op.ShallowCells.Count && op.ShallowCells[j + count] == start + count && (start + count) / rect.width == start / rect.width) count++;
                    int x = rect.x + start % rect.width, y = rect.y + start / rect.width;
                    Graphics.CopyTexture(zero, 0, 0, 0, 0, count, 1, water.WaterTexture, 0, 0, x, y);
                    for (int k = 0; k < count; k++) depths[y * water.TextureSize.x + x + k] = default;
                    j += count;
                }
                // Render texture stores derived surface height, not depth. Rebuild it via
                // the native conversion kernel rather than zeroing its channels.
                using (var commands = new CommandBuffer { name = "CityWeaver local water render refresh" })
                {
                    ((WaterSimulation)water.WaterSimulation).CopyToHeightmapStep(commands);
                    Graphics.ExecuteCommandBuffer(commands);
                }
                var after = Read(water.WaterTexture, rect);
                foreach (int i in op.ShallowCells)
                    if (after[i].r != 0) throw new QueryException("WATER_READBACK_FAILED", "GPU readback did not confirm cleared cells.");
                op.ClearedWaterCells = op.ShallowCells.Count;
                op.ChangeObserved = op.ClearedWaterCells > 0;
                op.State = "completed";
            }
            finally { UnityEngine.Object.Destroy(zero); }
        }
    }
}
