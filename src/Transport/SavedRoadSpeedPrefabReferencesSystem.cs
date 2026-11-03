using Game;
using Game.Common;
using Game.Prefabs;
using Game.Serialization;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    public partial class SavedRoadSpeedPrefabReferencesSystem : GameSystemBase
    {
        private EntityQuery m_Policies;
        protected override void OnCreate()
        {
            base.OnCreate();
            m_Policies = GetEntityQuery(ComponentType.ReadWrite<McpSavedRoadSpeed>(), ComponentType.Exclude<Deleted>());
        }
        protected override void OnUpdate()
        {
            McpLegacyCompatibility.ImportRoadSpeeds(World);
            var system = World.GetExistingSystemManaged<CheckPrefabReferencesSystem>();
            var references = system.GetPrefabReferences(this, out var dependencies);
            dependencies.Complete(); EntityManager.CompleteAllTrackedJobs();
            int checkedPolicies = 0, resolvedPolicies = 0;
            using (var edges = m_Policies.ToEntityArray(Allocator.Temp)) foreach (var edge in edges)
            {
                var policies = EntityManager.GetBuffer<McpSavedRoadSpeed>(edge);
                for (int i = 0; i < policies.Length; i++)
                {
                    var policy = policies[i];
                    if (!EntityManager.HasComponent<PrefabData>(policy.RoadPrefab) || !EntityManager.HasComponent<PrefabData>(policy.LanePrefab))
                    {
                        Mod.log.Warn("Saved road speed has unresolved prefab references on " + edge);
                        continue;
                    }
                    var oldRoad = policy.RoadPrefab; var oldLane = policy.LanePrefab;
                    policy.ResolvePrefabReferences(EntityManager, ref references);
                    checkedPolicies++;
                    if (oldRoad != policy.RoadPrefab || oldLane != policy.LanePrefab) resolvedPolicies++;
                    policies[i] = policy;
                }
            }
            // All reference checking above is synchronous; no outstanding user job.
            system.AddPrefabReferencesUser(default);
            if (checkedPolicies > 0) Mod.log.Info("Saved road speed prefab check: policies=" + checkedPolicies + ", resolved=" + resolvedPolicies);
        }
    }
}
