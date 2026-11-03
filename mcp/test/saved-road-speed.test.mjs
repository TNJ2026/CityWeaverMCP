import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('saved edge speed survives serialization, lane regeneration and exact undo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-saved-speed-'));
  try {
    const source = fileURLToPath(new URL('../../src/Persistence/McpSavedRoadSpeed.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `
using System; using System.Collections; using System.Collections.Generic; using CityWeaver; using Unity.Entities; using Game.Net; using Game.Prefabs;
namespace Unity.Entities {
 public interface IBufferElementData {} public class InternalBufferCapacityAttribute:Attribute {public InternalBufferCapacityAttribute(int x){}}
 public struct Entity {public int Index;public static bool operator ==(Entity a,Entity b)=>a.Index==b.Index;public static bool operator !=(Entity a,Entity b)=>!(a==b);public override bool Equals(object x)=>x is Entity e&&this==e;public override int GetHashCode()=>Index;}
 public class DynamicBuffer<T>:List<T>{public int Length=>Count;}
 public class EntityManager {
  public Dictionary<(int,Type),object> Data=new();
  public T GetComponentData<T>(Entity e)=>(T)Data[(e.Index,typeof(T))];
  public void Set<T>(Entity e,T v)=>Data[(e.Index,typeof(T))]=v;
  public bool HasBuffer<T>(Entity e)=>Data.ContainsKey((e.Index,typeof(DynamicBuffer<T>)));
  public bool HasComponent<T>(Entity e)=>Data.ContainsKey((e.Index,typeof(T)))||HasBuffer<T>(e);
  public DynamicBuffer<T> GetBuffer<T>(Entity e,bool readOnly=false)=>(DynamicBuffer<T>)Data[(e.Index,typeof(DynamicBuffer<T>))];
  public void AddBuffer<T>(Entity e)=>Data[(e.Index,typeof(DynamicBuffer<T>))]=new DynamicBuffer<T>();
  public void RemoveComponent<T>(Entity e)=>Data.Remove((e.Index,typeof(DynamicBuffer<T>)));
 }
}
namespace Colossal.Serialization.Entities {
 public interface ISerializable {void Serialize<W>(W w) where W:IWriter;void Deserialize<R>(R r) where R:IReader;}
 public interface IWriter {void Write(Entity x);void Write(int x);void Write(float x);}
 public interface IReader {void Read(out Entity x);void Read(out int x);void Read(out float x);}
}
namespace Game.Net {
 public struct Node {public int Owner,Index;public float Position;public int GetLaneIndex()=>Index;public float GetCurvePos()=>Position;}
 public struct Lane {public Node m_StartNode,m_MiddleNode,m_EndNode;}
 public struct CarLane {public float m_SpeedLimit,m_DefaultSpeedLimit;public ushort m_CarriagewayGroup;public int Flags;}
}
namespace Game.Prefabs {public struct PrefabRef {public Entity m_Prefab;} public struct LoadedIndex {}}
namespace Game.Serialization {
 public struct PrefabReferences {
  public Dictionary<int,int> Active;
  public bool IsLoading;
  public Entity Check(EntityManager em,Entity entity)=>IsLoading&&em.HasComponent<LoadedIndex>(entity)?entity:new Entity{Index=Active[entity.Index]};
 }
}
class Stream:Colossal.Serialization.Entities.IWriter,Colossal.Serialization.Entities.IReader {
 readonly Queue<object> q=new();public void Write(Entity v)=>q.Enqueue(new Entity{Index=v.Index+1000});public void Write(int v)=>q.Enqueue(v);public void Write(float v)=>q.Enqueue(v);
 public void Read(out Entity v)=>v=(Entity)q.Dequeue();public void Read(out int v)=>v=(int)q.Dequeue();public void Read(out float v)=>v=(float)q.Dequeue();
}
class Program {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void Main(){
  var em=new EntityManager();var edge=new Entity{Index=1};var lane=new Entity{Index=2};
  em.Set(edge,new PrefabRef{m_Prefab=new Entity{Index=10}});em.Set(lane,new PrefabRef{m_Prefab=new Entity{Index=11}});
  var nodes=new Lane{m_StartNode=new Node{Owner=1,Index=3},m_MiddleNode=new Node{Owner=1,Index=4},m_EndNode=new Node{Owner=1,Index=5,Position=1}};
  em.Set(lane,nodes);em.Set(lane,new CarLane{m_CarriagewayGroup=7});
  var key=McpSavedRoadSpeed.Key(em,edge,lane);Check(!McpSavedRoadSpeed.Read(em,edge,key).HasValue,"preview must not create policy");
  var saved=key;saved.Speed=90f/1.8f;saved.DefaultSpeed=90f/1.8f;
  McpSavedRoadSpeed.Write(em,edge,key,saved);Check(McpSavedRoadSpeed.Read(em,edge,key).Value.Speed==50,"commit");
  var second=saved;second.Speed=100f/1.8f;McpSavedRoadSpeed.Write(em,edge,key,second);Check(em.GetBuffer<McpSavedRoadSpeed>(edge).Count==1,"idempotent upsert");
  McpSavedRoadSpeed.Write(em,edge,key,saved);Check(McpSavedRoadSpeed.Read(em,edge,key).Value.Speed==50,"restore prior override");
  var io=new Stream();saved.Serialize(io);var loaded=new McpSavedRoadSpeed();loaded.Deserialize(io);
  nodes.m_StartNode.Owner=101;nodes.m_MiddleNode.Owner=101;nodes.m_EndNode.Owner=101;em.Set(lane,nodes);
  em.Set(edge,new PrefabRef{m_Prefab=new Entity{Index=3010}});em.Set(lane,new PrefabRef{m_Prefab=new Entity{Index=3011}});
  var regeneratedKey=McpSavedRoadSpeed.Key(em,edge,lane);
  Check(!loaded.SameLane(regeneratedKey),"entity deserialization alone must reproduce the unresolved prefab bug");
  em.AddBuffer<LoadedIndex>(new Entity{Index=3010});em.AddBuffer<LoadedIndex>(new Entity{Index=3011});
  var references=new Game.Serialization.PrefabReferences{IsLoading=true,Active=new Dictionary<int,int>{{1010,3010},{1011,3011},{3010,5010},{3011,5011}}};
  loaded.ResolvePrefabReferences(em,ref references);
  Check(loaded.SameLane(regeneratedKey),"native prefab phase resolves placeholders to active prefabs");
  loaded.ResolvePrefabReferences(em,ref references);Check(loaded.SameLane(regeneratedKey),"a repeated load-phase check must not remap active prefab indices again");
  references.IsLoading=false;references.Active[3010]=3010;references.Active[3011]=3011;
  loaded.ResolvePrefabReferences(em,ref references);Check(loaded.SameLane(regeneratedKey),"save-time reference discovery remains stable");
  var car=new CarLane{m_SpeedLimit=20f/1.8f,m_DefaultSpeedLimit=20f/1.8f,Flags=93,m_CarriagewayGroup=7};
  Check(loaded.Restore(ref car)&&car.m_SpeedLimit==50&&car.Flags==93,"restore 90, preserve lane flags");Check(!loaded.Restore(ref car),"stable restore is a no-op");
  var different=regeneratedKey;different.LanePrefab=new Entity{Index=99};Check(!loaded.SameLane(different),"do not apply to different lane prefab");
  different=regeneratedKey;different.Start++;Check(!loaded.SameLane(different),"do not apply to different lane");
  different=regeneratedKey;different.RoadPrefab=new Entity{Index=99};Check(!loaded.SameLane(different),"do not apply after road upgrade");
  McpSavedRoadSpeed.Write(em,edge,key,null);Check(!em.HasBuffer<McpSavedRoadSpeed>(edge),"undo removes newly introduced override");
  Console.WriteLine("saved road speed verified");
 }
}`);
    assert.match(execFileSync('dotnet', ['run', '--project', path.join(dir, 'Test.csproj')], {encoding:'utf8', timeout:120000}), /saved road speed verified/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

