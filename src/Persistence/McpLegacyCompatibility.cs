using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Game.Common;
using Game.Prefabs;
using Unity.Collections;
using Unity.Entities;

namespace CityWeaver
{
    // Reads legacy data only when its owning assembly is already present. New
    // data belongs to unique MCP types; no duplicate serialized types are added.
    internal static class McpLegacyCompatibility
    {
        internal static McpVehicleDoorProperties ReadDoors(PrefabBase prefab)
        {
            var current=prefab.GetComponent<McpVehicleDoorProperties>();if(current!=null)return current;
            var type=OptionalHelicopterRuntime.FindType("CityWeaver.VehicleDoorProperties");
            if(type==null)return null;
            var components=new List<ComponentBase>();prefab.GetComponents(components);
            var legacy=components.Find(c=>c!=null&&c.GetType()==type);if(legacy==null)return null;
            var doors=new List<McpVehicleDoorProperties.Door>();
            if(OptionalHelicopterRuntime.Read(legacy,"m_Doors") is IEnumerable items)foreach(var item in items)
            {
                if(item==null)throw new ArgumentException("Null legacy door configuration.");
                doors.Add(new McpVehicleDoorProperties.Door{
                    bone=(string)OptionalHelicopterRuntime.Read(item,"bone"),
                    right=(bool)OptionalHelicopterRuntime.Read(item,"right"),
                    angle=(float)OptionalHelicopterRuntime.Read(item,"angle"),
                    duration=(float)OptionalHelicopterRuntime.Read(item,"duration")});
            }
            return new McpVehicleDoorProperties{m_Doors=doors.ToArray()};
        }
        internal static void ImportVehicleModels(McpVehicleModelPersistenceSystem target,World world)
        {
            if(target.Data.LegacyImported||target.LegacyMigrationFailed)return;
            var legacy=OptionalHelicopterRuntime.System(world,"VehicleModelPersistenceSystem");
            if(legacy==null)return;
            try
            {
                var data=OptionalHelicopterRuntime.Read(legacy,"Data");if(data==null)return;
                var json=(string)OptionalHelicopterRuntime.Invoke(data,"Encode");
                target.Data.MergeDefaults(McpVehicleModelSaveData.Decode(json));
                target.Data.LegacyImported=true;
            }
            catch(Exception e){target.LegacyMigrationFailed=true;Mod.log.Error("Unable to import legacy vehicle overrides: "+e.Message);}
        }
        internal static void ImportRoadSpeeds(World world)
        {
            var type=OptionalHelicopterRuntime.FindType("CityWeaver.SavedRoadSpeed");
            if(type==null||!typeof(IBufferElementData).IsAssignableFrom(type))return;
            try{typeof(McpLegacyCompatibility).GetMethod(nameof(ImportRoadSpeedBuffers),BindingFlags.NonPublic|BindingFlags.Static).MakeGenericMethod(type).Invoke(null,new object[]{world});}
            catch(TargetInvocationException e){Mod.log.Error("Unable to import legacy road speeds: "+(e.InnerException??e).Message);}
        }
        private static void ImportRoadSpeedBuffers<T>(World world)where T:unmanaged,IBufferElementData
        {
            var em=world.EntityManager;
            using(var query=em.CreateEntityQuery(ComponentType.ReadOnly<T>(),ComponentType.Exclude<Deleted>()))
            using(var entities=query.ToEntityArray(Allocator.Temp))foreach(var entity in entities)
            {
                // Own data is authoritative, including overrides made after migration.
                // Consume the old buffer so clearing a new policy cannot resurrect it.
                if(em.HasBuffer<McpSavedRoadSpeed>(entity)){em.RemoveComponent<T>(entity);continue;}
                var records=new List<McpSavedRoadSpeed>();
                foreach(var item in em.GetBuffer<T>(entity,true))
                {
                    object boxed=item;
                    var record=new McpSavedRoadSpeed{
                        RoadPrefab=(Entity)OptionalHelicopterRuntime.Read(boxed,"RoadPrefab"),LanePrefab=(Entity)OptionalHelicopterRuntime.Read(boxed,"LanePrefab"),
                        Start=(int)OptionalHelicopterRuntime.Read(boxed,"Start"),Middle=(int)OptionalHelicopterRuntime.Read(boxed,"Middle"),End=(int)OptionalHelicopterRuntime.Read(boxed,"End"),
                        StartPosition=(int)OptionalHelicopterRuntime.Read(boxed,"StartPosition"),EndPosition=(int)OptionalHelicopterRuntime.Read(boxed,"EndPosition"),
                        Carriageway=(int)OptionalHelicopterRuntime.Read(boxed,"Carriageway"),Speed=(float)OptionalHelicopterRuntime.Read(boxed,"Speed"),DefaultSpeed=(float)OptionalHelicopterRuntime.Read(boxed,"DefaultSpeed")};
                    if(float.IsNaN(record.Speed)||float.IsInfinity(record.Speed)||float.IsNaN(record.DefaultSpeed)||float.IsInfinity(record.DefaultSpeed))throw new ArgumentException("Invalid legacy speed.");
                    records.Add(record);
                }
                if(records.Count==0)continue;
                var output=em.AddBuffer<McpSavedRoadSpeed>(entity);foreach(var record in records)output.Add(record);
                em.RemoveComponent<T>(entity);
            }
        }
    }
}
