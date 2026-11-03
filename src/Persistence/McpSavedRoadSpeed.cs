using System;
using Colossal.Serialization.Entities;
using Game.Net;
using Game.Prefabs;
using Unity.Entities;
using CarLane = Game.Net.CarLane;

namespace CityWeaver
{
    // Stored on the permanent edge: generated lane entities are discarded on map load.
    // Prefab entity references use the game's serializer and are remapped on loading.
    [InternalBufferCapacity(0)]
    public struct McpSavedRoadSpeed : IBufferElementData, ISerializable
    {
        public Entity RoadPrefab, LanePrefab;
        public int Start, Middle, End, StartPosition, EndPosition, Carriageway;
        public float Speed, DefaultSpeed;

        public void Serialize<TWriter>(TWriter writer) where TWriter : IWriter
        {
            writer.Write(RoadPrefab); writer.Write(LanePrefab);
            writer.Write(Start); writer.Write(Middle); writer.Write(End);
            writer.Write(StartPosition); writer.Write(EndPosition); writer.Write(Carriageway);
            writer.Write(Speed); writer.Write(DefaultSpeed);
        }
        public void Deserialize<TReader>(TReader reader) where TReader : IReader
        {
            reader.Read(out RoadPrefab); reader.Read(out LanePrefab);
            reader.Read(out Start); reader.Read(out Middle); reader.Read(out End);
            reader.Read(out StartPosition); reader.Read(out EndPosition); reader.Read(out Carriageway);
            reader.Read(out Speed); reader.Read(out DefaultSpeed);
        }
        // Entity deserialization remaps saved IDs to loaded prefab placeholders.
        // The native PrefabReferences phase then resolves those placeholders to
        // the active prefabs, just as it does for the built-in PrefabRef component.
        public void ResolvePrefabReferences(EntityManager em, ref Game.Serialization.PrefabReferences references)
        {
            // The managed overload recognizes active prefabs by LoadedIndex.
            // Check(ref Entity) assumes the reference has not already been fixed.
            RoadPrefab = references.Check(em, RoadPrefab);
            LanePrefab = references.Check(em, LanePrefab);
        }
        public bool SameLane(McpSavedRoadSpeed other) => RoadPrefab == other.RoadPrefab && LanePrefab == other.LanePrefab &&
            Start == other.Start && Middle == other.Middle && End == other.End && StartPosition == other.StartPosition &&
            EndPosition == other.EndPosition && Carriageway == other.Carriageway;

        public bool Restore(ref CarLane lane)
        {
            if (lane.m_SpeedLimit == Speed && lane.m_DefaultSpeedLimit == DefaultSpeed) return false;
            lane.m_SpeedLimit = Speed; lane.m_DefaultSpeedLimit = DefaultSpeed;
            return true;
        }

        public static McpSavedRoadSpeed Key(EntityManager em, Entity edge, Entity lane)
        {
            var nodes = em.GetComponentData<Lane>(lane);
            return new McpSavedRoadSpeed {
                RoadPrefab = em.GetComponentData<PrefabRef>(edge).m_Prefab,
                LanePrefab = em.GetComponentData<PrefabRef>(lane).m_Prefab,
                Start = nodes.m_StartNode.GetLaneIndex(), Middle = nodes.m_MiddleNode.GetLaneIndex(), End = nodes.m_EndNode.GetLaneIndex(),
                StartPosition = (int)Math.Round(nodes.m_StartNode.GetCurvePos() * 32767),
                EndPosition = (int)Math.Round(nodes.m_EndNode.GetCurvePos() * 32767),
                Carriageway = em.GetComponentData<CarLane>(lane).m_CarriagewayGroup
            };
        }
        public static McpSavedRoadSpeed? Read(EntityManager em, Entity edge, McpSavedRoadSpeed key)
        {
            if (em.HasBuffer<McpSavedRoadSpeed>(edge))
                foreach (var item in em.GetBuffer<McpSavedRoadSpeed>(edge, true)) if (item.SameLane(key)) return item;
            return null;
        }
        public static void Write(EntityManager em, Entity edge, McpSavedRoadSpeed key, McpSavedRoadSpeed? value)
        {
            if (!em.HasBuffer<McpSavedRoadSpeed>(edge))
            {
                if (!value.HasValue) return;
                em.AddBuffer<McpSavedRoadSpeed>(edge);
            }
            var buffer = em.GetBuffer<McpSavedRoadSpeed>(edge);
            for (int i = buffer.Length - 1; i >= 0; i--) if (buffer[i].SameLane(key)) buffer.RemoveAt(i);
            if (value.HasValue) buffer.Add(value.Value);
            if (buffer.Length == 0) em.RemoveComponent<McpSavedRoadSpeed>(edge);
        }
    }
}


