using System;
using System.Collections.Generic;

namespace CityWeaver
{
    // Keep editor support explicit: city economy, construction and progression remain city-only.
    internal static class EditorAccessPolicy
    {
        internal static readonly HashSet<string> Tools = new HashSet<string>(StringComparer.Ordinal)
        {
            "get_editor_state", "show_editor_save_panel",
            "list_editor_assets", "get_editor_asset", "select_editor_asset", "preview_editor_asset",
            "get_editor_asset_operation", "apply_editor_asset", "cancel_editor_asset_preview",
            "list_road_prefabs", "find_roads_by_name", "inspect_road_lanes",
            "preview_road", "preview_road_route", "preview_road_ring",
            "get_road_operation", "build_road", "cancel_road_preview",
            "list_waterway_prefabs", "list_waterways", "get_waterway", "preview_waterway", "preview_waterway_delete",
            "get_waterway_operation", "apply_waterway_operation", "cancel_waterway_preview",
            "list_editor_environment_presets", "preview_editor_environment",
            "get_editor_configuration", "preview_editor_configuration", "apply_editor_configuration", "get_editor_configuration_operation", "cancel_editor_configuration_preview",
            "get_climate_state", "sample_wind", "sample_pollution",
            "get_camera_view", "capture_game_view", "set_simulation_speed",
            "sample_terrain", "preview_terrain", "apply_terrain", "get_terrain_operation", "cancel_terrain_preview",
            "list_water_sources", "create_water_source", "update_water_source", "delete_water_source",
            "list_landscape_prefabs", "list_landscape_objects", "get_landscape_object", "analyze_landscape_area",
            "place_landscape_objects", "plant_landscape_pattern", "move_landscape_object", "set_tree_state",
            "remove_landscape_objects", "clear_landscape_area",
            "list_environment_layers", "read_environment_grid", "read_surface_water_mask", "sample_soil_water",
            "query_entities", "get_entity_components", "list_game_systems", "get_system_schema", "read_entity_field",
            "preview_map_resources", "apply_map_resources", "get_map_resource_operation", "cancel_map_resource_preview"
        };
        internal static bool Allows(string tool) => tool != null && Tools.Contains(tool);
        internal static bool EditorWaterway(bool editor, string transactionKind) => editor && transactionKind == "waterway";
        // Null is the ordinary native road transaction kind; do not admit other networks or direct writes.
        internal static bool EditorNetwork(bool editor, string transactionKind, string operationType) => editor &&
            (transactionKind == "waterway" || (transactionKind == null && operationType == "create"));
        internal static bool DirectMutation(string tool) => tool == "create_water_source" || tool == "update_water_source" || tool == "delete_water_source" ||
            tool == "place_landscape_objects" || tool == "plant_landscape_pattern" || tool == "move_landscape_object" || tool == "set_tree_state" ||
            tool == "remove_landscape_objects" || tool == "clear_landscape_area";
        internal static bool IsResource(string resource) => resource == "ore" || resource == "oil" || resource == "fertility" || resource == "groundwater";
        internal static bool ContainsCell(double x, double z, double centerX, double centerZ, double halfX, double halfZ, double radius)
        {
            var dx = Math.Abs(x - centerX) + halfX;
            var dz = Math.Abs(z - centerZ) + halfZ;
            return dx * dx + dz * dz <= radius * radius;
        }
    }
}
