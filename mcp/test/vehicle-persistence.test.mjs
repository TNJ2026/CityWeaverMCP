import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('city vehicle saves round-trip, restore once, retain missing assets and isolate cities',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-vehicle-save-'));
 try{
 const sources=['../../src/Persistence/McpVehicleModelSaveData.cs','../../src/Persistence/McpVehicleModelPersistenceSystem.cs','../../src/Editor/VehicleModelPersistenceSystem.cs','../../src/Editor/VehicleModelDefaults.cs'].map(p=>fileURLToPath(new URL(p,import.meta.url)));
 assert.ok(process.env.CSII_MANAGEDPATH,'Game managed path required for Newtonsoft.Json');
 await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>${sources.map(p=>`<Compile Include="${p}"/>`).join('')}<Reference Include="Newtonsoft.Json"><HintPath>${process.env.CSII_MANAGEDPATH}/Newtonsoft.Json.dll</HintPath></Reference></ItemGroup></Project>`);
 await writeFile(path.join(dir,'Program.cs'),String.raw`
using System;using System.Collections.Generic;using System.Linq;using Newtonsoft.Json.Linq;using CityWeaver;
namespace Unity.Entities {public class World{}}
namespace Colossal.PSI.Environment{public static class EnvPath{public static string kUserDataPath=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"cw-policy-"+Guid.NewGuid().ToString("N"));}}
namespace Colossal.Serialization.Entities {
 public interface IWriter{void Write(string s);} public interface IReader{void Read(out string s);}
 public class Context{} public interface ISerializable{} public interface IDefaultSerializable{}
 public class Buffer:IWriter,IReader{public string Text;public void Write(string s){Text=s;}public void Read(out string s){s=Text;}}
}
namespace Game {public enum GameMode{Game,Editor} public abstract class GameSystemBase{public Unity.Entities.World World=new();protected abstract void OnUpdate();public void Step()=>OnUpdate();}}
namespace Game.SceneFlow{public class GameManager{public static GameManager instance=new();public bool isGameLoading;public Game.GameMode gameMode=Game.GameMode.Game;}}
namespace CityWeaver {
 public class QueryException:Exception{public QueryException(string s):base(s){}}
 public static class Mod{public static Logger log=new();}public class Logger{public void Warn(string s){}public void Error(string s){}}
 public static class OptionalHelicopterRuntime{public static bool OwnsModelConfiguration(string target,JObject configuration)=>false;} public static class McpLegacyCompatibility{public static void ImportVehicleModels(McpVehicleModelPersistenceSystem target,Unity.Entities.World world){}}
 public partial class McpVehicleModelPersistenceSystem{private GameQueryService m_TestQueries;internal GameQueryService Queries{get=>m_TestQueries;set{m_TestQueries=value;UpdateModels=value.UpdateSavedVehicleModels;}}}
 public class Target{public string name;}
 public class Op{public string Session="city",Id,State="applying",Error;public bool Dispatched=true;public Target Target;public JObject Configuration;}
 public sealed partial class GameQueryService{
  private string m_Session="city";internal List<Op> m_VehicleModelOrder=new();internal Dictionary<string,Op> m_VehicleModels=new();
  public int Applies,Previews;public bool Missing,Busy;
  private bool IsReady()=>true;
  private void AssetFilesIdle(Unity.Entities.World w,bool loading){if(Busy)throw new QueryException("tool busy");}
  private JObject ReadVehicleOperation(JObject a,Unity.Entities.World w){m_VehicleModels[(string)a["operation_id"]].State="completed";return new();}
  private JObject PreviewVehicleReplacement(JObject a,Unity.Entities.World w,JObject c){Previews++;if(Missing)throw new Exception("asset missing");var id=Guid.NewGuid().ToString();Add(id,(string)a["prefab"],c);return new(){["operation_id"]=id};}
  private JObject ApplyVehicleReplacement(JObject a,Unity.Entities.World w,bool automatic){Applies++;return new();}
  internal void Add(string id,string target,JObject c){var op=new Op{Id=id,Target=new(){name=target},Configuration=c};m_VehicleModels[id]=op;m_VehicleModelOrder.Add(op);}
 }
}
class Program{
 static void Check(bool x){if(!x)throw new Exception("assertion failed");}
 static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("invalid accepted");}
 static JObject Config()=>JObject.Parse("{\"parts\":[{\"render_prefab\":\"imported-small-mi26\",\"rig_mode\":\"source\",\"position\":[0,0,0]}]}");
 static void Main(){
  var data=new McpVehicleModelSaveData();var config=Config();data.Put("HelicopterPassenger01",config);config["parts"][0]["render_prefab"]="mutated";
  Check((string)data.Get("HelicopterPassenger01")["parts"][0]["render_prefab"]=="imported-small-mi26");
  var loaded=McpVehicleModelSaveData.Decode(data.Encode());Check(loaded.Encode()==data.Encode());loaded.Remove("HelicopterPassenger01");Check(!McpVehicleModelSaveData.Decode(loaded.Encode()).Targets.Any());Check(data.Targets.Count()==1);
  var bad=Config();bad["parts"][0]["render_prefab_id"]="old-session:123:1";Reject(()=>data.Put("heli",bad));Reject(()=>McpVehicleModelSaveData.Decode("{\"version\":99,\"vehicles\":[]}"));
  // Global defaults fill new/legacy cities, preserve custom choices and explicit opt-outs.
  var defaults=new McpVehicleModelSaveData();defaults.Put("HelicopterPassenger01",Config());
  var fresh=new McpVehicleModelSaveData();fresh.MergeDefaults(defaults);Check(fresh.Targets.Count()==1);
  var custom=Config();custom["parts"][0]["render_prefab"]="custom";fresh.Put("HelicopterPassenger01",custom);
  fresh.MergeDefaults(defaults);Check((string)fresh.Get("HelicopterPassenger01")["parts"][0]["render_prefab"]=="custom");
  fresh.DisableDefault("HelicopterPassenger01");fresh=McpVehicleModelSaveData.Decode(fresh.Encode());fresh.MergeDefaults(defaults);Check(!fresh.Targets.Any());
  fresh.Put("HelicopterPassenger01",custom);fresh=McpVehicleModelSaveData.Decode(fresh.Encode());Check(fresh.Targets.Count()==1);
  var other=new McpVehicleModelSaveData();other.MergeDefaults(defaults);Check((string)other.Get("HelicopterPassenger01")["parts"][0]["render_prefab"]=="imported-small-mi26");
  Reject(()=>McpVehicleModelSaveData.Decode("{\"version\":1,\"vehicles\":[],\"disabled_defaults\":[123]}"));
  var service=new GameQueryService();var sys=new McpVehicleModelPersistenceSystem{Queries=service};sys.Data=data;
  service.Busy=true;sys.Step();Check(service.Applies==0&&sys.Data.Targets.Count()==1);
  service.Busy=false;service.Missing=true;sys.RetryAt=default;sys.Step();Check(service.Applies==0&&sys.Errors.Count==1&&sys.Data.Targets.Count()==1);
  service.Missing=false;sys.RetryAt=default;sys.Step();Check(service.Applies==1&&sys.Errors.Count==0);sys.RetryAt=default;sys.Step();Check(service.Applies==1);
  var buffer=new Colossal.Serialization.Entities.Buffer();sys.Serialize(buffer);
  var nextService=new GameQueryService();var next=new McpVehicleModelPersistenceSystem{Queries=nextService};next.Deserialize(buffer);next.Step();Check(nextService.Applies==1);next.Step();Check(nextService.Applies==1);
  // Manual restore removes intent; a saved/reloaded city must not reapply it.
  var id=next.Operations["HelicopterPassenger01"];nextService.m_VehicleModels[id].State="restored";next.Forget("HelicopterPassenger01");next.Step();next.Serialize(buffer);
  var final=new McpVehicleModelPersistenceSystem{Queries=new()};final.Deserialize(buffer);final.Step();Check(final.Queries.Applies==0);
  // A different/new city starts empty, including pending failures and operation handles.
  next.SetDefaults(new());Check(!next.Data.Targets.Any()&&next.Operations.Count==0&&next.Errors.Count==0);
  // New manual replacements are persisted only after native verification.
  var manual=new McpVehicleModelPersistenceSystem{Queries=new()};manual.Queries.Add("manual","Bus01",Config());manual.Step();Check(manual.Data.Targets.Single()=="Bus01");
  Check(!VehicleModelDefaults.Load().Targets.Any());
  var standalone=new McpVehicleModelPersistenceSystem();standalone.Data=data;standalone.Step();var standaloneBuffer=new Colossal.Serialization.Entities.Buffer();standalone.Serialize(standaloneBuffer);var recovered=new McpVehicleModelPersistenceSystem();recovered.Deserialize(standaloneBuffer);recovered.Step();Check(recovered.Data.Encode()==data.Encode());
  Console.WriteLine("Vehicle save lifecycle passed");
 }
}
`);
 const result=execFileSync('dotnet',['run','--project',path.join(dir,'Tests.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000});assert.match(result,/Vehicle save lifecycle passed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
