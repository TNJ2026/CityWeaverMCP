using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Colossal.IO.AssetDatabase;
using Game.Prefabs;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using UnityEngine;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private bool m_ModelExportStopped;
        private readonly Dictionary<string,JObject> m_ModelExports=new Dictionary<string,JObject>();
        private readonly Dictionary<string,string> m_ModelExportRequests=new Dictionary<string,string>();
        private JObject ModelExportById(JObject args)
        {
            if(!m_ModelExports.TryGetValue((string)args["operation_id"]??"",out var op))throw new QueryException("UNKNOWN_MODEL_EXPORT","Unknown export operation.");
            return (JObject)op.DeepClone();
        }
        private JObject ExportModel(JObject args,World world)
        {
            string request=RequestKey(args),fingerprint=new JObject(args.Properties().OrderBy(p=>p.Name,StringComparer.Ordinal).Select(p=>new JProperty(p.Name,p.Value.DeepClone()))).ToString(Formatting.None);
            if(m_ModelExportRequests.TryGetValue(request,out var oldId)){
                var old=m_ModelExports[oldId];if((string)old["fingerprint"]!=fingerprint)throw new QueryException("IDEMPOTENCY_CONFLICT","Export request_id belongs to other arguments.");
                return (JObject)old.DeepClone();
            }
            AssetFilesIdle(world);
            if(m_ModelExports.Values.Any(o=>(string)o["state"]=="running"))throw new QueryException("MODEL_EXPORT_BUSY","Wait for the running export.");
            if(m_ModelExports.Count>=128)throw new QueryException("MODEL_EXPORT_LIMIT","Export journal is full; restart the mod.");
            string parent;try{parent=AssetFileRules.LocalPath((string)args["output_directory"],true);}catch(Exception e){throw new QueryException("INVALID_OUTPUT_DIRECTORY",e.Message);}
            var selection=(JObject)args.DeepClone();
            if(args["entity_id"]!=null){
                if(args["prefab"]!=null||args["prefab_id"]!=null)throw new QueryException("INVALID_ARGUMENT","Choose entity_id OR prefab/prefab_id.");
                var e=ParseEntity((string)args["entity_id"],world.EntityManager);
                if(!world.EntityManager.HasComponent<PrefabRef>(e))throw new QueryException("NO_MODEL_PREFAB","Entity has no prefab reference.");
                selection["prefab_id"]=EntityId(world.EntityManager.GetComponentData<PrefabRef>(e).m_Prefab);
            }
            var entity=ResolveEditorAsset(selection,world,out var root);
            var parts=new List<ObjectMeshInfo>();
            if(root is RenderPrefab render)parts.Add(new ObjectMeshInfo{m_Mesh=render});
            else if(root is ObjectGeometryPrefab geometry && geometry.m_Meshes!=null)parts.AddRange(geometry.m_Meshes);
            else throw new QueryException("MODEL_EXPORT_UNSUPPORTED","Select a vehicle, building, static object or RenderPrefab with native object geometry.");
            if(parts.Count==0||parts.Count>128||parts.Any(p=>p==null||!(p.m_Mesh is RenderPrefab)))throw new QueryException("MODEL_EXPORT_UNSUPPORTED","Requires 1..128 native RenderPrefab parts; unsupported part types are not silently omitted.");
            var id=Guid.NewGuid().ToString("N");var folder=Path.Combine(parent,"CityWeaver_"+id);
            var op=new JObject{["operation_id"]=id,["request_id"]=request,["fingerprint"]=fingerprint,["session_id"]=m_Session,["state"]="running",["prefab"]=root.name,["prefab_id"]=EntityId(entity),["output_directory"]=folder,["include_textures"]=(bool?)args["include_textures"]??true,["parts"]=new JArray(),["files"]=new JArray(),["warnings"]=new JArray(),["limitations"]=new JArray("Static prefab pose; no bones, animations, gameplay or instance skin", "All declared mesh/state parts are exported; state variants may overlap; inspect parts in manifest", "No placed child objects, trailers or procedural road geometry", "PNG texture samples are not a reproduction of the game shader; packed masks/normals require manual interpretation"),["coordinates"]="Metres, Y up, right handed; Z reflected and triangle winding reversed; part transforms baked"};
            m_ModelExports.Add(id,op);m_ModelExportRequests.Add(request,id);
            Game.SceneFlow.GameManager.instance.StartCoroutine(RunModelExport(op,parts,world));
            return (JObject)op.DeepClone();
        }
        private IEnumerator RunModelExport(JObject op,List<ObjectMeshInfo> parts,World world)
        {
            yield return null;
            var steps=ExportModelSteps(op,parts,world);
            try{
                while(true){bool more;try{more=steps.MoveNext();}catch(Exception ex){op["state"]="failed";op["error"]=ex.Message;break;}if(!more)break;yield return steps.Current;}
            }finally{
                (steps as IDisposable)?.Dispose();
                if((string)op["state"]=="running"){op["state"]="interrupted";op["error"]="Export stopped; partial files retained.";}
                try{if(Directory.Exists((string)op["output_directory"]))ExportWrite(op,"manifest.json",Encoding.UTF8.GetBytes(op.ToString(Formatting.Indented)),false);}catch(Exception ex){op["manifest_error"]=ex.Message;}
            }
        }
        private void ExportContext(JObject op,World world)
        {
            if(m_ModelExportStopped || (string)op["session_id"]!=m_Session || !m_Loaded || world==null||!world.IsCreated||World.DefaultGameObjectInjectionWorld!=world)throw new InvalidOperationException("Map/session changed during export.");
            AssetFilesIdle(world);
            AssetFileRules.LocalPath((string)op["output_directory"],true);
        }
        private static void ExportWrite(JObject op,string file,byte[] bytes,bool record=true)
        {
            var folder=AssetFileRules.LocalPath((string)op["output_directory"],true);
            if(Directory.GetFiles(folder).Sum(f=>new FileInfo(f).Length)+bytes.LongLength>AssetFileRules.ProjectLimit)throw new IOException("Export exceeds 512 MiB.");
            using(var stream=new FileStream(Path.Combine(folder,file),FileMode.CreateNew,FileAccess.Write,FileShare.None))stream.Write(bytes,0,bytes.Length);
            if(record)((JArray)op["files"]).Add(new JObject{["name"]=file,["bytes"]=bytes.LongLength,["sha256"]=AssetFileRules.HashBytes(bytes)});
        }
        private IEnumerator ExportModelSteps(JObject op,List<ObjectMeshInfo> parts,World world)
        {
            string folder=(string)op["output_directory"];
            if(Directory.Exists(folder)||File.Exists(folder))throw new IOException("Export directory already exists.");
            AssetFileRules.LocalPath(Path.GetDirectoryName(folder),true);Directory.CreateDirectory(folder);
            int slot=0;var mtl=new StringBuilder("# Native texture properties are recorded in manifest.json\n");
            using(var stream=new FileStream(Path.Combine(folder,"model.obj"),FileMode.CreateNew,FileAccess.Write,FileShare.Read))
            using(var output=new StreamWriter(stream,new UTF8Encoding(false)))
            {
                var writer=new ModelObjWriter(output);
                foreach(var part in parts){
                    ExportContext(op,world);var render=(RenderPrefab)part.m_Mesh;
                    if(render.isImpostor)throw new InvalidOperationException("Impostor geometry requires a specialized export.");
                    for(int materialIndex=0;materialIndex<render.materialCount;materialIndex++){
                        ExportContext(op,world);
                        if(slot>=256)throw new InvalidOperationException("Export exceeds 256 material parts.");
                        string material="part_"+(slot++).ToString("D3");
                        var row=new JObject{["object"]=material,["render_prefab"]=render.name,["surface_index"]=materialIndex,["required_state"]=part.m_RequireState.ToString(),["textures"]=new JArray()};
                        var mesh=render.ObtainMesh(materialIndex,out int submesh);
                        try{
                            if(mesh==null || mesh.GetTopology(submesh)!=MeshTopology.Triangles)throw new InvalidOperationException("Missing or non-triangle mesh.");
                            if(mesh.vertexCount>2000000 || mesh.GetIndexCount(submesh)>6000000)throw new InvalidOperationException("Mesh exceeds 2 million vertices.");
                            var rotation=new Quaternion(part.m_Rotation.value.x,part.m_Rotation.value.y,part.m_Rotation.value.z,part.m_Rotation.value.w);
                            var position=new Vector3(part.m_Position.x,part.m_Position.y,part.m_Position.z);
                            var vertices=mesh.vertices.Select(v=>rotation*v+position).Select(v=>new[]{v.x,v.y,v.z}).ToArray();
                            var normals=mesh.normals.Select(n=>rotation*n).Select(n=>new[]{n.x,n.y,n.z}).ToArray();
                            var uv=mesh.uv.Select(t=>new[]{t.x,t.y}).ToArray();var indices=mesh.GetIndices(submesh);
                            writer.Part(vertices,uv,normals,indices,material);row["vertices"]=vertices.Length;row["triangles"]=indices.Length/3;
                        }finally{render.ReleaseMeshes();}
                        output.Flush();if(stream.Length>256L*1024*1024)throw new IOException("OBJ exceeds 256 MiB.");
                        ((JArray)op["parts"]).Add(row);mtl.Append("newmtl ").Append(material).Append("\nKd 1 1 1\nd 1\n");
                        yield return null;
                        if((bool)op["include_textures"]){
                            var surface=render.GetSurfaceAsset(materialIndex);
                            if(surface==null)((JArray)op["warnings"]).Add(material+": no surface material available.");
                            if(surface!=null){
                                if(!surface.isDataLoaded)surface.LoadProperties(true);
                                int textureIndex=0;
                                foreach(var pair in surface.textures.ToArray()){
                                    ExportContext(op,world);
                                    string filename=material+"_tex_"+(textureIndex++).ToString("D2")+".png";
                                    try{
                                        if(((JArray)op["files"]).Count>=256)throw new IOException("Export exceeds 256 texture files.");
                                        var bytes=ExportTexture(surface,pair.Key,pair.Value);
                                        ExportWrite(op,filename,bytes);
                                        ((JArray)row["textures"]).Add(new JObject{["property"]=pair.Key,["file"]=filename,["encoding"]="RGBA8 PNG sampled from native texture"});
                                        if(pair.Key=="_BaseColorMap")mtl.Append("map_Kd ").Append(filename).Append('\n');
                                    }catch(Exception ex){((JArray)op["warnings"]).Add(material+" "+pair.Key+": "+ex.Message);}
                                    yield return null;
                                }
                            }
                        }
                    }
                }
            }
            var objPath=Path.Combine(folder,"model.obj");
            if(slot==0)throw new InvalidOperationException("No geometry exported.");
            ((JArray)op["files"]).Add(new JObject{["name"]="model.obj",["bytes"]=new FileInfo(objPath).Length,["sha256"]=AssetFileRules.Hash(objPath)});
            ExportWrite(op,"model.mtl",Encoding.UTF8.GetBytes(mtl.ToString()));
            op["state"]=((JArray)op["warnings"]).Count==0?"completed":"completed_with_warnings";
        }
        private static byte[] ExportTexture(SurfaceAsset surface,string property,TextureAsset asset)
        {
            Texture2D source=null,readable=null;Action release=null;
            try{
                if(asset!=null&&!asset.isDummy){AssetFileRules.Dimensions(asset.width,asset.height);source=asset.Load(0) as Texture2D;release=()=>asset.Unload();}
                else{
                    var description=AssetDatabase.global.resources.materialLibrary.GetMaterialDescription(surface.materialTemplateHash);
                    int stack=description.GetStackConfigIndex(property),layer=stack<0?-1:description.GetLayerIndexInStack(stack,property);
                    var guids=surface.preProcessedTextureGuids.ToArray();int offset=AssetFileRules.VtLayerOffset(stack,layer,surface.stackCount);
                    if(offset<guids.Length && AssetDatabase.global.TryGetAsset<VTTextureAsset>(guids[offset],out var vt)){
                        // VT Load has no reference counting: never unload an already shared native texture.
                        bool owned=vt.state==LoadState.NotLoaded;
                        source=vt.Load() as Texture2D;if(owned)release=()=>vt.Unload();
                    }else if(surface.hasVTSurfaceAsset){
                        // Stock vehicles pack their preprocessed layers into a VTSurface instead of separate VTTexture assets.
                        // Reconstruct into a PRIVATE material; never alter/unload the renderer's shared material.
                        var template=surface.GetTemplateMaterial();var temporary=new Material(template);
                        release=()=>{
                            var generated=new HashSet<Texture>();
                            foreach(var key in temporary.GetTexturePropertyNames()){
                                var value=temporary.GetTexture(key);
                                if(value!=null && value!=template.GetTexture(key))generated.Add(value);
                            }
                            UnityEngine.Object.Destroy(temporary);
                            foreach(var value in generated)UnityEngine.Object.Destroy(value);
                        };
                        using(var reader=new BinaryReader(surface.vtSurfaceAsset.GetReadStream()))
                        using(var handler=new VTSurfaceDataHandler()){
                            handler.ReadHeader(reader);handler.FillDebugMaterial(reader,temporary,description);
                        }
                        var candidate=temporary.GetTexture(property);
                        if(candidate!=template.GetTexture(property))source=candidate as Texture2D;
                    }else throw new InvalidOperationException("Virtual texture source unavailable.");
                }
                if(source==null)throw new InvalidOperationException("Texture is not a readable 2D source.");
                readable=ReadableTexture(source);return ImageConversion.EncodeToPNG(readable);
            }finally{if(readable!=null)UnityEngine.Object.Destroy(readable);release?.Invoke();}
        }
    }
}
