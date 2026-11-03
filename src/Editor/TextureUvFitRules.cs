using System;

namespace CityWeaver
{
    // Rectangles use bottom-left texture coordinates. Letterboxing preserves the
    // image's physical aspect, rather than assuming atlas pixels are square on mesh.
    internal static class TextureUvFitRules
    {
        internal static byte[] Bake(byte[] source,int width,int height,float[][] triangles,float[] panelContent)
        {
            if(source==null||source.Length!=(long)width*height*4||width<1||height<1||triangles==null||triangles.Length>2048)
                throw new ArgumentException("Invalid UV bake input.");
            var output=new byte[source.Length];var written=new bool[width*height];
            for(int i=3;i<output.Length;i+=4)output[i]=255;
            long work=0;
            foreach(var t in triangles)
            {
                if(t==null||t.Length!=12)throw new ArgumentException("UV triangle requires UV and projected XY at each corner.");
                foreach(float value in t)if(float.IsNaN(value)||float.IsInfinity(value))throw new ArgumentException("Nonfinite UV triangle.");
                for(int i=0;i<6;i++)if(t[i]<0||t[i]>1)throw new ArgumentException("Tiled UV coordinates require a separate workflow.");
                float det=(t[2]-t[0])*(t[5]-t[1])-(t[3]-t[1])*(t[4]-t[0]);if(Math.Abs(det)<1e-9f)continue;
                int x0=Math.Max(0,(int)Math.Floor(Math.Min(t[0],Math.Min(t[2],t[4]))*width));
                int x1=Math.Min(width,(int)Math.Ceiling(Math.Max(t[0],Math.Max(t[2],t[4]))*width));
                int y0=Math.Max(0,(int)Math.Floor(Math.Min(t[1],Math.Min(t[3],t[5]))*height));
                int y1=Math.Min(height,(int)Math.Ceiling(Math.Max(t[1],Math.Max(t[3],t[5]))*height));
                work+=(long)(x1-x0)*(y1-y0);if(work>(long)width*height*32)throw new ArgumentException("UV bake work exceeds safe bounds.");
                for(int y=y0;y<y1;y++)for(int x=x0;x<x1;x++)
                {
                    float du=(x+0.5f)/width-t[0],dv=(y+0.5f)/height-t[1];
                    float b=(du*(t[5]-t[1])-dv*(t[4]-t[0]))/det,c=((t[2]-t[0])*dv-(t[3]-t[1])*du)/det,a=1-b-c;
                    if(a< -1e-5f||b< -1e-5f||c< -1e-5f)continue;
                    float px=a*t[6]+b*t[8]+c*t[10],py=a*t[7]+b*t[9]+c*t[11];
                    float sx=(px-panelContent[0])/(panelContent[2]-panelContent[0]),sy=(py-panelContent[1])/(panelContent[3]-panelContent[1]);
                    int pixel=y*width+x,dst=pixel*4;
                    byte r=0,g=0,bl=0,alpha=255;
                    if(sx>=0&&sx<=1&&sy>=0&&sy<=1)
                    {
                        int src=(Math.Min(height-1,(int)(sy*height))*width+Math.Min(width-1,(int)(sx*width)))*4;
                        r=source[src];g=source[src+1];bl=source[src+2];alpha=source[src+3];
                    }
                    if(written[pixel]&&(Math.Abs(output[dst]-r)>8||Math.Abs(output[dst+1]-g)>8||Math.Abs(output[dst+2]-bl)>8||Math.Abs(output[dst+3]-alpha)>8))
                        throw new ArgumentException("Overlapping UV faces require conflicting image pixels.");
                    output[dst]=r;output[dst+1]=g;output[dst+2]=bl;output[dst+3]=alpha;written[pixel]=true;
                }
            }
            return output;
        }
        internal static float[] Contain(float u0,float v0,float u1,float v1,float panelAspect,int width,int height)
        {
            foreach(var value in new[]{u0,v0,u1,v1,panelAspect})
                if(float.IsNaN(value)||float.IsInfinity(value))throw new ArgumentException("Nonfinite UV layout.");
            if(u0<0||v0<0||u1>1||v1>1||u1-u0<0.0001f||v1-v0<0.0001f||panelAspect<=0||width<1||height<1)
                throw new ArgumentException("UV fit requires a nonempty rectangle in the unit tile and positive image/panel dimensions.");
            float imageAspect=(float)width/height,w=u1-u0,h=v1-v0;
            if(imageAspect>panelAspect)h*=panelAspect/imageAspect;else w*=imageAspect/panelAspect;
            float x=(u0+u1-w)*0.5f,y=(v0+v1-h)*0.5f;
            return new[]{x,y,x+w,y+h};
        }
    }
}
