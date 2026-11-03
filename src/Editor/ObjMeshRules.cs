using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace CityWeaver
{
    internal sealed class ObjMeshPart
    {
        internal string Name;
        internal readonly List<float> Positions=new List<float>(),Normals=new List<float>(),UVs=new List<float>(),Tangents=new List<float>();
        internal readonly List<int> Indices=new List<int>();
        internal readonly List<string> Groups=new List<string>();
        internal float[] Bounds(float scale=1)
        {
            if(Positions.Count<3 || Positions.Count%3!=0)throw new ArgumentException("OBJ position stream is empty or incomplete.");
            var b=new[]{float.PositiveInfinity,float.PositiveInfinity,float.PositiveInfinity,float.NegativeInfinity,float.NegativeInfinity,float.NegativeInfinity};
            for(int i=0;i<Positions.Count;i++){int axis=i%3;float value=Positions[i]*scale;b[axis]=Math.Min(b[axis],value);b[axis+3]=Math.Max(b[axis+3],value);}
            return b;
        }
    }
    internal static class ObjMeshRules
    {
        internal const int MaxVertices=1000000;
        private struct V
        {
            internal float X,Y,Z;internal V(float x,float y,float z){X=x;Y=y;Z=z;}
            public static V operator -(V a,V b)=>new V(a.X-b.X,a.Y-b.Y,a.Z-b.Z);
            public static V operator *(V a,float b)=>new V(a.X*b,a.Y*b,a.Z*b);
            internal static V Cross(V a,V b)=>new V(a.Y*b.Z-a.Z*b.Y,a.Z*b.X-a.X*b.Z,a.X*b.Y-a.Y*b.X);
            internal static float Dot(V a,V b)=>a.X*b.X+a.Y*b.Y+a.Z*b.Z;
            internal V Unit(){var length=Math.Sqrt(Dot(this,this));if(length<1e-12 || double.IsNaN(length) || double.IsInfinity(length))throw new ArgumentException("Degenerate OBJ vector/triangle.");return this*(float)(1/length);}
            internal void Append(List<float> list){list.Add(X);list.Add(Y);list.Add(Z);}
        }
        private struct Corner{internal int P,T,N;}
        private static float Number(string s)
        {
            if(!float.TryParse(s,NumberStyles.Float,CultureInfo.InvariantCulture,out var f) || float.IsNaN(f) || float.IsInfinity(f) || Math.Abs(f)>1000000)
                throw new ArgumentException("Invalid/unbounded OBJ coordinate.");return f;
        }
        private static int Index(string s,int count)
        {
            if(!int.TryParse(s,NumberStyles.Integer,CultureInfo.InvariantCulture,out var i) || i==0)throw new ArgumentException("Invalid OBJ index.");
            long actual=i>0?(long)i-1:(long)count+i;if(actual<0 || actual>=count)throw new ArgumentException("OBJ index outside its declared stream.");return (int)actual;
        }
        internal static List<ObjMeshPart> Parse(IEnumerable<string> lines)
        {
            var positions=new List<V>();var uvs=new List<V>();var normals=new List<V>();var parts=new Dictionary<string,ObjMeshPart>();
            string material="Default",group="Default";int total=0,lineNumber=0;
            foreach(var source in lines)
            {
                if(++lineNumber>5000000 || source.Length>16384)throw new ArgumentException("OBJ text limit exceeded.");
                var line=source.Split('#')[0].Trim();if(line.Length==0)continue;
                var words=line.Split((char[])null,StringSplitOptions.RemoveEmptyEntries);
                switch(words[0])
                {
                    case "v":
                        if(words.Length!=4 || positions.Count>=MaxVertices)throw new ArgumentException("OBJ v requires xyz; homogeneous/color vertices are unsupported.");
                        // OBJ is right-handed, Unity is left-handed. Reflect Z and
                        // reverse face winding together; preserve metre units and UVs.
                        positions.Add(new V(Number(words[1]),Number(words[2]),-Number(words[3])));break;
                    case "vt":
                        if(words.Length<3 || words.Length>4 || uvs.Count>=MaxVertices)throw new ArgumentException("Invalid OBJ UV.");
                        uvs.Add(new V(Number(words[1]),Number(words[2]),0));break;
                    case "vn":
                        if(words.Length!=4 || normals.Count>=MaxVertices)throw new ArgumentException("Invalid OBJ normal.");
                        normals.Add(new V(Number(words[1]),Number(words[2]),-Number(words[3])).Unit());break;
                    case "usemtl": material=string.Join("_",words.Skip(1));if(material.Length==0 || material.Length>128)throw new ArgumentException("Invalid OBJ material group.");break;
                    case "f":
                        if(words.Length<4 || words.Length>257)throw new ArgumentException("OBJ faces require 3..256 corners.");
                        var face=new Corner[words.Length-1];
                        for(int i=0;i<face.Length;i++)
                        {
                            var components=words[i+1].Split('/');if(components.Length>3)throw new ArgumentException("Invalid OBJ face corner.");
                            face[i]=new Corner{P=Index(components[0],positions.Count),T=components.Length>1&&components[1].Length>0?Index(components[1],uvs.Count):-1,N=components.Length>2&&components[2].Length>0?Index(components[2],normals.Count):-1};
                        }
                        var normal=V.Cross(positions[face[1].P]-positions[face[0].P],positions[face[2].P]-positions[face[0].P]).Unit();
                        // Convex planar polygons can be triangulated without changing
                        // winding. Reject ambiguous concave/nonplanar input explicitly.
                        for(int i=0;i<face.Length;i++)
                        {
                            var a=positions[face[i].P];var b=positions[face[(i+1)%face.Length].P];var c=positions[face[(i+2)%face.Length].P];
                            if(V.Dot(V.Cross(b-a,c-b),normal)<-1e-5f || Math.Abs(V.Dot(a-positions[face[0].P],normal))>.001f)
                                throw new ArgumentException("Triangulate concave or nonplanar OBJ faces before import.");
                        }
                        if(!parts.TryGetValue(material,out var part)){if(parts.Count>=64)throw new ArgumentException("OBJ exceeds 64 materials.");part=new ObjMeshPart{Name=material};parts.Add(material,part);}
                        for(int i=1;i<face.Length-1;i++)
                        {
                            if((total+=3)>MaxVertices)throw new ArgumentException("OBJ exceeds one million expanded vertices.");
                            var corners=new[]{face[0],face[i+1],face[i]};var a=positions[corners[0].P];var b=positions[corners[1].P];var c=positions[corners[2].P];
                            var faceNormal=V.Cross(b-a,c-a).Unit();
                            var uv=corners.Select(v=>v.T<0?new V(0,0,0):uvs[v.T]).ToArray();
                            var uv1=uv[1]-uv[0];var uv2=uv[2]-uv[0];var det=uv1.X*uv2.Y-uv1.Y*uv2.X;
                            var tangent=Math.Abs(det)>1e-12f?((b-a)*uv2.Y-(c-a)*uv1.Y)*(1/det):new V(0,0,0);
                            var bitangent=Math.Abs(det)>1e-12f?((c-a)*uv1.X-(b-a)*uv2.X)*(1/det):new V(0,0,0);
                            for(int j=0;j<3;j++)
                            {
                                var corner=corners[j];var n=corner.N<0?faceNormal:normals[corner.N];
                                var t=tangent-n*V.Dot(n,tangent);
                                if(V.Dot(t,t)<1e-12f)t=V.Cross(Math.Abs(n.Y)<.9f?new V(0,1,0):new V(1,0,0),n);
                                t=t.Unit();part.Indices.Add(part.Positions.Count/3);positions[corner.P].Append(part.Positions);n.Append(part.Normals);
                                part.Groups.Add(group);
                                part.UVs.Add(uv[j].X);part.UVs.Add(uv[j].Y);t.Append(part.Tangents);part.Tangents.Add(V.Dot(V.Cross(n,t),bitangent)<0?-1:1);
                            }
                        }
                        break;
                    case "g":group=string.Join("_",words.Skip(1));if(group.Length==0||group.Length>128)throw new ArgumentException("Invalid OBJ group.");break;
                    case "o":case "s":case "mtllib":break;
                    default:throw new ArgumentException("Unsupported OBJ directive: "+words[0]);
                }
            }
            if(parts.Count==0)throw new ArgumentException("OBJ contains no faces.");return parts.Values.ToList();
        }
    }
}
