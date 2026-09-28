using System;

namespace CityWeaver
{
    internal static class UtilityPlacementHeight
    {
        // NetToolSystem selects the nearest valid elevation when switching prefabs.
        internal static float DefaultElevation(float min, float max)
            => Math.Max(min, Math.Min(max, 0f));

        // LocalConnect ports supply horizontal attachment, not a pipe's world height.
        internal static float UndergroundHeight(float terrain, float elevation)
            => terrain + elevation;

        internal static bool NeedsLocalConnection(bool resourceNetwork, bool hasTarget, bool samePipePrefab)
            => resourceNetwork && hasTarget && !samePipePrefab;

        internal static bool EndpointHeightMatches(float planned, float actual)
            => !float.IsNaN(actual) && !float.IsInfinity(actual) && Math.Abs(planned - actual) <= 2f;
    }
}
