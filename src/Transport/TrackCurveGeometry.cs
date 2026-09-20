using System;

namespace CityWeaver
{
    // Horizontal curvature only; vertical grade is validated separately by the game query.
    public static class TrackCurveGeometry
    {
        public static double SampledMinimumRadius(double ax, double az, double bx, double bz,
            double cx, double cz, double dx, double dz)
        {
            double minimum = double.PositiveInfinity;
            for (int i = 0; i <= 256; i++)
            {
                double t = i / 256.0, u = 1 - t;
                double vx = 3 * (u * u * (bx - ax) + 2 * u * t * (cx - bx) + t * t * (dx - cx));
                double vz = 3 * (u * u * (bz - az) + 2 * u * t * (cz - bz) + t * t * (dz - cz));
                double xx = 6 * (u * (cx - 2 * bx + ax) + t * (dx - 2 * cx + bx));
                double xz = 6 * (u * (cz - 2 * bz + az) + t * (dz - 2 * cz + bz));
                double speed2 = vx * vx + vz * vz;
                if (speed2 < 1e-8) return 0; // Cusp or degenerate endpoint.
                double cross = Math.Abs(vx * xz - vz * xx);
                if (cross > 1e-10) minimum = Math.Min(minimum, Math.Pow(speed2, 1.5) / cross);
            }
            return minimum;
        }
    }
}
