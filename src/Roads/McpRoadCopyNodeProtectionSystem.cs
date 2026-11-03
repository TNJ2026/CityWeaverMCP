using System.Collections.Generic;
using Game;
using Game.Common;
using Game.Net;
using Game.Tools;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    // NodeReductionSystem excludes Fixed nodes. Protect only temporary aliases of
    // the explicitly selected corridor endpoints, for that one pipeline step.
    // Never add Fixed to permanent entities or carry it into ApplyNetSystem.
    public sealed partial class McpRoadCopyNodeProtectionSystem : GameSystemBase
    {
        private readonly List<Entity> m_Protected = new List<Entity>();
        private EntityQuery m_Nodes;
        protected override void OnCreate()
        {
            base.OnCreate();
            m_Nodes = GetEntityQuery(ComponentType.ReadOnly<Temp>(), ComponentType.ReadOnly<Node>(),
                ComponentType.Exclude<Fixed>(), ComponentType.Exclude<Deleted>());
        }
        protected override void OnUpdate()
        {
            EntityManager.CompleteAllTrackedJobs();
            Release();
            var tool = World.GetExistingSystemManaged<McpRoadToolSystem>();
            if (tool == null) return;
            using (var nodes = m_Nodes.ToEntityArray(Allocator.Temp))
                foreach (var node in nodes)
                    if (tool.ProtectCopyEndpoint(EntityManager.GetComponentData<Temp>(node).m_Original))
                    {
                        EntityManager.AddComponentData(node, new Fixed { m_Index = -1 });
                        m_Protected.Add(node);
                    }
        }
        internal void Release()
        {
            if (m_Protected.Count == 0) return;
            EntityManager.CompleteAllTrackedJobs();
            foreach (var node in m_Protected)
                if (EntityManager.Exists(node) && EntityManager.HasComponent<Temp>(node) && EntityManager.HasComponent<Fixed>(node))
                    EntityManager.RemoveComponent<Fixed>(node);
            m_Protected.Clear();
        }
        protected override void OnDestroy() { Release(); base.OnDestroy(); }
    }

    public sealed partial class McpRoadCopyNodeProtectionCleanupSystem : GameSystemBase
    {
        protected override void OnUpdate() => World.GetExistingSystemManaged<McpRoadCopyNodeProtectionSystem>()?.Release();
    }
}
