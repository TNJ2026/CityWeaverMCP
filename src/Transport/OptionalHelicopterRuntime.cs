using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using Game.Prefabs;
using Newtonsoft.Json.Linq;
using Unity.Entities;

namespace CityWeaver
{
    // Optional integration only: never loads an assembly or starts the other mod.
    internal static class OptionalHelicopterRuntime
    {
        internal const string Airport="CityWeaver Passenger Heliport", Station="CityWeaver Helicopter Station",
            ImportedStation="CityWeaver Imported Helipad Station", Stop="CityWeaver Helicopter Boarding Stop",
            Vehicle="CityWeaver Passenger Helicopter", Line="CityWeaver Helicopter Line";
        internal const string HeliportPreset="passenger_heliport_v7";
        private const BindingFlags Members=BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.Static;
        private static Assembly s_RuntimeAssembly,s_CompatibilityAssembly;
        internal static Type FindType(string name)
        {
            var loaded=AppDomain.CurrentDomain.GetAssemblies();
            if(s_RuntimeAssembly==null)s_RuntimeAssembly=loaded.FirstOrDefault(a=>
                (a.GetName().Name=="TransportFever3Helicopters.Runtime"||a.GetName().Name=="CityWeaver")&&
                a.GetType("CityWeaver.HelicopterRuntime",false)!=null);
            var type=s_RuntimeAssembly?.GetType(name,false);
            if(type!=null)return type;
            if(s_CompatibilityAssembly==null)s_CompatibilityAssembly=loaded.FirstOrDefault(a=>a.GetName().Name=="CityWeaver");
            return s_CompatibilityAssembly?.GetType(name,false);
        }
        internal static object Read(object owner,string name)
        {
            if(owner==null)return null;
            var type=owner as Type??owner.GetType();var instance=owner is Type?null:owner;
            return type.GetProperty(name,Members)?.GetValue(instance)??type.GetField(name,Members)?.GetValue(instance);
        }
        internal static object Invoke(object owner,string method,params object[] arguments)
        {
            if(owner==null)return null;
            var type=owner as Type??owner.GetType();var instance=owner is Type?null:owner;
            var selected=type.GetMethods(Members).SingleOrDefault(m=>m.Name==method&&!m.IsGenericMethod&&m.GetParameters().Length==arguments.Length);
            if(selected==null)throw new MissingMethodException(type.FullName,method);
            try{return selected.Invoke(instance,arguments);}
            catch(TargetInvocationException e){ExceptionDispatchInfo.Capture(e.InnerException??e).Throw();throw;}
        }
        internal static bool Loaded=>Read(FindType("CityWeaver.HelicopterRuntime"),"Loaded") is bool loaded&&loaded;
        internal static object System(World world,string name)
        {
            var type=FindType(name.StartsWith("CityWeaver.",StringComparison.Ordinal)?name:"CityWeaver."+name);
            if(type==null)return null;
            // A loaded compatibility library does not imply its systems were registered.
            try{return world.GetExistingSystemManaged(type);}catch(ArgumentException){return null;}catch(InvalidOperationException){return null;}
        }
        internal static JToken Value(object owner,string member,object fallback=null)
        {
            var value=Read(owner,member)??fallback;
            return value==null?JValue.CreateNull():JToken.FromObject(value);
        }
        internal static JToken SystemValue(World world,string system,string member,object fallback=null)=>Value(System(world,system),member,fallback);
        internal static JToken GraceFrames
        {
            get{var type=FindType("CityWeaver.HelicopterLineSafetyRules`1");return Value(type?.MakeGenericType(typeof(Entity)),"GraceFrames");}
        }
        internal static bool HasComponent(PrefabBase prefab,string name)
        {
            var type=FindType(name);if(type==null)return false;
            var components=new List<ComponentBase>();prefab.GetComponents(components);
            return components.Any(c=>c!=null&&c.GetType()==type);
        }
        internal static string ValidateRoute(EntityManager entities,PrefabSystem prefabs,Entity line,IReadOnlyList<Entity> stops,bool closed)
        {
            if(!prefabs.TryGetPrefab<PrefabBase>(line,out var prefab)||prefab.name!=Line)return null;
            if(!Loaded)return "HELICOPTER_MOD_REQUIRED";
            var type=FindType("CityWeaver.PassengerHelicopterRoutePolicy");
            if(type==null)return "HELICOPTER_COMPATIBILITY_UNAVAILABLE";
            return (string)Invoke(type,"Validate",entities,prefabs,line,stops,closed);
        }
        internal static string ValidateAirports(IReadOnlyList<Entity> airports,IReadOnlyList<bool> roads,bool depot)
        {
            var type=FindType("CityWeaver.PassengerHelicopterRules");
            var method=type?.GetMethods(Members).SingleOrDefault(m=>m.Name=="ValidateAirports"&&m.IsGenericMethodDefinition);
            if(method==null)return "HELICOPTER_COMPATIBILITY_UNAVAILABLE";
            return (string)method.MakeGenericMethod(typeof(Entity)).Invoke(null,new object[]{airports,roads,depot});
        }
        internal static bool OwnsModelConfiguration(string target,JObject configuration)
        {
            if(!Loaded||(target!=Vehicle&&target!="HelicopterPassenger01"))return false;
            if(Read(FindType("CityWeaver.HelicopterModelPolicy"),"ImportedModelsEnabled") is bool enabled&&!enabled)return true;
            var type=FindType("CityWeaver.HelicopterRuntime");
            return Invoke(type,"OwnsModelConfiguration",configuration) is bool owned&&owned;
        }
        internal static void ValidateHeliport(ObjectMeshInfo[] meshes)
        {
            if(!Loaded)throw new QueryException("HELICOPTER_MOD_REQUIRED","Enable the independent helicopter mod to use its heliport preset.");
            var type=FindType("CityWeaver.ImportedHeliportLayout");
            if(type==null)throw new QueryException("HELICOPTER_COMPATIBILITY_UNAVAILABLE","The loaded helicopter mod does not expose its heliport preset.");
            Invoke(type,"Validate",(object)meshes);
        }
        internal static StaticObjectPrefab CreateHeliport(string name,ObjectMeshInfo[] meshes,PrefabSystem prefabs)
        {
            ValidateHeliport(meshes);
            return (StaticObjectPrefab)Invoke(FindType("CityWeaver.ImportedHeliportLayout"),"Create",name,meshes,prefabs);
        }
    }
}
