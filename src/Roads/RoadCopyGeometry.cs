using System;
using System.Collections.Generic;

namespace CityWeaver
{
    internal static class RoadCopyGeometry
    {
        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        internal static bool ValidMirrorAxis(float ax, float az, float bx, float bz) =>
            Finite(ax) && Finite(az) && Finite(bx) && Finite(bz) &&
            ((double)bx - ax) * (bx - ax) + ((double)bz - az) * (bz - az) >= 1;

        // Reflect about an infinite world-space line. Reflecting twice restores
        // the point; height and directed start/end ordering are unchanged.
        internal static void Reflect(float x, float z, float ax, float az, float bx, float bz, out float resultX, out float resultZ)
        {
            if (!ValidMirrorAxis(ax, az, bx, bz) || !Finite(x) || !Finite(z)) throw new ArgumentException("Mirror axis must be finite and at least one metre long.");
            double dx = (double)bx - ax, dz = (double)bz - az;
            double t = (((double)x - ax) * dx + ((double)z - az) * dz) / (dx * dx + dz * dz);
            resultX = (float)(2 * (ax + t * dx) - x);
            resultZ = (float)(2 * (az + t * dz) - z);
        }

        internal static void SwapSides<T>(ref T left, ref T right)
        {
            var original = left; left = right; right = original;
        }

        // Same positive Y rotation as Unity's quaternion.RotateY. No scale or snapping.
        internal static void Transform(float x, float y, float z, float originX, float originZ,
            float targetX, float targetZ, float degrees, float heightOffset,
            out float resultX, out float resultY, out float resultZ)
        {
            var radians = degrees * Math.PI / 180;
            var dx = (double)x - originX; var dz = (double)z - originZ;
            resultX = (float)(targetX + Math.Cos(radians) * dx + Math.Sin(radians) * dz);
            resultY = y + heightOffset;
            resultZ = (float)(targetZ - Math.Sin(radians) * dx + Math.Cos(radians) * dz);
        }

        // A shared source node must remain shared, and distinct source nodes must not merge.
        internal static bool BindNode<T>(Dictionary<T, T> forward, Dictionary<T, T> reverse, T source, T copy)
        {
            var comparer = EqualityComparer<T>.Default;
            if (forward.TryGetValue(source, out var mapped)) return comparer.Equals(mapped, copy);
            if (reverse.ContainsKey(copy)) return false;
            forward.Add(source, copy); reverse.Add(copy, source); return true;
        }
    }
}
