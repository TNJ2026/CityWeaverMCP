using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using UnityEngine;
using Game.Prefabs;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private JObject PreviewModelColor(JObject args,World world)
        {
            AssetFilesIdle(world);
            string path=AssetFileRules.LocalPath((string)args["configuration_path"],false);
            if(new FileInfo(path).Length>65536)throw new ArgumentException("Color configuration exceeds 64 KiB.");
            string hash=AssetFileRules.Hash(path);var config=JObject.Parse(File.ReadAllText(path));
            VehicleFields(config,"render_prefab","surface_index","source_path","mask_path","mask_mode","minimum_brightness","maximum_saturation","feather","strength","color");
            string color=(string)args["color"]??(string)config["color"];ModelColorRules.Hex(color);config["color"]=color.ToUpperInvariant();
            string mode=(string)config["mask_mode"]??"texture";
            if(mode!="texture"&&mode!="neutral_paint")throw new ArgumentException("mask_mode must be texture or neutral_paint.");
            config["mask_mode"]=mode;
            foreach(var field in new[]{"minimum_brightness","maximum_saturation","feather","strength"})
                if(config[field]!=null)ModelColorRules.Unit((float)config[field]);
            ResolveEditorAsset(new JObject{["prefab"]=(string)config["render_prefab"]},world,out var prefab);
            if(!(prefab is RenderPrefab render))throw new QueryException("INVALID_RENDER_PREFAB","Configuration must name a RenderPrefab from list_asset_materials.");
            string source=AssetFileRules.LocalPath((string)config["source_path"],false);config["source_path"]=source;
            string mask=null,maskHash=null;
            if(mode=="texture"){mask=AssetFileRules.LocalPath((string)config["mask_path"],false);maskHash=AssetFileRules.Hash(mask);config["mask_path"]=mask;}
            else if(config["mask_path"]!=null)throw new ArgumentException("neutral_paint cannot also specify mask_path.");
            var previewArgs=new JObject{["request_id"]=RequestKey(args),["render_prefab_id"]=EntityId(world.GetExistingSystemManaged<PrefabSystem>().GetEntity(render)),
                ["surface_index"]=config["surface_index"],["property"]="_BaseColorMap",["color_space"]="srgb",["file_path"]=source,
                ["color_configuration"]=config.DeepClone(),["configuration_hash"]=hash,["configuration_path"]=path,["mask_hash"]=maskHash};
            // Check idempotency before resolving native entity ids again after an UpdatePrefab.
            if(m_AssetFileRequests.TryGetValue(RequestKey(args),out var known))
            {
                var old=m_AssetFiles[known];
                if(old.ColorConfig==null || old.ColorConfigPath!=path || old.ColorConfigHash!=hash || !JToken.DeepEquals(old.ColorConfig,config) || old.ColorMaskHash!=maskHash || old.Hash!=AssetFileRules.Hash(source))
                    throw new QueryException("IDEMPOTENCY_CONFLICT","request_id already belongs to different color inputs.");
                return old.Json();
            }
            var preview=PreviewTextureReplacement(previewArgs,world);var op=m_AssetFiles[(string)preview["operation_id"]];
            op.ColorConfig=config;op.ColorConfigPath=path;op.ColorConfigHash=hash;op.ColorMaskHash=maskHash;
            try
            {
                if(mask!=null)op.Bytes+=new FileInfo(mask).Length;
                op.Bytes+=new FileInfo(path).Length;
                var input=DecodeTexture(source,false,out _,out _,op.Hash);
                try{ApplyModelColorPixels(input,op);}finally{UnityEngine.Object.Destroy(input);}
                if(AssetFileRules.Hash(path)!=hash)throw new QueryException("ASSET_INPUT_CHANGED","Color configuration changed during preview.");
                return op.Json();
            }
            catch{op.State="cancelled";throw;}
        }
        private JObject SetModelColor(JObject args,World world)
        {
            var preview=PreviewModelColor(args,world);
            return ApplyAssetFile(new JObject{["operation_id"]=preview["operation_id"],["request_id"]=RequestKey(args),["max_input_bytes"]=preview["input_bytes"]},world);
        }
        private static void ApplyModelColorPixels(Texture2D image,AssetFileOperation op)
        {
            var config=op.ColorConfig;
            if(AssetFileRules.Hash(op.ColorConfigPath)!=op.ColorConfigHash)throw new QueryException("ASSET_INPUT_CHANGED","Color configuration changed; create a new request.");
            var rgb=ModelColorRules.Hex((string)config["color"]);var pixels=image.GetPixels32();Texture2D mask=null;
            float minimum=ModelColorRules.Unit((float?)config["minimum_brightness"]??0.45f),saturation=ModelColorRules.Unit((float?)config["maximum_saturation"]??0.12f),
                feather=ModelColorRules.Unit((float?)config["feather"]??0.08f),strength=ModelColorRules.Unit((float?)config["strength"]??1);
            try
            {
                Color32[] masks=null;
                if((string)config["mask_mode"]=="texture")
                {
                    mask=DecodeTexture((string)config["mask_path"],true,out _,out _,op.ColorMaskHash);
                    if(mask.width!=image.width||mask.height!=image.height)throw new ArgumentException("Mask and original source must have identical dimensions and UV layout.");
                    masks=mask.GetPixels32();
                }
                int affected=0;
                for(int i=0;i<pixels.Length;i++)
                {
                    var p=pixels[i];float weight=strength*(masks==null?ModelColorRules.Neutral(p.r,p.g,p.b,minimum,saturation,feather):masks[i].r/255f);
                    if(weight<=0||p.a==0)continue;affected++;
                    float light=(p.r*0.2126f+p.g*0.7152f+p.b*0.0722f)/255f;
                    pixels[i]=new Color32(ModelColorRules.Blend(p.r,rgb[0],light,weight),ModelColorRules.Blend(p.g,rgb[1],light,weight),ModelColorRules.Blend(p.b,rgb[2],light,weight),p.a);
                }
                if(affected==0)throw new ArgumentException("Paint mask selects no visible pixels.");
                op.ColorPixels=affected;image.SetPixels32(pixels);image.Apply(false,false);
            }
            finally{if(mask!=null)UnityEngine.Object.Destroy(mask);}
        }
        private JObject RestoreModelColor(JObject args,World world)
        {
            var op=AssetFileById(args);if(op.ColorConfig==null)throw new ArgumentException("Not a model color operation.");
            if(op.State=="restored")return op.Json();AssetFilesIdle(world);
            // Undo only a contiguous chain of our color operations on this surface. Never overwrite a later external edit.
            var chain=m_AssetFileOrder.Where(o=>o.Render==op.Render&&o.SurfaceIndex==op.SurfaceIndex&&o.Replacement!=null&&o.State!="restored").Reverse().ToArray();
            if(chain.Length==0 || chain[0]!=op)throw new QueryException("ASSET_RESTORE_CONFLICT","Restore from the latest color operation for this surface.");
            foreach(var item in chain)
            {
                if(item.ColorConfig==null)break;
                RestoreTextureFile(new JObject{["operation_id"]=item.Id},world);
            }
            return op.Json();
        }
        private JObject SaveModelColorPreset(JObject args)
        {
            var op=AssetFileById(args);if(op.ColorConfig==null)throw new ArgumentException("Not a model color operation.");
            string directory=Path.Combine(Application.persistentDataPath,"ModsData","CityWeaver","ColorPresets");Directory.CreateDirectory(directory);
            string path=Path.Combine(directory,Guid.NewGuid().ToString("N")+".json");
            using(var stream=new FileStream(path,FileMode.CreateNew,FileAccess.Write))using(var writer=new StreamWriter(stream))writer.Write(op.ColorConfig.ToString(Formatting.Indented));
            return new JObject{["configuration_path"]=path,["configuration"]=op.ColorConfig.DeepClone(),["persistence"]="Reusable preset. After reload explicitly call set_model_color with this path; retain source/mask files. No automatic reapply."};
        }
    }
}
