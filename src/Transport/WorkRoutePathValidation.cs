namespace CityWeaver
{
    internal static class WorkRoutePathValidation
    {
        internal static bool HeightAllowed(bool hasWater, float height, float surface, bool exactNativeStop)
            => hasWater && !float.IsNaN(height) && !float.IsInfinity(height) &&
               !float.IsNaN(surface) && !float.IsInfinity(surface) &&
               (exactNativeStop || System.Math.Abs(height - surface) <= 8f);

        // PathFlags: Pending, Failed, Obsolete, Scheduled and Stuck cannot certify a route.
        internal static bool Ready(int count, float distance, int flags)
            => count > 0 && !float.IsNaN(distance) && !float.IsInfinity(distance) && distance >= 0 && (flags & (1 | 2 | 4 | 8 | 64)) == 0;
    }
}
