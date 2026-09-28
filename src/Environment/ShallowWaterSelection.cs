using System;

namespace CityWeaver
{
    internal static class ShallowWaterSelection
    {
        internal static bool Eligible(float depth, float maximum) =>
            !float.IsNaN(depth) && !float.IsInfinity(depth) &&
            depth > .001f && depth <= maximum;

        internal static bool WithinSegment(double x, double z, double ax, double az, double bx, double bz, double diameter, double cell)
        {
            double radius = diameter / 2 - cell * Math.Sqrt(2) / 2;
            if (radius <= 0) return false;
            double dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
            double t = length > 0 ? Math.Max(0, Math.Min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
            double ex = x - ax - t * dx, ez = z - az - t * dz;
            return ex * ex + ez * ez <= radius * radius;
        }
    }
}
