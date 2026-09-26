using System;
using System.Collections.Generic;
using Game;
using Game.Common;
using Game.Net;
using Game.Objects;
using Game.Simulation;
using Game.Tools;
using Unity.Entities;

namespace CityWeaver
{
    public sealed class TrafficSignalPhasePlan
    {
        public byte SignalGroup;
        public ushort DurationSteps;
    }

    public sealed class TrafficSignalProgramPlan
    {
        public Entity Node;
        public ushort OffsetSteps;
        public readonly List<TrafficSignalPhasePlan> Phases = new List<TrafficSignalPhasePlan>();
    }

    /// <summary>
    /// Applies optional, session-scoped fixed-time programs after the native adaptive
    /// controller. One program step equals sixteen simulation frames, matching the
    /// native traffic-light update cadence. Native lane groups and light objects remain
    /// authoritative; this system only selects which existing group is green.
    /// </summary>
    public sealed partial class McpTrafficSignalProgramSystem : GameSystemBase
    {
        private readonly Dictionary<Entity, TrafficSignalProgramPlan> m_Programs = new Dictionary<Entity, TrafficSignalProgramPlan>();
        private SimulationSystem m_SimulationSystem;

        protected override void OnCreate()
        {
            base.OnCreate();
            m_SimulationSystem = World.GetOrCreateSystemManaged<SimulationSystem>();
        }

        public IEnumerable<TrafficSignalProgramPlan> Programs => m_Programs.Values;

        public bool TryGet(Entity node, out TrafficSignalProgramPlan program) => m_Programs.TryGetValue(node, out program);

        public void Set(TrafficSignalProgramPlan program) => m_Programs[program.Node] = program;

        public bool Remove(Entity node) => m_Programs.Remove(node);

        public void ClearAll() => m_Programs.Clear();

        protected override void OnUpdate()
        {
            if (m_Programs.Count == 0) return;
            var step = m_SimulationSystem.frameIndex / 16u;
            var stale = new List<Entity>();
            foreach (var pair in m_Programs)
            {
                var node = pair.Key;
                var program = pair.Value;
                if (!EntityManager.Exists(node) || EntityManager.HasComponent<Deleted>(node) ||
                    EntityManager.HasComponent<Temp>(node) || !EntityManager.HasComponent<TrafficLights>(node))
                {
                    stale.Add(node);
                    continue;
                }

                const int transitionSteps = 4;
                int cycle = 0;
                foreach (var phase in program.Phases) cycle += phase.DurationSteps + transitionSteps;
                if (cycle <= 0) { stale.Add(node); continue; }
                var cursor = (int)((step + program.OffsetSteps) % (uint)cycle);
                int selectedIndex = 0;
                int phaseCursor = 0;
                for (int i = 0; i < program.Phases.Count; i++)
                {
                    var span = program.Phases[i].DurationSteps + transitionSteps;
                    if (cursor < span) { selectedIndex = i; phaseCursor = cursor; break; }
                    cursor -= span;
                }
                var selectedGroup = program.Phases[selectedIndex].SignalGroup;
                var nextGroup = program.Phases[(selectedIndex + 1) % program.Phases.Count].SignalGroup;

                var trafficLights = EntityManager.GetComponentData<TrafficLights>(node);
                if (selectedGroup < 1 || selectedGroup > trafficLights.m_SignalGroupCount) continue;
                if (phaseCursor < program.Phases[selectedIndex].DurationSteps)
                {
                    trafficLights.m_State = Game.Net.TrafficLightState.Ongoing;
                    trafficLights.m_CurrentSignalGroup = selectedGroup;
                    trafficLights.m_NextSignalGroup = 0;
                }
                else
                {
                    var transition = phaseCursor - program.Phases[selectedIndex].DurationSteps;
                    trafficLights.m_State = transition < 2 ? Game.Net.TrafficLightState.Ending
                        : transition == 2 ? Game.Net.TrafficLightState.Changing
                        : Game.Net.TrafficLightState.Beginning;
                    trafficLights.m_CurrentSignalGroup = transition == 3 ? (byte)0 : selectedGroup;
                    trafficLights.m_NextSignalGroup = nextGroup;
                }
                trafficLights.m_Timer = 0;
                EntityManager.SetComponentData(node, trafficLights);

                if (EntityManager.HasBuffer<Game.Net.SubLane>(node))
                {
                    var lanes = EntityManager.GetBuffer<Game.Net.SubLane>(node, true);
                    for (int i = 0; i < lanes.Length; i++)
                    {
                        var lane = lanes[i].m_SubLane;
                        if (!EntityManager.Exists(lane) || !EntityManager.HasComponent<LaneSignal>(lane)) continue;
                        var signal = EntityManager.GetComponentData<LaneSignal>(lane);
                        TrafficLightSystem.UpdateLaneSignal(trafficLights, ref signal);
                        EntityManager.SetComponentData(lane, signal);
                    }
                }
                if (EntityManager.HasBuffer<Game.Objects.SubObject>(node))
                {
                    var objects = EntityManager.GetBuffer<Game.Objects.SubObject>(node, true);
                    for (int i = 0; i < objects.Length; i++)
                    {
                        var light = objects[i].m_SubObject;
                        if (!EntityManager.Exists(light) || !EntityManager.HasComponent<TrafficLight>(light)) continue;
                        var state = EntityManager.GetComponentData<TrafficLight>(light);
                        TrafficLightSystem.UpdateTrafficLightState(trafficLights, ref state);
                        EntityManager.SetComponentData(light, state);
                    }
                }
            }
            foreach (var node in stale) m_Programs.Remove(node);
        }
    }
}
