using System;

namespace CityWeaver
{
    internal static class FloatingPlacement
    {
        // ObjectToolSystem.CalculateHeight: apply the prefab offset to the water surface,
        // then retain the distance above the terrain reference in ControlPoint.m_Elevation.
        internal static float Height(float waterHeight, float placementOffset, float terrainReference)
            => Math.Max(terrainReference, waterHeight + placementOffset);

        internal static float Elevation(float placementHeight, float terrainReference)
            => Math.Max(0f, placementHeight - terrainReference);

        internal static bool Matches(float height, float elevation, float expectedHeight, float expectedElevation)
            => !float.IsNaN(height) && !float.IsNaN(elevation) &&
               Math.Abs(height - expectedHeight) <= .25f && Math.Abs(elevation - expectedElevation) <= .25f;
    }
}
