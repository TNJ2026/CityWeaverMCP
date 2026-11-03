using System;
using System.Collections.Generic;
using Colossal.Serialization.Entities;
using Game;
using Game.SceneFlow;
using Newtonsoft.Json.Linq;

namespace CityWeaver
{
    // Native per-save serialization keeps same-named cities and different save branches separate.
    // Runs before PrefabSystem, even while paused, without depending on the MCP bridge.
    public partial class McpVehicleModelPersistenceSystem : GameSystemBase, IDefaultSerializable, ISerializable
    {
        internal Action<McpVehicleModelPersistenceSystem,Unity.Entities.World> UpdateModels;
        internal McpVehicleModelSaveData Data=new McpVehicleModelSaveData();
        internal readonly Dictionary<string,string> Operations=new Dictionary<string,string>();
        internal readonly Dictionary<string,string> Errors=new Dictionary<string,string>();
        internal DateTime RetryAt,Started;
        internal bool DefaultsLoaded;
        internal bool LegacyMigrationFailed;
        internal void Forget(string target){Data.DisableDefault(target);Operations.Remove(target);Errors.Remove(target);}
        protected override void OnUpdate()
        {
            var gm=GameManager.instance;
            if(UpdateModels==null||gm==null||gm.isGameLoading||gm.gameMode!=GameMode.Game)return;
            UpdateModels(this,World);
        }
        public void Serialize<TWriter>(TWriter writer) where TWriter:IWriter {writer.Write(Data.Encode());}
        public void Deserialize<TReader>(TReader reader) where TReader:IReader
        {
            reader.Read(out string json);Reset();
            try{Data=McpVehicleModelSaveData.Decode(json);}
            catch(Exception e){Mod.log.Error("Unable to read saved vehicle overrides: "+e.Message);}
        }
        public void SetDefaults(Context context){Reset();}
        private void Reset(){Data=new McpVehicleModelSaveData();Operations.Clear();Errors.Clear();RetryAt=default;Started=default;DefaultsLoaded=false;LegacyMigrationFailed=false;}
        internal JObject Status(string target)=>new JObject{
            ["saved_in_city"]=Data.Get(target)!=null,
            ["operation_id"]=Operations.TryGetValue(target,out var id)?id:null,
            ["error"]=Errors.TryGetValue(target,out var error)?error:null
        };
    }

}


