using System;
using System.Collections.Generic;
using Game;
using Game.Common;
using Game.Objects;
using Game.Prefabs;
using Game.Rendering;
using Game.Simulation;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;
using UnityEngine;

namespace CityWeaver
{
    // Runs after native wheel interpolation and before skeleton GPU upload.
    // Only explicitly replaced vehicle prefabs participate; stock vehicles are untouched.
    public partial class McpVehicleDoorSystem : GameSystemBase
    {
        internal static readonly HashSet<VehiclePrefab> Targets=new HashSet<VehiclePrefab>();
        private EntityQuery m_Query;
        private readonly Dictionary<(Entity,int,int),float> m_Progress=new Dictionary<(Entity,int,int),float>();
        internal struct DoorSignal
        {
            internal bool Left,Right,Boarding;
            internal string Source,TransportState;
        }
        internal static DoorSignal ReadSignal(EntityManager em,Entity entity)
        {
            var flags=em.HasComponent<InterpolatedTransform>(entity)?em.GetComponentData<InterpolatedTransform>(entity).m_Flags:0;
            var signal=new DoorSignal{Left=(flags&TransformFlags.BoardingLeft)!=0,Right=(flags&TransformFlags.BoardingRight)!=0,Source="interpolated_transform"};
            signal.Boarding=signal.Left||signal.Right;
            if(!em.HasComponent<Game.Vehicles.Car>(entity)||!em.HasComponent<Game.Vehicles.PublicTransport>(entity))return signal;
            var state=em.GetComponentData<Game.Vehicles.PublicTransport>(entity).m_State;
            bool boarding=(state&Game.Vehicles.PublicTransportFlags.Boarding)!=0;
            bool left=(state&Game.Vehicles.PublicTransportFlags.StopLeft)!=0,right=(state&Game.Vehicles.PublicTransportFlags.StopRight)!=0;
            float stopLocalX=float.NaN;string source="public_transport_stop_flags";
            // UpdateStop can clear both side flags once the car's lane progress reaches zero.
            // Only use an actual stop currently boarding THIS vehicle as a geometric fallback.
            if(boarding&&!left&&!right&&em.HasComponent<Game.Common.Target>(entity)&&em.HasComponent<Game.Objects.Transform>(entity))
            {
                var target=em.GetComponentData<Game.Common.Target>(entity).m_Target;
                if(em.HasComponent<Game.Routes.Connected>(target)){
                    var stop=em.GetComponentData<Game.Routes.Connected>(target).m_Connected;
                    if(em.HasComponent<Game.Routes.BoardingVehicle>(stop)&&em.GetComponentData<Game.Routes.BoardingVehicle>(stop).m_Vehicle==entity&&em.HasComponent<Game.Objects.Transform>(stop)){
                        var vehicle=em.GetComponentData<Game.Objects.Transform>(entity);var point=em.GetComponentData<Game.Objects.Transform>(stop).m_Position;
                        var delta=point-vehicle.m_Position;
                        if(math.lengthsq(delta)<10000){stopLocalX=math.rotate(math.inverse(vehicle.m_Rotation),delta).x;source="boarding_stop_position";}
                    }
                }
            }
            int side=VehicleDoorRules.BoardingSide(boarding,left,right,stopLocalX);
            return new DoorSignal{Left=side<0,Right=side>0,Boarding=boarding,Source=side==0?"public_transport_no_boarding_side":source,TransportState=state.ToString()};
        }
        protected override void OnCreate()
        {
            base.OnCreate();m_Query=GetEntityQuery(ComponentType.ReadOnly<Game.Vehicles.Vehicle>(),ComponentType.ReadOnly<PrefabRef>(),ComponentType.ReadOnly<InterpolatedTransform>(),ComponentType.ReadWrite<Skeleton>(),ComponentType.ReadWrite<Bone>(),ComponentType.Exclude<Deleted>());
        }
        protected override void OnUpdate()
        {
            if(Targets.Count==0){m_Progress.Clear();return;}
            var ps=World.GetExistingSystemManaged<PrefabSystem>();var selected=new HashSet<Entity>();
            foreach(var target in Targets)if(target!=null)selected.Add(ps.GetEntity(target));
            EntityManager.CompleteAllTrackedJobs();
            float dt=math.min(UnityEngine.Time.deltaTime,.1f)*World.GetExistingSystemManaged<SimulationSystem>().selectedSpeed;
            var active=new HashSet<(Entity,int,int)>();
            using(var entities=m_Query.ToEntityArray(Allocator.Temp))foreach(var entity in entities)
            {
                var prefab=EntityManager.GetComponentData<PrefabRef>(entity).m_Prefab;if(!selected.Contains(prefab)||!EntityManager.HasBuffer<SubMesh>(prefab))continue;
                var meshes=EntityManager.GetBuffer<SubMesh>(prefab,true);var skeletons=EntityManager.GetBuffer<Skeleton>(entity);var bones=EntityManager.GetBuffer<Bone>(entity);
                var signal=ReadSignal(EntityManager,entity);
                float speed=EntityManager.HasComponent<Moving>(entity)?math.length(EntityManager.GetComponentData<Moving>(entity).m_Velocity):0;
                for(int part=0;part<math.min(meshes.Length,skeletons.Length);part++)
                {
                    var mesh=meshes[part].m_SubMesh;
                    if(!ps.TryGetPrefab<RenderPrefab>(mesh,out var render))continue;
                    var doors=McpLegacyCompatibility.ReadDoors(render);var rig=render.GetComponent<ProceduralAnimationProperties>();
                    if(doors?.m_Doors==null||rig?.m_Bones==null||!EntityManager.HasBuffer<ProceduralBone>(mesh))continue;
                    var procedural=EntityManager.GetBuffer<ProceduralBone>(mesh,true);var skeleton=skeletons[part];if(skeleton.m_BufferAllocation.Empty)continue;
                    foreach(var door in doors.m_Doors)
                    {
                        int bind=Array.FindIndex(rig.m_Bones,b=>b.name==door.bone),index=-1;
                        for(int i=0;i<procedural.Length;i++)if(procedural[i].m_BindIndex==bind){index=i;break;}
                        int offset=skeleton.m_BoneOffset+index;if(index<0||offset<0||offset>=bones.Length)continue;
                        var key=(entity,part,bind);active.Add(key);m_Progress.TryGetValue(key,out float progress);
                        bool open=VehicleDoorRules.Open(door.right,signal.Left,signal.Right,speed);
                        progress=VehicleDoorRules.Step(progress,open,dt,door.duration);m_Progress[key]=progress;
                        var bone=bones[offset];var rotation=math.mul(procedural[index].m_Rotation,quaternion.RotateY(math.radians(door.angle)*progress));
                        skeleton.m_CurrentUpdated|=!bone.m_Rotation.Equals(rotation);bone.m_Rotation=rotation;bones[offset]=bone;
                    }
                    skeletons[part]=skeleton;
                }
            }
            var stale=new List<(Entity,int,int)>();foreach(var key in m_Progress.Keys)if(!active.Contains(key))stale.Add(key);foreach(var key in stale)m_Progress.Remove(key);
        }
    }
}
