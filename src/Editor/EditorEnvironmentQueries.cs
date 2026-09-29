using System;
using System.Collections.Generic;
using System.Linq;
using Game.Prefabs;
using Game.Prefabs.Climate;
using Game.Prefabs.Terrain;
using Game.Prefabs.Water;
using Game.UI.Editor;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Collections;
using Unity.Entities;
using UnityEngine;

namespace CityWeaver
{
    public sealed partial class GameQueryService
    {
        private static string EditorEnvironmentKind(PrefabBase prefab) => prefab is ClimatePrefab ? "climate" : prefab is WaterRenderSettingsPrefab ? "water_render" : prefab is TerrainRenderSettingsPrefab ? "terrain_render" : null;
        private Dictionary<string, List<PrefabBase>> EditorEnvironmentCatalog(World world)
        {
            var result=new Dictionary<string,List<PrefabBase>>(StringComparer.Ordinal);
            var ps=world.GetExistingSystemManaged<PrefabSystem>();
            using(var query=world.EntityManager.CreateEntityQuery(ComponentType.ReadOnly<PrefabData>()))
            using(var entities=query.ToEntityArray(Allocator.Temp)) foreach(var entity in entities) {
                if(!ps.TryGetPrefab<PrefabBase>(entity,out var prefab)) continue;
                var kind=EditorEnvironmentKind(prefab); if(kind==null) continue;
                var key=kind+":"+prefab.name;
                if(!result.TryGetValue(key,out var matches)) result[key]=matches=new List<PrefabBase>();
                matches.Add(prefab);
            }
            return result;
        }
        private JObject EditorEnvironmentDescription(PrefabBase prefab,EditorConfigurationContext c)
        {
            var kind=EditorEnvironmentKind(prefab);
            var current=kind=="climate"?(PrefabBase)c.ClimatePrefab:kind=="water_render"?c.WaterPrefab:(PrefabBase)c.TerrainPrefab;
            var result=new JObject { ["kind"]=kind,["name"]=prefab.name,["entity_id"]=EntityId(c.Prefabs.GetEntity(prefab)),
                ["current"]=prefab==current,["read_only"]=prefab.isReadOnly };
            if(prefab is ClimatePrefab climate) {
                result["latitude"]=climate.m_Latitude; result["longitude"]=climate.m_Longitude;
                result["seasons"]=new JArray((climate.m_Seasons??Array.Empty<Game.Simulation.ClimateSystem.SeasonInfo>()).Select((s,i)=>new JObject {
                    ["index"]=i,["name"]=s?.name,["start_time"]=s?.m_StartTime,
                    ["night_temperature"]=s?.m_TempNightDay.x,["day_temperature"]=s?.m_TempNightDay.y }));
            }
            if(prefab is TerrainRenderSettingsPrefab terrain) {
                result["texture_configuration"]=JObject.Parse(JsonUtility.ToJson(terrain));
            }
            return result;
        }
        private JObject ListEditorEnvironmentPresets(JObject args,World world)
        {
            RequireEditor(); var c=new EditorConfigurationContext(world);
            var kind=(string)args["kind"]??"all"; var search=(string)args["search"]??"";
            if(kind!="all" && kind!="climate" && kind!="water_render" && kind!="terrain_render") throw new QueryException("INVALID_ARGUMENT","Unknown environment preset kind.");
            int offset=ComponentInspector.Int(args,"offset",0,0,100000), limit=ComponentInspector.Int(args,"limit",30,1,100);
            var rows=EditorEnvironmentCatalog(world).Values.SelectMany(x=>x).Where(p=>(kind=="all" || EditorEnvironmentKind(p)==kind) && p.name.IndexOf(search,StringComparison.OrdinalIgnoreCase)>=0)
                .OrderBy(p=>EditorEnvironmentKind(p),StringComparer.Ordinal).ThenBy(p=>p.name,StringComparer.Ordinal).ToList();
            return new JObject { ["total"]=rows.Count,["offset"]=offset,["next_offset"]=offset+limit<rows.Count?new JValue(offset+limit):null,
                ["items"]=new JArray(rows.Skip(offset).Take(limit).Select(p=>EditorEnvironmentDescription(p,c))),
                ["note"]="Loaded native/mod/local presets only. A complete environment combines climate, water_render and terrain_render. This does not change terrain height, resources, vegetation, sea level or city architectural theme." };
        }
        private Dictionary<string,PrefabBase> ResolveEditorEnvironment(JObject presets,World world)
        {
            if(presets==null || presets.Count<1 || presets.Count>3) throw new QueryException("INVALID_ARGUMENT","Select one to three environment preset kinds.");
            var catalog=EditorEnvironmentCatalog(world); var result=new Dictionary<string,PrefabBase>(StringComparer.Ordinal);
            foreach(var p in presets.Properties().OrderBy(p=>p.Name,StringComparer.Ordinal)) {
                if(p.Name!="climate" && p.Name!="water_render" && p.Name!="terrain_render" || p.Value.Type!=JTokenType.String || string.IsNullOrWhiteSpace((string)p.Value))
                    throw new QueryException("INVALID_ARGUMENT","Use exact preset names from list_editor_environment_presets.");
                if(!catalog.TryGetValue(p.Name+":"+(string)p.Value,out var matches) || matches.Count!=1)
                    throw new QueryException("EDITOR_PRESET_NOT_UNIQUE","Preset is missing or ambiguous: "+p.Name+":"+(string)p.Value);
                var prefab=matches[0];
                if(prefab is ClimatePrefab climate && (climate.m_Seasons==null || climate.m_Seasons.Length<2 || climate.m_Seasons.Any(s=>s==null || s.m_Prefab==null) ||
                    !EditorConfigurationRules.ValidSeasonStarts(climate.m_Seasons.Select(s=>(double)s.m_StartTime).ToArray()) ||
                    climate.m_Temperature==null || climate.m_Precipitation==null || climate.m_Cloudiness==null || climate.m_Aurora==null || climate.m_Fog==null))
                    throw new QueryException("EDITOR_PRESET_INVALID","Climate preset must have valid existing seasons and built weather curves.");
                result.Add(p.Name,prefab);
            }
            return result;
        }
        private string EditorEnvironmentSourceBaseline(Dictionary<string,PrefabBase> presets,PrefabSystem ps) =>
            new JObject(presets.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>new JProperty(p.Key,new JObject {
                ["entity"]=EntityId(ps.GetEntity(p.Value)),["serialized"]=JsonUtility.ToJson(p.Value) }))).ToString(Formatting.None);
        private JObject PreviewEditorEnvironment(JObject args,World world)
        {
            RequireEditor(); RequireEditorIdle(world); var request=RequestKey(args);
            var c=new EditorConfigurationContext(world); var selected=ResolveEditorEnvironment(args["presets"] as JObject,world);
            var normalized=new JObject(selected.Select(p=>new JProperty(p.Key,p.Value.name)));
            var fingerprint="environment:"+normalized.ToString(Formatting.None);
            var prior=m_EditorConfigurations.Values.FirstOrDefault(o=>o.Request==request);
            if(prior!=null) { if(prior.Fingerprint!=fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT","request_id belongs to another configuration plan."); return prior.Json(); }
            if(m_EditorConfigurations.Count>=1024) throw new QueryException("EDITOR_OPERATION_LIMIT","Save and reload before more configuration operations.");
            var before=new JObject(); var after=new JObject();
            foreach(var p in selected) { before[p.Key]=EditorEnvironmentDescription((PrefabBase)c.Target(p.Key,-1),c); after[p.Key]=EditorEnvironmentDescription(p.Value,c); }
            var op=new EditorConfigurationOperation {Session=m_Session,Request=request,Fingerprint=fingerprint,Baseline=c.Baseline(),Changes=new JArray(),
                Presets=normalized,SourceBaseline=EditorEnvironmentSourceBaseline(selected,c.Prefabs),Before=before,After=after};
            m_EditorConfigurations.Add(op.Id,op); return op.Json();
        }
        private JObject ApplyEditorEnvironment(EditorConfigurationOperation op,World world,EditorConfigurationContext c)
        {
            var selected=ResolveEditorEnvironment(op.Presets,world);
            if(EditorEnvironmentSourceBaseline(selected,c.Prefabs)!=op.SourceBaseline) throw new QueryException("EDITOR_PRESET_CHANGED","A selected source preset changed since preview; cancel and preview again.");
            try {
                op.State="applying";
                // Same public reference setters as the native picker. The source preset is not edited.
                foreach(var p in selected) {
                    var entity=c.Prefabs.GetEntity(p.Value);
                    if(p.Key=="climate") {
                        var climate=(ClimatePrefab)p.Value; c.Climate.currentClimate=entity;
                        c.Planet.latitude=climate.m_Latitude; c.Planet.longitude=climate.m_Longitude; c.Planet.sunLimit=climate.sunLimitRadians;
                    } else if(p.Key=="water_render") c.WaterRender.currentWaterRenderSettings=entity;
                    else c.TerrainRender.currentTerrainRenderSettings=entity;
                }
                c.WaterRender.ApplyMaterialParams();
                world.GetExistingSystemManaged<EditorHierarchyUISystem>()?.SetViewportDirty();
                var live=new EditorConfigurationContext(world); var actual=new JObject();
                foreach(var p in selected) {
                    if(!ReferenceEquals(live.Target(p.Key,-1),p.Value)) throw new QueryException("EDITOR_READBACK_MISMATCH","Environment preset reference did not match: "+p.Key);
                    actual[p.Key]=EditorEnvironmentDescription(p.Value,live);
                }
                op.After=actual; op.State="completed";
            } catch(Exception ex) { op.State="outcome_unknown"; op.Error=ex.Message; }
            return op.Json();
        }
    }
}
