using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Game.Common;
using Game.Prefabs;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;
using UnityEngine;

namespace CityWeaver
{
    internal sealed class VehicleModelOperation
    {
        internal string Id=Guid.NewGuid().ToString("N"),Request,Session,Fingerprint,Path,Hash,Baseline,AppliedSignature,EffectSignature,State="preview_ready",Error;
        internal DateTime Expires=DateTime.UtcNow.AddMinutes(10),Deadline;
        internal VehiclePrefab Target,Staged;
        internal ObjectMeshInfo[] Original;
        internal EffectSource OriginalEffects;
        internal RenderPrefab[] Renders;
        internal readonly Dictionary<RenderPrefab,string> Sources=new Dictionary<RenderPrefab,string>();
        internal JArray Changes=new JArray();
        internal readonly List<VehicleRouteColorMask> RouteColorMasks=new List<VehicleRouteColorMask>();
        internal int InstanceCount,RouteCacheHits,RouteCacheWrites;
        internal bool Dispatched;
        internal JObject Configuration;
        internal Entity Before;
        internal McpVehicleRouteReferenceSystem.Pending RouteReferences;
        internal void Refresh(){if(State=="preview_ready"&&DateTime.UtcNow>Expires){State="expired";RouteColorMasks.Clear();}}
        internal JObject Json(){Refresh();return new JObject{["operation_id"]=Id,["request_id"]=Request,["session_id"]=Session,["state"]=State,["error"]=Error,["can_commit"]=State=="preview_ready",["dispatched"]=Dispatched,["prefab"]=Target?.name,["affected_instances_at_preview"]=InstanceCount,["route_references_synchronized"]=RouteReferences?.Synced??false,["updated_route_count"]=RouteReferences?.Routes??0,["updated_route_reference_count"]=RouteReferences?.References??0,["route_color_cache_hits"]=RouteCacheHits,["route_color_cache_writes"]=RouteCacheWrites,["changes"]=Changes.DeepClone(),["expires_at_utc"]=Expires.ToString("O"),["scope"]="All existing and future instances of this vehicle prefab; vehicle behavior components remain on the original prefab",["persistence"]="Verified overrides are stored with the next city save and restored automatically on load. Imported source assets must remain installed. Manual restore removes the saved override.",["verification"]="Native prefab/submesh readback; inspect wheels, animations, lights and driving visually after apply"};}
    }
    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string,VehicleModelOperation> m_VehicleModels=new Dictionary<string,VehicleModelOperation>();
        private readonly Dictionary<string,string> m_VehicleModelRequests=new Dictionary<string,string>();
        private readonly List<VehicleModelOperation> m_VehicleModelOrder=new List<VehicleModelOperation>();
        private static void VehicleFields(JObject value,params string[] allowed){foreach(var field in value.Properties())if(!allowed.Contains(field.Name))throw new QueryException("INVALID_VEHICLE_CONFIG","Unknown configuration field: "+field.Name);}
        private static JArray VehicleArray(JObject obj,string key){if(obj[key]==null)return null;if(!(obj[key] is JArray array))throw new QueryException("INVALID_VEHICLE_CONFIG",key+" must be an array.");return array;}
        private static T VehicleEnum<T>(string text) where T:struct {if(!Enum.TryParse<T>(text,false,out var value)||!Enum.IsDefined(typeof(T),value))throw new QueryException("INVALID_VEHICLE_CONFIG","Unknown "+typeof(T).Name+": "+text);return value;}
        private static float VehicleNumber(JObject obj,string key,float fallback,float min,float max){float value=(float?)obj[key]??fallback;VehicleModelRules.Finite(value,min,max,key);return value;}
        private static Vector3 VehicleVector(JToken token,Vector3 fallback,float limit=1000){if(token==null)return fallback;var a=token as JArray;if(a==null||a.Count!=3)throw new QueryException("INVALID_VEHICLE_CONFIG","Expected a three-number vector.");var v=new Vector3((float)a[0],(float)a[1],(float)a[2]);VehicleModelRules.Finite(v.x,-limit,limit,"x");VehicleModelRules.Finite(v.y,-limit,limit,"y");VehicleModelRules.Finite(v.z,-limit,limit,"z");return v;}
        private static string VehicleComponents(PrefabBase prefab){var components=new List<ComponentBase>();prefab.GetComponents(components);return string.Join("|",components.Select(c=>c is McpVehicleDoorProperties doors?VehicleDoorConfiguration(doors).ToString(Formatting.None):JsonUtility.ToJson(c)));}
        private static int VehicleIndex(JObject args,string key,int fallback,int min,int max){int value=ComponentInspector.Int(args,key,fallback,min,max);if(value<min||value>max)throw new QueryException("INVALID_VEHICLE_CONFIG",key+" is missing or out of range.");return value;}
        private static string VehicleRenderSignature(RenderPrefab render)=>VehicleComponents(render)+"|"+string.Join("|",render.surfaceAssets.Select(s=>s==null?"null":SurfaceSignature(s)));
        private static string VehicleSignature(VehiclePrefab vehicle)=>VehicleComponents(vehicle)+"|"+string.Join("|",(vehicle.m_Meshes??Array.Empty<ObjectMeshInfo>()).Select(p=>p.m_Mesh is RenderPrefab r?VehicleRenderSignature(r):p.m_Mesh?.name));
        private VehiclePrefab ResolveVehicle(JObject args,World world,out Entity entity){entity=ResolveEditorAsset(args,world,out var prefab);if(!(prefab is VehiclePrefab vehicle))throw new QueryException("NOT_VEHICLE_PREFAB","Select a native vehicle prefab, including cars, trains, ships or aircraft.");return vehicle;}
        private static int VehicleInstances(World world,Entity prefab){int count=0;using(var query=world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<PrefabRef>(),ComponentType.ReadOnly<Game.Vehicles.Vehicle>(),ComponentType.Exclude<Deleted>()))using(var entities=query.ToEntityArray(Allocator.Temp))foreach(var e in entities)if(world.EntityManager.GetComponentData<PrefabRef>(e).m_Prefab==prefab)count++;return count;}
        private JObject ListVehicleModels(JObject args,World world)
        {
            string search=(string)args["search"]??"";int offset=ComponentInspector.Int(args,"offset",0,0,100000),limit=ComponentInspector.Int(args,"limit",30,1,100);var rows=new List<JObject>();var ps=world.GetExistingSystemManaged<PrefabSystem>();
            using(var query=world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(),ComponentType.Exclude<Deleted>()))using(var entities=query.ToEntityArray(Allocator.Temp))foreach(var e in entities)
                if(ps.TryGetPrefab<PrefabBase>(e,out var loaded)&&loaded is VehiclePrefab p&&VehicleModelRules.MatchesName(p.name,search))rows.Add(new JObject{["prefab"]=p.name,["prefab_id"]=EntityId(e),["type"]=p.GetType().Name,["mesh_parts"]=p.m_Meshes?.Length??0});
            rows=rows.OrderBy(r=>(string)r["prefab"],StringComparer.Ordinal).ToList();return new JObject{["total"]=rows.Count,["offset"]=offset,["next_offset"]=offset+limit<rows.Count?(int?)(offset+limit):null,["items"]=new JArray(rows.Skip(offset).Take(limit))};
        }
        private JObject GetVehicleModel(JObject args,World world)
        {
            var entity=ResolveEditorAsset(args,world,out var inspected);var vehicle=inspected as ObjectGeometryPrefab;var modelParts=vehicle?.m_Meshes;if(inspected is RenderPrefab rootRender)modelParts=new[]{new ObjectMeshInfo{m_Mesh=rootRender}};if(modelParts==null)throw new QueryException("NO_MODEL_GEOMETRY","Select a vehicle, imported object or render prefab.");var ps=world.GetExistingSystemManaged<PrefabSystem>();var parts=new JArray();
            for(int i=0;i<(modelParts?.Length??0);i++){
                var part=modelParts[i];var render=part.m_Mesh as RenderPrefab;var rig=render?.GetComponent<ProceduralAnimationProperties>();var lights=render?.GetComponent<EmissiveProperties>();
                parts.Add(new JObject{["index"]=i,["render_prefab"]=part.m_Mesh?.name,["render_prefab_id"]=render==null?null:EntityId(ps.GetEntity(render)),["position"]=new JArray(part.m_Position.x,part.m_Position.y,part.m_Position.z),["rotation_degrees"]=render==null?null:new JArray(((Quaternion)part.m_Rotation).eulerAngles.x,((Quaternion)part.m_Rotation).eulerAngles.y,((Quaternion)part.m_Rotation).eulerAngles.z),["required_state"]=part.m_RequireState.ToString(),["material_count"]=render?.materialCount??0,["door_configuration"]=VehicleDoorConfiguration(render?.GetComponent<McpVehicleDoorProperties>()),["color_configuration"]=render?.GetComponent<ColorProperties>() is ColorProperties colorProperties?JObject.Parse(JsonUtility.ToJson(colorProperties)):null,["bones"]=rig?.m_Bones==null?new JArray():new JArray(rig.m_Bones.Select((b,index)=>new JObject{["index"]=index,["name"]=b.name,["parent"]=b.parentId,["type"]=b.m_Type.ToString(),["position"]=new JArray(b.position.x,b.position.y,b.position.z),["speed"]=b.m_Speed,["acceleration"]=b.m_Acceleration,["connection_id"]=b.m_ConnectionID,["source_id"]=b.m_SourceID})),["animations"]=rig?.m_Animations==null?new JArray():new JArray(rig.m_Animations.Select((a,index)=>new JObject{["index"]=index,["name"]=a.name,["layer"]=a.layer.ToString(),["state"]=a.state.ToString(),["playback"]=a.playback.ToString(),["frames"]=a.frameCount})),["emissive_configuration"]=lights==null?null:JObject.Parse(JsonUtility.ToJson(lights))});
            }
            var effects=vehicle?.GetComponent<EffectSource>();
            return new JObject{["persistence"]=world.GetOrCreateSystemManaged<McpVehicleModelPersistenceSystem>().Status(inspected.name),["prefab"]=inspected.name,["prefab_id"]=EntityId(entity),["type"]=inspected.GetType().Name,["instances"]=vehicle is VehiclePrefab?VehicleInstances(world,entity):0,["parts"]=parts,["effects"]=effects==null?null:JObject.Parse(JsonUtility.ToJson(effects)),["object_states"]=new JArray(Enum.GetNames(typeof(Game.Objects.ObjectState))),["bone_types"]=new JArray(Enum.GetNames(typeof(BoneType))),["light_purposes"]=new JArray(Enum.GetNames(typeof(EmissiveProperties.Purpose))),["animation_layers"]=new JArray(Enum.GetNames(typeof(AnimationLayer))),["clip_states"]=new JArray(Enum.GetNames(typeof(ClipState))),["animation_playback"]=new JArray(Enum.GetNames(typeof(AnimationPlayback))),["workflow"]="Import FBX/OBJ -> inspect list_asset_materials for exact render prefab -> JSON configuration -> preview_vehicle_replacement -> apply_vehicle_replacement -> get_vehicle_replacement_operation -> visual verification. Texture edits use existing preview_texture_replacement on returned private render prefabs.",["rig_requirement"]="Wheel positions, bind poses and skin weights must be authored in the source model; Plain OBJ has no skinning. Optional cityweaver-rig.json authors rigid groups, tire roles and boarding-driven door hinges. Configure procedural roles by bone name. Source dimensions are metres; rescale in the native model import settings or source authoring tool."};
        }
        private VehicleModelOperation VehicleOperation(JObject args){if(!m_VehicleModels.TryGetValue((string)args["operation_id"]??"",out var op))throw new QueryException("UNKNOWN_VEHICLE_REPLACEMENT","Unknown vehicle replacement operation.");op.Refresh();return op;}
        private JObject PreviewVehicleReplacement(JObject args,World world,JObject savedConfiguration=null)
        {
            string request=RequestKey(args),fingerprint=new JObject(args.Properties().OrderBy(p=>p.Name,StringComparer.Ordinal).Select(p=>new JProperty(p.Name,p.Value.DeepClone()))).ToString(Formatting.None);
            if(m_VehicleModelRequests.TryGetValue(request,out var previous)){var old=m_VehicleModels[previous];if(old.Fingerprint!=fingerprint)throw new QueryException("IDEMPOTENCY_CONFLICT","request_id belongs to different arguments.");return old.Json();}
            AssetFilesIdle(world,savedConfiguration!=null);if(m_VehicleModels.Count>=128)throw new QueryException("VEHICLE_OPERATION_LIMIT","Vehicle operation journal is full.");
            var target=ResolveVehicle(args,world,out var entity);
            if(m_VehicleModelOrder.Any(o=>o.Target==target&&o.Session==m_Session&&o.Dispatched&&o.State!="restored"&&o.State!="failed"))throw new QueryException("VEHICLE_OVERRIDE_ACTIVE","Restore the existing override for this vehicle before replacing again.");
            string path=null;
            if(savedConfiguration==null){path=AssetFileRules.LocalPath((string)args["configuration_path"],false);if(new FileInfo(path).Length>1024*1024)throw new QueryException("INVALID_VEHICLE_CONFIG","Configuration exceeds 1 MiB.");}
            var config=savedConfiguration==null?JObject.Parse(File.ReadAllText(path)):(JObject)savedConfiguration.DeepClone();VehicleFields(config,"parts","effects");var entries=config["parts"] as JArray;
            if(entries==null||entries.Count<1||entries.Count>64)throw new QueryException("INVALID_VEHICLE_CONFIG","parts requires 1..64 entries, in final mesh order.");
            var op=new VehicleModelOperation{Request=request,Fingerprint=fingerprint,Session=m_Session,Path=path,Hash=path==null?null:AssetFileRules.Hash(path),Configuration=config,Target=target,Original=target.m_Meshes,Baseline=VehicleSignature(target),InstanceCount=VehicleInstances(world,entity)};
            op.Staged=(VehiclePrefab)target.Clone("CityWeaver_VehiclePreview_"+op.Id);
            op.OriginalEffects=op.Staged.GetComponent<EffectSource>();
            // Snapshot effects on a separate component: the staged copy may be edited below.
            if(op.OriginalEffects!=null)op.OriginalEffects=UnityEngine.Object.Instantiate(op.OriginalEffects);
            var meshes=new List<ObjectMeshInfo>();var clones=new List<RenderPrefab>();
            try{
                foreach(JObject entry in entries){
                    VehicleFields(entry,"render_prefab","render_prefab_id","position","rotation_degrees","original_part","rig_mode","color_mode","route_color","bones","animations","lights","required_state");
                    int original=ComponentInspector.Int(entry,"original_part",Math.Min(meshes.Count,(target.m_Meshes?.Length??1)-1),0,63);
                    if(target.m_Meshes==null||original>=target.m_Meshes.Length)throw new QueryException("INVALID_VEHICLE_CONFIG","original_part does not exist.");
                    var oldPart=target.m_Meshes[original];var oldRender=oldPart.m_Mesh as RenderPrefab;
                    var selection=new JObject{["prefab"]=(string)entry["render_prefab"]};if(entry["render_prefab_id"]!=null)selection["prefab_id"]=entry["render_prefab_id"].DeepClone();if(selection["prefab"].Type==JTokenType.Null)selection.Remove("prefab");
                    ResolveEditorAsset(selection,world,out var sourcePrefab);if(!(sourcePrefab is RenderPrefab source)||source.geometryAsset==null||source.isImpostor)throw new QueryException("INVALID_VEHICLE_MODEL","Select an ordinary native RenderPrefab, not an object root or impostor.");
                    // Entity IDs belong to a load session. Store the resolved asset name instead.
                    entry["render_prefab"]=source.name;entry.Remove("render_prefab_id");
                    op.Sources[source]=VehicleRenderSignature(source);
                    var clone=(RenderPrefab)source.Clone("CityWeaver_Vehicle_"+op.Id+"_"+meshes.Count);clones.Add(clone);
                    var sourceDoors=McpLegacyCompatibility.ReadDoors(source);
                    if(sourceDoors!=null)clone.AddOrGetComponent<McpVehicleDoorProperties>().m_Doors=McpVehicleDoorProperties.CopyDoors(sourceDoors.m_Doors);
                    ConfigureVehicleRig(clone,oldRender,entry);
                    string colorMode=(string)entry["color_mode"]??"source";
                    if(colorMode!="source"&&colorMode!="original"&&colorMode!="route")throw new QueryException("INVALID_VEHICLE_CONFIG","color_mode must be source, original or route.");
                    if(colorMode=="route")PrepareVehicleRouteColor(op,clone,entry["route_color"] as JObject);
                    else if(entry["route_color"]!=null)throw new ArgumentException("route_color requires color_mode route.");
                    if(colorMode=="original"){if(oldRender==null||oldRender.materialCount!=clone.materialCount)throw new QueryException("VEHICLE_COLOR_MISMATCH","Original color mappings require matching material slot count.");var colors=oldRender.GetComponent<ColorProperties>();if(colors!=null)clone.AddComponentFrom(colors);else clone.Remove<ColorProperties>();}
                    ConfigureVehicleLights(clone,VehicleArray(entry,"lights"));
                    ValidateVehicleMesh(clone);
                    var position=VehicleVector(entry["position"],(Vector3)oldPart.m_Position);var rotation=entry["rotation_degrees"]==null?(Quaternion)oldPart.m_Rotation:Quaternion.Euler(VehicleVector(entry["rotation_degrees"],Vector3.zero,360));
                    meshes.Add(new ObjectMeshInfo{m_Mesh=clone,m_Position=(float3)position,m_Rotation=(quaternion)rotation,m_RequireState=entry["required_state"]==null?oldPart.m_RequireState:VehicleEnum<Game.Objects.ObjectState>((string)entry["required_state"])});
                    op.Changes.Add(new JObject{["part"]=meshes.Count-1,["source_render"]=source.name,["replacement_render"]=clone.name,["rig_mode"]=(string)entry["rig_mode"]??"source",["color_mode"]=colorMode,["door_count"]=McpLegacyCompatibility.ReadDoors(clone)?.m_Doors?.Length??0,["route_paint_pixels"]=op.RouteColorMasks.Where(m=>m.Render==clone).Sum(m=>m.PaintPixels),["bones"]=clone.GetComponent<ProceduralAnimationProperties>()?.m_Bones?.Length??0,["animations"]=clone.GetComponent<ProceduralAnimationProperties>()?.m_Animations?.Length??0,["materials"]=clone.materialCount});
                }
                op.Renders=clones.ToArray();op.Staged.m_Meshes=meshes.ToArray();ConfigureVehicleEffects(op.Staged,VehicleArray(config,"effects"));
                m_VehicleModels.Add(op.Id,op);m_VehicleModelRequests.Add(request,op.Id);m_VehicleModelOrder.Add(op);return op.Json();
            }catch{op.RouteColorMasks.Clear();foreach(var clone in clones)UnityEngine.Object.Destroy(clone);UnityEngine.Object.Destroy(op.Staged);if(op.OriginalEffects!=null)UnityEngine.Object.Destroy(op.OriginalEffects);throw;}
        }
        private static void ConfigureVehicleRig(RenderPrefab render,RenderPrefab donor,JObject entry)
        {
            var rig=render.GetComponent<ProceduralAnimationProperties>();var old=donor?.GetComponent<ProceduralAnimationProperties>();string mode=(string)entry["rig_mode"]??"source";
            if(mode!="source"&&mode!="original_by_name")throw new QueryException("INVALID_VEHICLE_CONFIG","rig_mode must be source or original_by_name.");
            if(mode=="original_by_name"){
                if(rig?.m_Bones==null||old?.m_Bones==null)throw new QueryException("VEHICLE_RIG_MISSING","Both meshes need authored skinning and bone names; OBJ cannot acquire a skeleton by copying metadata.");
                int[] map=VehicleModelRules.Match(rig.m_Bones.Select(b=>b.name).ToArray(),old.m_Bones.Select(b=>b.name).ToArray());
                for(int i=0;i<map.Length;i++){
                    var b=rig.m_Bones[i];var source=old.m_Bones[map[i]];
                    int parent=b.parentId<0?-1:map[b.parentId];if(parent!=source.parentId)throw new QueryException("VEHICLE_RIG_MISMATCH","Bone hierarchy differs from original.");
                    b.m_Type=source.m_Type;b.m_Speed=source.m_Speed;b.m_Acceleration=source.m_Acceleration;b.m_ConnectionID=source.m_ConnectionID;
                    // Native MeshSystem resolves SourceID against ConnectionID, not a bone array index.
                    b.m_SourceID=source.m_SourceID;
                }
                if(old.m_Animations!=null&&old.m_Animations.Length>0){
                    // Clip channels reference bone indices/rest poses. Name-only correspondence is insufficient.
                    for(int i=0;i<map.Length;i++)if(map[i]!=i || rig.m_Bones[i].bindPose!=old.m_Bones[i].bindPose)throw new QueryException("VEHICLE_CLIP_MISMATCH","Original clips require identical bone order and bind poses; use source clips otherwise.");
                    rig.m_Animations=JsonUtility.FromJson<VehicleAnimationCopy>(JsonUtility.ToJson(new VehicleAnimationCopy{items=old.m_Animations})).items;
                }
            }
            if(entry["bones"]!=null){
                if(rig?.m_Bones==null)throw new QueryException("VEHICLE_RIG_MISSING","Bone mapping requires a rigged source model.");
                var seen=new HashSet<string>();var entries=entry["bones"] as JArray;if(entries==null||entries.Count>256)throw new QueryException("INVALID_VEHICLE_CONFIG","Invalid bone mappings.");
                foreach(JObject patch in entries){
                    VehicleFields(patch,"name","type","speed","acceleration","connection_id","source_id");string name=(string)patch["name"];
                    var b=rig.m_Bones.SingleOrDefault(x=>x.name==name);if(b==null||!seen.Add(name))throw new QueryException("INVALID_VEHICLE_CONFIG","Unknown or duplicate bone: "+name);
                    if(patch["type"]!=null)b.m_Type=VehicleEnum<BoneType>((string)patch["type"]);
                    b.m_Speed=VehicleNumber(patch,"speed",b.m_Speed,-10000,10000);b.m_Acceleration=VehicleNumber(patch,"acceleration",b.m_Acceleration,0,10000);
                    b.m_ConnectionID=VehicleIndex(patch,"connection_id",b.m_ConnectionID,0,900);b.m_SourceID=VehicleIndex(patch,"source_id",b.m_SourceID,0,900);
                }
            }
            if(entry["animations"]!=null){
                var patches=entry["animations"] as JArray;if(patches==null||patches.Count>128||rig?.m_Animations==null)throw new QueryException("VEHICLE_ANIMATION_MISSING","Animation mapping requires imported native clips.");var seen=new HashSet<int>();
                foreach(JObject patch in patches){VehicleFields(patch,"index","layer","state","playback","acceleration");int index=VehicleIndex(patch,"index",-1,0,rig.m_Animations.Length-1);if(!seen.Add(index))throw new QueryException("INVALID_VEHICLE_CONFIG","Duplicate animation index.");var a=rig.m_Animations[index];if(patch["layer"]!=null)a.layer=VehicleEnum<AnimationLayer>((string)patch["layer"]);if(patch["state"]!=null)a.state=VehicleEnum<ClipState>((string)patch["state"]);if(patch["playback"]!=null)a.playback=VehicleEnum<AnimationPlayback>((string)patch["playback"]);a.acceleration=VehicleNumber(patch,"acceleration",a.acceleration,0,10000);}
            }
        }
        [Serializable] private sealed class VehicleAnimationCopy { public ProceduralAnimationProperties.AnimationInfo[] items; }
        private static void ConfigureVehicleLights(RenderPrefab render,JArray patches)
        {
            if(patches==null)return;if(patches.Count>256)throw new QueryException("INVALID_VEHICLE_CONFIG","Too many lights.");
            var lights=render.AddOrGetComponent<EmissiveProperties>();lights.m_SingleLights=new List<EmissiveProperties.SingleLightMapping>();lights.m_MultiLights=new List<EmissiveProperties.MultiLightMapping>();var seen=new HashSet<string>();
            foreach(JObject patch in patches){
                VehicleFields(patch,"material_id","layer_id","purpose","color","color_off","intensity","luminance","response_time","animation_index");
                if((patch["material_id"]==null)==(patch["layer_id"]==null))throw new QueryException("INVALID_VEHICLE_CONFIG","Light needs exactly one material_id or layer_id.");
                EmissiveProperties.LightProperties light;string key;
                if(patch["material_id"]!=null){int id=VehicleIndex(patch,"material_id",-1,0,render.materialCount-1);var single=new EmissiveProperties.SingleLightMapping{materialId=id};lights.m_SingleLights.Add(single);light=single;key="material:"+id;}
                else{int id=VehicleIndex(patch,"layer_id",-1,0,255);var multi=new EmissiveProperties.MultiLightMapping{layerId=id};lights.m_MultiLights.Add(multi);light=multi;key="layer:"+id;}
                if(!seen.Add(key))throw new QueryException("INVALID_VEHICLE_CONFIG","Duplicate light mapping.");
                light.purpose=VehicleEnum<EmissiveProperties.Purpose>((string)patch["purpose"]);var color=VehicleVector(patch["color"],Vector3.one,1);var off=VehicleVector(patch["color_off"],Vector3.zero,1);
                if(color.x<0||color.y<0||color.z<0||off.x<0||off.y<0||off.z<0)throw new QueryException("INVALID_VEHICLE_CONFIG","Light colors must be RGB 0..1.");
                light.color=new Color(color.x,color.y,color.z,1);light.colorOff=new Color(off.x,off.y,off.z,1);light.intensity=VehicleNumber(patch,"intensity",1,0,10000);light.luminance=VehicleNumber(patch,"luminance",1,0,10000);light.responseTime=VehicleNumber(patch,"response_time",.1f,0,60);light.animationIndex=VehicleIndex(patch,"animation_index",-1,-1,(lights.m_AnimationCurves?.Count??0)-1);
            }
        }
        private static void ConfigureVehicleEffects(VehiclePrefab vehicle,JArray patches)
        {
            var effects=vehicle.GetComponent<EffectSource>();
            if(patches!=null){if(patches.Count>128||effects?.m_Effects==null)throw new QueryException("INVALID_VEHICLE_CONFIG","Effect configuration requires original vehicle effects.");var seen=new HashSet<int>();
                foreach(JObject patch in patches){VehicleFields(patch,"index","position","rotation_degrees","scale","intensity","parent_mesh","animation_index");int index=VehicleIndex(patch,"index",-1,0,effects.m_Effects.Count-1);if(!seen.Add(index))throw new QueryException("INVALID_VEHICLE_CONFIG","Duplicate effect index.");var effect=effects.m_Effects[index];effect.m_PositionOffset=(float3)VehicleVector(patch["position"],(Vector3)effect.m_PositionOffset);if(patch["rotation_degrees"]!=null)effect.m_Rotation=(quaternion)Quaternion.Euler(VehicleVector(patch["rotation_degrees"],Vector3.zero,360));var scale=VehicleVector(patch["scale"],(Vector3)effect.m_Scale,100);if(scale.x<=0||scale.y<=0||scale.z<=0)throw new QueryException("INVALID_VEHICLE_CONFIG","Effect scale must be positive.");effect.m_Scale=(float3)scale;effect.m_Intensity=VehicleNumber(patch,"intensity",effect.m_Intensity,.0001f,10000);effect.m_ParentMesh=VehicleIndex(patch,"parent_mesh",effect.m_ParentMesh,-1,vehicle.m_Meshes.Length-1);effect.m_AnimationIndex=VehicleIndex(patch,"animation_index",effect.m_AnimationIndex,-1,(effects.m_AnimationCurves?.Count??0)-1);}
            }
            if(effects?.m_Effects!=null)foreach(var effect in effects.m_Effects)if(effect.m_ParentMesh>=vehicle.m_Meshes.Length||effect.m_ParentMesh< -1)throw new QueryException("VEHICLE_EFFECT_MISMATCH","Original light/effect parent mesh no longer exists; supply effect parent mapping.");
        }
        private static void ValidateVehicleMesh(RenderPrefab render)
        {
            var rig=render.GetComponent<ProceduralAnimationProperties>();var bones=rig?.m_Bones??Array.Empty<ProceduralAnimationProperties.BoneInfo>();
            VehicleModelRules.Hierarchy(bones.Select(b=>b.name).ToArray(),bones.Select(b=>b.parentId).ToArray());
            var doors=McpLegacyCompatibility.ReadDoors(render);
            if(doors?.m_Doors!=null)
            {
                var seen=new HashSet<string>();
                foreach(var door in doors.m_Doors)
                {
                    var bone=bones.SingleOrDefault(b=>b.name==door.bone);
                    if(bone==null||bone.m_Type!=BoneType.None||bone.parentId!=0||!seen.Add(door.bone))throw new QueryException("VEHICLE_DOOR_RIG_INVALID","Doors require unique root-child None bones.");
                    VehicleModelRules.Finite(door.angle,-120,120,"door angle");VehicleModelRules.Finite(door.duration,.1f,10,"door duration");
                }
            }
            if(rig?.m_Animations!=null){if(rig.m_Animations.Length>128)throw new QueryException("VEHICLE_CLIP_LIMIT","Too many clips.");for(int i=0;i<rig.m_Animations.Length;i++){var a=rig.m_Animations[i];if(a==null||a.frameCount<1||a.frameRate<1||rig.GetAnimation(i)==null)throw new QueryException("VEHICLE_CLIP_MISSING","Animation clip asset or timing is invalid.");}}
            var meshes=render.ObtainMeshes();
            try{
                if(meshes==null||meshes.Length==0||meshes.Sum(m=>(long)m.vertexCount)>2000000)throw new QueryException("VEHICLE_MESH_LIMIT","Empty mesh or more than 2 million vertices.");
                foreach(var mesh in meshes){
                    if(!AssetFileRules.ValidBounds(mesh.bounds.min.x,mesh.bounds.min.y,mesh.bounds.min.z,mesh.bounds.max.x,mesh.bounds.max.y,mesh.bounds.max.z))throw new QueryException("VEHICLE_MESH_INVALID","Invalid mesh bounds.");
                    if(mesh.bounds.size.magnitude>1000)throw new QueryException("VEHICLE_MESH_SCALE","Model exceeds 1000 metres; fix source/import units.");
                    if(doors!=null){ObjRigidRig.ValidateSkin(mesh,bones.Length);continue;}
                    var weights=mesh.boneWeights;if(weights.Length>0&&bones.Length==0)throw new QueryException("VEHICLE_RIG_MISSING","Skinned geometry lacks procedural bone metadata.");
                    foreach(var w in weights){VehicleModelRules.Weight(w.weight0,w.boneIndex0,bones.Length);VehicleModelRules.Weight(w.weight1,w.boneIndex1,bones.Length);VehicleModelRules.Weight(w.weight2,w.boneIndex2,bones.Length);VehicleModelRules.Weight(w.weight3,w.boneIndex3,bones.Length);}
                }
            }finally{render.ReleaseMeshes();}
        }
        private JObject ApplyVehicleReplacement(JObject args,World world,bool automatic=false)
        {
            var op=VehicleOperation(args);if((string)args["request_id"]!=op.Request)throw new QueryException("IDEMPOTENCY_CONFLICT","Use original preview request_id.");if(op.Dispatched)return ReadVehicleOperation(args,world);
            if(op.State!="preview_ready"||op.Session!=m_Session)throw new QueryException("VEHICLE_PREVIEW_STALE","Preview expired or belongs to an old session.");AssetFilesIdle(world,automatic);
            if((op.Path!=null&&AssetFileRules.Hash(op.Path)!=op.Hash)||VehicleSignature(op.Target)!=op.Baseline||op.Sources.Any(p=>VehicleRenderSignature(p.Key)!=p.Value))throw new QueryException("VEHICLE_INPUT_CHANGED","Target, source model or configuration changed; create a new preview.");
            var ps=world.GetExistingSystemManaged<PrefabSystem>();int count=VehicleInstances(world,ps.GetEntity(op.Target));int max=ComponentInspector.Int(args,"max_affected_instances",-1,0,1000000);if(count>max)throw new QueryException("VEHICLE_INSTANCE_LIMIT","max_affected_instances must cover all current instances.");
            op.Dispatched=true;op.State="applying";op.Deadline=DateTime.UtcNow.AddSeconds(30);op.Before=ps.GetEntity(op.Target);
            try{
                ApplyVehicleRouteColors(op);
                foreach(var render in op.Renders)if(!ps.AddPrefab(render))throw new InvalidOperationException("Failed to register private render prefab.");
                op.Target.m_Meshes=op.Staged.m_Meshes;var effects=op.Staged.GetComponent<EffectSource>();if(effects!=null)op.Target.AddComponentFrom(effects);
                if(op.Renders.Any(r=>McpLegacyCompatibility.ReadDoors(r)?.m_Doors?.Length>0))McpVehicleDoorSystem.Targets.Add(op.Target);
                op.AppliedSignature=VehicleSignature(op.Target);op.EffectSignature=effects==null?null:JsonUtility.ToJson(op.Target.GetComponent<EffectSource>());
                op.RouteReferences=world.GetOrCreateSystemManaged<McpVehicleRouteReferenceSystem>().Track(op.Target,op.Before);
                ps.UpdatePrefab(op.Target);
            }catch(Exception e){op.State=op.Target.m_Meshes==op.Staged.m_Meshes?"outcome_unknown":"failed";op.Error=e.Message;op.RouteColorMasks.Clear();}
            return op.Json();
        }
        private static bool VehicleRenderReady(World world,Entity entity,RenderPrefab render)
        {
            var em=world.EntityManager;var rig=render.GetComponent<ProceduralAnimationProperties>();
            int count=rig?.m_Bones?.Length??0;
            if(count>0){
                if(!em.HasBuffer<ProceduralBone>(entity))return false;var bones=em.GetBuffer<ProceduralBone>(entity);if(bones.Length!=count)return false;
                foreach(var bone in bones){if(bone.m_BindIndex<0||bone.m_BindIndex>=count||bone.m_Type!=rig.m_Bones[bone.m_BindIndex].m_Type)return false;}
            }
            count=rig?.m_Animations?.Length??0;
            if(count>0){
                if(!em.HasBuffer<Game.Prefabs.AnimationClip>(entity))return false;var clips=em.GetBuffer<Game.Prefabs.AnimationClip>(entity);if(clips.Length!=count)return false;
                for(int i=0;i<count;i++)if(clips[i].m_Layer!=rig.m_Animations[i].layer||clips[i].m_ClipState!=rig.m_Animations[i].state||clips[i].m_Playback!=rig.m_Animations[i].playback)return false;
            }
            var lights=render.GetComponent<EmissiveProperties>();
            if(lights!=null&&lights.lightsCount>0){if(!em.HasBuffer<ProceduralLight>(entity)||em.GetBuffer<ProceduralLight>(entity).Length!=lights.lightsCount)return false;}
            var colors=render.GetComponent<ColorProperties>();
            if(colors?.m_ColorVariations?.Count>0){
                if(!em.HasBuffer<ColorVariation>(entity))return false;var variations=em.GetBuffer<ColorVariation>(entity);
                if(variations.Length!=colors.m_ColorVariations.Count)return false;
                foreach(var variation in variations){
                    if(variation.m_ColorSourceType!=colors.m_ExternalColorSource)return false;
                    for(sbyte channel=0;channel<3;channel++)if(variation.GetExternalChannelIndex(channel)!=(colors.CanBeModifiedByExternal(channel)?colors.m_ChannelsBinding[channel].m_ChannelId:-1))return false;
                }
            }
            return true;
        }
        private JObject ReadVehicleOperation(JObject args,World world)
        {
            var op=VehicleOperation(args);
            if(op.State=="applying"||op.State=="restoring"){
                if(op.Session!=m_Session){op.State="outcome_unknown";op.Error="Session changed during native update.";return op.Json();}
                world.EntityManager.CompleteAllTrackedJobs();var ps=world.GetExistingSystemManaged<PrefabSystem>();var entity=ps.GetEntity(op.Target);var expected=op.State=="restoring"?op.Original:op.Staged.m_Meshes;
                if(entity!=op.Before&&world.EntityManager.HasComponent<ObjectGeometryData>(entity)&&world.EntityManager.HasBuffer<SubMesh>(entity)){
                    var geometry=world.EntityManager.GetComponentData<ObjectGeometryData>(entity);var meshes=world.EntityManager.GetBuffer<SubMesh>(entity);bool valid=geometry.m_MinLod!=255&&meshes.Length==expected.Length&&AssetFileRules.ValidBounds(geometry.m_Bounds.min.x,geometry.m_Bounds.min.y,geometry.m_Bounds.min.z,geometry.m_Bounds.max.x,geometry.m_Bounds.max.y,geometry.m_Bounds.max.z);
                    for(int i=0;valid&&i<meshes.Length;i++)valid=meshes[i].m_SubMesh==ps.GetEntity(expected[i].m_Mesh)&&math.distance(meshes[i].m_Position,expected[i].m_Position)<.001f&&math.abs(math.dot(meshes[i].m_Rotation.value,expected[i].m_Rotation.value))>.9999f&&(!(expected[i].m_Mesh is RenderPrefab expectedRender)||VehicleRenderReady(world,meshes[i].m_SubMesh,expectedRender));
                    if(op.State=="applying"&&op.Renders.Any(r=>McpLegacyCompatibility.ReadDoors(r)?.m_Doors?.Length>0)&&!McpVehicleDoorSystem.Targets.Contains(op.Target))valid=false;
                    if(valid&&VehicleInstances(world,op.Before)==0&&world.GetOrCreateSystemManaged<McpVehicleRouteReferenceSystem>().Verified(op.RouteReferences,entity)){op.State=op.State=="restoring"?"restored":"completed";if(op.State=="completed"){op.AppliedSignature=VehicleSignature(op.Target);op.EffectSignature=op.Target.GetComponent<EffectSource>()==null?null:JsonUtility.ToJson(op.Target.GetComponent<EffectSource>());}op.Error=null;}
                }
                if((op.State=="applying"||op.State=="restoring")&&DateTime.UtcNow>op.Deadline){op.State="outcome_unknown";op.Error="Native prefab/instance replacement not verified within 30 seconds; inspect original operation, do not retry apply with a new request ID.";}
            }
            return op.Json();
        }
        private JObject RestoreVehicleReplacement(JObject args,World world)
        {
            var op=VehicleOperation(args);if(op.State=="restored"||op.State=="restoring")return ReadVehicleOperation(args,world);AssetFilesIdle(world);
            if(op.Session!=m_Session||!op.Dispatched||op.Target.m_Meshes!=op.Staged.m_Meshes)throw new QueryException("VEHICLE_RESTORE_CONFLICT","Only the active override in this session can be restored.");
            // A texture edit on a private render does not prevent restoring the original meshes.
            var effects=op.Target.GetComponent<EffectSource>();var stagedEffects=op.Staged.GetComponent<EffectSource>();
            if((effects==null)!=(stagedEffects==null)||effects!=null&&JsonUtility.ToJson(effects)!=op.EffectSignature)throw new QueryException("VEHICLE_RESTORE_CONFLICT","Vehicle effects were changed externally.");
            McpVehicleDoorSystem.Targets.Remove(op.Target);
            var ps=world.GetExistingSystemManaged<PrefabSystem>();op.Before=ps.GetEntity(op.Target);op.Target.m_Meshes=op.Original;if(op.OriginalEffects!=null)op.Target.AddComponentFrom(op.OriginalEffects);
            op.RouteReferences=world.GetOrCreateSystemManaged<McpVehicleRouteReferenceSystem>().Track(op.Target,op.Before);
            ps.UpdatePrefab(op.Target);op.State="restoring";op.Deadline=DateTime.UtcNow.AddSeconds(30);
            world.GetOrCreateSystemManaged<McpVehicleModelPersistenceSystem>().Forget(op.Target.name);
            return op.Json();
        }
        private JObject CancelVehicleReplacement(JObject args){var op=VehicleOperation(args);if(op.Dispatched)throw new QueryException("VEHICLE_ALREADY_DISPATCHED","Use restore_vehicle_replacement after apply.");if(op.State=="preview_ready"){op.State="cancelled";op.RouteColorMasks.Clear();}return op.Json();}
        private void ResetVehicleModels()
        {
            McpVehicleDoorSystem.Targets.Clear();
            var world=World.DefaultGameObjectInjectionWorld;
            foreach(var op in m_VehicleModelOrder.AsEnumerable().Reverse()){
                if(op.Dispatched&&op.Target!=null&&op.Staged!=null&&op.Target.m_Meshes==op.Staged.m_Meshes){op.Target.m_Meshes=op.Original;if(op.OriginalEffects!=null)op.Target.AddComponentFrom(op.OriginalEffects);if(world!=null&&world.IsCreated){var ps=world.GetExistingSystemManaged<PrefabSystem>();if(ps!=null){world.GetOrCreateSystemManaged<McpVehicleRouteReferenceSystem>().Track(op.Target,ps.GetEntity(op.Target));ps.UpdatePrefab(op.Target);}}op.State="restored";}
                else if(op.State=="preview_ready")op.State="expired";
            }
            m_VehicleModels.Clear();m_VehicleModelRequests.Clear();m_VehicleModelOrder.Clear();
        }
    }
}
