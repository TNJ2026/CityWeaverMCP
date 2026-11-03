using Newtonsoft.Json.Linq;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private void AddPassengerManifest(JObject row, EntityManager em, Entity vehicle, bool detail)
        {
            if (!em.HasBuffer<Game.Vehicles.Passenger>(vehicle)) return;
            var buffer = em.GetBuffer<Game.Vehicles.Passenger>(vehicle, true);
            var counts = new McpPassengerManifestCounts();
            var people = detail ? new JArray() : null;
            var pets = detail ? new JArray() : null;
            foreach (var entry in buffer)
            {
                bool pet = em.HasComponent<Game.Creatures.Pet>(entry.m_Passenger);
                counts.Add(pet);
                var ids = pet ? pets : people;
                if (detail && ids.Count < 256) ids.Add(OptionalEntity(m_Session, entry.m_Passenger));
            }
            row["passenger_count"] = counts.Passengers;
            row["pet_count"] = counts.Pets;
            row["passenger_buffer_count"] = counts.Total;
            if (!detail) return;
            row["passenger_ids"] = people; row["pet_ids"] = pets;
            row["passengers_truncated"] = counts.Passengers > people.Count;
            row["pets_truncated"] = counts.Pets > pets.Count;
        }
    }
}
