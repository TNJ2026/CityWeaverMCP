using Unity.Entities;

namespace CityWeaver
{
    internal static class RoadSpeedSignRefresh
    {
        internal static void Request(EntityManager em, Entity edge)
        {
            if (!em.Exists(edge) || !em.HasBuffer<Game.Objects.SubObject>(edge)) return;
            // SecondaryObjectSystem accepts ChangedDistrict to reselect road
            // decorations from current lane data, then removes the tag. Unlike
            // Updated this does not rebuild lanes and erase per-lane overrides.
            if (!em.HasComponent<Game.Areas.ChangedDistrict>(edge))
                em.AddComponent<Game.Areas.ChangedDistrict>(edge);
        }
    }
}
