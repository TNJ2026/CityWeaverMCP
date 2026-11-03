using System;
using System.Collections.Generic;
using System.Linq;
using Colossal.AssetPipeline.Importers;
using Colossal.IO.AssetDatabase;
using Game.Prefabs;
using Game.Rendering;
using Newtonsoft.Json.Linq;
using Unity.Mathematics;
using UnityEngine;
using TextureAsset=Colossal.IO.AssetDatabase.TextureAsset;

namespace CityWeaver
{
    internal sealed class VehicleRouteColorMask
    {
        internal RenderPrefab Render;
        internal SurfaceAsset Original;
        internal int Slot,Width=4,Height=4,PaintPixels;
        internal byte[] Weights;
        internal Color32[] NeutralBase;
        internal TextureWrapMode Wrap=TextureWrapMode.Repeat;
        internal FilterMode Filter=FilterMode.Bilinear;
    }
    public sealed partial class GameQueryService
    {
        // Native MeshColorSystem reads CurrentRoute -> Routes.Color for Brand bindings.
        // Only a per-pixel control mask is shared; each vehicle's actual color remains native.
        private static void PrepareVehicleRouteColor(VehicleModelOperation op,RenderPrefab render,JObject config)
        {
            if(config==null)throw new ArgumentException("color_mode route requires route_color configuration.");
            VehicleFields(config,"surface_indices","neutral_surface_indices","neutral_uv_regions","minimum_brightness","maximum_saturation","feather","paint_hue_degrees","hue_tolerance_degrees","minimum_saturation");
            if(!(config["surface_indices"] is JArray array)||array.Any(v=>v.Type!=JTokenType.Integer))throw new ArgumentException("surface_indices must be an integer array.");
            var slots=VehicleRouteColorRules.Slots(array.Select(v=>(int)v).ToArray(),render.materialCount);
            var neutralArray=config["neutral_surface_indices"] as JArray;
            if(config["neutral_surface_indices"]!=null&&(neutralArray==null||neutralArray.Any(v=>v.Type!=JTokenType.Integer)))throw new ArgumentException("neutral_surface_indices must be an integer array.");
            var neutralSlots=VehicleRouteColorRules.NeutralSlots(neutralArray?.Select(v=>(int)v).ToArray(),slots,render.materialCount);
            var regions=new Dictionary<int,float[][]>();
            if(config["neutral_uv_regions"]!=null){
                if(!(config["neutral_uv_regions"] is JArray entries)||entries.Count>16)throw new ArgumentException("neutral_uv_regions must be an array of at most 16 entries.");
                foreach(var entry in entries){
                    if(!(entry is JObject region))throw new ArgumentException("Invalid UV region.");
                    VehicleFields(region,"surface_index","triangles");
                    if(region["surface_index"]?.Type!=JTokenType.Integer)throw new ArgumentException("UV surface_index must be an integer.");
                    int slot=(int)region["surface_index"];
                    if(!slots.Contains(slot)||regions.ContainsKey(slot)||neutralSlots.Contains(slot))throw new ArgumentException("UV region requires a unique selected non-neutral material slot.");
                    if(!(region["triangles"] is JArray triangles)||triangles.Count==0||triangles.Count>10000)throw new ArgumentException("UV regions require 1..10000 triangles.");
                    var values=triangles.Select(t=>{if(!(t is JArray row)||row.Count!=6||row.Any(v=>v.Type!=JTokenType.Float&&v.Type!=JTokenType.Integer))throw new ArgumentException("UV triangle requires six numbers.");return row.Select(v=>(float)v).ToArray();}).ToArray();
                    VehicleRouteColorRules.Rasterize(values,1,1);regions.Add(slot,values);
                }
            }
            float minimum=VehicleNumber(config,"minimum_brightness",.45f,0,1),saturation=VehicleNumber(config,"maximum_saturation",.12f,0,1),feather=VehicleNumber(config,"feather",.08f,0,1);
            bool hueMode=config["paint_hue_degrees"]!=null;
            if(!hueMode&&(config["hue_tolerance_degrees"]!=null||config["minimum_saturation"]!=null))throw new ArgumentException("Hue selection settings require paint_hue_degrees.");
            float hue=VehicleNumber(config,"paint_hue_degrees",0,0,359.999f),tolerance=VehicleNumber(config,"hue_tolerance_degrees",12,.1f,60),minimumSaturation=VehicleNumber(config,"minimum_saturation",.45f,0,1);
            for(int slot=0;slot<render.materialCount;slot++)
            {
                var surface=render.GetSurfaceAsset(slot);if(surface==null)throw new ArgumentException("Missing surface.");
                if(!surface.isDataLoaded)surface.LoadProperties(true);
                if(surface.isVTMaterial)throw new ArgumentException("Route paint preparation currently requires non-VT imported surfaces.");
                // Glass cannot consume the mask; leave an unselected glass
                // material intact, but reject an unsupported selected surface.
                if(!VehicleRouteColorRules.PrepareSurface(slots.Contains(slot),surface.GetTemplateMaterial().HasProperty("_ControlMask"),slot))continue;
                var mask=new VehicleRouteColorMask{Render=render,Original=surface,Slot=slot};
                if(slots.Contains(slot))
                {
                    bool selectHue=hueMode&&!neutralSlots.Contains(slot);
                    if(!surface.TryGetTexture("_BaseColorMap",out var asset)||asset==null)throw new ArgumentException("Paint surface requires a base color texture.");
                    Texture2D readable=null;bool loaded=false;
                    try
                    {
                        var texture=asset.Load(0) as Texture2D;loaded=true;if(texture==null)throw new ArgumentException("Paint base color must be a 2D texture.");
                        long pixels=(long)texture.width*texture.height;
                        if(pixels>16777216||op.RouteColorMasks.Sum(m=>(long)(m.Weights?.Length??0))+pixels>100663296)throw new ArgumentException("Route paint preparation exceeds pixel budget.");
                        readable=ReadableTexture(texture);mask.Width=readable.width;mask.Height=readable.height;mask.Wrap=texture.wrapMode;mask.Filter=texture.filterMode;
                        var source=readable.GetPixels32();mask.Weights=new byte[source.Length];
                        byte[] uvMask=regions.TryGetValue(slot,out var triangles)?VehicleRouteColorRules.Rasterize(triangles,mask.Width,mask.Height):null;
                        for(int i=0;i<source.Length;i++){
                            var p=source[i];byte weight=selectHue?VehicleRouteColorRules.HueWeight(p.r,p.g,p.b,p.a,hue,tolerance,minimum,minimumSaturation,feather):VehicleRouteColorRules.Weight(p.r,p.g,p.b,p.a,minimum,saturation,feather);
                            if(uvMask!=null&&uvMask[i]!=0)weight=Math.Max(weight,VehicleRouteColorRules.Weight(p.r,p.g,p.b,p.a,minimum,saturation,feather));
                            mask.Weights[i]=weight;if(weight>0)mask.PaintPixels++;
                            // Remove only the selected original paint hue before native
                            // per-instance multiplication; preserve value/detail and alpha.
                            if((selectHue||neutralSlots.Contains(slot))&&weight>0){byte value=Math.Max(p.r,Math.Max(p.g,p.b));source[i]=new Color32(VehicleRouteColorRules.Neutralize(p.r,value,weight),VehicleRouteColorRules.Neutralize(p.g,value,weight),VehicleRouteColorRules.Neutralize(p.b,value,weight),p.a);}
                        }
                        if(selectHue||neutralSlots.Contains(slot))mask.NeutralBase=source;
                        if(mask.PaintPixels==0)throw new ArgumentException("No matching paint pixels found on selected surface; adjust paint selection.");
                    }
                    finally{if(readable!=null)UnityEngine.Object.Destroy(readable);if(loaded)asset.Unload();}
                }
                op.RouteColorMasks.Add(mask);
            }
            var colors=render.AddOrGetComponent<ColorProperties>();
            colors.m_ExternalColorSource=ColorSourceType.Brand;
            colors.m_ColorVariations=new List<ColorProperties.VariationSet>{new ColorProperties.VariationSet{m_Colors=new[]{Color.white,Color.white,Color.white}}};
            colors.m_ChannelsBinding=new List<ColorProperties.ColorChannelBinding>();
            for(sbyte i=0;i<3;i++)colors.m_ChannelsBinding.Add(new ColorProperties.ColorChannelBinding{m_ChannelId=i,m_CanBeModifiedByExternal=i==0});
            colors.m_VariationRanges=int3.zero;colors.m_AlphaRanges=int3.zero;colors.m_VariationGroups=null;
        }
        private static void ApplyVehicleRouteColors(VehicleModelOperation op)
        {
            int number=0;
            foreach(var mask in op.RouteColorMasks)
            {
                // Surfaces remain private; immutable textures are content-addressed.
                // Unpainted materials still receive zero masks to protect their colours.
                var texture=CachedRouteTexture(op,mask,false);
                string path="ImportedData/CityWeaver/"+op.Id;
                var surface=AssetDatabase.user.AddAsset<SurfaceAsset>(AssetDataPath.Create(path,"RouteSurface_"+number));
                surface.CopyFrom(mask.Original);surface.UpdateTexture("_ControlMask",texture);
                if(mask.NeutralBase!=null)
                {
                    var baseAsset=CachedRouteTexture(op,mask,true);
                    surface.UpdateTexture("_BaseColorMap",baseAsset);
                    mask.NeutralBase=null;
                }
                surface.Save();
                mask.Render.SetSurfaceAsset(mask.Slot,surface);number++;
            }
            op.RouteColorMasks.Clear();
        }
    }
}
