using System;
using System.Collections.Generic;
using System.IO;
using Colossal.AssetPipeline;
using Colossal.AssetPipeline.Diagnostic;
using Colossal.AssetPipeline.Importers;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Rendering;

namespace CityWeaver
{
    [Extension(new[]{".obj"})]
    public sealed class CityWeaverObjImporter : ModelImporter
    {
        public override string displayName=>"CityWeaver OBJ Importer";
        public struct ImportSettings : ISettings { public float scale; }
        public override ISettings GetDefaultSettings()=>new ImportSettings{scale=1};
        public override bool ImportAnimationData<T>(ISettings settings,string path,Report.FileReport report,out T instance){instance=default;return false;}
        public override bool Import<T>(ISettings settings,string path,Report.FileReport report,out T instance)
        {
            var parsed=ObjMeshRules.Parse(File.ReadLines(path));var scale=((ImportSettings)settings).scale;
            if(float.IsNaN(scale) || float.IsInfinity(scale) || scale<=0 || scale>1000)throw new ArgumentException("OBJ scale must be in (0,1000].");
            var rig=ObjRigidRig.Load(Path.GetDirectoryName(path),scale);
            var models=new List<Model>();
            try{
                foreach(var part in parsed)
                {
                    int count=part.Positions.Count/3;
                    var limits=part.Bounds(scale);var bounds=new Bounds();
                    bounds.SetMinMax(new Vector3(limits[0],limits[1],limits[2]),new Vector3(limits[3],limits[4],limits[5]));
                    var attributes=new List<Model.VertexData>();NativeArray<int> indices=default;
                    try{
                        var positions=part.Positions.ConvertAll(v=>v*scale);
                        attributes.Add(Attribute(VertexAttribute.Position,3,positions));attributes.Add(Attribute(VertexAttribute.Normal,3,part.Normals));
                        attributes.Add(Attribute(VertexAttribute.TexCoord0,2,part.UVs));attributes.Add(Attribute(VertexAttribute.Tangent,4,part.Tangents));
                        if(rig!=null)
                        {
                            // The native pipeline uses one UInt32 index with no weight
                            // stream for rigid skinning (SkinPostProcessor.GenerateGenericRig).
                            var ids=new int[count];for(int i=0;i<count;i++)ids[i]=rig.Index(part.Groups[i]);
                            var bytes=new byte[count*4];Buffer.BlockCopy(ids,0,bytes,0,bytes.Length);
                            attributes.Add(new Model.VertexData(VertexAttribute.BlendIndices,VertexAttributeFormat.UInt32,1,new NativeArray<byte>(bytes,Allocator.Persistent)));
                        }
                        indices=new NativeArray<int>(part.Indices.ToArray(),Allocator.Persistent);
                        models.Add(new Model(Path.GetFileNameWithoutExtension(path)+(models.Count==0?"":"#"+models.Count),Matrix4x4.identity,count,indices,attributes.ToArray(),
                            new[]{new SubMeshDescriptor(0,indices.Length,MeshTopology.Triangles){firstVertex=0,vertexCount=count,bounds=bounds}},rig==null?-1:0,rig?.Bones??Array.Empty<Model.BoneInfo>()));
                    }catch{if(indices.IsCreated)indices.Dispose();foreach(var attribute in attributes)attribute.Dispose();throw;}
                }
                instance=(T)(object)new ModelList{models=models.ToArray()};return true;
            }catch{foreach(var model in models)model.Dispose();throw;}
        }
        private static Model.VertexData Attribute(VertexAttribute attribute,int dimension,List<float> values)
        {
            var bytes=new byte[checked(values.Count*sizeof(float))];Buffer.BlockCopy(values.ToArray(),0,bytes,0,bytes.Length);
            return new Model.VertexData(attribute,VertexAttributeFormat.Float32,dimension,new NativeArray<byte>(bytes,Allocator.Persistent));
        }
    }
}
