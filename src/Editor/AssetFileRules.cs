using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

namespace CityWeaver
{
    internal static class AssetFileRules
    {
        internal const long TextureLimit=64L*1024*1024, ProjectLimit=512L*1024*1024;
        internal const int MaxFiles=256, MaxPixels=16777216;
        internal static string LocalPath(string value,bool directory)
        {
            if(string.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value) || value.StartsWith(@"\\",StringComparison.Ordinal) || value.IndexOf('\0')>=0)
                throw new ArgumentException("Expected an absolute local filesystem path.");
            var full=Path.GetFullPath(value);
            if(directory ? !Directory.Exists(full) : !File.Exists(full)) throw new FileNotFoundException("Input does not exist.",full);
            for(var p=directory?full:Path.GetDirectoryName(full);!string.IsNullOrEmpty(p);p=Path.GetDirectoryName(p))
                if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0) throw new ArgumentException("Input paths must not traverse symbolic links or junctions.");
            if((File.GetAttributes(full)&FileAttributes.ReparsePoint)!=0) throw new ArgumentException("Linked inputs are unsupported.");
            return full;
        }
        internal static string Hash(string path)
        {
            using(var sha=SHA256.Create()) using(var input=File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","");
        }
        internal static string HashBytes(byte[] bytes)
        {
            using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","");
        }
        internal static Dictionary<string,string> Scan(string root)
        {
            root=LocalPath(root,true);
            var files=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase); long bytes=0;
            var directories=new Queue<string>();directories.Enqueue(root);int directoryCount=1;
            while(directories.Count>0)
            {
                var dir=directories.Dequeue();
                foreach(var child in Directory.GetDirectories(dir))
                {
                    if((File.GetAttributes(child)&FileAttributes.ReparsePoint)!=0) throw new ArgumentException("Linked project directories are unsupported.");
                    directories.Enqueue(child);
                    if(++directoryCount>MaxFiles) throw new ArgumentException("Too many project directories.");
                }
                foreach(var file in Directory.GetFiles(dir))
                {
                    LocalPath(file,false);
                    var ext=Path.GetExtension(file).ToLowerInvariant();
                    if(!new[]{".fbx",".obj",".mtl",".png",".tga",".json"}.Contains(ext))
                        throw new ArgumentException("Unsupported project input extension: "+ext);
                    bytes+=new FileInfo(file).Length;
                    if(bytes>ProjectLimit || files.Count>=MaxFiles) throw new ArgumentException("Project exceeds 256 files or 512 MiB.");
                    files.Add(file.Substring(root.TrimEnd(Path.DirectorySeparatorChar).Length+1),Hash(file));
                }
            }
            if(!files.Keys.Any(p=>new[]{".fbx",".obj"}.Contains(Path.GetExtension(p).ToLowerInvariant())))
                throw new ArgumentException("Project must contain an FBX or OBJ model.");
            return files;
        }
        internal static bool Same(Dictionary<string,string> a,Dictionary<string,string> b) =>
            a.Count==b.Count && a.All(p=>b.TryGetValue(p.Key,out var hash) && hash==p.Value);
        internal static string NativePath(string path)=>Path.GetFullPath(path).Replace('\\','/').TrimEnd('/');
        internal static int VtLayerOffset(int stack,int layer,int stackCount)
        {
            if(stack<0 || stack>=stackCount || layer<0 || layer>=4)throw new ArgumentException("Invalid VT stack/layer.");
            return checked(stack*4+layer);
        }
        internal static bool ValidBounds(float minX,float minY,float minZ,float maxX,float maxY,float maxZ)
        {
            var values=new[]{minX,minY,minZ,maxX,maxY,maxZ};
            return values.All(v=>!float.IsNaN(v)&&!float.IsInfinity(v)) && minX<=maxX && minY<=maxY && minZ<=maxZ &&
                ((double)maxX-minX+(double)maxY-minY+(double)maxZ-minZ)>0.00001;
        }
        internal static void Dimensions(int width,int height)
        {
            if(width<1 || height<1 || width>8192 || height>8192 || (long)width*height>MaxPixels)
                throw new ArgumentException("Texture exceeds 8192 per axis or 16 megapixels.");
        }
        internal static void ImageSize(byte[] data,string extension,out int width,out int height)
        {
            if(data.LongLength>TextureLimit) throw new ArgumentException("Texture exceeds 64 MiB.");
            if(extension.Equals(".png",StringComparison.OrdinalIgnoreCase))
            {
                byte[] signature={137,80,78,71,13,10,26,10};
                if(data.Length<33 || !data.Take(8).SequenceEqual(signature) || data[12]!=73 || data[13]!=72 || data[14]!=68 || data[15]!=82)
                    throw new ArgumentException("Invalid PNG header.");
                width=checked((int)(((uint)data[16]<<24)|((uint)data[17]<<16)|((uint)data[18]<<8)|data[19]));
                height=checked((int)(((uint)data[20]<<24)|((uint)data[21]<<16)|((uint)data[22]<<8)|data[23]));
            }
            else if(extension.Equals(".tga",StringComparison.OrdinalIgnoreCase))
            {
                if(data.Length<18 || data[1]!=0 || (data[2]!=2 && data[2]!=10) || (data[16]!=24 && data[16]!=32) || (data[17]&0xc0)!=0)
                    throw new ArgumentException("TGA requires uncompressed/RLE true color, 24/32 bits, no color map or interleaving.");
                width=data[12]|data[13]<<8; height=data[14]|data[15]<<8;
            }
            else throw new ArgumentException("Texture must be PNG or TGA.");
            Dimensions(width,height);
        }
        // Returns Unity's bottom-left, row-major RGBA layout. Both TGA origin bits
        // and RLE packet limits are handled before touching Unity objects.
        internal static byte[] DecodeTga(byte[] data,out int width,out int height)
        {
            ImageSize(data,".tga",out width,out height);
            int pixels=checked(width*height),stride=data[16]/8,cursor=18+data[0],written=0;
            var rgba=new byte[checked(pixels*4)];
            while(written<pixels)
            {
                int count=1;bool repeat=false;
                if(data[2]==10){if(cursor>=data.Length)throw new ArgumentException("Truncated TGA packet.");var packet=data[cursor++];repeat=(packet&128)!=0;count=(packet&127)+1;}
                if(count>pixels-written || cursor+(repeat?stride:count*stride)>data.Length) throw new ArgumentException("Invalid TGA packet length.");
                for(int i=0;i<count;i++)
                {
                    int input=cursor+(repeat?0:i*stride),x=written%width,y=written/width;
                    if((data[17]&16)!=0)x=width-1-x;if((data[17]&32)!=0)y=height-1-y;
                    int output=(y*width+x)*4;rgba[output]=data[input+2];rgba[output+1]=data[input+1];rgba[output+2]=data[input];rgba[output+3]=stride==4?data[input+3]:(byte)255;written++;
                }
                cursor+=repeat?stride:count*stride;
            }
            return rgba;
        }
    }
}
