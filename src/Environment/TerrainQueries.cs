using System;
using System.Collections.Generic;
using System.Linq;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed class TerrainOperation
    {
        public string Id = Guid.NewGuid().ToString("N"), Session, RequestId, Fingerprint;
        public string Mode, State = "preview_ready", Error, CommitRequestId;
        public readonly List<float3> Points = new List<float3>();
        public readonly List<float> BeforeHeights = new List<float>(), AfterHeights = new List<float>();
        public readonly List<float3> VerificationPoints = new List<float3>();
        public readonly List<float> VerificationBefore = new List<float>(), VerificationAfter = new List<float>();
        public bool? ChangeObserved;
        public float BrushSize, Strength, TargetHeight, StartHeight;
        public float Amount;
        public int Passes;
        public int LandHeightCells, WaterHeightCells;
        public bool ClearWater, RemoveWaterSources;
        public int ClearedWaterCells, RemovedWaterSources;
        public DateTime Created = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5);
        public bool CommitRequested, ApplyDispatched, CancelRequested;
        public bool Terminal => State == "completed" || State == "failed" || State == "cancelled" || State == "expired" || State == "outcome_unknown";

        private static JObject Point(float3 p, float height) => new JObject { ["x"] = p.x, ["z"] = p.z, ["height_m"] = height };
        public JObject Json()
        {
            var path = new JArray();
            for (int i = 0; i < Points.Count; i++) path.Add(Point(Points[i], i < BeforeHeights.Count ? BeforeHeights[i] : Points[i].y));
            var after = new JArray();
            for (int i = 0; i < Points.Count && i < AfterHeights.Count; i++) after.Add(Point(Points[i], AfterHeights[i]));
            var result = new JObject {
                ["operation_id"] = Id, ["mode"] = Mode, ["state"] = State,
                ["brush_size_m"] = BrushSize, ["strength"] = Strength, ["passes"] = Passes,
                ["amount_m"] = Mode == "raise_land" ? new JValue(Amount) : JValue.CreateNull(),
                ["land_height_cells"] = LandHeightCells, ["water_height_cells"] = WaterHeightCells,
                ["clear_water"] = Mode == "flatten_map" ? new JValue(ClearWater) : JValue.CreateNull(),
                ["remove_water_sources"] = Mode == "flatten_map" ? new JValue(RemoveWaterSources) : JValue.CreateNull(),
                ["cleared_water_cells"] = ClearedWaterCells, ["removed_water_sources"] = RemovedWaterSources,
                ["path"] = path, ["target_height_m"] = Mode == "level" || Mode == "slope" || Mode == "flatten_map" ? new JValue(TargetHeight) : JValue.CreateNull(),
                ["start_height_m"] = Mode == "slope" ? new JValue(StartHeight) : JValue.CreateNull(),
                ["cost"] = 0, ["preview_kind"] = "validated_plan_with_live_baseline_samples",
                ["native_visual_preview_available"] = false, ["expires_at_utc"] = Expires.ToString("O"),
                ["apply_dispatched"] = ApplyDispatched, ["after"] = after,
                ["change_observed"] = ChangeObserved.HasValue ? new JValue(ChangeObserved.Value) : JValue.CreateNull(),
                ["error"] = Error == null ? JValue.CreateNull() : new JValue(Error)
            };
            if (AfterHeights.Count == BeforeHeights.Count && BeforeHeights.Count != 0)
            {
                var deltas = AfterHeights.Zip(BeforeHeights, (a, b) => a - b).ToArray();
                result["observed_delta_m"] = new JObject { ["min"] = deltas.Min(), ["max"] = deltas.Max(), ["mean"] = deltas.Average() };
            }
            return result;
        }
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, TerrainOperation> m_TerrainOperations = new Dictionary<string, TerrainOperation>();
        private readonly Dictionary<string, string> m_TerrainRequestIds = new Dictionary<string, string>();
        private McpTerrainToolSystem TerrainTool(World world) => world.GetExistingSystemManaged<McpTerrainToolSystem>() ?? throw new QueryException("TERRAIN_TOOL_UNAVAILABLE", "Terrain tool was not initialized.");

        private void ResetTerrainOperations()
        {
            var world = World.DefaultGameObjectInjectionWorld;
            if (world != null && world.IsCreated) world.GetExistingSystemManaged<McpTerrainToolSystem>()?.AbortForLoading();
            m_TerrainOperations.Clear(); m_TerrainRequestIds.Clear();
        }

        private static float TerrainNumber(JObject args, string name, float fallback, float min, float max, bool required = false)
        {
            var token = args[name];
            if (token == null) { if (required) throw new QueryException("INVALID_ARGUMENT", name + " is required."); return fallback; }
            if ((token.Type != JTokenType.Float && token.Type != JTokenType.Integer) || !float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) || !math.isfinite(value) || value < min || value > max)
                throw new QueryException("INVALID_ARGUMENT", name + " must be a finite number from " + min + " to " + max + ".");
            return value;
        }

        private static bool TerrainBool(JObject args, string name, bool fallback)
        {
            var token = args[name];
            if (token == null) return fallback;
            if (token.Type != JTokenType.Boolean) throw new QueryException("INVALID_ARGUMENT", name + " must be boolean.");
            return (bool)token;
        }

        private static float3 TerrainPoint(JToken token, string key)
        {
            if (!(token is JObject point)) throw new QueryException("INVALID_ARGUMENT", key + " must contain x and z.");
            return new float3(ReadCoordinate(point, key, "x"), 0, ReadCoordinate(point, key, "z"));
        }

        private static List<float> SampleTerrain(TerrainHeightData heights, IList<float3> points)
        {
            var values = new List<float>(points.Count);
            for (int i = 0; i < points.Count; i++)
            {
                var point = points[i]; var value = TerrainUtils.SampleHeight(ref heights, point);
                if (!math.isfinite(value)) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain height is unavailable at a requested point.");
                values.Add(value);
            }
            return values;
        }

        private JObject SampleTerrain(JObject args, World world)
        {
            if (!(args["points"] is JArray input) || input.Count < 1 || input.Count > 256) throw new QueryException("INVALID_ARGUMENT", "points must contain 1..256 coordinates.");
            var points = input.Select((token, i) => TerrainPoint(token, "points[" + i + "]")).ToList();
            var data = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            if (!data.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            var values = SampleTerrain(data, points); var items = new JArray();
            for (int i = 0; i < points.Count; i++) items.Add(new JObject { ["x"] = points[i].x, ["z"] = points[i].z, ["height_m"] = values[i] });
            return new JObject { ["count"] = items.Count, ["items"] = items, ["source"] = "TerrainSystem.GetHeightData(true)", ["values_are_live"] = true };
        }

        private JObject PreviewTerrain(JObject args, World world)
        {
            var key = RequestKey(args); var mode = ((string)args["mode"] ?? "").ToLowerInvariant();
            if (!new[] { "raise", "lower", "level", "smooth", "slope", "raise_land", "flatten_map" }.Contains(mode)) throw new QueryException("INVALID_ARGUMENT", "mode must be raise, lower, level, smooth, slope, raise_land, or flatten_map.");
            var fingerprint = new JObject { ["mode"] = mode, ["points"] = args["points"]?.DeepClone(), ["brush_size_m"] = args["brush_size_m"]?.DeepClone(), ["strength"] = args["strength"]?.DeepClone(), ["passes"] = args["passes"]?.DeepClone(), ["target_height_m"] = args["target_height_m"]?.DeepClone(), ["start_height_m"] = args["start_height_m"]?.DeepClone(), ["amount_m"] = args["amount_m"]?.DeepClone(), ["clear_water"] = args["clear_water"]?.DeepClone(), ["remove_water_sources"] = args["remove_water_sources"]?.DeepClone() }.ToString(Formatting.None);
            if (m_TerrainRequestIds.TryGetValue(key, out var oldId))
            {
                var old = m_TerrainOperations[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "request_id already belongs to another terrain operation.");
                return old.Json();
            }
            if (m_TerrainOperations.Count >= 128) throw new QueryException("TERRAIN_OPERATION_LIMIT", "This city session has reached 128 terrain operations; reload the city to reset the journal.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before previewing terrain changes.");
            var tool = TerrainTool(world); var tools = world.GetExistingSystemManaged<ToolSystem>();
            if (tool.Busy || !(tools.activeTool is DefaultToolSystem)) throw new QueryException("TOOL_BUSY", "Finish the current tool operation and select the default selection tool first.");
            if (!(args["points"] is JArray input) || input.Count < 1 || input.Count > 64) throw new QueryException("INVALID_ARGUMENT", "points must contain 1..64 coordinates.");
            if (mode == "slope" && input.Count < 2) throw new QueryException("INVALID_ARGUMENT", "slope requires at least two path points.");
            var operation = new TerrainOperation { Session = m_Session, RequestId = key, Fingerprint = fingerprint, Mode = mode,
                BrushSize = TerrainNumber(args, "brush_size_m", 100, 8, 1000), Strength = TerrainNumber(args, "strength", 0.5f, 0.01f, 1),
                Passes = ComponentInspector.Int(args, "passes", 1, 1, 32) };
            for (int i = 0; i < input.Count; i++) operation.Points.Add(TerrainPoint(input[i], "points[" + i + "]"));
            var terrain = world.GetExistingSystemManaged<TerrainSystem>(); var heights = terrain.GetHeightData(true);
            if (!heights.isCreated) throw new QueryException("TERRAIN_UNAVAILABLE", "Terrain CPU heights are not ready.");
            operation.BeforeHeights.AddRange(SampleTerrain(heights, operation.Points));
            for (int i = 0; i < operation.Points.Count; i++) { var p = operation.Points[i]; p.y = operation.BeforeHeights[i]; operation.Points[i] = p; }
            var verificationOffset = operation.BrushSize * 0.25f;
            foreach (var point in operation.Points)
            {
                operation.VerificationPoints.Add(point);
                foreach (var delta in new[] { new float2(verificationOffset, 0), new float2(-verificationOffset, 0), new float2(0, verificationOffset), new float2(0, -verificationOffset) })
                {
                    var xz = point.xz + delta;
                    if (math.all(math.abs(xz) <= 7168)) operation.VerificationPoints.Add(new float3(xz.x, point.y, xz.y));
                }
            }
            operation.VerificationBefore.AddRange(SampleTerrain(heights, operation.VerificationPoints));
            operation.TargetHeight = mode == "level" || mode == "slope" || mode == "flatten_map" ? TerrainNumber(args, "target_height_m", 0, -1024, 4096, true) : 0;
            operation.StartHeight = mode == "slope" ? TerrainNumber(args, "start_height_m", 0, -1024, 4096, true) : 0;
            operation.Amount = mode == "raise_land" ? TerrainNumber(args, "amount_m", 0, 0.0625f, 500, true) : 0;
            operation.ClearWater = mode == "flatten_map" && TerrainBool(args, "clear_water", true);
            operation.RemoveWaterSources = mode == "flatten_map" && TerrainBool(args, "remove_water_sources", true);
            if (mode == "flatten_map" && operation.ClearWater && operation.TargetHeight <= world.GetExistingSystemManaged<WaterSystem>().SeaLevel)
                throw new QueryException("TARGET_BELOW_SEA_LEVEL", "A dry flattened map requires target_height_m above the current sea level.");
            m_TerrainOperations.Add(operation.Id, operation); m_TerrainRequestIds.Add(key, operation.Id);
            return operation.Json();
        }

        private TerrainOperation TerrainOperationById(JObject args)
        {
            if (!m_TerrainOperations.TryGetValue((string)args["operation_id"] ?? "", out var operation) || operation.Session != m_Session)
                throw new QueryException("TERRAIN_OPERATION_NOT_FOUND", "Unknown terrain operation in this city session.");
            return operation;
        }

        private JObject ApplyTerrain(JObject args, World world)
        {
            var op = TerrainOperationById(args); var key = RequestKey(args);
            if (op.CommitRequestId != null)
            {
                if (op.CommitRequestId != key) throw new QueryException("IDEMPOTENCY_CONFLICT", "This operation already has another apply request; poll it instead.");
                return op.Json();
            }
            if (op.State != "preview_ready" || op.CancelRequested || DateTime.UtcNow >= op.Expires) throw new QueryException("TERRAIN_NOT_READY", "Wait for a valid unexpired terrain preview before applying.");
            if (world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed != 0) throw new QueryException("CITY_MUST_BE_PAUSED", "Pause the city before applying terrain changes.");
            op.CommitRequestId = key; op.CommitRequested = true; op.State = "commit_queued";
            try { TerrainTool(world).Begin(op); }
            catch { op.CommitRequestId = null; op.CommitRequested = false; op.State = "preview_ready"; throw; }
            return op.Json();
        }

        private JObject CancelTerrain(JObject args)
        {
            var op = TerrainOperationById(args);
            if (op.ApplyDispatched) throw new QueryException("ALREADY_COMMITTED", "Terrain application has already started and cannot be cancelled.");
            if (!op.Terminal) { op.CancelRequested = true; op.State = "cancelled"; }
            return op.Json();
        }
    }
}
