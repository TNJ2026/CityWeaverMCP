using System;
using System.Collections.Generic;

namespace CityWeaver
{
    internal static class VehicleRouteColorRules
    {
        internal static byte[] Rasterize(float[][] triangles,int width,int height)
        {
            if(triangles==null||triangles.Length>10000||width<1||height<1||(long)width*height>16777216)throw new ArgumentException("Invalid UV mask dimensions.");
            var mask=new byte[width*height];
            foreach(var t in triangles){
                if(t==null||t.Length!=6)throw new ArgumentException("UV triangle requires six coordinates.");
                foreach(float v in t)ModelColorRules.Unit(v);
                float den=(t[3]-t[5])*(t[0]-t[4])+(t[4]-t[2])*(t[1]-t[5]);if(Math.Abs(den)<1e-12f)continue;
                int minX=Math.Max(0,(int)Math.Floor(Math.Min(t[0],Math.Min(t[2],t[4]))*width));
                int maxX=Math.Min(width-1,(int)Math.Ceiling(Math.Max(t[0],Math.Max(t[2],t[4]))*width));
                int minY=Math.Max(0,(int)Math.Floor(Math.Min(t[1],Math.Min(t[3],t[5]))*height));
                int maxY=Math.Min(height-1,(int)Math.Ceiling(Math.Max(t[1],Math.Max(t[3],t[5]))*height));
                for(int y=minY;y<=maxY;y++)for(int x=minX;x<=maxX;x++){
                    float u=(x+.5f)/width,v=(y+.5f)/height;
                    float a=((t[3]-t[5])*(u-t[4])+(t[4]-t[2])*(v-t[5]))/den;
                    float b=((t[5]-t[1])*(u-t[4])+(t[0]-t[4])*(v-t[5]))/den;
                    if(a>=0&&b>=0&&a+b<=1)mask[y*width+x]=255;
                }
            }
            return mask;
        }
        internal static HashSet<int> NeutralSlots(int[] values,HashSet<int> selected,int materialCount)
        {
            if(values==null||values.Length==0)return new HashSet<int>();
            var slots=Slots(values,materialCount);
            if(!slots.IsSubsetOf(selected))throw new ArgumentException("neutral_surface_indices must be included in surface_indices.");
            return slots;
        }
        internal static bool PrepareSurface(bool selected,bool supportsControlMask,int slot)
        {
            if(supportsControlMask)return true;
            if(selected)throw new ArgumentException("Selected paint material shader does not expose _ControlMask (slot "+slot+").");
            return false;
        }
        internal static HashSet<int> Slots(int[] slots,int materialCount)
        {
            if(slots==null||slots.Length==0||slots.Length>16)throw new ArgumentException("Select 1..16 paint surfaces.");
            var selected=new HashSet<int>();
            foreach(int slot in slots)if(slot<0||slot>=materialCount||!selected.Add(slot))throw new ArgumentException("Paint surfaces must be unique valid material indices.");
            return selected;
        }
        internal static byte Weight(byte r,byte g,byte b,byte a,float minimum,float saturation,float feather)
        {
            ModelColorRules.Unit(minimum);ModelColorRules.Unit(saturation);ModelColorRules.Unit(feather);
            if(a<128)return 0;
            return (byte)Math.Round(255*ModelColorRules.Neutral(r,g,b,minimum,saturation,feather));
        }
        internal static byte HueWeight(byte r,byte g,byte b,byte a,float hue,float tolerance,float minimum,float saturation,float feather)
        {
            ModelColorRules.Unit(minimum);ModelColorRules.Unit(saturation);ModelColorRules.Unit(feather);
            if(float.IsNaN(hue)||float.IsInfinity(hue)||hue<0||hue>=360||float.IsNaN(tolerance)||float.IsInfinity(tolerance)||tolerance<=0||tolerance>60)
                throw new ArgumentException("Paint hue must be 0..<360 and tolerance 0..60 degrees.");
            float hi=Math.Max(r,Math.Max(g,b)),lo=Math.Min(r,Math.Min(g,b)),delta=hi-lo;
            if(a<128||hi/255f<minimum||delta==0||delta/hi<saturation)return 0;
            float actual=60*(hi==r?(g-b)/delta:hi==g?2+(b-r)/delta:4+(r-g)/delta);
            if(actual<0)actual+=360;
            float distance=Math.Abs(actual-hue);distance=Math.Min(distance,360-distance);
            if(distance>=tolerance)return 0;
            float edge=feather==0?1:Math.Min(1,(tolerance-distance)/(tolerance*feather));
            return (byte)Math.Round(255*edge);
        }
        internal static byte Neutralize(byte channel,byte value,byte weight) =>
            (byte)Math.Round(channel+(value-channel)*(weight/255f));
    }
}
