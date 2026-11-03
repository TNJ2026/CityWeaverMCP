using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Colossal.AssetPipeline;
using Colossal.AssetPipeline.Importers;
using Colossal.IO.AssetDatabase;
using Game.AssetPipeline;
using Game.Common;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Game.UI.Editor;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using UnityEngine;
using TextureAsset = Colossal.IO.AssetDatabase.TextureAsset;

namespace CityWeaver
{
    internal sealed class AssetFileOperation
    {
        internal string Id=Guid.NewGuid().ToString("N"),Session,Request,Fingerprint,Kind,State="preview_ready",Error,Source,Hash,Property,Preset,ColorSpace,Baseline,ReplacementSignature;
        internal long Bytes; internal int Width,Height,SurfaceIndex;
        internal JObject ColorConfig;
        internal string[] CompositionSources;
        internal JArray CompositionDescription;
        internal JArray CompositionLights;
        internal string ColorConfigPath,ColorConfigHash,ColorMaskHash;
        internal int ColorPixels;
        internal string Mode;internal uint ConstructionCost;
        internal bool FitToSurface;
        internal float[] UvBounds,UvContent;
        internal float[][] UvTriangles;
        internal float PanelAspect;
        internal string UvGeometry;
        internal DateTime Expires=DateTime.UtcNow.AddMinutes(10);
        internal RenderPrefab Render; internal SurfaceAsset Original,Replacement;
        internal TextureAsset OriginalTexture;
        internal readonly Dictionary<string,Texture2D> RecoveredTextures=new Dictionary<string,Texture2D>();
        internal Dictionary<string,string> Files;
        internal JArray Results=new JArray();
        internal bool Dispatched,CancelRequested;
        internal void Refresh(){if(State=="preview_ready" && DateTime.UtcNow>=Expires)State="expired";}
        internal JObject Json(){Refresh();return new JObject{
            ["operation_id"]=Id,["session_id"]=Session,["request_id"]=Request,["kind"]=Kind,["state"]=State,["error"]=Error,
            ["can_commit"]=State=="preview_ready",["expires_at_utc"]=Expires.ToString("O"),["dispatched"]=Dispatched,
            ["source_path"]=Source,["input_bytes"]=Bytes,["file_count"]=Kind=="composition"?0:ColorConfig!=null?(ColorMaskHash==null?2:3):(Files?.Count??1),["sha256"]=Hash,
            ["mode_at_preview"]=Mode,["construction_cost"]=ConstructionCost,["composition_modules"]=CompositionDescription?.DeepClone(),
            ["composition_lights"]=CompositionLights?.DeepClone(),
            ["render_prefab"]=Render?.name,["surface_index"]=SurfaceIndex,["property"]=Property,["color_space"]=ColorSpace,
            ["width"]=Width,["height"]=Height,["preset"]=Preset,["results"]=Results.DeepClone(),
            ["color_configuration"]=ColorConfig?.DeepClone(),["paint_pixel_count"]=ColorPixels,
            ["color_mask_warning"]=ColorConfig!=null && (string)ColorConfig["mask_mode"]=="neutral_paint"?"Brightness/saturation selection also includes neutral logos and trim. Use an authored texture mask for exact paint boundaries.":null,
            ["fit_to_surface"]=FitToSurface,["uv_bounds"]=UvBounds==null?null:new JArray(UvBounds),
            ["panel_content_bounds"]=UvContent==null?null:new JArray(UvContent),["uv_triangle_count"]=UvTriangles?.Length??0,["panel_aspect"]=FitToSurface?(float?)PanelAspect:null,
            ["reconstructed_vt_properties"]=new JArray(RecoveredTextures.Keys),
            ["retained_vt_texture_format"]=RecoveredTextures.Count>0?"RGBA8 with regenerated mipmaps; verify normal/mask/color appearance":null,
            ["scope"]=Kind=="texture"?"All objects/roads sharing this render prefab and surface slot; not a single instance":"New local imported asset; no automatic map placement",
            ["persistence"]=Kind=="texture"?"Session override; restored before map reload or mod shutdown. Generated files remain in user asset database.":"Saved in user asset database; verify reload separately",
            ["visual_verification_required"]=true};}
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string,AssetFileOperation> m_AssetFiles=new Dictionary<string,AssetFileOperation>();
        private readonly Dictionary<string,string> m_AssetFileRequests=new Dictionary<string,string>();
        private readonly List<AssetFileOperation> m_AssetFileOrder=new List<AssetFileOperation>();
        private Task m_AssetImportTask;
        private void AssetFilesIdle(World world,bool loadingVehicleOverride=false)
        {
            if(!AssetImportPolicy.Mode(Game.SceneFlow.GameManager.instance.gameMode.ToString()))throw new QueryException("ASSET_MODE_UNSUPPORTED","Load a playable city or editor map.");
            if(m_AssetImportTask!=null && !m_AssetImportTask.IsCompleted)throw new QueryException("ASSET_IMPORT_BUSY","Wait for the original import operation; do not start another native importer.");
            var dispatcher=typeof(AssetImportPipeline).GetField("s_MainThreadDispatcher",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static);
            if(dispatcher==null || dispatcher.GetValue(null)!=null)throw new QueryException("ASSET_IMPORT_BUSY","Native importer is active or its idle state cannot be verified.");
            if(!loadingVehicleOverride&&world.GetExistingSystemManaged<SimulationSystem>().selectedSpeed!=0)throw new QueryException("CITY_MUST_BE_PAUSED","Pause before asset changes.");
            var tools=world.GetExistingSystemManaged<ToolSystem>();
            if(!(tools.activeTool is DefaultToolSystem))throw new QueryException("TOOL_BUSY","Finish the active tool preview and return to selection.");
            world.EntityManager.CompleteAllTrackedJobs();
        }
        private JObject AssetFileCapabilities()=>new JObject{
            ["model_composition_workflow"]="preview_model_composition -> apply_asset_file_operation (max_input_bytes:0) -> get_asset_file_operation. New static composite preserving separate render modules and transforms; sources must be owned imports with single-LOD 1..8-material meshes. No automatic placement or gameplay setup.",
            ["obj_rigid_rig"]="Optional root-level cityweaver-rig.json maps explicit OBJ groups to 1..64 rigid bones. Native rolling/steering tires; authored left/right door pivots use boarding-state control after vehicle replacement. No arbitrary clips inferred. See VEHICLE-RIG-GUIDE.md.",
            ["dynamic_color_workflow"]="preview_model_color -> apply_asset_file_operation, or set_model_color; restore_model_color restores the contiguous color chain; save_model_color_preset saves reusable configuration",
            ["dynamic_color_scope"]="Paused Game/Editor; shared RenderPrefab surface; original-source masked tint per command, not per-frame animation. PNG/TGA red-channel mask or explicit neutral_paint selector. Session-only; presets require explicit reapply after reload.",
            ["vehicle_replacement_workflow"]="list_vehicle_models -> get_vehicle_model -> preview_vehicle_replacement -> apply_vehicle_replacement -> get_vehicle_replacement_operation; verified replacements persist with city saves and restore automatically after load; restore_vehicle_replacement removes the override",["vehicle_replacement_support"]="All VehiclePrefab types; rigged source bones/wheels and clips, emissive material/layer light mapping, existing effect transforms; authored rig/UV/shader data required",
            ["model_export_formats"]=new JArray("OBJ", "MTL", "PNG"),["model_export_workflow"]="export_model -> get_model_export_operation; static vehicle/object geometry in paused Game or Editor; inspect manifest and warnings",
            ["texture_formats"]=new JArray("PNG","TGA true-color 24/32-bit, raw or RLE"),["model_formats"]=new JArray("FBX","OBJ"),
            ["texture_scope"]="Shared building/road RenderPrefab surface slot, 2D texture properties only. Inspect list_asset_materials first.",
            ["texture_persistence"]="Session only; restore_texture_replacement or map reload restores original references. No stock asset files overwritten.",
            ["texture_uv_fit"]="Optional fit_to_surface for _BaseColorMap: project planar triangles to their real UV0 coordinates and physical aspect; contain artwork with opaque black letterboxing; reject ambiguous overlap.",
            ["model_mode"]="Paused playable city or map editor; native asset pipeline, isolated user assets; no automatic placement",
            ["model_modes"]=new JArray("Game","Editor"),
            ["model_workflow"]="preview_model_import -> apply_asset_file_operation -> get_asset_file_operation -> list_imported_models -> select_imported_model (manual native placement)",
            ["model_saving"]="Models live in the local user asset database. Save placed instances through the normal city/map save workflow and retain the imported asset files when moving saves.",
            ["obj_convention"]="Metres, Y up; right-handed OBJ Z and winding converted to Unity. Convex planar faces only; missing normals are flat-generated; UVs preserved; MTL colors/maps are not automatically translated.",
            ["input"]="Absolute local paths on the game host. Model source_directory contains one asset group and its textures/settings; no symlinks/junctions.",
            ["max_texture_bytes"]=AssetFileRules.TextureLimit,["max_texture_pixels"]=AssetFileRules.MaxPixels,["max_project_bytes"]=AssetFileRules.ProjectLimit,["max_project_files"]=AssetFileRules.MaxFiles,
            ["limitations"]=new JArray("No per-instance skins or arbitrary shader replacement", "Texture arrays/cubemaps require a specialized workflow and are rejected", "Animated/rigged models retain only native importer support; no gameplay configuration inferred", "Native import errors may leave partial local files; outcome_unknown is never retried automatically")};

