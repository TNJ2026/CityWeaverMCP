using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using Colossal.AssetPipeline.Importers;
using Game.Prefabs;
using UnityEngine.Rendering;

namespace CityWeaver
{
    // Optional authored rigid skinning. Coordinates are Unity metres, with parent-local pivots.
    internal sealed class ObjRigidRig
    {
        internal ModelImporter.Model.BoneInfo[] Bones;
        internal ProceduralAnimationProperties.BoneInfo[] Procedural;
        internal McpVehicleDoorProperties.Door[] Doors;
        internal Dictionary<string,int> Groups;
        internal static ObjRigidRig Load(string directory,float scale=1)
        {
            string path=Path.Combine(directory,"cityweaver-rig.json");if(!File.Exists(path))return null;
            AssetFileRules.LocalPath(path,false);if(new FileInfo(path).Length>256*1024)throw new ArgumentException("Rig configuration exceeds 256 KiB.");
            var json=JObject.Parse(File.ReadAllText(path));Fields(json,"bones","groups");var rows=json["bones"] as JArray;
            if(rows==null||rows.Count<1||rows.Count>64)throw new ArgumentException("Rigid rig requires 1..64 bones.");
            var names=rows.Select(r=>(string)r["name"]).ToArray();var parents=rows.Select(r=>(int?)r["parent"]??-2).ToArray();VehicleModelRules.Hierarchy(names,parents);
            if(parents[0]!=-1||parents.Skip(1).Any(p=>p<0))throw new ArgumentException("Rig requires one root at index zero.");
            var rig=new ObjRigidRig{Bones=new ModelImporter.Model.BoneInfo[rows.Count],Procedural=new ProceduralAnimationProperties.BoneInfo[rows.Count],Groups=new Dictionary<string,int>(StringComparer.Ordinal)};
            var positions=new Vector3[rows.Count];var worlds=new Matrix4x4[rows.Count];var doors=new List<McpVehicleDoorProperties.Door>();
            for(int i=0;i<rows.Count;i++)
            {
                var row=(JObject)rows[i];Fields(row,"name","parent","position","type","rotation_degrees","speed","acceleration","door_side","open_angle_degrees","duration_seconds");
                if(parents[i]>=i)throw new ArgumentException("Parents must precede their children.");
                var p=row["position"] as JArray;if(p==null||p.Count!=3)throw new ArgumentException("Bone position needs xyz.");
                var xyz=p.Select(x=>Number((float)x,-1000,1000,"position")*scale).ToArray();var local=new Vector3(xyz[0],xyz[1],xyz[2]);
                var rotation=Quaternion.identity;
                if(row["rotation_degrees"]!=null)
                {
                    var angles=row["rotation_degrees"] as JArray;
                    if(angles==null||angles.Count!=3)throw new ArgumentException("Bone rotation needs xyz.");
                    var degrees=angles.Select(x=>Number((float)x,-360,360,"rotation")).ToArray();
                    rotation=Quaternion.Euler(degrees[0],degrees[1],degrees[2]);
                }
                worlds[i]=(parents[i]<0?Matrix4x4.identity:worlds[parents[i]])*Matrix4x4.TRS(local,rotation,Vector3.one);
                positions[i]=worlds[i].MultiplyPoint3x4(Vector3.zero);
                var type=(string)row["type"]??"None";
                if(type!="None"&&type!="RollingTire"&&type!="SteeringTire"&&type!="PoweredRotation")throw new ArgumentException("Unsupported rigid bone type.");
                var boneType=(BoneType)Enum.Parse(typeof(BoneType),type);
                if(boneType!=BoneType.PoweredRotation&&Quaternion.Angle(rotation,Quaternion.identity)>.001f)
                    throw new ArgumentException("Authored rotation currently requires a PoweredRotation bone.");
                if((boneType==BoneType.RollingTire||boneType==BoneType.SteeringTire)&&(parents[i]!=0||positions[i].y<=0))throw new ArgumentException("Tires must be root children with positive axle height (native rolling radius).");
                float speed=Number((float?)row["speed"]??0,-100,100,"speed"),acceleration=Number((float?)row["acceleration"]??0,0,100,"acceleration");
                if(boneType==BoneType.PoweredRotation&&(parents[i]!=0||Math.Abs(speed)<.001f||acceleration<=0))throw new ArgumentException("Rotors require a root-child bone, nonzero speed and positive acceleration.");
                var bind=worlds[i].inverse;
                rig.Bones[i]=new ModelImporter.Model.BoneInfo{id=i,name=names[i],parentIndex=parents[i],localPosition=local,localRotation=rotation,localScale=Vector3.one,bindPose=bind};
                rig.Procedural[i]=new ProceduralAnimationProperties.BoneInfo{name=names[i],parentId=parents[i],position=local,rotation=rotation,scale=Vector3.one,bindPose=bind,m_Type=boneType,m_Speed=speed,m_Acceleration=acceleration};
                if(row["door_side"]!=null)
                {
                    string side=(string)row["door_side"];if((side!="left"&&side!="right")||boneType!=BoneType.None||parents[i]!=0)throw new ArgumentException("Doors require a root-child None bone and left/right side.");
                    float angle=Number((float?)row["open_angle_degrees"]??0,-120,120,"door angle"),duration=Number((float?)row["duration_seconds"]??1,.1f,10,"door duration");
                    if(Math.Abs(angle)<1)throw new ArgumentException("Door opening angle must be nonzero.");
                    doors.Add(new McpVehicleDoorProperties.Door{bone=names[i],right=side=="right",angle=angle,duration=duration});
                }
            }
            var groups=json["groups"] as JObject;if(groups==null||groups.Count<1||groups.Count>256)throw new ArgumentException("Explicit OBJ group-to-bone map required.");
            foreach(var entry in groups.Properties()){int index=Array.IndexOf(names,(string)entry.Value);if(index<0)throw new ArgumentException("Unknown rig bone for group "+entry.Name);rig.Groups.Add(entry.Name,index);}
            rig.Doors=doors.ToArray();return rig;
        }
        private static void Fields(JObject value,params string[] fields){if(value.Properties().Any(p=>!fields.Contains(p.Name)))throw new ArgumentException("Unknown rigid rig field.");}
        private static float Number(float value,float min,float max,string name){VehicleModelRules.Finite(value,min,max,name);return value;}
        internal int Index(string group){if(!Groups.TryGetValue(group,out var index))throw new ArgumentException("Unmapped OBJ group: "+group);return index;}
        internal void Attach(RenderPrefab render)
        {
            // GeometryAsset deliberately stores GPU vertex streams, not Unity Mesh.bindposes.
            // The native prefab component is the authoritative bind-pose and bone-order table.
            var native=render.GetComponent<ProceduralAnimationProperties>();
            if(native?.m_Bones==null||native.m_Bones.Length!=Bones.Length)throw new ArgumentException("Native procedural rig missing; settings.json must enable createProceduralAnimationForPrefab for this render group.");
            foreach(var expected in Procedural)
            {
                var actual=native.m_Bones.SingleOrDefault(b=>b.name==expected.name);
                if(actual==null)throw new ArgumentException("Native bone name missing: "+expected.name);
                string parent=actual.parentId<0?null:native.m_Bones[actual.parentId].name;
                string expectedParent=expected.parentId<0?null:Procedural[expected.parentId].name;
                if(parent!=expectedParent||Vector3.Distance(actual.position,expected.position)>.0001f||Quaternion.Angle(actual.rotation,expected.rotation)>.01f)throw new ArgumentException("Native bone hierarchy, pivot or axis mismatch: "+expected.name);
                for(int i=0;i<16;i++)if(Math.Abs(actual.bindPose[i]-expected.bindPose[i])>.0001f)throw new ArgumentException("Native bind pose mismatch: "+expected.name);
            }
            var meshes=render.ObtainMeshes();
            try{foreach(var mesh in meshes)ValidateSkin(mesh,native.m_Bones.Length);}
            finally{render.ReleaseMeshes();}
            foreach(var bone in native.m_Bones){var authored=Procedural.Single(b=>b.name==bone.name);bone.m_Type=authored.m_Type;bone.m_Speed=authored.m_Speed;bone.m_Acceleration=authored.m_Acceleration;}
            var doors=render.AddOrGetComponent<McpVehicleDoorProperties>();doors.m_Doors=Doors;
        }
        internal static void ValidateSkin(Mesh mesh,int boneCount)
        {
            var attribute=VertexAttribute.BlendIndices;
            if(!mesh.HasVertexAttribute(attribute)||mesh.GetVertexAttributeFormat(attribute)!=VertexAttributeFormat.UInt32||mesh.GetVertexAttributeDimension(attribute)!=1||mesh.HasVertexAttribute(VertexAttribute.BlendWeight))
                throw new ArgumentException("Expected native UInt32x1 rigid skin with no weight stream.");
            int stream=mesh.GetVertexAttributeStream(attribute),offset=mesh.GetVertexAttributeOffset(attribute),stride=mesh.GetVertexBufferStride(stream);
            using(var data=Mesh.AcquireReadOnlyMeshData(mesh))RigidSkinRules.Validate(data[0].GetVertexData<byte>(stream).ToArray(),stride,offset,mesh.vertexCount,boneCount);
        }
    }
}
