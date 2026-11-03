using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Colossal.IO.AssetDatabase;
using Game.Prefabs;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Entities;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private ObjectMeshInfo[] CompositionMeshes(string[] sources,World world,out string signature,out JArray description)
        {
            ModelCompositionRules.Sources(sources);
            var meshes=new List<ObjectMeshInfo>();var seen=new HashSet<RenderPrefabBase>();description=new JArray();
            foreach(var source in sources)
            {
                var entity=ResolveEditorAsset(new JObject{["prefab"]=source},world,out var prefab);
                if(!(prefab is StaticObjectPrefab model)||model.asset==null||!AssetImportPolicy.OwnedModel(model.name,model.asset.subPath))
                    throw new ArgumentException("Composition sources must be owned imported static objects.");
                if(!(bool)ImportedModelInfo(world,entity,model)["native_bounds_ready"]||model.m_Meshes==null||model.m_Meshes.Length==0)
                    throw new ArgumentException("Composition source geometry is not ready.");
                foreach(var part in model.m_Meshes)
                {
                    if(part==null||!(part.m_Mesh is RenderPrefab render)||render.asset==null||render.geometryAsset==null||render.indexCount<=0||render.vertexCount<=0)
                        throw new ArgumentException("Composition source has invalid render geometry.");
                    ModelCompositionRules.Render(render.materialCount,render.GetComponent<LodProperties>()?.m_LodMeshes?.Length??0);
                    if(!seen.Add(render)||meshes.Count>=32)throw new ArgumentException("Duplicate render module or more than 32 render modules.");
                    if(!Unity.Mathematics.math.all(Unity.Mathematics.math.isfinite(part.m_Position))||
                        !Unity.Mathematics.math.all(Unity.Mathematics.math.isfinite(part.m_Rotation.value))||
                        Math.Abs(Unity.Mathematics.math.lengthsq(part.m_Rotation.value)-1f)>.001f)
                        throw new ArgumentException("Composition source transform is invalid.");
                    if(!AssetFileRules.ValidBounds(render.bounds.min.x,render.bounds.min.y,render.bounds.min.z,render.bounds.max.x,render.bounds.max.y,render.bounds.max.z))
                        throw new ArgumentException("Composition render bounds invalid.");
                    var row=new JObject{["source"]=model.name,["source_asset"]=model.asset.id.ToString(),["render"]=render.name,
                        ["render_asset"]=render.asset.id.ToString(),["geometry"]=render.geometryAsset.id.ToString(),["indices"]=render.indexCount,
                        ["position"]=ModelCompositionJson.Position(part.m_Position),["rotation"]=ModelCompositionJson.Rotation(part.m_Rotation),["require_state"]=(int)part.m_RequireState,
                        ["surfaces"]=new JArray(Enumerable.Range(0,render.materialCount).Select(i=>SurfaceSignature(render.GetSurfaceAsset(i))))};
                    row["emissive_configuration"]=render.GetComponent<EmissiveProperties>() is EmissiveProperties lights
                        ?JObject.Parse(UnityEngine.JsonUtility.ToJson(lights)):null;
                    description.Add(row);
                    meshes.Add(new ObjectMeshInfo{m_Mesh=render,m_Position=part.m_Position,m_Rotation=part.m_Rotation,m_RequireState=part.m_RequireState});
                }
            }
            signature=description.ToString(Formatting.None);return meshes.ToArray();
        }
        private JObject PreviewModelComposition(JObject args,World world)
        {
            var op=NewAssetFile(args,"composition",out var existing);if(existing)return op.Json();AssetFilesIdle(world);
            var values=args["sources"] as JArray;
            if(values==null||values.Any(v=>v.Type!=JTokenType.String))throw new ArgumentException("sources must be an array of exact imported model names.");
            op.CompositionSources=values.Values<string>().ToArray();
            var meshes=CompositionMeshes(op.CompositionSources,world,out op.Baseline,out op.CompositionDescription);
            if(args["lights"]!=null){
                op.CompositionLights=args["lights"] as JArray;
                if(op.CompositionLights==null)throw new ArgumentException("lights must be an array.");
                ValidateCompositionLights(op.CompositionLights,meshes);
                op.CompositionLights=(JArray)op.CompositionLights.DeepClone();
            }
            var cost=(long?)args["construction_cost"]??0;
            if(cost<0||cost>10000000)throw new ArgumentException("construction_cost must be 0..10000000.");
            op.Preset=(string)args["preset"]??"static_object";
            if(op.Preset!= "static_object" && op.Preset!=OptionalHelicopterRuntime.HeliportPreset)
                throw new ArgumentException("Unknown composition preset.");
            if(op.Preset==OptionalHelicopterRuntime.HeliportPreset) {
                OptionalHelicopterRuntime.ValidateHeliport(meshes);
                if(args["lights"]!=null)throw new ArgumentException("Configure heliport lights on source modules first.");
            }
            op.ConstructionCost=(uint)cost;op.Bytes=0;
            return RememberAssetFile(op);
        }
        private async Task ComposeModel(AssetFileOperation op,ObjectMeshInfo[] meshes,World world)
        {
            try{
                RequireImportContext(op,world);
                var ps=world.GetExistingSystemManaged<PrefabSystem>();
                var model=op.Preset==OptionalHelicopterRuntime.HeliportPreset
                    ?(StaticObjectPrefab)OptionalHelicopterRuntime.CreateHeliport("CityWeaver_"+op.Id,meshes,ps)
                    :PrefabBase.Create<StaticObjectPrefab>("CityWeaver_"+op.Id);
                if(op.Preset!=OptionalHelicopterRuntime.HeliportPreset)model.m_Meshes=meshes;
                model.AddOrGetComponent<PlaceableObject>().m_ConstructionCost=op.ConstructionCost;
                var stage=Path.Combine(Colossal.PSI.Environment.EnvPath.kUserDataPath,"ModsData","CityWeaver","AssetCompositions",op.Id);
                Directory.CreateDirectory(stage);
                if(op.CompositionLights!=null){
                    ValidateCompositionLights(op.CompositionLights,meshes);
                    foreach(var group in op.CompositionLights.Cast<JObject>().GroupBy(p=>(int)p["mesh_index"])){
                        var source=(RenderPrefab)meshes[group.Key].m_Mesh;
                        var clone=(RenderPrefab)source.Clone(model.name+"_Lights_"+group.Key);
                        var lights=clone.AddOrGetComponent<EmissiveProperties>();
                        UnityEngine.JsonUtility.FromJsonOverwrite(UnityEngine.JsonUtility.ToJson(source.GetComponent<EmissiveProperties>()),lights);
                        foreach(var patch in group){
                            var light=lights.m_MultiLights.Single(l=>l.layerId==(int)patch["layer_id"]);
                            var rgb=(JArray)patch["color"];
                            light.color=new UnityEngine.Color((float)rgb[0],(float)rgb[1],(float)rgb[2],1);
                            light.colorOff=(bool?)patch["always_on"]==true?light.color:UnityEngine.Color.black;
                            light.purpose=EmissiveProperties.Purpose.DecorativeLight;
                            light.intensity=(float)patch["intensity"];light.luminance=(float)patch["luminance"];
                            light.animationIndex=-1;light.responseTime=0;
                        }
                        AssetDatabase.user.AddAsset(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,clone.name),clone);
                        clone.asset.Save(stage,true);
                        if(!ps.AddPrefab(clone))throw new Exception("Composition light render registration failed.");
                        meshes[group.Key].m_Mesh=clone;
                    }
                    File.WriteAllText(Path.Combine(stage,"lights.json"),op.CompositionLights.ToString(Formatting.Indented));
                }
                File.WriteAllText(Path.Combine(stage,"composition.json"),op.CompositionDescription.ToString(Formatting.Indented));
                AssetDatabase.user.AddAsset(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,model.name),model);
                model.asset.Save(stage,true);if(!ps.AddPrefab(model))throw new Exception("Composition registration failed.");
                for(int tick=0;tick<150;tick++){
                    RequireImportContext(op,world);world.EntityManager.CompleteAllTrackedJobs();
                    var info=ImportedModelInfo(world,ps.GetEntity(model),model);
                    if((bool)info["native_bounds_ready"]&&(bool)info["native_selectable"]){
                        info["render_meshes"]=new JArray(meshes.Select(m=>m.m_Mesh.name));info["placed"]=false;
                        info["gameplay_configuration"]=op.Preset==OptionalHelicopterRuntime.HeliportPreset
                            ?"Roadside passenger heliport V7 with depot, separate boarding/spawn markers, pedestrian paths and native terrain grading. Requires live placement/flight validation; retain source assets."
                            :"Static composite only; source modules remain local dependencies. No animation or transport configuration added.";
                        op.Results.Add(info);op.State="completed";return;
                    }
                    await Task.Delay(100);
                }
                throw new Exception("Composition saved but native bounds did not initialize; inspect partial output.");
            }catch(Exception ex){op.State="outcome_unknown";op.Error=ex.Message;}
        }
        private static void ValidateCompositionLights(JArray patches,ObjectMeshInfo[] meshes)
        {
            ModelCompositionLightRules.Validate(patches,meshes.Select(m=>
                ((RenderPrefab)m.m_Mesh).GetComponent<EmissiveProperties>()?.m_MultiLights?.Select(l=>l.layerId).ToArray()).ToArray());
        }
    }
}
