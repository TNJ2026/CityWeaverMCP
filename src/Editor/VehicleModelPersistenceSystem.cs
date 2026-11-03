using System;
using System.Collections.Generic;
using Colossal.Serialization.Entities;
using Game;
using Game.SceneFlow;
using Newtonsoft.Json.Linq;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        internal void UpdateSavedVehicleModels(McpVehicleModelPersistenceSystem system,Unity.Entities.World world)
        {
            if(!IsReady())return;
            McpLegacyCompatibility.ImportVehicleModels(system,world);
            if(!system.DefaultsLoaded)
            {
                system.DefaultsLoaded=true;
                try{system.Data.MergeDefaults(VehicleModelDefaults.Load());}
                catch(Exception e){Mod.log.Error("Unable to read global vehicle defaults: "+e.Message);}
            }
            // Verification and persistence also run without client polling.
            foreach(var op in m_VehicleModelOrder.ToArray())
            {
                if(op.Session!=m_Session||!op.Dispatched)continue;
                if(op.State=="applying"||op.State=="restoring")ReadVehicleOperation(new JObject{["operation_id"]=op.Id},world);
                if(op.State=="completed"&&(!system.Operations.TryGetValue(op.Target.name,out var savedId)||savedId!=op.Id))
                {
                    system.Data.Put(op.Target.name,op.Configuration);system.Operations[op.Target.name]=op.Id;
                    system.Errors.Remove(op.Target.name);
                }
            }
            if(DateTime.UtcNow<system.RetryAt)return;
            system.RetryAt=DateTime.UtcNow.AddSeconds(2);
            // Tool/import activity is temporary and must not consume the asset-readiness timeout.
            try{AssetFilesIdle(world,true);}catch(QueryException){system.Started=default;return;}
            if(system.Started==default)system.Started=DateTime.UtcNow;
            foreach(var target in system.Data.Targets)
            {
                // The standalone mod owns helicopter initialization. Retain old saved
                // intent, but do not race its native prefab replacement on load.
                if(OptionalHelicopterRuntime.OwnsModelConfiguration(target,system.Data.Get(target)))continue;
                if(system.Operations.TryGetValue(target,out var active))
                {
                    if(m_VehicleModels.TryGetValue(active,out var op)&&op.State=="outcome_unknown")system.Errors[target]=op.Error;
                    continue;
                }
                // Missing assets may register late. Retain the saved intent, but stop retrying
                // unresolved assets after two minutes. Never replace them with a guessed model.
                if(DateTime.UtcNow-system.Started>TimeSpan.FromMinutes(2))continue;
                try
                {
                    AssetFilesIdle(world,true);
                    string request="restore-save-"+Guid.NewGuid().ToString("N");
                    var preview=PreviewVehicleReplacement(new JObject{["request_id"]=request,["prefab"]=target},world,system.Data.Get(target));
                    string id=(string)preview["operation_id"];
                    // Record before dispatch: an uncertain native result must never be replayed.
                    system.Operations[target]=id;
                    var result=ApplyVehicleReplacement(new JObject{["request_id"]=request,["operation_id"]=id,["max_affected_instances"]=1000000},world,true);
                    if((string)result["error"]!=null)system.Errors[target]=(string)result["error"];
                    else system.Errors.Remove(target);
                }
                catch(Exception e)
                {
                    if(!system.Errors.TryGetValue(target,out var previous)||previous!=e.Message)Mod.log.Warn("Saved vehicle override "+target+": "+e.Message);
                    system.Errors[target]=e.Message;
                }
            }
        }
    }
}
