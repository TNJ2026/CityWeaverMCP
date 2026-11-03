using Game;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Unity.Collections;
using Unity.Entities;
using CarLane = Game.Net.CarLane;
using SubLane = Game.Net.SubLane;

namespace CityWeaver
{
    public partial class SavedRoadSpeedSystem : GameSystemBase
    {
        private EntityQuery m_Roads;
        private float m_NextCheck;
        protected override void OnCreate()
        {
            base.OnCreate();
            m_Roads = GetEntityQuery(ComponentType.ReadOnly<McpSavedRoadSpeed>(), ComponentType.ReadOnly<Edge>(),
                ComponentType.ReadOnly<PrefabRef>(), ComponentType.Exclude<Deleted>(), ComponentType.Exclude<Created>(),
                ComponentType.Exclude<Game.Tools.Temp>(), ComponentType.Exclude<Updated>());
        }
        protected override void OnUpdate()
        {
            var game = Game.SceneFlow.GameManager.instance;
            if (game == null || game.isGameLoading || UnityEngine.Time.unscaledTime < m_NextCheck) return;
            m_NextCheck = UnityEngine.Time.unscaledTime + 1;
            var em = EntityManager; em.CompleteAllTrackedJobs();
            using (var edges = m_Roads.ToEntityArray(Allocator.Temp)) foreach (var edge in edges)
            {
                if (!em.HasBuffer<SubLane>(edge)) continue;
                bool changed = false;
                // Copy before adding PathfindUpdated, which can invalidate a buffer reference.
                using (var lanes = em.GetBuffer<SubLane>(edge, true).ToNativeArray(Allocator.Temp)) foreach (var sub in lanes)
                {
                    var lane = sub.m_SubLane;
                    if (!em.HasComponent<CarLane>(lane) || !em.HasComponent<Lane>(lane) || !em.HasComponent<PrefabRef>(lane) || em.HasComponent<Deleted>(lane)) continue;
                    var saved = McpSavedRoadSpeed.Read(em, edge, McpSavedRoadSpeed.Key(em, edge, lane));
                    if (!saved.HasValue) continue; // Changed road or unmatched lane: never guess.
                    var data = em.GetComponentData<CarLane>(lane); var value = saved.Value;
                    if (!value.Restore(ref data)) continue;
                    em.SetComponentData(lane, data);
                    if (!em.HasComponent<PathfindUpdated>(lane)) em.AddComponent<PathfindUpdated>(lane);
                    changed = true;
                }
                if (changed) RoadSpeedSignRefresh.Request(em, edge);
            }
        }
    }
}
