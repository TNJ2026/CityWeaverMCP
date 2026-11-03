using System;
using Game.Prefabs;
using Game.Rendering;
using Game.Objects;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Mathematics;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private static JObject VehicleDoorConfiguration(McpVehicleDoorProperties doors)
            =>doors==null?null:new JObject{["active"]=doors.active,["door_count"]=doors.m_Doors?.Length??0,["doors"]=JArray.FromObject(doors.m_Doors??Array.Empty<McpVehicleDoorProperties.Door>())};
        private JObject GetVehicleAnimationState(JObject args,World world)
        {
            var em=world.EntityManager;var entity=ParseEntity((string)args["vehicle_id"],em);
            if(!em.HasComponent<Game.Vehicles.Vehicle>(entity))throw new QueryException("NOT_VEHICLE","Select a live vehicle entity.");
            em.CompleteAllTrackedJobs();var ps=world.GetExistingSystemManaged<PrefabSystem>();
            var prefab=em.GetComponentData<PrefabRef>(entity).m_Prefab;var parts=new JArray();
            bool ready=em.HasBuffer<Skeleton>(entity)&&em.HasBuffer<Bone>(entity)&&em.HasBuffer<SubMesh>(prefab);
            var flags=em.HasComponent<InterpolatedTransform>(entity)?em.GetComponentData<InterpolatedTransform>(entity).m_Flags:0;
            var signal=McpVehicleDoorSystem.ReadSignal(em,entity);
            bool registered=ps.TryGetPrefab<PrefabBase>(prefab,out var vehiclePrefab)&&vehiclePrefab is VehiclePrefab vehicle&&McpVehicleDoorSystem.Targets.Contains(vehicle);
            if(ready)
            {
                var meshes=em.GetBuffer<SubMesh>(prefab,true);var skeletons=em.GetBuffer<Skeleton>(entity,true);var bones=em.GetBuffer<Bone>(entity,true);
                for(int part=0;part<math.min(meshes.Length,skeletons.Length);part++)
                {
                    var mesh=meshes[part].m_SubMesh;if(!ps.TryGetPrefab<RenderPrefab>(mesh,out var render)||!em.HasBuffer<ProceduralBone>(mesh))continue;
                    var rig=render.GetComponent<ProceduralAnimationProperties>();var procedural=em.GetBuffer<ProceduralBone>(mesh,true);var rows=new JArray();
                    for(int i=0;i<procedural.Length;i++)
                    {
                        int index=skeletons[part].m_BoneOffset+i;if(index<0||index>=bones.Length)continue;
                        var p=procedural[i];var b=bones[index];var name=rig?.m_Bones!=null&&p.m_BindIndex>=0&&p.m_BindIndex<rig.m_Bones.Length?rig.m_Bones[p.m_BindIndex].name:null;
                        rows.Add(new JObject{["name"]=name,["type"]=p.m_Type.ToString(),["position"]=new JArray(b.m_Position.x,b.m_Position.y,b.m_Position.z),["rotation_xyzw"]=new JArray(b.m_Rotation.value.x,b.m_Rotation.value.y,b.m_Rotation.value.z,b.m_Rotation.value.w)});
                    }
                    var doors=McpLegacyCompatibility.ReadDoors(render);
                    parts.Add(new JObject{["part"]=part,["render_prefab"]=render.name,["allocated"]=!skeletons[part].m_BufferAllocation.Empty,["bones"]=rows,["door_configuration"]=VehicleDoorConfiguration(doors)});
                }
            }
            return new JObject{["vehicle_id"]=EntityId(entity),["skeleton_ready"]=ready,["speed_m_s"]=em.HasComponent<Moving>(entity)?math.length(em.GetComponentData<Moving>(entity).m_Velocity):0,
                ["boarding_left"]=signal.Left,["boarding_right"]=signal.Right,["boarding"]=signal.Boarding,["door_signal_source"]=signal.Source,["public_transport_state"]=signal.TransportState,["door_controller_registered"]=registered,
                ["interpolated_boarding_left"]=(flags&TransformFlags.BoardingLeft)!=0,["interpolated_boarding_right"]=(flags&TransformFlags.BoardingRight)!=0,["parts"]=parts,
                ["note"]="Rendering snapshot: only allocated/visible skeletons update. Compare wheel rotations across moving frames and door rotations across real boarding transitions; metadata alone does not prove animation."};
        }
    }
}
