namespace CityWeaver
{
    internal static class RoadCopyLimits
    {
        internal const int MaxExplicitEdges = 1024;
        internal const int MaxAreaEdges = 2048;
        internal static bool ValidExplicitCount(int count) => count >= 1 && count <= MaxExplicitEdges;
        internal static bool ValidAreaCount(int count) => count >= 1 && count <= MaxAreaEdges;
    }
}
