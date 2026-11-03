using System;
using System.Globalization;

namespace CityWeaver
{
    // Pure pixel rules. Always evaluate against the immutable source, never a previous tint.
    internal static class ModelColorRules
    {
        internal static byte[] Hex(string value)
        {
            if(value==null || value.Length!=7 || value[0]!='#')throw new ArgumentException("color must be #RRGGBB.");
            var rgb=new byte[3];
            for(int i=0;i<3;i++)if(!byte.TryParse(value.Substring(1+i*2,2),NumberStyles.AllowHexSpecifier,CultureInfo.InvariantCulture,out rgb[i]))throw new ArgumentException("Invalid hex color.");
            return rgb;
        }
        internal static float Unit(float value)
        {if(float.IsNaN(value)||float.IsInfinity(value)||value<0||value>1)throw new ArgumentException("Mask settings must be finite values in 0..1.");return value;}
        internal static float Neutral(byte r,byte g,byte b,float minimum,float saturation,float feather)
        {
            float hi=Math.Max(r,Math.Max(g,b))/255f,lo=Math.Min(r,Math.Min(g,b))/255f;
            if(hi==0 || (hi-lo)/hi>saturation || lo<minimum)return 0;
            return feather==0?1:Math.Min(1,(lo-minimum)/feather);
        }
        internal static byte Blend(byte original,byte target,float luminance,float weight)
            =>(byte)Math.Max(0,Math.Min(255,Math.Round(original*(1-weight)+target*luminance*weight)));
    }
}