        private JObject ListAssetMaterials(JObject args,World world)
        {
            var entity=ResolveEditorAsset(args,world,out var root);var ps=world.GetExistingSystemManaged<PrefabSystem>();
            var queue=new Queue<PrefabBase>();var seen=new HashSet<PrefabBase>();var rows=new JArray();queue.Enqueue(root);
            while(queue.Count>0)
            {
                var p=queue.Dequeue();if(p==null || !seen.Add(p))continue;
                if(seen.Count>2048)throw new QueryException("ASSET_DEPENDENCY_LIMIT","Narrow the selected prefab to a mesh or road section.");
                if(p is RenderPrefab render)
                    for(int index=0;index<render.materialCount;index++)
                    {
                        var surface=render.GetSurfaceAsset(index);if(surface==null)continue;if(!surface.isDataLoaded)surface.LoadProperties(true);
                        rows.Add(new JObject{["render_prefab_id"]=EntityId(ps.GetEntity(render)),["render_prefab"]=render.name,["surface_index"]=index,
                            ["surface_id"]=surface.id.ToString(),["is_vt"]=surface.isVTMaterial,
                            ["material_template_hash"]=surface.materialTemplateHash,["material_template"]=surface.GetTemplateMaterial()?.name,["shader"]=surface.GetTemplateMaterial()?.shader?.name,
                            ["textures"]=new JArray(surface.textures.Select(t=>new JObject{["property"]=t.Key,["texture_id"]=t.Value?.id.ToString()}))});
                    }
                var dependencies=new List<PrefabBase>();p.GetDependencies(dependencies);foreach(var dependency in dependencies)queue.Enqueue(dependency);
            }
            return new JObject{["prefab_id"]=EntityId(entity),["prefab"]=root.name,["materials"]=rows,["scope"]="Changing a render prefab affects every reference to that mesh, including other buildings/road types sharing it."};
        }
        private AssetFileOperation AssetFileById(JObject args)
        {
            if(!m_AssetFiles.TryGetValue((string)args["operation_id"]??"",out var op))throw new QueryException("UNKNOWN_ASSET_FILE_OPERATION","Unknown asset file operation.");
            op.Refresh();return op;
        }
        private AssetFileOperation NewAssetFile(JObject args,string kind,out bool existing)
        {
            var request=RequestKey(args);var fingerprint=kind+":"+new JObject(args.Properties().OrderBy(p=>p.Name,StringComparer.Ordinal).Select(p=>new JProperty(p.Name,p.Value.DeepClone()))).ToString(Formatting.None);
            if(m_AssetFileRequests.TryGetValue(request,out var id))
            {
                var old=m_AssetFiles[id];if(old.Fingerprint!=fingerprint)throw new QueryException("IDEMPOTENCY_CONFLICT","request_id already belongs to a different asset file operation.");
                existing=true;return old;
            }
            if(m_AssetFiles.Count>=512)throw new QueryException("ASSET_OPERATION_LIMIT","Asset operation journal is full; reload the mod to reset it.");
            existing=false;return new AssetFileOperation{Session=m_Session,Request=request,Fingerprint=fingerprint,Kind=kind,Mode=Game.SceneFlow.GameManager.instance.gameMode.ToString()};
        }
        private JObject RememberAssetFile(AssetFileOperation op){m_AssetFiles.Add(op.Id,op);m_AssetFileRequests.Add(op.Request,op.Id);m_AssetFileOrder.Add(op);return op.Json();}
        private static byte[] TextureBytes(string path)
        {
            if(new FileInfo(path).Length>AssetFileRules.TextureLimit)throw new QueryException("ASSET_FILE_TOO_LARGE","Texture exceeds 64 MiB.");
            return File.ReadAllBytes(path);
        }
        private static Texture2D DecodeTexture(string path,bool linear,out int width,out int height,string expectedHash)
        {
            var bytes=TextureBytes(path);
            if(AssetFileRules.HashBytes(bytes)!=expectedHash)throw new QueryException("ASSET_INPUT_CHANGED","Texture bytes differ from the validated input.");
            AssetFileRules.ImageSize(bytes,Path.GetExtension(path),out width,out height);
            var texture=new Texture2D(width,height,TextureFormat.RGBA32,false,linear){name=Path.GetFileNameWithoutExtension(path),wrapMode=TextureWrapMode.Repeat};
            try{
                if(Path.GetExtension(path).Equals(".tga",StringComparison.OrdinalIgnoreCase))texture.LoadRawTextureData(AssetFileRules.DecodeTga(bytes,out width,out height));
                else if(!ImageConversion.LoadImage(texture,bytes,false))throw new ArgumentException("PNG decoder rejected this file.");
                AssetFileRules.Dimensions(texture.width,texture.height);
                if(texture.width!=width || texture.height!=height)throw new ArgumentException("Decoded texture dimensions differ from header.");
                // LoadImage may change the native graphics format. Copy decoded
                // pixels into a known RGBA8 format before serializing a TextureAsset.
                var normalized=new Texture2D(width,height,TextureFormat.RGBA32,false,linear){name=texture.name,wrapMode=texture.wrapMode};
                try{normalized.SetPixels32(texture.GetPixels32());normalized.Apply(false,false);}
                catch{UnityEngine.Object.Destroy(normalized);throw;}
                UnityEngine.Object.Destroy(texture);return normalized;
            }catch{UnityEngine.Object.Destroy(texture);throw;}
        }
        private static string SurfaceSignature(SurfaceAsset surface)
        {
            if(!surface.isDataLoaded)surface.LoadProperties(true);
            return JsonConvert.SerializeObject(new { material=surface.materialTemplateHash,
                textures=surface.textures.OrderBy(p=>p.Key).Select(p=>new {p.Key,Id=p.Value?.id.ToString()}).ToArray(),
                floats=surface.floats.OrderBy(p=>p.Key).ToArray(),ints=surface.ints.OrderBy(p=>p.Key).ToArray(),
                vectors=surface.vectors.OrderBy(p=>p.Key).Select(p=>new {p.Key,Value=new[]{p.Value.x,p.Value.y,p.Value.z,p.Value.w}}).ToArray(),
                colors=surface.colors.OrderBy(p=>p.Key).Select(p=>new {p.Key,Value=new[]{p.Value.r,p.Value.g,p.Value.b,p.Value.a}}).ToArray(),keywords=surface.keywords.OrderBy(p=>p).ToArray() });
        }
        private JObject PreviewTextureReplacement(JObject args,World world)
        {
            var op=NewAssetFile(args,"texture",out var existing);if(existing)return op.Json();AssetFilesIdle(world);
            op.Source=AssetFileRules.LocalPath((string)args["file_path"],false);op.Hash=AssetFileRules.Hash(op.Source);op.Bytes=new FileInfo(op.Source).Length;
            var renderEntity=ParseEntity((string)args["render_prefab_id"],world.EntityManager);
            if(!world.GetExistingSystemManaged<PrefabSystem>().TryGetPrefab<RenderPrefab>(renderEntity,out var render))throw new QueryException("INVALID_RENDER_PREFAB","Select a render_prefab_id from list_asset_materials.");
            op.Render=render;op.SurfaceIndex=(int?)args["surface_index"]??-1;
            if(op.SurfaceIndex<0 || op.SurfaceIndex>=render.materialCount)throw new QueryException("INVALID_SURFACE_INDEX","Surface index is outside this mesh.");
            op.Original=render.GetSurfaceAsset(op.SurfaceIndex);op.Property=(string)args["property"];op.ColorSpace=(string)args["color_space"];
            if(op.ColorSpace!="srgb" && op.ColorSpace!="linear")throw new QueryException("INVALID_ARGUMENT","color_space must be srgb or linear.");
            if(op.Original==null)throw new QueryException("INVALID_SURFACE_INDEX","Surface slot has no material.");
            if(!op.Original.isDataLoaded)op.Original.LoadProperties(true);op.Baseline=SurfaceSignature(op.Original);
            if(string.IsNullOrEmpty(op.Property) || !op.Original.textures.TryGetValue(op.Property,out var old) || old==null)
                throw new QueryException("UNKNOWN_TEXTURE_PROPERTY","Select an existing texture property from list_asset_materials.");
            // Read the source texture metadata without switching the stock shared
            // material out of virtual-texture mode during a read-only preview.
            if(op.Original.textures.Any(p=>p.Value!=null && p.Value.isDummy))
            {
                if(!op.Original.isVTMaterial)throw new QueryException("TEXTURE_SOURCE_UNAVAILABLE","Missing texture is not backed by a VT surface.");
                foreach(var pair in op.Original.textures.Where(p=>p.Value!=null && p.Value.isDummy))
                    op.RecoveredTextures.Add(pair.Key,RecoverVtTexture(op.Original,pair.Key));
            }
            if(!old.isDummy && !old.isDataLoaded && !old.isObjectLoaded)old.LoadData();
            op.OriginalTexture=old;
            if(!old.isDummy && old.dimension!=UnityEngine.Rendering.TextureDimension.Tex2D)
                throw new QueryException("TEXTURE_DIMENSION_UNSUPPORTED","Only 2D texture slots are supported; arrays/cubemaps cannot be replaced by one image.");
            var decoded=DecodeTexture(op.Source,op.ColorSpace=="linear",out op.Width,out op.Height,op.Hash);UnityEngine.Object.Destroy(decoded);
            op.FitToSurface=(bool?)args["fit_to_surface"]??false;
            if(op.FitToSurface)
            {
                if(op.Property!="_BaseColorMap")throw new QueryException("UV_FIT_COLOR_ONLY","UV fitting is limited to base color artwork.");
                op.UvBounds=SurfaceUvBounds(render,op.SurfaceIndex,out op.PanelAspect,out op.UvTriangles);
                op.UvContent=TextureUvFitRules.Contain(0,0,1,1,op.PanelAspect,op.Width,op.Height);
                op.UvGeometry=render.geometryAsset.id.ToString();
                // Exercise the complete UV rasterization during preview so a
                // conflicting atlas is rejected before any asset is saved/bound.
                var input=DecodeTexture(op.Source,op.ColorSpace=="linear",out _,out _,op.Hash);
                Texture2D fitted=null;
                try{fitted=FitSurfaceArtwork(input,op);}finally{UnityEngine.Object.Destroy(input);if(fitted!=null)UnityEngine.Object.Destroy(fitted);}
            }
            if(op.Hash!=AssetFileRules.Hash(op.Source))throw new QueryException("ASSET_INPUT_CHANGED","Input changed during validation.");
            return RememberAssetFile(op);
        }
        private JObject PreviewModelImport(JObject args,World world)
        {
            var op=NewAssetFile(args,"model",out var existing);if(existing)return op.Json();AssetFilesIdle(world);
            op.Source=AssetFileRules.LocalPath((string)args["source_directory"],true);op.Files=AssetFileRules.Scan(op.Source);
            var rigFiles=op.Files.Keys.Where(p=>Path.GetFileName(p).Equals("cityweaver-rig.json",StringComparison.OrdinalIgnoreCase)).ToArray();
            if(rigFiles.Any(p=>p!="cityweaver-rig.json") || rigFiles.Length>0&&op.Files.Keys.Any(p=>Path.GetExtension(p).Equals(".fbx",StringComparison.OrdinalIgnoreCase)))
                throw new ArgumentException("Rigid OBJ projects require one root-level cityweaver-rig.json and no FBX files.");
            foreach(var file in op.Files.Keys.Where(p=>Path.GetExtension(p).Equals(".obj",StringComparison.OrdinalIgnoreCase)))
            {
                var full=Path.Combine(op.Source,file);var parts=ObjMeshRules.Parse(File.ReadLines(full));var rig=ObjRigidRig.Load(Path.GetDirectoryName(full));
                if(rig!=null)foreach(var part in parts)foreach(var group in part.Groups.Distinct())rig.Index(group);
            }
            op.Bytes=op.Files.Keys.Sum(p=>new FileInfo(Path.Combine(op.Source,p)).Length);op.Preset=(string)args["preset"]??"static_object";
            if(op.Preset!="static_object" && op.Preset!="building")throw new QueryException("INVALID_ARGUMENT","preset must be static_object or building.");
            var cost=(long?)args["construction_cost"]??0;
            if(cost<0 || cost>10000000)throw new QueryException("INVALID_ARGUMENT","construction_cost must be 0..10000000.");op.ConstructionCost=(uint)cost;
            return RememberAssetFile(op);
        }
        private JObject ApplyAssetFile(JObject args,World world)
        {
            var op=AssetFileById(args);
            if((string)args["request_id"]!=op.Request)throw new QueryException("IDEMPOTENCY_CONFLICT","Use the preview's original request_id.");
            if(op.Dispatched)return op.Json();
            if(op.Session!=m_Session || op.State!="preview_ready")throw new QueryException("ASSET_PREVIEW_STALE","Asset preview is no longer ready in this session.");
            AssetFilesIdle(world);
            if(op.Mode!=Game.SceneFlow.GameManager.instance.gameMode.ToString())throw new QueryException("ASSET_PREVIEW_STALE","Game mode changed since preview.");
            if((long?)args["max_input_bytes"]<op.Bytes || args["max_input_bytes"]==null)throw new QueryException("ASSET_INPUT_LIMIT","max_input_bytes must cover the preview's exact input_bytes.");
            if(op.Kind=="texture")
            {
                if(op.Render==null || op.Render.GetSurfaceAsset(op.SurfaceIndex)!=op.Original || SurfaceSignature(op.Original)!=op.Baseline || AssetFileRules.Hash(op.Source)!=op.Hash)
                    throw new QueryException("ASSET_INPUT_CHANGED","Target material or input file changed; inspect before creating a new preview.");
                op.Dispatched=true;
                try{ApplyTextureFile(op,world);op.State="completed";}
                catch(Exception ex){op.State="outcome_unknown";op.Error=ex.Message;}
            }
            else if(op.Kind=="composition")
            {
                var meshes=CompositionMeshes(op.CompositionSources,world,out var signature,out var description);
                if(signature!=op.Baseline)throw new QueryException("ASSET_INPUT_CHANGED","Composition source changed since preview.");
                op.Dispatched=true;op.State="importing";m_AssetImportTask=ComposeModel(op,meshes,world);
            }
            else
            {
                if(!AssetFileRules.Same(op.Files,AssetFileRules.Scan(op.Source)))throw new QueryException("ASSET_INPUT_CHANGED","Project files changed since preview.");
                op.Dispatched=true;op.State="importing";m_AssetImportTask=ImportModelFiles(op,world);
            }
            return op.Json();
        }
        private void ApplyTextureFile(AssetFileOperation op,World world)
        {
            var image=DecodeTexture(op.Source,op.ColorSpace=="linear",out var width,out var height,op.Hash);
            try{
                if(op.ColorConfig!=null)ApplyModelColorPixels(image,op);
                if(op.FitToSurface)
                {
                    var uv=SurfaceUvBounds(op.Render,op.SurfaceIndex,out var aspect,out var triangles);
                    if(op.Render.geometryAsset.id.ToString()!=op.UvGeometry || !uv.SequenceEqual(op.UvBounds) || aspect!=op.PanelAspect || JsonConvert.SerializeObject(triangles)!=JsonConvert.SerializeObject(op.UvTriangles))
                        throw new QueryException("UV_LAYOUT_CHANGED","Mesh UV layout changed after preview.");
                    var fitted=FitSurfaceArtwork(image,op);UnityEngine.Object.Destroy(image);image=fitted;
                }
                var recovered=op.RecoveredTextures.TryGetValue(op.Property,out var originalImage)?originalImage:null;
                image.wrapMode=recovered!=null?recovered.wrapMode:op.OriginalTexture.wrapMode;
                image.filterMode=recovered!=null?recovered.filterMode:op.OriginalTexture.filterMode;
                image.anisoLevel=recovered!=null?recovered.anisoLevel:op.OriginalTexture.anisoLevel;
                using(var data=new TextureImporter.Texture("CityWeaver_"+op.Id,op.Source,image))
                {
                    data.ComputeMips(false,false);
                    var texture=AssetDatabase.user.AddAsset<TextureAsset,TextureImporter.ITexture>(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,"Texture"),data);texture.Save();ValidateSavedTexture(texture);
                    var surface=AssetDatabase.user.AddAsset<SurfaceAsset>(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,"Surface"));
                    surface.CopyFrom(op.Original);
                    foreach(var pair in op.RecoveredTextures)
                    {
                        if(pair.Key==op.Property)continue;
                        var pixels=ReadableTexture(pair.Value);
                        try{using(var recoveredData=new TextureImporter.Texture(pair.Key,op.Source,pixels))
                        {
                            recoveredData.ComputeMips(pixels.wrapMode==TextureWrapMode.Clamp,false);
                            var retained=AssetDatabase.user.AddAsset<TextureAsset,TextureImporter.ITexture>(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,"Retained_"+pair.Key),recoveredData);
                            retained.Save();ValidateSavedTexture(retained);surface.UpdateTexture(pair.Key,retained);
                        }}finally{UnityEngine.Object.Destroy(pixels);}
                    }
                    surface.UpdateTexture(op.Property,texture);surface.Save();op.Replacement=surface;
                    // Record the recovery baseline before changing a live reference,
                    // so an exception during prefab refresh remains restorable.
                    op.ReplacementSignature=SurfaceSignature(surface);
                    op.Render.SetSurfaceAsset(op.SurfaceIndex,surface);world.GetExistingSystemManaged<PrefabSystem>().UpdatePrefab(op.Render);
                    var actual=op.Render.GetSurfaceAsset(op.SurfaceIndex);if(!actual.isDataLoaded)actual.LoadProperties(true);
                    if(actual!=surface || !actual.TryGetTexture(op.Property,out var readback) || readback.id!=texture.id)throw new Exception("Texture reference readback mismatch.");
                    op.ReplacementSignature=SurfaceSignature(surface);
                    op.Results.Add(new JObject{["surface_id"]=surface.id.ToString(),["texture_id"]=texture.id.ToString(),["reference_verified"]=true,["gpu_load_verified"]=true,["saved_override"]=false});
                }
            }finally{UnityEngine.Object.Destroy(image);}
        }
        private static float[] SurfaceUvBounds(RenderPrefab render,int surfaceIndex,out float panelAspect,out float[][] bakeTriangles)
        {
            panelAspect=0;bakeTriangles=null;
            if(render.geometryAsset==null)throw new QueryException("UV_FIT_UNSUPPORTED","Mesh geometry is unavailable.");
            var mesh=render.ObtainMesh(surfaceIndex,out var localSubMesh);
            try{
                if(mesh==null||!mesh.isReadable)throw new QueryException("UV_FIT_UNSUPPORTED","Chosen mesh is unavailable or unreadable.");
                var indices=mesh.GetIndices(localSubMesh);var uv=mesh.uv;var positions=mesh.vertices;
                if(uv.Length!=positions.Length||indices.Length==0||indices.Length>6144)throw new QueryException("UV_FIT_UNSUPPORTED","UV projection requires a bounded readable artwork mesh.");
                int seed=-1;float largest=0;
                for(int i=0;i+2<indices.Length;i+=3){var n=Vector3.Cross(positions[indices[i+1]]-positions[indices[i]],positions[indices[i+2]]-positions[indices[i]]);var d1=uv[indices[i+1]]-uv[indices[i]];var d2=uv[indices[i+2]]-uv[indices[i]];if(n.magnitude>largest&&Math.Abs(d1.x*d2.y-d1.y*d2.x)>1e-8f){seed=i;largest=n.magnitude;}}
                if(seed<0)throw new QueryException("UV_FIT_UNSUPPORTED","Mesh has no nondegenerate artwork triangle.");
                int a=indices[seed],b=indices[seed+1],c=indices[seed+2];
                var p1=positions[b]-positions[a];var p2=positions[c]-positions[a];var du1=uv[b]-uv[a];var du2=uv[c]-uv[a];float det=du1.x*du2.y-du1.y*du2.x;
                var normal=Vector3.Cross(p1,p2).normalized;
                var axisU=((p1*du2.y-p2*du1.y)/det).normalized;
                var tangentV=(p2*du1.x-p1*du2.x)/det;var axisV=(tangentV-axisU*Vector3.Dot(tangentV,axisU)).normalized;
                if(axisU.sqrMagnitude<0.5f||axisV.sqrMagnitude<0.5f)throw new QueryException("UV_FIT_UNSUPPORTED","Cannot derive artwork plane axes.");
                var chosen=new List<int>();float area=0,minX=float.MaxValue,minY=float.MaxValue,maxX=float.MinValue,maxY=float.MinValue;
                float u0=float.MaxValue,v0=float.MaxValue,u1=float.MinValue,v1=float.MinValue;
                for(int i=0;i+2<indices.Length;i+=3)
                {
                    var x=positions[indices[i]];var y=positions[indices[i+1]];var z=positions[indices[i+2]];var cross=Vector3.Cross(y-x,z-x);
                    if(cross.magnitude<1e-8f||Vector3.Dot(cross.normalized,normal)<0.999f)continue;
                    if(Math.Abs(Vector3.Dot(x-positions[a],normal))>0.01f||Math.Abs(Vector3.Dot(y-positions[a],normal))>0.01f||Math.Abs(Vector3.Dot(z-positions[a],normal))>0.01f)continue;
                    chosen.Add(i);area+=cross.magnitude*0.5f;
                    for(int k=0;k<3;k++){int index=indices[i+k];float px=Vector3.Dot(positions[index],axisU),py=Vector3.Dot(positions[index],axisV);minX=Math.Min(minX,px);maxX=Math.Max(maxX,px);minY=Math.Min(minY,py);maxY=Math.Max(maxY,py);u0=Math.Min(u0,uv[index].x);u1=Math.Max(u1,uv[index].x);v0=Math.Min(v0,uv[index].y);v1=Math.Max(v1,uv[index].y);}
                }
                float width=maxX-minX,height=maxY-minY;
                if(width<1e-5f||height<1e-5f||Math.Abs(area/(width*height)-1)>0.03f)
                    throw new QueryException("UV_FIT_UNSUPPORTED","Dominant artwork plane must cover a rectangle without overlapping geometry.");
                panelAspect=width/height;TextureUvFitRules.Contain(u0,v0,u1,v1,panelAspect,1,1);
                bakeTriangles=chosen.Select(i=>{var t=new float[12];for(int k=0;k<3;k++){int index=indices[i+k];t[k*2]=uv[index].x;t[k*2+1]=uv[index].y;t[6+k*2]=(Vector3.Dot(positions[index],axisU)-minX)/width;t[7+k*2]=(Vector3.Dot(positions[index],axisV)-minY)/height;}return t;}).ToArray();
                return new[]{u0,v0,u1,v1};
            }finally{render.ReleaseMeshes();}
        }
        private static Texture2D FitSurfaceArtwork(Texture2D image,AssetFileOperation op)
        {
            var colors=image.GetPixels32();var source=new byte[colors.Length*4];
            for(int i=0;i<colors.Length;i++){source[i*4]=colors[i].r;source[i*4+1]=colors[i].g;source[i*4+2]=colors[i].b;source[i*4+3]=colors[i].a;}
            var pixels=TextureUvFitRules.Bake(source,image.width,image.height,op.UvTriangles,op.UvContent);
            var result=new Texture2D(image.width,image.height,TextureFormat.RGBA32,false,op.ColorSpace=="linear"){name=image.name,wrapMode=TextureWrapMode.Clamp};
            try{result.LoadRawTextureData(pixels);result.Apply(false,false);return result;}catch{UnityEngine.Object.Destroy(result);throw;}
        }
        private static Texture2D RecoverVtTexture(SurfaceAsset surface,string property)
        {
            var description=AssetDatabase.global.resources.materialLibrary.GetMaterialDescription(surface.materialTemplateHash);
            var stack=description.GetStackConfigIndex(property);
            var layer=stack<0?-1:description.GetLayerIndexInStack(stack,property);
            var guids=surface.preProcessedTextureGuids.ToArray();
            var offset=AssetFileRules.VtLayerOffset(stack,layer,surface.stackCount);
            Texture2D image=null;
            // Use the ordered GUID list. The game's GetPreProcessedTextureGuid
            // accessor multiplies stack*layer and aliases layers in stack zero.
            if(offset<guids.Length && AssetDatabase.global.TryGetAsset<VTTextureAsset>(guids[offset],out var shared))image=shared.Load() as Texture2D;
            else if(surface.hasVTSurfaceAsset)
            {
                var material=surface.vtSurfaceAsset.Load();
                var candidate=material.GetTexture(property);
                if(candidate!=surface.GetTemplateMaterial().GetTexture(property))image=candidate as Texture2D;
            }
            if(image==null)throw new QueryException("VT_TEXTURE_UNAVAILABLE","Cannot reconstruct virtual texture property "+property+"; no material changes applied.");
            AssetFileRules.Dimensions(image.width,image.height);return image;
        }
        private static Texture2D ReadableTexture(Texture2D source)
        {
            AssetFileRules.Dimensions(source.width,source.height);
            bool srgb=UnityEngine.Experimental.Rendering.GraphicsFormatUtility.IsSRGBFormat(source.graphicsFormat);
            var target=RenderTexture.GetTemporary(source.width,source.height,0,RenderTextureFormat.ARGB32,srgb?RenderTextureReadWrite.sRGB:RenderTextureReadWrite.Linear);
            var previous=RenderTexture.active;bool write=GL.sRGBWrite;Texture2D result=null;
            try{
                GL.sRGBWrite=srgb;Graphics.Blit(source,target);RenderTexture.active=target;
                result=new Texture2D(source.width,source.height,TextureFormat.RGBA32,false,!srgb){wrapMode=source.wrapMode,filterMode=source.filterMode,anisoLevel=source.anisoLevel};
                result.ReadPixels(new Rect(0,0,source.width,source.height),0,0,false);result.Apply(false,false);return result;
            }catch{if(result!=null)UnityEngine.Object.Destroy(result);throw;}
            finally{RenderTexture.active=previous;GL.sRGBWrite=write;RenderTexture.ReleaseTemporary(target);}
        }
        private async Task ImportModelFiles(AssetFileOperation op,World world)
        {
            var database=AssetImportPipeline.targetDatabase;var seed=AssetImportPipeline.importSeed;var parallel=AssetImportPipeline.useParallelImport;
            try{
                RequireImportContext(op,world);
                // Isolate native outputs by operation; reimport cannot overwrite an
                // existing user's geometry/material/prefab files.
                var stage=AssetFileRules.NativePath(Path.Combine(Colossal.PSI.Environment.EnvPath.kUserDataPath,"ModsData","CityWeaver","AssetImports",op.Id,"ProjectFiles"));
                var groupName=Path.GetFileName(op.Source.TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar));
                if(string.IsNullOrEmpty(groupName) || groupName.IndexOfAny(Path.GetInvalidFileNameChars())>=0)groupName="Asset";
                var group=Path.Combine(stage,groupName);Directory.CreateDirectory(group);
                foreach(var file in op.Files)
                {
                    var to=Path.Combine(group,file.Key);Directory.CreateDirectory(Path.GetDirectoryName(to));File.Copy(Path.Combine(op.Source,file.Key),to,false);
                    if(AssetFileRules.Hash(to)!=file.Value)throw new IOException("Project changed during staging.");
                }
                var factory=new AssetImportPanel.PrefabFactory();
                ImporterCache.Reset();ImporterCache.CacheSupportedExtensions();
                if(op.Files.Keys.Any(p=>Path.GetExtension(p).Equals(".obj",StringComparison.OrdinalIgnoreCase)) && !ImporterCache.Supports(".obj"))throw new Exception("OBJ adapter was not discovered by the native importer cache.");
                AssetImportPipeline.targetDatabase=AssetDatabase.user;AssetImportPipeline.importSeed="CityWeaver_"+op.Id;AssetImportPipeline.useParallelImport=false;
                await AssetImportPipeline.ImportPath(stage,new[]{groupName},ImportMode.All,false,(title,info,progress)=>op.CancelRequested || op.Session!=m_Session,factory);
                RequireImportContext(op,world);
                var renders=factory.rootPrefabs.Select(p=>p.prefab).OfType<RenderPrefab>().ToArray();
                if(renders.Length==0 || renders.Any(p=>p.geometryAsset==null || p.vertexCount<=0 || p.indexCount<=0 ||
                    !AssetFileRules.ValidBounds(p.bounds.min.x,p.bounds.min.y,p.bounds.min.z,p.bounds.max.x,p.bounds.max.y,p.bounds.max.z)))
                    throw new Exception("Native importer produced no complete model geometry/bounds. Inspect the game import log; partial files may remain.");
                var ps=world.GetExistingSystemManaged<PrefabSystem>();
                var rigidRig=ObjRigidRig.Load(group);
                if(rigidRig!=null)foreach(var render in renders){rigidRig.Attach(render);ValidateVehicleMesh(render);}
                int number=0;
                foreach(var prefab in factory.prefabs)
                {
                    prefab.name="CityWeaver_"+op.Id+"_"+(number++)+"_"+prefab.name;
                    AssetDatabase.user.AddAsset(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,prefab.name),prefab);
                }
                foreach(var prefab in factory.prefabs)
                {
                    prefab.asset.Save(group,true);
                    ps.AddOrUpdatePrefab(prefab);
                }
                ObjectGeometryPrefab placed=op.Preset=="building"?(ObjectGeometryPrefab)PrefabBase.Create<BuildingPrefab>("CityWeaver_"+op.Id):PrefabBase.Create<StaticObjectPrefab>("CityWeaver_"+op.Id);
                placed.m_Meshes=renders.Select(p=>new ObjectMeshInfo{m_Mesh=p}).ToArray();
                placed.AddComponent<PlaceableObject>().m_ConstructionCost=op.ConstructionCost;
                AssetDatabase.user.AddAsset(AssetDataPath.Create("ImportedData/CityWeaver/"+op.Id,placed.name),placed);
                placed.asset.Save(group,true);if(!ps.AddPrefab(placed))throw new Exception("Imported prefab registration failed.");
                bool ready=false;
                for(int tick=0;tick<150;tick++)
                {
                    RequireImportContext(op,world);
                    world.EntityManager.CompleteAllTrackedJobs();
                    var entity=ps.GetEntity(placed);
                    if(world.EntityManager.HasComponent<ObjectGeometryData>(entity))
                    {
                        var geometry=world.EntityManager.GetComponentData<ObjectGeometryData>(entity);
                        if(geometry.m_MinLod!=255 && AssetFileRules.ValidBounds(geometry.m_Bounds.min.x,geometry.m_Bounds.min.y,geometry.m_Bounds.min.z,
                            geometry.m_Bounds.max.x,geometry.m_Bounds.max.y,geometry.m_Bounds.max.z)){ready=true;break;}
                    }
                    await Task.Delay(100);
                }
                if(!ready)throw new Exception("Imported asset saved, but native object bounds/LOD did not initialize; inspect before use.");
                op.Results.Add(new JObject{["prefab"]=placed.name,["prefab_id"]=EntityId(ps.GetEntity(placed)),["asset_id"]=placed.asset.id.ToString(),
                    ["render_meshes"]=new JArray(renders.Select(p=>new JObject{["name"]=p.name,["vertices"]=p.vertexCount,["indices"]=p.indexCount})),
                    ["native_bounds_verified"]=true,["placed"]=false,["gameplay_configuration"]="Native geometry only; configure building behavior/lot/road access separately."});
                op.State="completed";
            }catch(Exception ex){op.State="outcome_unknown";op.Error=ex.Message;}
            finally{AssetImportPipeline.SetReportCallback(null);AssetImportPipeline.targetDatabase=database;AssetImportPipeline.importSeed=seed;AssetImportPipeline.useParallelImport=parallel;}
        }
        private void RequireImportContext(AssetFileOperation op,World world)
        {
            bool created=world!=null && world.IsCreated;
            var manager=Game.SceneFlow.GameManager.instance;
            if(op.CancelRequested || op.Session!=m_Session || !created || manager.isGameLoading || op.Mode!=manager.gameMode.ToString())
                throw new QueryException("ASSET_IMPORT_CONTEXT_CHANGED","Import session or mode changed; inspect partial local outputs before retrying.");
            if(op.CancelRequested || !AssetImportPolicy.Context(op.Mode,manager.gameMode.ToString(),op.Session==m_Session,created,
                world.GetExistingSystemManaged<SimulationSystem>()?.selectedSpeed==0,manager.isGameLoading))
                throw new QueryException("ASSET_IMPORT_CONTEXT_CHANGED","Keep the original city/editor paused until import finishes. Session, mode, loading or speed changed; inspect partial local outputs before retrying.");
        }
        private JObject ImportedModelInfo(World world,Entity entity,ObjectGeometryPrefab prefab)
        {
            var em=world.EntityManager;bool ready=false;JObject size=null;
            if(em.HasComponent<ObjectGeometryData>(entity))
            {
                var data=em.GetComponentData<ObjectGeometryData>(entity);
                ready=data.m_MinLod!=255 && AssetFileRules.ValidBounds(data.m_Bounds.min.x,data.m_Bounds.min.y,data.m_Bounds.min.z,data.m_Bounds.max.x,data.m_Bounds.max.y,data.m_Bounds.max.z);
                size=new JObject{["x"]=data.m_Size.x,["y"]=data.m_Size.y,["z"]=data.m_Size.z};
            }
            bool selectable=em.HasComponent<PlaceableObjectData>(entity);
            return new JObject{["prefab"]=prefab.name,["prefab_id"]=EntityId(entity),["asset_id"]=prefab.asset.id.ToString(),["kind"]=prefab is BuildingPrefab?"building":"static_object",
                ["native_bounds_ready"]=ready,["native_selectable"]=selectable,["construction_cost"]=selectable?(long)em.GetComponentData<PlaceableObjectData>(entity).m_ConstructionCost:0,
                ["size_m"]=size,["placement"]="Select the native tool, inspect its preview, then place manually. Building gameplay configuration is separate."};
        }
        private JObject ListImportedModels(JObject args,World world)
        {
            world.EntityManager.CompleteAllTrackedJobs();
            string search=(string)args["search"]??"";int offset=ComponentInspector.Int(args,"offset",0,0,100000),limit=ComponentInspector.Int(args,"limit",30,1,100);
            var ps=world.GetExistingSystemManaged<PrefabSystem>();var rows=new List<JObject>();
            using(var query=world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>(),ComponentType.ReadOnly<ObjectGeometryData>(),ComponentType.Exclude<Deleted>()))
            using(var entities=query.ToEntityArray(Allocator.Temp))foreach(var entity in entities)
                if(ps.TryGetPrefab<ObjectGeometryPrefab>(entity,out var prefab) && prefab!=null && prefab.asset!=null && AssetImportPolicy.OwnedModel(prefab.name,prefab.asset.subPath) && prefab.name.IndexOf(search,StringComparison.OrdinalIgnoreCase)>=0)
                    rows.Add(ImportedModelInfo(world,entity,prefab));
            rows=rows.OrderBy(r=>(string)r["prefab"],StringComparer.Ordinal).ToList();
            return new JObject{["total"]=rows.Count,["offset"]=offset,["next_offset"]=offset+limit<rows.Count?(int?)(offset+limit):null,["items"]=new JArray(rows.Skip(offset).Take(limit)),
                ["note"]="Rediscovered live IDs. Model files are local dependencies; no automatic map placement or city save."};
        }
        private JObject SelectImportedModel(JObject args,World world)
        {
            AssetFilesIdle(world);var entity=ResolveEditorAsset(args,world,out var prefab);
            if(!(prefab is ObjectGeometryPrefab model) || model.asset==null || !AssetImportPolicy.OwnedModel(model.name,model.asset.subPath))
                throw new QueryException("NOT_IMPORTED_MODEL","Select an exact model returned by list_imported_models.");
            var info=ImportedModelInfo(world,entity,model);
            if(!(bool)info["native_bounds_ready"] || !(bool)info["native_selectable"])throw new QueryException("IMPORTED_MODEL_NOT_READY","Model is not natively placeable. Older imports may need reimporting with the current version.");
            var tools=world.GetExistingSystemManaged<ToolSystem>();info["selected"]=tools.ActivatePrefabTool(model);info["active_tool"]=tools.activeTool?.toolID;info["placed"]=false;return info;
        }
        private JObject CancelAssetFile(JObject args)
        {
            var op=AssetFileById(args);if(op.Dispatched)throw new QueryException("ASSET_ALREADY_DISPATCHED","Cannot cancel an applied/importing operation; inspect its original result.");
            if(op.State=="preview_ready")op.State="cancelled";return op.Json();
        }
        private JObject RestoreTextureFile(JObject args,World world)
        {
            var op=AssetFileById(args);if(op.State=="restored")return op.Json();AssetFilesIdle(world);
            if(op.Kind!="texture" || op.Session!=m_Session || op.Replacement==null || op.Render==null || op.Render.GetSurfaceAsset(op.SurfaceIndex)!=op.Replacement || SurfaceSignature(op.Replacement)!=op.ReplacementSignature)
                throw new QueryException("ASSET_RESTORE_CONFLICT","Only the currently applied replacement can be restored; undo later replacements first.");
            op.Render.SetSurfaceAsset(op.SurfaceIndex,op.Original);world.GetExistingSystemManaged<PrefabSystem>().UpdatePrefab(op.Render);op.State="restored";return op.Json();
        }
        private void ResetAssetFiles()
        {
            var world=World.DefaultGameObjectInjectionWorld;
            foreach(var op in m_AssetFileOrder.AsEnumerable().Reverse())
            {
                if(op.State=="importing"){op.CancelRequested=true;op.State="outcome_unknown";op.Error="CITY_SESSION_CHANGED";}
                if(op.Kind=="texture" && op.Render!=null && op.Replacement!=null && op.Render.GetSurfaceAsset(op.SurfaceIndex)==op.Replacement)
                {
                    op.Render.SetSurfaceAsset(op.SurfaceIndex,op.Original);
                    if(world!=null && world.IsCreated)world.GetExistingSystemManaged<PrefabSystem>()?.UpdatePrefab(op.Render);
                    op.State="restored";
                }
                if(op.State=="preview_ready")op.State="expired";
            }
        }
    }
}
