$ErrorActionPreference = 'Stop'
$directory = Join-Path $PSScriptRoot '../../artifacts/prefab-source-tests'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
# Compile the complete production reader against an in-memory ECS/catalog fixture.
@'
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Game.Prefabs;
namespace Unity.Entities {
    public struct Entity : IEquatable<Entity> {
        public int Index; public static Entity Null => default;
        public bool Equals(Entity b) => Index == b.Index;
        public override bool Equals(object b) => b is Entity e && Equals(e);
        public override int GetHashCode() => Index;
        public static bool operator ==(Entity a, Entity b) => a.Equals(b);
        public static bool operator !=(Entity a, Entity b) => !a.Equals(b);
    }
    public class Buffer<T> : List<T> { public int Length => Count; }
    public class EntityManager {
        public Dictionary<Entity, Dictionary<Type, object>> Values = new();
        public bool Exists(Entity e) => Values.ContainsKey(e);
        public bool HasComponent<T>(Entity e) => Exists(e) && Values[e].ContainsKey(typeof(T));
        public T GetComponentData<T>(Entity e) => (T)Values[e][typeof(T)];
        public bool HasBuffer<T>(Entity e) => HasComponent<Buffer<T>>(e);
        public Buffer<T> GetBuffer<T>(Entity e, bool readOnly) => GetComponentData<Buffer<T>>(e);
        public void Set<T>(Entity e, T data) => Values[e][typeof(T)] = data;
    }
    public class World {
        public EntityManager EntityManager = new(); public PrefabSystem Prefabs = new();
        public T GetExistingSystemManaged<T>() where T : class => Prefabs as T;
    }
}
namespace Game.Prefabs {
    [Flags] public enum ContentFlags { RequireDlc=1, RequirePdxLogin=2, RequireMod=4 }
    public struct ContentData { public int m_DlcID; public ContentFlags m_Flags; }
    public struct ContentPrerequisiteData { public Entity m_ContentPrerequisite; }
    public struct ModPrerequisiteData { public Entity m_ContentPrerequisite; }
    public struct AssetPackElement { public Entity m_Pack; }
    public class PrefabBase {
        public string name; public bool isBuiltin, isSubscribedMod;
        public Dictionary<Type,object> Components = new();
        public bool TryGet<T>(out T value) where T : class { Components.TryGetValue(typeof(T),out var v); value=v as T; return value!=null; }
    }
    public class ContentPrefab : PrefabBase { public bool Available = true; public bool IsAvailable() => Available; }
    public class DlcRequirement {
        public bool Throw; public string GetDebugString() => Throw ? throw new Exception() : "Fixture expansion DLC";
    }
    public class ModRequirement { public string m_ModId; }
    public class PrefabSystem {
        public Dictionary<Entity,PrefabBase> Values = new();
        public bool TryGetPrefab<T>(Entity e,out T value) where T:class { Values.TryGetValue(e,out var v); value=v as T; return value!=null; }
        public string GetPrefabName(Entity e) => Values[e].name;
    }
}
namespace CityWeaver {
    public sealed partial class GameQueryService {
        string EntityId(Entity e) => e==Entity.Null ? null : "fixture:"+e.Index;
        public JObject Read(World w,Entity e) => PrefabSource(w,e);
    }
}
class Program {
    static void Check(bool ok,string message) { if(!ok)throw new Exception(message); }
    static void Main() {
        var w=new World(); var reader=new CityWeaver.GameQueryService();
        Entity Add(int id,string name) { var e=new Entity{Index=id}; w.EntityManager.Values[e]=new(); w.Prefabs.Values[e]=new PrefabBase{name=name,isBuiltin=true}; return e; }
        var asset=Add(1,"Bridge"); var content=Add(2,"Expansion"); var pack=Add(3,"Asset pack");
        w.Prefabs.Values[content]=new ContentPrefab{name="Expansion",isBuiltin=true};
        JObject Read()=>reader.Read(w,asset);
        Check((string)Read()["category"]=="no_declared_requirement" && (string)Read()["base_game_status"]=="unverified","Unrestricted asset mislabeled base game");
        w.EntityManager.Set(asset,new ContentPrerequisiteData{m_ContentPrerequisite=content});
        Check((string)Read()["category"]=="unknown","Missing content data accepted");
        w.EntityManager.Set(content,new ContentData{m_DlcID=1006,m_Flags=ContentFlags.RequireDlc});
        var dlc=new DlcRequirement(); w.Prefabs.Values[content].Components[typeof(DlcRequirement)]=dlc;
        var source=Read();
        Check((string)source["category"]=="dlc" && (bool)source["is_builtin_asset"],"Built-in DLC misclassified");
        Check((int)source["content_requirements"][0]["dlc_id"]==1006 && (string)source["content_requirements"][0]["dlc_display_name"]=="Fixture expansion DLC","DLC evidence missing");
        Check((bool)Read()["content_available"],"Available DLC rejected");
        ((ContentPrefab)w.Prefabs.Values[content]).Available=false;
        Check(!(bool)Read()["content_available"],"Unavailable DLC accepted");
        ((ContentPrefab)w.Prefabs.Values[content]).Available=true;
        dlc.Throw=true; Check((string)Read()["category"]=="dlc" && Read()["content_requirements"][0]["dlc_display_name"].Type==JTokenType.Null,"Name failure broke classification");
        w.EntityManager.Set(content,new ContentData{m_Flags=ContentFlags.RequirePdxLogin});
        Check((string)Read()["category"]=="account_reward","Login reward misclassified");
        w.EntityManager.Set(asset,new ModPrerequisiteData{m_ContentPrerequisite=content});
        w.EntityManager.Set(content,new ContentData{m_Flags=ContentFlags.RequireDlc|ContentFlags.RequireMod});
        w.Prefabs.Values[content].Components[typeof(ModRequirement)]=new ModRequirement{m_ModId="42"};
        Check((string)Read()["category"]=="mixed_requirements" && ((JArray)Read()["content_requirements"]).Count==1,"Mixed/duplicate requirements mishandled");
        w.EntityManager.Set(asset,new Buffer<AssetPackElement>{new AssetPackElement{m_Pack=pack}});
        Check((string)Read()["asset_packs"][0]["name"]=="Asset pack","Pack name missing");
        w.EntityManager.Values[asset].Clear(); w.Prefabs.Values[asset].isSubscribedMod=true;
        Check((string)Read()["category"]=="mod","Subscribed asset without gate missed");
        w.Prefabs.Values[asset].isSubscribedMod=false;
        w.EntityManager.Set(asset,new ContentPrerequisiteData{m_ContentPrerequisite=new Entity{Index=999}});
        Check((string)Read()["category"]=="unknown","Dangling reference misclassified");
        Console.WriteLine("PASS: builtin/DLC distinction, metadata labels, rewards, mods, mixed gates, packs, missing references");
    }
}
'@ | Set-Content -LiteralPath (Join-Path $directory 'Program.cs')
$production = [System.Security.SecurityElement]::Escape((Join-Path $PSScriptRoot '../../src/Core/PrefabSourceQueries.cs'))
$json = [System.Security.SecurityElement]::Escape((Join-Path $env:CSII_MANAGEDPATH 'Newtonsoft.Json.dll'))
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><Compile Include="$production" Link="PrefabSourceQueries.cs" />
    <Reference Include="Newtonsoft.Json"><HintPath>$json</HintPath></Reference></ItemGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $directory 'PrefabSourceTests.csproj')
dotnet run --project (Join-Path $directory 'PrefabSourceTests.csproj') --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'Prefab source regression failed' }
