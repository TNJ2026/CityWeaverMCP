using System.Collections.Generic;
using System.Linq;
using Game;
using Game.Common;
using Game.Prefabs;
using Game.Routes;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    // PrefabSystem completes native instance replacement in MainLoop. Patch route selections
    // immediately afterwards, before LateUpdate simulation can reject the replacement model.
    // This must run even when paused, and must not depend on the client polling an operation.
    public partial class McpVehicleRouteReferenceSystem : GameSystemBase
    {
        internal sealed class Pending
        {
            internal VehiclePrefab Target;
            internal Entity Before,After;
            internal int References,Routes;
            internal bool Synced;
        }
        private readonly List<Pending> m_Pending=new List<Pending>();
        private EntityQuery m_Routes;
        private EntityQuery m_UncoloredVehicles;
        private readonly HashSet<VehiclePrefab> m_ColorTargets=new HashSet<VehiclePrefab>();
        private readonly HashSet<Entity> m_ColorArchetypes=new HashSet<Entity>();
        protected override void OnCreate()
        {
            base.OnCreate();
            m_Routes=GetEntityQuery(ComponentType.ReadWrite<VehicleModel>(),ComponentType.Exclude<Deleted>());
            m_UncoloredVehicles=GetEntityQuery(ComponentType.ReadOnly<Game.Vehicles.Vehicle>(),ComponentType.ReadOnly<PrefabRef>(),
                ComponentType.Exclude<Game.Rendering.MeshColor>(),ComponentType.Exclude<Deleted>(),ComponentType.Exclude<Game.Tools.Temp>());
        }
        internal Pending Track(VehiclePrefab target,Entity before)
        {
            if(target.m_Meshes.Any(m=>m.m_Mesh?.GetComponent<ColorProperties>()!=null))m_ColorTargets.Add(target);
            else m_ColorTargets.Remove(target);
            var pending=new Pending{Target=target,Before=before};m_Pending.Add(pending);return pending;
        }
        internal bool Verified(Pending pending,Entity after)
        {
            if(pending==null||!pending.Synced||pending.After!=after)return false;
            EntityManager.CompleteAllTrackedJobs();
            if(m_ColorTargets.Contains(pending.Target))
            {
                if(!m_ColorArchetypes.Contains(after))return false;
                using(var vehicles=m_UncoloredVehicles.ToEntityArray(Allocator.Temp))foreach(var vehicle in vehicles)
                    if(EntityManager.GetComponentData<PrefabRef>(vehicle).m_Prefab==after)return false;
            }
            using(var routes=m_Routes.ToEntityArray(Allocator.Temp))foreach(var route in routes)
            {
                var models=EntityManager.GetBuffer<VehicleModel>(route,true);
                foreach(var model in models)if(model.m_PrimaryPrefab==pending.Before||model.m_SecondaryPrefab==pending.Before)return false;
            }
            return true;
        }
        protected override void OnUpdate()
        {
            if(m_Pending.Count==0&&m_ColorTargets.Count==0)return;
            EntityManager.CompleteAllTrackedJobs();var ps=World.GetExistingSystemManaged<PrefabSystem>();
            for(int i=m_Pending.Count-1;i>=0;i--)
            {
                var pending=m_Pending[i];
                if(pending.Target==null){m_Pending.RemoveAt(i);continue;}
                var after=ps.GetEntity(pending.Target);
                if(after==Entity.Null||after==pending.Before||!EntityManager.Exists(after)||EntityManager.HasComponent<Deleted>(after))continue;
                using(var routes=m_Routes.ToEntityArray(Allocator.Temp))foreach(var route in routes)
                {
                    var models=EntityManager.GetBuffer<VehicleModel>(route);int changed=0;
                    for(int j=0;j<models.Length;j++)
                    {
                        var model=models[j];int count=VehicleRouteReferenceRules.Remap(ref model.m_PrimaryPrefab,ref model.m_SecondaryPrefab,pending.Before,after);
                        if(count>0){models[j]=model;changed+=count;}
                    }
                    if(changed>0){pending.Routes++;pending.References+=changed;}
                }
                pending.After=after;pending.Synced=true;m_Pending.RemoveAt(i);
            }
            // Native prefab replacement remaps PrefabRef but does not add new
            // optional rendering buffers to existing vehicle archetypes. A
            // formerly unpaintable helicopter otherwise renders neutral white.
            var colored=new HashSet<Entity>();
            foreach(var target in m_ColorTargets)
            {
                if(target==null||!ps.TryGetEntity(target,out var type)||EntityManager.HasComponent<Created>(type)||
                    !EntityManager.HasComponent<ObjectData>(type))continue;
                colored.Add(type);
                if(m_ColorArchetypes.Contains(type))continue;
                var data=EntityManager.GetComponentData<ObjectData>(type);if(!data.m_Archetype.Valid)continue;
                using(var old=data.m_Archetype.GetComponentTypes())
                {
                    var components=new HashSet<ComponentType>(old.ToArray());
                    components.Add(ComponentType.ReadWrite<Game.Rendering.MeshColor>());
                    components.Add(ComponentType.ReadWrite<Game.Rendering.CustomMeshColor>());
                    data.m_Archetype=EntityManager.CreateArchetype(components.ToArray());
                }
                EntityManager.SetComponentData(type,data);m_ColorArchetypes.Add(type);
            }
            if(colored.Count==0)return;
            using(var vehicles=m_UncoloredVehicles.ToEntityArray(Allocator.Temp))foreach(var vehicle in vehicles)
            {
                if(!colored.Contains(EntityManager.GetComponentData<PrefabRef>(vehicle).m_Prefab))continue;
                EntityManager.AddBuffer<Game.Rendering.MeshColor>(vehicle);
                if(!EntityManager.HasBuffer<Game.Rendering.CustomMeshColor>(vehicle))EntityManager.AddBuffer<Game.Rendering.CustomMeshColor>(vehicle);
                if(!EntityManager.HasComponent<BatchesUpdated>(vehicle))EntityManager.AddComponent<BatchesUpdated>(vehicle);
            }
        }
    }
}

