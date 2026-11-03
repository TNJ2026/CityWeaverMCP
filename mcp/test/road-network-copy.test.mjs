import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('road network copies preserve rigid geometry and reject graph or native readback changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-road-copy-'));
  try {
    const geometry = fileURLToPath(new URL('../../src/Roads/RoadCopyGeometry.cs', import.meta.url));
    const verifier = fileURLToPath(new URL('../../src/Roads/McpRoadToolSystem.NetworkCopy.cs', import.meta.url));
    const connections = fileURLToPath(new URL('../../src/Roads/McpRoadToolSystem.CopyConnections.cs', import.meta.url));
    const protection = fileURLToPath(new URL('../../src/Roads/McpRoadCopyNodeProtectionSystem.cs', import.meta.url));
    const curves = fileURLToPath(new URL('../../src/Roads/RoadCopyCurveRules.cs', import.meta.url));
    const paths = fileURLToPath(new URL('../../src/Roads/McpRoadToolSystem.CopyPaths.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${geometry}"/><Compile Include="${verifier}"/><Compile Include="${connections}"/><Compile Include="${curves}"/><Compile Include="${protection}"/><Compile Include="${paths}"/></ItemGroup></Project>`);
    // Minimal ECS doubles run the production readback verifier outside the Unity player.
    await writeFile(path.join(dir, 'Program.cs'), `using System;using System.Linq;using System.Collections.Generic;using System.Text.Json;using Unity.Entities;using Unity.Mathematics;using Game.Net;using Game.Prefabs;using Game.Common;using CityWeaver;using Bezier=Colossal.Mathematics.Bezier4x3;
namespace Unity.Collections {public enum Allocator{Temp}}
namespace Unity.Entities {
 public struct Entity {public int Id;public static Entity Null=>default;public static implicit operator Entity(int id)=>new Entity{Id=id};public static bool operator ==(Entity a,Entity b)=>a.Id==b.Id;public static bool operator !=(Entity a,Entity b)=>a.Id!=b.Id;public override bool Equals(object o)=>o is Entity e&&e.Id==Id;public override int GetHashCode()=>Id;}
 public class Manager {
  readonly Dictionary<(Entity,Type),object> data=new Dictionary<(Entity,Type),object>();
  public void Put<T>(Entity e,T value)=>data[(e,typeof(T))]=value;
  public void CompleteAllTrackedJobs(){}public void AddComponentData<T>(Entity e,T value)=>Put(e,value);public void RemoveComponent<T>(Entity e)=>data.Remove((e,typeof(T)));
  public bool Exists(Entity e)=>e!=Entity.Null;
  public bool HasComponent<T>(Entity e)=>data.ContainsKey((e,typeof(T)));
  public T GetComponentData<T>(Entity e)=>(T)data[(e,typeof(T))];
  public bool HasBuffer<T>(Entity e)=>HasComponent<List<T>>(e);
  public List<T> GetBuffer<T>(Entity e,bool readOnly)=>GetComponentData<List<T>>(e);
  public IEnumerable<Entity> With<T>()=>data.Keys.Where(k=>k.Item2==typeof(T)).Select(k=>k.Item1);
 }
 public struct ComponentType {public static ComponentType ReadOnly<T>()=>default;public static ComponentType Exclude<T>()=>default;}
 public class FakeWorld {public Dictionary<Type,object> Items=new Dictionary<Type,object>();public T GetExistingSystemManaged<T>() where T:class=>Items.TryGetValue(typeof(T),out var v)?v as T:null;}
 public class EntityQuery {readonly Manager em;readonly bool nodes;public EntityQuery(Manager m,bool n=false){em=m;nodes=n;}public EntityArray ToEntityArray(Unity.Collections.Allocator a)=>new EntityArray(em.With<Game.Tools.Temp>().Where(e=>nodes?em.HasComponent<Node>(e)&&!em.HasComponent<Fixed>(e)&&!em.HasComponent<Deleted>(e):em.HasComponent<Edge>(e)).ToArray());}
 public class EntityArray:IDisposable,System.Collections.Generic.IEnumerable<Entity>{readonly Entity[] data;public EntityArray(Entity[] e){data=e;}public System.Collections.Generic.IEnumerator<Entity> GetEnumerator()=>((IEnumerable<Entity>)data).GetEnumerator();System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator()=>data.GetEnumerator();public void Dispose(){}}
}
namespace Game {public abstract class GameSystemBase {
 public Unity.Entities.Manager EntityManager;public Unity.Entities.FakeWorld World;
 public void Init(Unity.Entities.Manager m,Unity.Entities.FakeWorld w){EntityManager=m;World=w;OnCreate();}public void Run()=>OnUpdate();
 protected Unity.Entities.EntityQuery GetEntityQuery(params Unity.Entities.ComponentType[] t)=>new Unity.Entities.EntityQuery(EntityManager,true);
 protected virtual void OnCreate(){}protected virtual void OnDestroy(){}protected abstract void OnUpdate();
}}
namespace Unity.Mathematics {
 public struct float2 {public float x,y;public float2(float a,float b){x=a;y=b;}}
 public struct float3 {public float x,y,z;public float3(float a,float b,float c){x=a;y=b;z=c;}public float2 xz=>new float2(x,z);}
 public static class math{public static float distance(float3 a,float3 b)=>(float)Math.Sqrt(Math.Pow(a.x-b.x,2)+Math.Pow(a.y-b.y,2)+Math.Pow(a.z-b.z,2));public static bool all(bool b)=>b;public static bool isfinite(float v)=>float.IsFinite(v);public static bool isfinite(float3 p)=>isfinite(p.x)&&isfinite(p.y)&&isfinite(p.z);public static bool isfinite(float2 p)=>isfinite(p.x)&&isfinite(p.y);public static float abs(float v)=>Math.Abs(v);public static float max(float a,float b)=>Math.Max(a,b);public static float min(float a,float b)=>Math.Min(a,b);}
}
namespace Colossal.Mathematics {
 public struct Bezier4x3{public float3 a,b,c,d;public Bezier4x3 xz=>this;}
 public static class MathUtils{
  public static float3 Position(Bezier4x3 c,float t){float u=1-t;return new float3(u*u*u*c.a.x+3*u*u*t*c.b.x+3*u*t*t*c.c.x+t*t*t*c.d.x,u*u*u*c.a.y+3*u*u*t*c.b.y+3*u*t*t*c.c.y+t*t*t*c.d.y,u*u*u*c.a.z+3*u*u*t*c.b.z+3*u*t*t*c.c.z+t*t*t*c.d.z);}
  public static float Distance(Bezier4x3 c,float2 p,out float t){float D(float f){var q=Position(c,f);return (q.x-p.x)*(q.x-p.x)+(q.z-p.y)*(q.z-p.y);}int best=0;float value=float.MaxValue;for(int i=0;i<=128;i++){var d=D(i/128f);if(d<value){value=d;best=i;}}float l=Math.Max(0,(best-1)/128f),r=Math.Min(1,(best+1)/128f);for(int i=0;i<28;i++){float a=l+(r-l)/3,b=r-(r-l)/3;if(D(a)<D(b))r=b;else l=a;}t=(l+r)/2;return (float)Math.Sqrt(D(t));}
 }
}
namespace Game.Common {public struct Deleted{}}
namespace Game.Tools {public struct Temp{public Entity m_Original;}}
namespace Game.Prefabs{public struct PrefabRef{public Entity m_Prefab;}}
namespace Game.Net {
 public struct Fixed{public int m_Index;}public struct Edge{public Entity m_Start,m_End;}public struct ConnectedEdge{public Entity m_Edge;}
 public struct Node{public float3 m_Position;}public struct Curve{public Bezier m_Bezier;}
 public struct CompositionFlags{public int Value;}public struct Upgraded{public CompositionFlags m_Flags;}
}
namespace CityWeaver {
 public class RoadSegmentPlan {public Entity Prefab,CopySourceStart,CopySourceEnd;public Bezier Curve;public CompositionFlags UpgradeFlags;public float3 Start,End;public float CopyStartTrimLimit,CopyEndTrimLimit;}
 public class RoadCopyTarget{public Entity Edge,Prefab,StartNode,EndNode;public Bezier Curve,OriginalCurve;public CompositionFlags Flags;public float3 Start,End;}
 public class RoadCopyBinding{public Entity Edge;public HashSet<Entity> ExternalEdges=new HashSet<Entity>();}
 public class RoadOperation {public bool Terminal,ApplyDispatched,CopyNodeCourses;public string CurveMode="network_copy",CopyValidationFailure;public int CopySourceNodeCount;public List<RoadSegmentPlan> Segments=new List<RoadSegmentPlan>();public List<RoadCopyTarget> CopyConnectionTargets=new List<RoadCopyTarget>();public Dictionary<Entity,RoadCopyBinding> CopyBindings=new Dictionary<Entity,RoadCopyBinding>();}
 public sealed partial class McpRoadToolSystem {public Manager EntityManager=new Manager();private RoadOperation m_Operation;private EntityQuery m_RoadQuery;private List<Entity> m_SplitRemnants=new List<Entity>();public McpRoadToolSystem(RoadOperation op){m_Operation=op;m_RoadQuery=new EntityQuery(EntityManager);}public bool Verify(List<Entity> edges)=>NetworkCopyMatches(edges);public void Remnants(params Entity[] edges)=>m_SplitRemnants=edges.ToList();public bool TargetsValid()=>CopyTargetsUnchanged();public Entity Canonical(Entity e)=>CopyCanonical(e);}
}
class Program {
 static int count;
 static void Check(bool value,string label){count++;if(!value)throw new Exception(label);}
 static void Near(float a,float b)=>Check(Math.Abs(a-b)<.001f,"transform changed");
 static Bezier Line(float x,float z,float endX,float endZ)=>new Bezier{a=new float3(x,10,z),b=new float3(x+(endX-x)/3,10,z+(endZ-z)/3),c=new float3(x+2*(endX-x)/3,10,z+2*(endZ-z)/3),d=new float3(endX,10,endZ)};
 static void Main(string[] args){
  RoadCopyGeometry.Transform(110,12,220,100,200,1000,2000,0,30,out var x,out var y,out var z);Near(x,1010);Near(y,42);Near(z,2020);
  RoadCopyGeometry.Transform(110,12,220,100,200,1000,2000,90,0,out x,out y,out z);Near(x,1020);Near(y,12);Near(z,1990);
  RoadCopyGeometry.Transform(x,y,z,1000,2000,100,200,-90,0,out x,out y,out z);Near(x,110);Near(y,12);Near(z,220);
  foreach(var angle in new[]{-360f,-123f,45f,180f,360f}){
   RoadCopyGeometry.Transform(3,7,4,0,0,0,0,angle,0,out x,out y,out z);Near(x*x+z*z,25);Near(y,7);
  }
  var op=new RoadOperation{CopySourceNodeCount=4};
  foreach(var axis in new[]{new[]{0f,0f,0f,10f},new[]{0f,0f,10f,0f},new[]{-3000f,0f,-2980f,-6300f},new[]{10f,10f,0f,0f}}){
   RoadCopyGeometry.Reflect(3,7,axis[0],axis[1],axis[2],axis[3],out var mx,out var mz);
   RoadCopyGeometry.Reflect(mx,mz,axis[0],axis[1],axis[2],axis[3],out var bx,out var bz);Near(bx,3);Near(bz,7);
   RoadCopyGeometry.Reflect(3,7,axis[2],axis[3],axis[0],axis[1],out bx,out bz);Near(mx,bx);Near(mz,bz);
   RoadCopyGeometry.Reflect(axis[0],axis[1],axis[0],axis[1],axis[2],axis[3],out bx,out bz);Near(bx,axis[0]);Near(bz,axis[1]);
   RoadCopyGeometry.Transform(mx,12,mz,mx,mz,100,200,37,5,out bx,out var by,out bz);Near(bx,100);Near(by,17);Near(bz,200);
  }
  RoadCopyGeometry.Reflect(3,7,0,0,0,10,out var vx,out var vz);Near(vx,-3);Near(vz,7);
  RoadCopyGeometry.Reflect(3,7,0,0,10,10,out vx,out vz);Near(vx,7);Near(vz,3);
  Check(!RoadCopyGeometry.ValidMirrorAxis(0,0,.9f,0),"short mirror axis accepted");
  Check(!RoadCopyGeometry.ValidMirrorAxis(float.NaN,0,10,0),"NaN axis accepted");
  Check(!RoadCopyGeometry.ValidMirrorAxis(0,0,float.PositiveInfinity,0),"infinite axis accepted");
  int left=3,right=9;RoadCopyGeometry.SwapSides(ref left,ref right);Check(left==9&&right==3,"mirrored side flags");
  // A branch: input order is unrelated to route traversal, with mixed prefabs and upgrades.
  op.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=1,CopySourceEnd=2,Curve=Line(0,0,30,0)});
  op.Segments.Add(new RoadSegmentPlan{Prefab=10,CopySourceStart=2,CopySourceEnd=3,Curve=Line(30,0,30,30),UpgradeFlags=new CompositionFlags{Value=7}});
  op.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=2,CopySourceEnd=4,Curve=Line(30,0,60,0)});
  var tool=new McpRoadToolSystem(op);var em=tool.EntityManager;var edges=new List<Entity>{103,101,102};
  for(int i=0;i<3;i++){var s=op.Segments[i];em.Put<Curve>(101+i,new Curve{m_Bezier=s.Curve});em.Put<PrefabRef>(101+i,new PrefabRef{m_Prefab=s.Prefab});em.Put<Edge>(101+i,new Edge{m_Start=s.CopySourceStart.Id+10,m_End=s.CopySourceEnd.Id+10});em.Put<Upgraded>(101+i,new Upgraded{m_Flags=s.UpgradeFlags});}
  em.Put(11,new List<ConnectedEdge>{new ConnectedEdge{m_Edge=101}});em.Put(12,new List<ConnectedEdge>{new ConnectedEdge{m_Edge=101},new ConnectedEdge{m_Edge=102},new ConnectedEdge{m_Edge=103}});em.Put(13,new List<ConnectedEdge>{new ConnectedEdge{m_Edge=102}});em.Put(14,new List<ConnectedEdge>{new ConnectedEdge{m_Edge=103}});
  Check(tool.Verify(edges),"branch rejected");
  em.Put<PrefabRef>(102,new PrefabRef{m_Prefab=9});Check(!tool.Verify(edges),"mixed prefab lost");em.Put<PrefabRef>(102,new PrefabRef{m_Prefab=10});
  em.Put<Upgraded>(102,new Upgraded());Check(!tool.Verify(edges),"upgrades lost");em.Put<Upgraded>(102,new Upgraded{m_Flags=op.Segments[1].UpgradeFlags});
  var changed=op.Segments[0].Curve;changed.b.z+=1;em.Put<Curve>(101,new Curve{m_Bezier=changed});Check(!tool.Verify(edges),"curve changed");em.Put<Curve>(101,new Curve{m_Bezier=op.Segments[0].Curve});
  em.Put<Edge>(102,new Edge{m_Start=13,m_End=12});Check(!tool.Verify(edges),"one-way reversed");
  em.Put<Edge>(102,new Edge{m_Start=15,m_End=13});Check(!tool.Verify(edges),"shared node split");
  em.Put<Edge>(102,new Edge{m_Start=12,m_End=14});Check(!tool.Verify(edges),"distinct nodes merged");em.Put<Edge>(102,new Edge{m_Start=12,m_End=13});
  em.Put<Game.Tools.Temp>(12,new Game.Tools.Temp{m_Original=99});Check(!tool.Verify(edges),"attached existing junction");em.Put<Game.Tools.Temp>(12,new Game.Tools.Temp());
  em.GetBuffer<ConnectedEdge>(12,true).Add(new ConnectedEdge{m_Edge=200});Check(!tool.Verify(edges),"unrequested connection");em.GetBuffer<ConnectedEdge>(12,true).RemoveAt(3);
  Check(!tool.Verify(new List<Entity>{101,102}),"missing edge accepted");Check(tool.Verify(edges),"restored copy failed");
  var forward=new Dictionary<int,int>();var reverse=new Dictionary<int,int>();
  Check(RoadCopyGeometry.BindNode(forward,reverse,1,11),"loop first");Check(RoadCopyGeometry.BindNode(forward,reverse,2,12),"loop second");Check(RoadCopyGeometry.BindNode(forward,reverse,1,11),"loop close");Check(!RoadCopyGeometry.BindNode(forward,reverse,3,11),"loop merged");
  var joined=new RoadOperation{CopySourceNodeCount=4};
  var main=Line(0,0,100,0);
  joined.CopyConnectionTargets.Add(new RoadCopyTarget{Edge=900,Prefab=9,StartNode=1001,EndNode=1002,Curve=main,OriginalCurve=main,Start=main.a,End=main.d});
  joined.CopyBindings.Add(1,new RoadCopyBinding{Edge=900});joined.CopyBindings.Add(2,new RoadCopyBinding{Edge=900});
  joined.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=1,CopySourceEnd=3,Curve=Line(20,0,20,-30),Start=new float3(20,10,0),End=new float3(20,10,-30)});
  joined.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=2,CopySourceEnd=4,Curve=Line(80,0,80,-30),Start=new float3(80,10,0),End=new float3(80,10,-30)});
  var attached=new McpRoadToolSystem(joined);var am=attached.EntityManager;
  void Road(int id,int start,int end,Bezier curve,int prefab=9){am.Put<Edge>(id,new Edge{m_Start=start,m_End=end});am.Put<Curve>(id,new Curve{m_Bezier=curve});am.Put<PrefabRef>(id,new PrefabRef{m_Prefab=prefab});}
  void Node(int id,float x,float z,params int[] links){am.Put<Game.Net.Node>(id,new Game.Net.Node{m_Position=new float3(x,10,z)});am.Put(id,links.Select(e=>new ConnectedEdge{m_Edge=e}).ToList());}
  Road(900,1001,1002,main);Road(901,1001,11,Line(0,0,20,0));Road(902,11,12,Line(20,0,80,0));Road(903,12,1002,Line(80,0,100,0));
  Road(101,11,13,joined.Segments[0].Curve);Road(102,12,14,joined.Segments[1].Curve);
  Node(1001,0,0,901);Node(1002,100,0,903);Node(11,20,0,901,902,101);Node(12,80,0,902,903,102);Node(13,20,-30,101);Node(14,80,-30,102);
  attached.Remnants(901,902,903);var newRoads=new List<Entity>{101,102};
  Check(attached.TargetsValid(),"valid target changed");Check(attached.Verify(newRoads),"same-prefab corridor split rejected");
  am.Put<Game.Tools.Temp>(101,new Game.Tools.Temp());am.Put<Game.Tools.Temp>(102,new Game.Tools.Temp());am.Put<Game.Tools.Temp>(901,new Game.Tools.Temp{m_Original=900});
  Check(attached.Verify(newRoads),"preview split rejected");
  am.Put<Game.Tools.Temp>(11,new Game.Tools.Temp{m_Original=900});Check(attached.Canonical(11)==11,"new split junction aliased to original edge");Check(attached.Verify(newRoads),"native edge-backed split junction rejected");
  Road(101,11,13,Line(20,-10,20,-11));Check(!attached.Verify(newRoads),"truncated new street accepted");Road(101,11,13,joined.Segments[0].Curve);
  attached.Remnants(901,903);Check(!attached.Verify(newRoads),"truncated existing corridor accepted");attached.Remnants(901,902,903);
  Road(902,11,12,Line(20,0,80,0),10);Check(!attached.Verify(newRoads),"existing corridor prefab changed");Road(902,11,12,Line(20,0,80,0));
  am.Put<Upgraded>(902,new Upgraded{m_Flags=new CompositionFlags{Value=99}});Check(!attached.Verify(newRoads),"existing upgrades lost");am.Put<Upgraded>(902,new Upgraded());
  var bent=Line(20,0,80,0);bent.b.z=10;Road(902,11,12,bent);Check(!attached.Verify(newRoads),"corridor rerouted");Road(902,11,12,Line(20,0,80,0));
  Node(15,20,0,902);Road(902,15,12,Line(20,0,80,0));Check(!attached.Verify(newRoads),"disconnected split looks connected");Road(902,11,12,Line(20,0,80,0));
  am.GetBuffer<ConnectedEdge>(11,true).Add(new ConnectedEdge{m_Edge=700});Check(!attached.Verify(newRoads),"unapproved connection accepted");am.GetBuffer<ConnectedEdge>(11,true).RemoveAt(3);
  Road(904,11,12,Line(20,0,80,0));attached.Remnants(901,902,903,904);Check(!attached.Verify(newRoads),"overlapping remnant accepted");attached.Remnants(901,902,903);
  am.Put<Curve>(900,new Curve{m_Bezier=bent});Check(!attached.TargetsValid(),"target mutation ignored");am.Put<Curve>(900,new Curve{m_Bezier=main});
  Check(attached.Verify(newRoads),"restored connected copy failed");
  Check(!RoadCopyCurveRules.OnCurve(main,Line(100,0,0,0),.5f),"direction reversed");
  var nan=main;nan.b.x=float.NaN;Check(!RoadCopyCurveRules.OnCurve(nan,main,.5f),"nonfinite reference accepted");
  Check(!RoadCopyCurveRules.Covers(new List<float2>{new float2(0,.4f),new float2(.5f,1)}),"coverage hole ignored");
  // Recorded live failure: projection 16.30m from the target's end; the native
  // split moved that old node 88m. A wider explicit tolerance must reuse it.
  Check(RoadCopyCurveRules.ConnectionEndpoint(183.7f,16.3f,184.1f,20.05f,16,32)==2,"short native approach allowed");
  Check(RoadCopyCurveRules.ConnectionEndpoint(183.7f,16.3f,184.1f,20.05f,24,32)==1,"near existing end not reused");
  Check(RoadCopyCurveRules.ConnectionEndpoint(119.1f,80.9f,119.7f,81.7f,24,32)==0,"safe interior split rejected");
  Check(RoadCopyCurveRules.ConnectionEndpoint(16,184,20,184.5f,24,32)==-1,"near existing start not reused");
  Check(RoadCopyCurveRules.ConnectionEndpoint(12,14,15,17,24,32)==-1,"short road chose wrong existing endpoint");
  Check(RoadCopyCurveRules.ConnectionEndpoint(float.NaN,14,15,17,24,32)==2,"nonfinite connection accepted");
  // Protected degree-two seam nodes keep the 120m placement even within
  // the old 32m guard; real intersections retain their conservative policy.
  Check(RoadCopyCurveRules.ConnectionEndpoint(182.26f,17.74f,182.3f,17.8f,1,32,true,true)==0,"120m seam still blocked");
  Check(RoadCopyCurveRules.ConnectionEndpoint(182.26f,17.74f,182.3f,17.8f,24,32,true,true)==0,"protected seam unnecessarily snapped");
  Check(RoadCopyCurveRules.ConnectionEndpoint(182.26f,17.74f,182.3f,17.8f,1,32,true,false)==2,"real junction guard bypassed");
  Check(RoadCopyCurveRules.ConnectionEndpoint(199.9f,.1f,199.9f,.1f,1,32,true,true)==1,"exact endpoint not reused");
  var world=new FakeWorld();world.Items[typeof(McpRoadToolSystem)]=attached;
  var protect=new McpRoadCopyNodeProtectionSystem();protect.Init(am,world);world.Items[typeof(McpRoadCopyNodeProtectionSystem)]=protect;
  var cleanup=new McpRoadCopyNodeProtectionCleanupSystem();cleanup.Init(am,world);
  Node(2001,0,0);am.Put(2001,new Game.Tools.Temp{m_Original=1001});
  Node(2002,100,0);am.Put(2002,new Game.Tools.Temp{m_Original=1002});am.Put(2002,new Fixed{m_Index=42});
  Node(2003,20,0);am.Put(2003,new Game.Tools.Temp{m_Original=900});
  Node(2004,40,0);am.Put(2004,new Game.Tools.Temp{m_Original=777});
  protect.Run();Check(am.HasComponent<Fixed>(2001),"corridor endpoint unprotected before reduction");
  Check(!am.HasComponent<Fixed>(1001),"permanent endpoint modified");Check(!am.HasComponent<Fixed>(2003),"inserted node confused with edge");Check(!am.HasComponent<Fixed>(2004),"unrelated preview modified");
  cleanup.Run();Check(!am.HasComponent<Fixed>(2001),"temporary Fixed could reach apply");Check(am.GetComponentData<Fixed>(2002).m_Index==42,"existing Fixed lost");
  protect.Run();protect.Release();Check(!am.HasComponent<Fixed>(2001),"fallback cleanup failed");
  joined.Terminal=true;protect.Run();Check(!am.HasComponent<Fixed>(2001),"finished operation protects nodes");joined.Terminal=false;
  joined.ApplyDispatched=true;protect.Run();Check(!am.HasComponent<Fixed>(2001),"applying operation protects nodes");joined.ApplyDispatched=false;
  joined.CurveMode="other";protect.Run();Check(!am.HasComponent<Fixed>(2001),"other operation protects nodes");joined.CurveMode="network_copy";
  // Verify the enlarged selection against the production geometry/topology
  // verifier, including shared nodes, mixed prefabs and reversed input order.
  var huge=new RoadOperation{CopySourceNodeCount=2049};
  float3 GridPoint(int i){int row=i/64,col=i%64;return new float3((row%2==0?col:63-col)*32,10,row*32);}
  for(int i=0;i<2048;i++){
   var a=GridPoint(i);var b=GridPoint(i+1);
   huge.Segments.Add(new RoadSegmentPlan{Prefab=i%2==0?9:10,CopySourceStart=100000+i,CopySourceEnd=100001+i,Start=a,End=b,Curve=Line(a.x,a.z,b.x,b.z)});
  }
  var hugeTool=new McpRoadToolSystem(huge);var hugeEdges=new List<Entity>();
  for(int i=0;i<2049;i++){
   var links=new List<ConnectedEdge>();if(i>0)links.Add(new ConnectedEdge{m_Edge=10000+i-1});if(i<2048)links.Add(new ConnectedEdge{m_Edge=10000+i});
   hugeTool.EntityManager.Put(500000+i,links);
   hugeTool.EntityManager.Put(500000+i,new Game.Net.Node{m_Position=GridPoint(i)});
  }
  for(int i=0;i<2048;i++){
   var segment=huge.Segments[i];Entity edgeId=10000+i;hugeEdges.Add(edgeId);
   hugeTool.EntityManager.Put(edgeId,new Curve{m_Bezier=segment.Curve});hugeTool.EntityManager.Put(edgeId,new PrefabRef{m_Prefab=segment.Prefab});
   hugeTool.EntityManager.Put(edgeId,new Edge{m_Start=500000+i,m_End=500001+i});
  }
  hugeEdges.Reverse();Check(hugeTool.Verify(hugeEdges),"2048-edge mixed road network rejected");
  huge.CopyNodeCourses=true;Check(hugeTool.Verify(hugeEdges),"2048-edge node-course path verification rejected");
  Check(!hugeTool.Verify(hugeEdges.Take(2047).ToList()),"large incomplete network accepted");
  hugeTool.EntityManager.Put(11024,new PrefabRef{m_Prefab=99});Check(!hugeTool.Verify(hugeEdges),"large road prefab mismatch accepted");
  // Native subdivision is permitted only as an unbranched directed path.
  var divided=new RoadOperation{CopyNodeCourses=true,CopySourceNodeCount=2};
  divided.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=1,CopySourceEnd=2,Start=new float3(0,10,0),End=new float3(222,10,0),Curve=Line(0,0,222,0),CopyStartTrimLimit=4,CopyEndTrimLimit=26,UpgradeFlags=new CompositionFlags{Value=7}});
  var splitTool=new McpRoadToolSystem(divided);var sm=splitTool.EntityManager;
  void SplitNode(int id,float px,params int[] links){sm.Put(id,new Game.Net.Node{m_Position=new float3(px,10,0)});sm.Put(id,links.Select(n=>new ConnectedEdge{m_Edge=n}).ToList());}
  void SplitEdge(int id,int a,int b,Bezier c){sm.Put(id,new Edge{m_Start=a,m_End=b});sm.Put(id,new Curve{m_Bezier=c});sm.Put(id,new PrefabRef{m_Prefab=9});sm.Put(id,new Upgraded{m_Flags=new CompositionFlags{Value=7}});}
  SplitNode(11,0,101);SplitNode(12,112,101,102);SplitNode(13,222,102);
  SplitEdge(101,11,12,Line(4,0,112,0));SplitEdge(102,12,13,Line(112,0,196,0));
  var splitEdges=new List<Entity>{102,101};Check(splitTool.Verify(splitEdges),"native long-road split rejected");
  Check(!splitTool.Verify(new List<Entity>{101}),"missing split piece accepted");
  sm.Put(102,new PrefabRef{m_Prefab=10});Check(!splitTool.Verify(splitEdges),"split piece changed prefab");sm.Put(102,new PrefabRef{m_Prefab=9});
  sm.Put(102,new Upgraded());Check(!splitTool.Verify(splitEdges),"split piece changed upgrades");sm.Put(102,new Upgraded{m_Flags=new CompositionFlags{Value=7}});
  SplitEdge(102,13,12,Line(112,0,196,0));Check(!splitTool.Verify(splitEdges),"reversed split edge accepted");SplitEdge(102,12,13,Line(112,0,196,0));
  SplitEdge(101,11,12,Line(4,0,100,0));Check(!splitTool.Verify(splitEdges),"interior physical gap accepted");SplitEdge(101,11,12,Line(4,0,112,0));
  var wrongBend=Line(112,0,196,0);wrongBend.b.z=5;SplitEdge(102,12,13,wrongBend);Check(!splitTool.Verify(splitEdges),"split centreline bend accepted");SplitEdge(102,12,13,Line(112,0,196,0));
  sm.GetBuffer<ConnectedEdge>(12,true).Add(new ConnectedEdge{m_Edge=999});Check(!splitTool.Verify(splitEdges),"foreign road attached to subdivision accepted");sm.GetBuffer<ConnectedEdge>(12,true).RemoveAt(2);
  sm.Put(50,new Game.Net.Node{m_Position=new float3(112,10,0)});sm.Put(12,new Game.Tools.Temp{m_Original=50});Check(!splitTool.Verify(splitEdges),"subdivision attached to existing node accepted");sm.RemoveComponent<Game.Tools.Temp>(12);
  SplitEdge(103,12,14,Line(112,0,112,30));SplitNode(14,300,103);sm.GetBuffer<ConnectedEdge>(12,true).Add(new ConnectedEdge{m_Edge=103});Check(!splitTool.Verify(new List<Entity>{101,102,103}),"extra branching subdivision accepted");sm.GetBuffer<ConnectedEdge>(12,true).RemoveAt(2);
  Check(splitTool.Verify(splitEdges),"restored native split rejected");

  // Native apply can delete a temporary replacement but retain the original
  // corridor entity. That must still prove complete geometry and connectivity.
  var inplace=new RoadOperation{CopyNodeCourses=true,CopySourceNodeCount=4};
  inplace.CopyConnectionTargets.Add(new RoadCopyTarget{Edge=900,Prefab=9,StartNode=21,EndNode=22,Curve=Line(0,0,100,0),OriginalCurve=Line(0,0,100,0),Start=new float3(0,10,0),End=new float3(100,10,0)});
  inplace.CopyBindings.Add(1,new RoadCopyBinding{Edge=900});inplace.CopyBindings.Add(2,new RoadCopyBinding{Edge=900});
  inplace.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=1,CopySourceEnd=3,Start=new float3(0,10,0),End=new float3(0,10,-30),Curve=Line(0,0,0,-30)});
  inplace.Segments.Add(new RoadSegmentPlan{Prefab=9,CopySourceStart=2,CopySourceEnd=4,Start=new float3(100,10,0),End=new float3(100,10,-30),Curve=Line(100,0,100,-30)});
  var inTool=new McpRoadToolSystem(inplace);var im=inTool.EntityManager;
  void InNode(int id,float px,float pz,params int[] links){im.Put(id,new Game.Net.Node{m_Position=new float3(px,10,pz)});im.Put(id,links.Select(n=>new ConnectedEdge{m_Edge=n}).ToList());}
  void InRoad(int id,int a,int b,Bezier c){im.Put(id,new Edge{m_Start=a,m_End=b});im.Put(id,new Curve{m_Bezier=c});im.Put(id,new PrefabRef{m_Prefab=9});}
  InNode(21,0,0,900,101);InNode(22,100,0,900,102);InNode(23,0,-30,101);InNode(24,100,-30,102);
  InRoad(101,21,23,Line(0,0,0,-30));InRoad(102,22,24,Line(100,0,100,-30));InRoad(900,21,22,Line(0,0,100,0));
  im.Put(950,new Deleted());inTool.Remnants(950);var ins=new List<Entity>{101,102};
  Check(inTool.Verify(ins),"deleted temp replacement hides surviving corridor");
  im.Put(900,new Deleted());Check(!inTool.Verify(ins),"missing corridor accepted after stale temp cleanup");im.RemoveComponent<Deleted>(900);
  InNode(25,40,0,900,951);InRoad(900,21,25,Line(0,0,40,0));Check(!inTool.Verify(ins),"retained partial corridor mistaken for complete road");
  InRoad(951,25,22,Line(40,0,100,0));inTool.Remnants(950,951);InNode(22,100,0,951,102);Check(inTool.Verify(ins),"retained original plus replacement half rejected");
  im.Put(951,new Upgraded{m_Flags=new CompositionFlags{Value=99}});Check(!inTool.Verify(ins),"replacement corridor flags changed");im.Put(951,new Upgraded());
  Check(inTool.Verify(ins),"restored in-place corridor rejected");
  // Replay anonymized node/edge/curve data captured from the real district.
  // All 460 sources must map onto the 461 native edges without an anchor.
  using(var doc=JsonDocument.Parse(System.IO.File.ReadAllText(args[0]))){
   var root=doc.RootElement;
   float3 Vec(JsonElement item)=>new float3(item[0].GetSingle(),item[1].GetSingle(),item[2].GetSingle());
   Bezier Bez(JsonElement item)=>new Bezier{a=Vec(item[0]),b=Vec(item[1]),c=Vec(item[2]),d=Vec(item[3])};
   var replay=new RoadOperation{CopyNodeCourses=true,CopySourceNodeCount=root.GetProperty("sourceNodeCount").GetInt32()};
   foreach(var item in root.GetProperty("segments").EnumerateArray())replay.Segments.Add(new RoadSegmentPlan{CopySourceStart=item.GetProperty("a").GetInt32(),CopySourceEnd=item.GetProperty("b").GetInt32(),Start=Vec(item.GetProperty("start")),End=Vec(item.GetProperty("end")),Curve=Bez(item.GetProperty("curve")),Prefab=item.GetProperty("prefab").GetInt32(),UpgradeFlags=new CompositionFlags{Value=item.GetProperty("flags").GetInt32()},CopyStartTrimLimit=item.GetProperty("trim")[0].GetSingle(),CopyEndTrimLimit=item.GetProperty("trim")[1].GetSingle()});
   var replayTool=new McpRoadToolSystem(replay);var rm=replayTool.EntityManager;var replayEdges=new List<Entity>();
   var links=new Dictionary<int,List<ConnectedEdge>>();
   foreach(var item in root.GetProperty("nodes").EnumerateArray()){
    int id=item.GetProperty("id").GetInt32();rm.Put(id,new Game.Net.Node{m_Position=Vec(item.GetProperty("position"))});links[id]=new List<ConnectedEdge>();
   }
   foreach(var item in root.GetProperty("edges").EnumerateArray()){
    int id=item.GetProperty("id").GetInt32(),a=item.GetProperty("a").GetInt32(),b=item.GetProperty("b").GetInt32();replayEdges.Add(id);
    rm.Put(id,new Edge{m_Start=a,m_End=b});rm.Put(id,new Curve{m_Bezier=Bez(item.GetProperty("curve"))});rm.Put(id,new PrefabRef{m_Prefab=item.GetProperty("prefab").GetInt32()});rm.Put(id,new Upgraded{m_Flags=new CompositionFlags{Value=item.GetProperty("flags").GetInt32()}});
    links[a].Add(new ConnectedEdge{m_Edge=id});links[b].Add(new ConnectedEdge{m_Edge=id});
   }
   foreach(var pair in links)rm.Put(pair.Key,pair.Value);
   replayEdges.Reverse();Check(replayTool.Verify(replayEdges),"captured 460-road native replay: "+replay.CopyValidationFailure);
   Check(!replayTool.Verify(replayEdges.Take(replayEdges.Count-1).ToList()),"captured district missing road accepted");
   var firstEdge=replayEdges[0];var originalPrefab=rm.GetComponentData<PrefabRef>(firstEdge);rm.Put(firstEdge,new PrefabRef{m_Prefab=99});Check(!replayTool.Verify(replayEdges),"captured district changed road accepted");rm.Put(firstEdge,originalPrefab);
   Check(replayTool.Verify(replayEdges),"restored captured district rejected");
   float3 Mirror(float3 p){RoadCopyGeometry.Reflect(p.x,p.z,-3000,0,-2980,-6300,out var px,out var pz);return new float3(px,p.y,pz);}
   Bezier MirrorCurve(Bezier b)=>new Bezier{a=Mirror(b.a),b=Mirror(b.b),c=Mirror(b.c),d=Mirror(b.d)};
   foreach(var s in replay.Segments){s.Start=Mirror(s.Start);s.End=Mirror(s.End);s.Curve=MirrorCurve(s.Curve);}
   Check(!replayTool.Verify(replayEdges),"unreflected native result accepted for mirror request");
   foreach(var id in links.Keys){var n=rm.GetComponentData<Node>(id);n.m_Position=Mirror(n.m_Position);rm.Put(id,n);}
   foreach(var id in replayEdges){var c=rm.GetComponentData<Curve>(id);c.m_Bezier=MirrorCurve(c.m_Bezier);rm.Put(id,c);}
   Check(replayTool.Verify(replayEdges),"mirrored 460-road native replay: "+replay.CopyValidationFailure);
  }
  Console.WriteLine(count+" road copy checks passed");
 }
}`);
    const sdk = process.env.CITYWEAVER_TEST_DOTNET ?? 'dotnet';
    const fixture=fileURLToPath(new URL('./fixtures/road-copy-460-native.json',import.meta.url));
    assert.match(execFileSync(sdk, ['run', '--project', path.join(dir, 'Test.csproj'), '--', fixture], {encoding:'utf8', timeout:120000}), /road copy checks passed/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
