using System;
using System.Collections.Generic;

namespace CityWeaver
{
    // Explicit editable fields, in native editor units. Never expose arbitrary reflection writes.
    internal sealed class EditorConfigurationRule
    {
        internal readonly double Min, Max;
        internal readonly int Components;
        internal readonly bool Integer, Boolean;
        internal EditorConfigurationRule(double min, double max, int components = 1, bool integer = false, bool boolean = false)
        { Min = min; Max = max; Components = components; Integer = integer; Boolean = boolean; }
        internal bool Accept(double value) => !double.IsNaN(value) && !double.IsInfinity(value) && value >= Min && value <= Max && (!Integer || value == Math.Truncate(value));
    }
    internal static class EditorConfigurationRules
    {
        internal static readonly Dictionary<string, EditorConfigurationRule> Fields = Create();
        private static Dictionary<string, EditorConfigurationRule> Create()
        {
            var d = new Dictionary<string, EditorConfigurationRule>(StringComparer.Ordinal);
            d.Add("climate.m_Latitude", new EditorConfigurationRule(-90,90));
            d.Add("climate.m_Longitude", new EditorConfigurationRule(-180,180));
            d.Add("climate.m_MaxSunElevationAngle", new EditorConfigurationRule(45,90));
            d.Add("climate.m_SunElevationClampStart", new EditorConfigurationRule(0,90));
            d.Add("climate.m_FreezingTemperature", new EditorConfigurationRule(-70,70));
            d.Add("climate.m_RandomSeed", new EditorConfigurationRule(1,100, integer:true));
            d.Add("season.m_StartTime", new EditorConfigurationRule(0,0.999999));
            d.Add("season.m_TempNightDay", new EditorConfigurationRule(-70,70,2));
            d.Add("season.m_TempDeviationNightDay", new EditorConfigurationRule(0.5,40,2));
            foreach (var name in new[]{"CloudChance","CloudAmount","PrecipitationChance","PrecipitationAmount","AuroraChance"})
                d.Add("season.m_"+name, new EditorConfigurationRule(0,100));
            foreach (var name in new[]{"CloudAmountDeviation","PrecipitationAmountDeviation"}) d.Add("season.m_"+name,new EditorConfigurationRule(1,100));
            d.Add("season.m_Turbulence",new EditorConfigurationRule(0,1));
            d.Add("season.m_AuroraAmount",new EditorConfigurationRule(0,1));
            d.Add("water.SeaLevel",new EditorConfigurationRule(0,2000));
            d.Add("water.seaWindStrength",new EditorConfigurationRule(0,1));
            d.Add("water.seaWindDirection",new EditorConfigurationRule(0,360));
            d.Add("wind.direction_degrees",new EditorConfigurationRule(0,360));
            d.Add("water_render.m_FoamAmount",new EditorConfigurationRule(0,2));
            d.Add("water_render.m_WavesMultiplier",new EditorConfigurationRule(0,2));
            d.Add("water_render.m_LakeWavesMultiplier",new EditorConfigurationRule(0,1));
            d.Add("water_render.m_MinWaterAmountForWaves",new EditorConfigurationRule(5,200));
            d.Add("water_render.m_CausticsPlaneDistance",new EditorConfigurationRule(0,10));
            d.Add("water_render.m_CausticsIntensity",new EditorConfigurationRule(0,3));
            d.Add("water_render.m_RipplesWindSpeed",new EditorConfigurationRule(0,15));
            d.Add("water_render.m_RipplesChaos",new EditorConfigurationRule(0,1));
            d.Add("water_render.m_SmoothnessClose",new EditorConfigurationRule(0,0.99));
            d.Add("water_render.m_SmoothnessDistant",new EditorConfigurationRule(0,0.99));
            d.Add("water_render.m_WaterColor",new EditorConfigurationRule(0,1,4));
            d.Add("water_render.m_WaterScatteringColor",new EditorConfigurationRule(0,1,4));
            d.Add("water_render.m_AbsorptionDistance",new EditorConfigurationRule(0,100));
            d.Add("water_render.m_MaxRefractionDistance",new EditorConfigurationRule(0,4));
            foreach(var name in new[]{"AmbientScattering","HeightScattering","DisplacementScattering","DirectLightTipScattering","DirectLightBodyScattering"})
                d.Add("water_render.m_"+name,new EditorConfigurationRule(0,1));
            d.Add("water_render.m_SeaWindAffectWavesDirection",new EditorConfigurationRule(0,1,boolean:true));
            d.Add("terrain_render.m_TriplanarBlendStrengthY",new EditorConfigurationRule(0.01,1));
            for(int i=1;i<=4;i++) {
                d.Add("terrain_render.m_Extra"+i+"DirtOverride",new EditorConfigurationRule(0,1));
                d.Add("terrain_render.m_Extra"+i+"SplatRange",new EditorConfigurationRule(0.1,1));
                d.Add("terrain_render.m_Extra"+i+"BlurDepth",new EditorConfigurationRule(0.01,0.3));
                d.Add("terrain_render.m_Extra"+i+"HeightOffset",new EditorConfigurationRule(-0.4,0.4));
            }
            return d;
        }
        internal static bool ValidSeasonStarts(double[] starts)
        {
            if(starts == null || starts.Length < 2) return false;
            var sorted = (double[])starts.Clone(); Array.Sort(sorted);
            for(int i=0;i<sorted.Length;i++) if(!Fields["season.m_StartTime"].Accept(sorted[i]) ||
                (i>0 && sorted[i]-sorted[i-1]<0.0001)) return false;
            return sorted[0]+1-sorted[sorted.Length-1]>=0.0001;
        }
    }
}
