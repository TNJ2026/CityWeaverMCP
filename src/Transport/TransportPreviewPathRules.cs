namespace CityWeaver
{
    internal static class TransportPreviewPathRules
    {
        internal static bool Ready(int elements, float distance, int flags, bool bindingsReady, bool endpointsReady)
            => elements > 0 && !float.IsNaN(distance) && !float.IsInfinity(distance) && distance >= 0 &&
               (flags & (1 | 2 | 4 | 8 | 64 | 2048 | 4096)) == 0 && bindingsReady && endpointsReady;
    }
}
