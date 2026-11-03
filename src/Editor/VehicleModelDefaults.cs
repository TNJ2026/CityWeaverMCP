namespace CityWeaver
{
    // Generic MCP overrides still persist per city. The standalone helicopter
    // mod initializes its own bundled default without the query bridge.
    internal static class VehicleModelDefaults
    {
        internal static McpVehicleModelSaveData Load() => new McpVehicleModelSaveData();
    }
}
