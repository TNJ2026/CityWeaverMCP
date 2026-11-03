namespace CityWeaver
{
    // CS2 road speeds use twice the displayed km/h: native EU Speed80
    // has TrafficSignData.m_SpeedLimit=160. Runtime lanes divide that by 3.6.
    internal static class RoadSpeedUnits
    {
        internal static float ToPrefab(float displayedKph) => displayedKph * 2f;
        internal static float FromPrefab(float nativeKph) => nativeKph * .5f;
        internal static float ToLane(float displayedKph) => displayedKph / 1.8f;
        internal static float FromLane(float nativeSpeed) => nativeSpeed * 1.8f;
    }
}
