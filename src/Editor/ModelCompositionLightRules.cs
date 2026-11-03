using System;
using System.Linq;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
namespace CityWeaver
{
    internal static class ModelCompositionLightRules
    {
        internal static void Validate(JArray patches,int[][] layers)
        {
            if(patches.Count<1||patches.Count>256)throw new ArgumentException("lights requires 1..256 patches.");
            var seen=new HashSet<string>();
            foreach(var value in patches){
                var patch=value as JObject;if(patch==null)throw new ArgumentException("Invalid light patch.");
                var allowed=new[]{"mesh_index","layer_id","color","intensity","luminance","always_on"};
                if(patch.Properties().Any(p=>!allowed.Contains(p.Name)))throw new ArgumentException("Unknown light field.");
                if(patch["mesh_index"]?.Type!=JTokenType.Integer||patch["layer_id"]?.Type!=JTokenType.Integer)
                    throw new ArgumentException("Light indices must be integers.");
                int index=(int)patch["mesh_index"],layer=(int)patch["layer_id"];
                if(index<0||index>=layers.Length||layer<1||layer>255||!seen.Add(index+":"+layer))throw new ArgumentException("Invalid or duplicate light target.");
                if(layers[index]==null||layers[index].Count(l=>l==layer)!=1)
                    throw new ArgumentException("Light layer must exist exactly once in the imported render.");
                var color=patch["color"] as JArray;
                if(color==null||color.Count!=3)throw new ArgumentException("Light color requires RGB.");
                foreach(var number in color)CompositionLightNumber(number,1);
                CompositionLightNumber(patch["intensity"],10000);CompositionLightNumber(patch["luminance"],10000);
                if(patch["always_on"]!=null&&patch["always_on"].Type!=JTokenType.Boolean)throw new ArgumentException("always_on must be boolean.");
            }
        }
        private static void CompositionLightNumber(JToken value,float max)
        {
            if(value==null||(value.Type!=JTokenType.Float&&value.Type!=JTokenType.Integer))throw new ArgumentException("Light values must be numbers.");
            double number=(double)value;
            if(double.IsNaN(number)||double.IsInfinity(number)||number<0||number>max)throw new ArgumentException("Light value outside allowed range.");
        }
    }
}
