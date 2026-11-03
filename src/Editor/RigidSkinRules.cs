using System;
namespace CityWeaver
{
    internal static class RigidSkinRules
    {
        internal static void Validate(byte[] stream,int stride,int offset,int vertices,int bones)
        {
            if(stream==null||bones<1||bones>256||vertices<1||offset<0||stride<4||offset>stride-4||(long)(vertices-1)*stride+offset+4>stream.Length)
                throw new ArgumentException("Rigid skin stream layout is invalid.");
            for(int i=0;i<vertices;i++)
            {
                int start=i*stride+offset;
                uint index=(uint)(stream[start]|stream[start+1]<<8|stream[start+2]<<16|stream[start+3]<<24);
                if(index>=bones)throw new ArgumentException("Rigid vertex bone index exceeds skeleton: "+index+" / "+bones);
            }
        }
    }
}
