using System;
using System.Globalization;
using System.IO;

namespace CityWeaver
{
    // Unity left-handed to OBJ right-handed, metres, Y up. Positions already in object space.
    internal sealed class ModelObjWriter
    {
        private readonly TextWriter writer;
        private int vertices,uvs,normals;
        internal ModelObjWriter(TextWriter writer){this.writer=writer;writer.WriteLine("# CityWeaver static geometry; metres, Y up, right handed\nmtllib model.mtl");}
        private static string F(float x){if(float.IsNaN(x)||float.IsInfinity(x))throw new ArgumentException("Non-finite mesh coordinate.");return x.ToString("R",CultureInfo.InvariantCulture);}
        internal void Part(float[][] positions,float[][] uv,float[][] normal,int[] indices,string material)
        {
            if(positions.Length==0 || positions.Length>2000000 || vertices+positions.Length>2000000 || indices.Length==0 || indices.Length%3!=0 || indices.Length>6000000)throw new ArgumentException("Unsupported mesh size/topology.");
            if(uv.Length!=0&&uv.Length!=positions.Length || normal.Length!=0&&normal.Length!=positions.Length)throw new ArgumentException("Mismatched vertex attributes.");
            foreach(int index in indices)if(index<0||index>=positions.Length)throw new ArgumentException("Invalid triangle index.");
            writer.WriteLine("o "+material);writer.WriteLine("usemtl "+material);
            foreach(var p in positions)writer.WriteLine("v "+F(p[0])+" "+F(p[1])+" "+F(-p[2]));
            foreach(var t in uv)writer.WriteLine("vt "+F(t[0])+" "+F(t[1]));
            foreach(var n in normal)writer.WriteLine("vn "+F(n[0])+" "+F(n[1])+" "+F(-n[2]));
            Func<int,string> face=i=>(vertices+i+1).ToString(CultureInfo.InvariantCulture)+(uv.Length>0?"/"+(uvs+i+1):normal.Length>0?"/":"")+(normal.Length>0?"/"+(normals+i+1):"");
            for(int i=0;i<indices.Length;i+=3)writer.WriteLine("f "+face(indices[i])+" "+face(indices[i+2])+" "+face(indices[i+1]));
            vertices+=positions.Length;uvs+=uv.Length;normals+=normal.Length;
        }
    }
}
