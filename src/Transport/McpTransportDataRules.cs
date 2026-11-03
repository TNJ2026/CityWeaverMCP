using Game.Common;
using Game.Routes;
using Unity.Entities;

namespace CityWeaver
{
    internal static class McpTransportStopHealth
    {
        internal static bool Valid(EntityManager em,Entity stop)=>stop!=Entity.Null&&em.Exists(stop)&&
            em.HasComponent<TransportStop>(stop)&&!em.HasComponent<Deleted>(stop)&&!em.HasComponent<Game.Tools.Temp>(stop);
        internal static int Missing(EntityManager em,Entity line)
        {
            int missing=0;
            foreach(var waypoint in em.GetBuffer<RouteWaypoint>(line,true))
            {
                var stop=em.HasComponent<Connected>(waypoint.m_Waypoint)?em.GetComponentData<Connected>(waypoint.m_Waypoint).m_Connected:Entity.Null;
                if(!Valid(em,stop))missing++;
            }
            return missing;
        }
    }
    internal struct McpPassengerManifestCounts
    {
        internal int Passengers,Pets;
        internal int Total=>Passengers+Pets;
        internal void Add(bool pet){if(pet)Pets++;else Passengers++;}
    }
}
