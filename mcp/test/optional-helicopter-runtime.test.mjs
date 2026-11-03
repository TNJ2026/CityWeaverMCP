import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('optional helicopter adapter works without the mod and binds loaded compatible APIs without starting it',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-optional-runtime-'));
 try{
  const main=path.join(dir,'Main'),plugin=path.join(dir,'Plugin');await mkdir(main);await mkdir(plugin);
  const files=['Transport/OptionalHelicopterRuntime.cs','Core/QueryException.cs'].map(p=>fileURLToPath(new URL('../../src/'+p,import.meta.url)));
  const json=path.join(process.env.CSII_MANAGEDPATH,'Newtonsoft.Json.dll');
  await writeFile(path.join(main,'Main.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>${files.map(p=>`<Compile Include="${p}"/>`).join('')}<Reference Include="Newtonsoft.Json"><HintPath>${json}</HintPath></Reference></ItemGroup></Project>`);
  await writeFile(path.join(main,'Program.cs'),`
using System;using System.Linq;using System.Reflection;using System.Collections.Generic;using CityWeaver;using Game.Prefabs;using Unity.Entities;using Newtonsoft.Json.Linq;
namespace Unity.Entities{public struct Entity{public int Id;}public struct EntityManager{}public class World{public Dictionary<Type,object> Systems=new();public object GetExistingSystemManaged(Type t)=>Systems.TryGetValue(t,out var value)?value:null;}}
namespace Game.Prefabs{public class ComponentBase{}public class PrefabBase{public string name;public List<ComponentBase> Components=new();public void GetComponents(List<ComponentBase> target)=>target.AddRange(Components);}public class ObjectMeshInfo{}public class StaticObjectPrefab:PrefabBase{}public class PrefabSystem{public PrefabBase Current;public bool TryGetPrefab<T>(Entity e,out T p)where T:PrefabBase{p=Current as T;return p!=null;}}}
class Program{
 static void Check(bool x,string message){if(!x)throw new Exception(message);}
 static void Main(string[] args){
  var world=new World();var prefabs=new PrefabSystem{Current=new PrefabBase{name="Bus Line"}};
  Check(!OptionalHelicopterRuntime.Loaded&&OptionalHelicopterRuntime.System(world,"PassengerHelicopterSystem")==null,"Absent mod must remain absent");
  Check(OptionalHelicopterRuntime.GraceFrames.Type==JTokenType.Null,"No invented absent-mod diagnostics");
  Check(OptionalHelicopterRuntime.ValidateRoute(default,prefabs,default,Array.Empty<Entity>(),true)==null,"Native transit must not require helicopters");
  prefabs.Current.name=OptionalHelicopterRuntime.Line;
  Check(OptionalHelicopterRuntime.ValidateRoute(default,prefabs,default,Array.Empty<Entity>(),true)=="HELICOPTER_MOD_REQUIRED","Helicopter writes must fail closed without the mod");
  bool rejected=false;try{OptionalHelicopterRuntime.ValidateHeliport(Array.Empty<ObjectMeshInfo>());}catch(QueryException e){rejected=e.Code=="HELICOPTER_MOD_REQUIRED";}Check(rejected,"Heliport preset must be gated");
  var assembly=Assembly.LoadFrom(args[0]);var runtime=assembly.GetType("CityWeaver.HelicopterRuntime");
  Check(!OptionalHelicopterRuntime.Loaded,"Loading a library must not activate a mod");
  runtime.GetField("Loaded").SetValue(null,true);
  Check(OptionalHelicopterRuntime.Loaded,"Late-loaded mod should be discovered");
  Check(OptionalHelicopterRuntime.ValidateRoute(default,prefabs,default,Array.Empty<Entity>(),true)=="HELICOPTER_COMPATIBILITY_UNAVAILABLE","Missing optional API must fail closed");
  var stops=new[]{new Entity{Id=1},new Entity{Id=2}};
  Check(OptionalHelicopterRuntime.ValidateAirports(stops,new[]{true,true},true)==null,"Generic optional method binding failed");
  Check(OptionalHelicopterRuntime.GraceFrames.Value<uint>()==512,"Generic diagnostic constant binding failed");
  var type=assembly.GetType("CityWeaver.PassengerHelicopterSystem");world.Systems[type]=Activator.CreateInstance(type);
  Check((string)OptionalHelicopterRuntime.SystemValue(world,"PassengerHelicopterSystem","State")=="registered","System diagnostics must bind by loaded type");
  Check(OptionalHelicopterRuntime.OwnsModelConfiguration(OptionalHelicopterRuntime.Vehicle,new JObject{["owned"]=true}),"Owned model restoration must defer to the independent mod");
  Check(!OptionalHelicopterRuntime.OwnsModelConfiguration("Bus01",new JObject{["owned"]=true}),"Generic vehicle restoration must not be suppressed");
  var meshes=Enumerable.Range(0,6).Select(_=>new ObjectMeshInfo()).ToArray();
  Check(OptionalHelicopterRuntime.CreateHeliport("optional-test",meshes,prefabs).name=="optional-test","Optional composition preset binding failed");
  Check((int)runtime.GetField("Starts").GetValue(null)==0,"Adapter must never start the other mod");
  Console.WriteLine("Optional adapter absent/present compatibility passed");
 }
}`);
  execFileSync('dotnet',['build',path.join(main,'Main.csproj'),'-c','Release','--nologo'],{stdio:'pipe',timeout:120000});
  await writeFile(path.join(plugin,'Plugin.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><AssemblyName>TransportFever3Helicopters.Runtime</AssemblyName></PropertyGroup><ItemGroup><Reference Include="Main"><HintPath>${path.join(main,'bin/Release/net8.0/Main.dll')}</HintPath></Reference><Reference Include="Newtonsoft.Json"><HintPath>${json}</HintPath></Reference></ItemGroup></Project>`);
  await writeFile(path.join(plugin,'Runtime.cs'),`
using System.Collections.Generic;using Game.Prefabs;using Newtonsoft.Json.Linq;
namespace CityWeaver{
 public static class HelicopterRuntime{public static bool Loaded;public static int Starts;public static void Load(){Starts++;}public static bool OwnsModelConfiguration(JObject value)=>(bool?)value["owned"]==true;}
 public static class HelicopterModelPolicy{public static bool ImportedModelsEnabled=true;}
 public class PassengerHelicopterSystem{public string State="registered";}
 public static class HelicopterLineSafetyRules<T>{public const uint GraceFrames=512;}
 public static class PassengerHelicopterRules{public static string ValidateAirports<T>(IReadOnlyList<T> stops,IReadOnlyList<bool> roads,bool depot)=>stops.Count>=2&&depot?null:"INVALID_ARGUMENT";}
 public static class ImportedHeliportLayout{public static void Validate(ObjectMeshInfo[] parts){if(parts.Length!=6)throw new System.ArgumentException();}public static StaticObjectPrefab Create(string name,ObjectMeshInfo[] parts,PrefabSystem prefabs)=>new StaticObjectPrefab{name=name};}
}`);
  execFileSync('dotnet',['build',path.join(plugin,'Plugin.csproj'),'-c','Release','--nologo'],{stdio:'pipe',timeout:120000});
  assert.match(execFileSync('dotnet',[path.join(main,'bin/Release/net8.0/Main.dll'),path.join(plugin,'bin/Release/net8.0/TransportFever3Helicopters.Runtime.dll')],{encoding:'utf8',timeout:120000}),/Optional adapter absent\/present compatibility passed/);
 }catch(error){if(error.stdout)process.stderr.write(error.stdout.toString());if(error.stderr)process.stderr.write(error.stderr.toString());throw error;}
 finally{await rm(dir,{recursive:true,force:true});}
});
