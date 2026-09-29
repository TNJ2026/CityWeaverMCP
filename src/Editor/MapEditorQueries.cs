using System;
using System.Collections.Generic;
using System.Linq;
using Game;
using Game.Areas;
using Game.Common;
using Game.SceneFlow;
using Game.Simulation;
using Game.Tools;
using Game.UI.Editor;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Jobs;
using Unity.Mathematics;

namespace CityWeaver
{
    internal sealed class MapResourceOperation
    {
        internal string Id = Guid.NewGuid().ToString("N"), Session, Request, Fingerprint, Resource, State = "preview_ready", Error;
        internal DateTime Expires = DateTime.UtcNow.AddMinutes(5);
        internal int Value, Width, Height;
        internal float2 CellSize;
        internal float2 Center;
        internal float Radius;
        internal readonly List<int> Cells = new List<int>();
        internal readonly List<int2> Before = new List<int2>();
        internal void Refresh() { if (State == "preview_ready" && DateTime.UtcNow >= Expires) State = "expired"; }
        internal JObject Json()
        {
            Refresh();
            return new JObject {
                ["operation_id"] = Id, ["session_id"] = Session, ["request_id"] = Request,
                ["state"] = State, ["resource"] = Resource, ["value"] = Value,
                ["center"] = new JObject { ["x"] = Center.x, ["z"] = Center.y }, ["radius_m"] = Radius,
                ["selected_cells"] = Cells.Count, ["selected_area_m2"] = Cells.Count * CellSize.x * CellSize.y,
                ["cell_size_m"] = new JObject { ["x"] = CellSize.x, ["z"] = CellSize.y },
                ["before_min"] = Before.Count == 0 ? 0 : Before.Min(v => v.x), ["before_max"] = Before.Count == 0 ? 0 : Before.Max(v => v.x),
                ["can_commit"] = State == "preview_ready", ["expires_at_utc"] = Expires.ToString("O"), ["error"] = Error,
                ["preview_kind"] = "fully_contained_resource_cells_with_live_baseline",
                ["note"] = "Editor-only native resource grid edit. Values are raw 0..10000 units, not percentages. Only selected resource changes; fish is water-derived and forests use vegetation tools. No automatic map save or undo."
            };
        }
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string, MapResourceOperation> m_MapResources = new Dictionary<string, MapResourceOperation>();
        private readonly Dictionary<string, string> m_MapResourceRequests = new Dictionary<string, string>();
        private bool IsEditorReady() => m_Loaded && !GameManager.instance.isGameLoading && GameManager.instance.gameMode == GameMode.Editor &&
            World.DefaultGameObjectInjectionWorld != null && World.DefaultGameObjectInjectionWorld.IsCreated &&
            World.DefaultGameObjectInjectionWorld.GetExistingSystemManaged<TerrainSystem>() != null;
        private void RequireEditor() { if (!IsEditorReady()) throw new QueryException("MAP_EDITOR_REQUIRED", "Load a map in the editor and wait for loading to finish."); }
        private void ResetMapResources() { m_MapResources.Clear(); m_MapResourceRequests.Clear(); }
        private static void RequireEditorIdle(World world)
        {
            RequirePaused(world);
            if (!(world.GetExistingSystemManaged<ToolSystem>()?.activeTool is DefaultToolSystem))
                throw new QueryException("TOOL_BUSY", "Return to the default selection tool before editing the map.");
        }
        private JObject EditorState(World world)
        {
            RequireEditor();
            var panel = world.GetExistingSystemManaged<EditorPanelUISystem>()?.activePanel;
            var terrain = world.GetExistingSystemManaged<TerrainSystem>().GetHeightData(true);
            return new JObject {
                ["editor_ready"] = true, ["terrain_ready"] = terrain.isCreated,
                ["active_panel_type"] = panel?.GetType().FullName, ["active_panel_tag"] = panel?.uiTag,
                ["active_tool"] = world.GetExistingSystemManaged<ToolSystem>()?.activeTool?.toolID,
                ["paused"] = world.GetExistingSystemManaged<SimulationSystem>()?.selectedSpeed == 0,
                ["supported_tools"] = new JArray(EditorAccessPolicy.Tools.OrderBy(x => x)),
                ["resource_types"] = new JArray("ore", "oil", "fertility", "groundwater"),
                ["map_save"] = "show_editor_save_panel opens the native save dialog; the player selects the file and confirms. No automatic overwrite, upload, or new-map creation.",
                ["limitations"] = "Native asset placement covers objects, stamps, networks and areas, including outside-connection objects. Non-placeable data requires specialized editors. Starting tiles and map metadata editing are not enabled. Fish derives from water; forest resources derive from trees."
            };
        }
        private JObject ShowEditorSavePanel(World world)
        {
            RequireEditor(); RequireEditorIdle(world);
            if (m_EditorAssets.Values.Any(o => !o.Terminal && (o.ApplyDispatched || DateTime.UtcNow < o.Expires)))
                throw new QueryException("EDITOR_PREVIEW_PENDING", "Finish or cancel pending editor asset placement before saving.");
            if (m_RoadOperations.Values.Any(o => !o.Terminal && (o.ApplyDispatched || DateTime.UtcNow < o.Expires)))
                throw new QueryException("EDITOR_PREVIEW_PENDING", "Finish or cancel pending road/waterway operations before saving.");
            if (m_EditorConfigurations.Values.Any(o => { o.Refresh(); return o.State == "preview_ready" || o.State == "applying"; }) || m_MapResources.Values.Any(o => { o.Refresh(); return o.State == "preview_ready"; }) || m_TerrainOperations.Values.Any(o => !o.Terminal && (o.ApplyDispatched || DateTime.UtcNow < o.Expires)))
                throw new QueryException("EDITOR_PREVIEW_PENDING", "Finish or cancel pending map previews before saving.");
            var panel = world.GetExistingSystemManaged<MapPanelSystem>();
            if (panel == null) throw new QueryException("EDITOR_PANEL_UNAVAILABLE", "The native map panel is unavailable.");
            var ui = world.GetExistingSystemManaged<EditorPanelUISystem>() ?? throw new QueryException("EDITOR_PANEL_UNAVAILABLE", "Editor UI unavailable.");
            ui.activePanel = panel;
            panel.ShowSaveMapPanel();
            return new JObject { ["save_dialog_opened"] = true, ["saved"] = false, ["note"] = "Confirm the filename and save in the native editor dialog." };
        }
        private static NaturalResourceAmount ResourceValue(NaturalResourceCell cell, string resource)
            => resource == "ore" ? cell.m_Ore : resource == "oil" ? cell.m_Oil : cell.m_Fertility;
        private MapResourceOperation MapResourceById(JObject args)
        {
            if (!m_MapResources.TryGetValue((string)args["operation_id"] ?? "", out var op) || op.Session != m_Session)
                throw new QueryException("MAP_RESOURCE_OPERATION_NOT_FOUND", "No resource operation in this map session.");
            op.Refresh(); return op;
        }
        private JObject PreviewMapResources(JObject args, World world)
        {
            RequireEditor(); RequireEditorIdle(world);
            var request = RequestKey(args); var resource = (string)args["resource"];
            if (!EditorAccessPolicy.IsResource(resource)) throw new QueryException("INVALID_ARGUMENT", "resource must be ore, oil, fertility or groundwater.");
            var center = TerrainPoint(args["center"], "center");
            var radius = TerrainNumber(args, "radius_m", 0, 56, 2000, true);
            if (math.any(math.abs(center.xz) + radius > 7168)) throw new QueryException("OUTSIDE_MAP", "The complete resource brush must be inside the map.");
            if (args["value"] == null) throw new QueryException("INVALID_ARGUMENT", "value is required.");
            var value = ComponentInspector.Int(args, "value", 0, 0, 10000);
            var fingerprint = new JObject { ["resource"] = resource, ["x"] = center.x, ["z"] = center.z, ["radius"] = radius, ["value"] = value }.ToString(Formatting.None);
            if (m_MapResourceRequests.TryGetValue(request, out var oldId))
            {
                var old = m_MapResources[oldId];
                if (old.Fingerprint != fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT", "This request_id belongs to another resource plan.");
                return old.Json();
            }
            if (m_MapResources.Count >= 4096) throw new QueryException("MAP_RESOURCE_OPERATION_LIMIT", "Save and reload the map before more resource operations.");
            var op = new MapResourceOperation { Session = m_Session, Request = request, Fingerprint = fingerprint, Resource = resource, Value = value, Center = center.xz, Radius = radius };
            if (resource == "groundwater")
            {
                var system = world.GetExistingSystemManaged<GroundWaterSystem>() ?? throw new QueryException("RESOURCE_UNAVAILABLE", "Groundwater system unavailable.");
                var data = system.GetData(true, out var deps); deps.Complete();
                if (!data.m_Buffer.IsCreated) throw new QueryException("RESOURCE_UNAVAILABLE", "Groundwater grid not ready.");
                SelectResourceCells(op, data.m_TextureSize, data.m_CellSize, center, radius, i => new int2(data.m_Buffer[i].m_Amount, data.m_Buffer[i].m_Max));
            }
            else
            {
                var system = world.GetExistingSystemManaged<NaturalResourceSystem>() ?? throw new QueryException("RESOURCE_UNAVAILABLE", "Natural resource system unavailable.");
                var data = system.GetData(true, out var deps); deps.Complete();
                if (!data.m_Buffer.IsCreated) throw new QueryException("RESOURCE_UNAVAILABLE", "Natural resource grid not ready.");
                SelectResourceCells(op, data.m_TextureSize, data.m_CellSize, center, radius, i => { var v = ResourceValue(data.m_Buffer[i], resource); return new int2(v.m_Base, v.m_Used); });
            }
            if (op.Cells.Count == 0) throw new QueryException("RESOURCE_SELECTION_EMPTY", "No complete resource cell fits inside this brush; enlarge or reposition it.");
            m_MapResources.Add(op.Id, op); m_MapResourceRequests.Add(request, op.Id); return op.Json();
        }
        private static void SelectResourceCells(MapResourceOperation op, int2 size, float2 cell, float3 center, float radius, Func<int, int2> read)
        {
            if (math.any(size <= 0) || math.any(cell <= 0)) throw new QueryException("RESOURCE_UNAVAILABLE", "Resource grid is not ready.");
            op.Width = size.x; op.Height = size.y; op.CellSize = cell;
            for (int z = 0; z < size.y; z++) for (int x = 0; x < size.x; x++)
            {
                var px = (x + .5f - size.x * .5f) * cell.x; var pz = (z + .5f - size.y * .5f) * cell.y;
                if (!EditorAccessPolicy.ContainsCell(px, pz, center.x, center.z, cell.x * .5f, cell.y * .5f, radius)) continue;
                var i = z * size.x + x; op.Cells.Add(i); op.Before.Add(read(i));
            }
        }
        private JObject ApplyMapResources(JObject args, World world)
        {
            RequireEditor(); var op = MapResourceById(args);
            if (RequestKey(args) != op.Request) throw new QueryException("IDEMPOTENCY_CONFLICT", "Use the preview request_id for resource apply.");
            if (op.State == "completed" || op.State == "outcome_unknown") return op.Json();
            if (op.State != "preview_ready") throw new QueryException("MAP_RESOURCE_NOT_READY", "Resource preview is not ready.");
            RequireEditorIdle(world); world.EntityManager.CompleteAllTrackedJobs();
            try
            {
                if (op.Resource == "groundwater")
                {
                    var system = world.GetExistingSystemManaged<GroundWaterSystem>(); var data = system.GetData(false, out var deps); deps.Complete();
                    CheckResourceBaseline(op, data.m_TextureSize, i => new int2(data.m_Buffer[i].m_Amount, data.m_Buffer[i].m_Max));
                    op.State = "applying";
                    foreach (var i in op.Cells) { var v = data.m_Buffer[i]; v.m_Amount = v.m_Max = (short)op.Value; v.m_Polluted = (short)math.min(v.m_Polluted, op.Value); data.m_Buffer[i] = v; }
                    system.AddWriter(default(JobHandle));
                    if (op.Cells.Any(i => data.m_Buffer[i].m_Amount != op.Value || data.m_Buffer[i].m_Max != op.Value)) throw new InvalidOperationException("Resource readback mismatch.");
                }
                else
                {
                    var system = world.GetExistingSystemManaged<NaturalResourceSystem>(); var data = system.GetData(false, out var deps); deps.Complete();
                    CheckResourceBaseline(op, data.m_TextureSize, i => { var v = ResourceValue(data.m_Buffer[i], op.Resource); return new int2(v.m_Base, v.m_Used); });
                    op.State = "applying";
                    foreach (var i in op.Cells)
                    {
                        var cell = data.m_Buffer[i]; var value = new NaturalResourceAmount { m_Base = (ushort)op.Value };
                        if (op.Resource == "ore") cell.m_Ore = value; else if (op.Resource == "oil") cell.m_Oil = value; else cell.m_Fertility = value;
                        data.m_Buffer[i] = cell;
                    }
                    system.AddWriter(default(JobHandle));
                    if (op.Cells.Any(i => ResourceValue(data.m_Buffer[i], op.Resource).m_Base != op.Value || ResourceValue(data.m_Buffer[i], op.Resource).m_Used != 0)) throw new InvalidOperationException("Resource readback mismatch.");
                }
                using (var q = world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<MapFeatureElement>(), ComponentType.Exclude<Deleted>()))
                    world.EntityManager.AddComponent<Updated>(q);
                op.State = "completed";
            }
            catch (Exception e)
            {
                op.Error = e is QueryException qe ? qe.Code : "RESOURCE_APPLY_ERROR";
                op.State = op.State == "applying" ? "outcome_unknown" : "failed";
            }
            return op.Json();
        }
        private static void CheckResourceBaseline(MapResourceOperation op, int2 size, Func<int, int2> read)
        {
            if (size.x != op.Width || size.y != op.Height) throw new QueryException("RESOURCE_GRID_CHANGED", "Re-preview the current resource grid.");
            for (int n = 0; n < op.Cells.Count; n++) if (!math.all(read(op.Cells[n]) == op.Before[n]))
                throw new QueryException("RESOURCE_BASELINE_CHANGED", "Resource cells changed since preview; no resource changes applied.");
        }
        private JObject CancelMapResources(JObject args)
        {
            var op = MapResourceById(args); if (op.State == "preview_ready") op.State = "cancelled"; return op.Json();
        }
    }
}
