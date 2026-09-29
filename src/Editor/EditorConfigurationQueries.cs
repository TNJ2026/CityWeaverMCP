using System;
using System.Collections.Generic;
using System.Linq;
using Game.Prefabs;
using Game.Prefabs.Climate;
using Game.Prefabs.Terrain;
using Game.Prefabs.Water;
using Game.Rendering;
using Game.Simulation;
using Game.UI.Editor;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Entities;
using Unity.Mathematics;
using UnityEngine;

namespace CityWeaver
{
    internal sealed class EditorConfigurationOperation
    {
        internal string Id = Guid.NewGuid().ToString("N"), Session, Request, Fingerprint, Baseline, State = "preview_ready", Error;
        internal DateTime Expires = DateTime.UtcNow.AddMinutes(5);
        internal JArray Changes;
        internal JObject Before, After;
        internal JObject Presets;
        internal string SourceBaseline;
        internal void Refresh() { if(State == "preview_ready" && DateTime.UtcNow >= Expires) State = "expired"; }
        internal JObject Json() {
            Refresh();
            return new JObject { ["operation_id"]=Id,["session_id"]=Session,["request_id"]=Request,["state"]=State,
                ["changes"]=Changes.DeepClone(),["before"]=Before.DeepClone(),["after"]=After?.DeepClone(),
                ["after_kind"]=State=="completed"?"verified_live_values":"proposed_values_not_verified",
                ["presets"]=Presets?.DeepClone(),
                ["can_commit"]=State=="preview_ready",["expires_at_utc"]=Expires.ToString("O"),["error"]=Error,
                ["saved"]=false,["scope"]="map-wide configuration",
                ["note"]=Presets!=null?"Selects existing native preset references without editing their contents. No automatic save or undo; inspect outcome_unknown before further edits.":"Prefab parameter changes use private copies as in the native editor. SeaLevel changes the boundary level; it does not reset/fill all map water. Save through the native map dialog. No automatic undo." };
        }
    }

    public sealed partial class GameQueryService
    {
        private readonly Dictionary<string,EditorConfigurationOperation> m_EditorConfigurations = new Dictionary<string,EditorConfigurationOperation>();
        private void ResetEditorConfigurations() => m_EditorConfigurations.Clear();
        private sealed class EditorConfigurationContext
        {
            internal PrefabSystem Prefabs;
            internal ClimateSystem Climate;
            internal WaterSystem Water;
            internal WaterRenderSystem WaterRender;
            internal TerrainMaterialSystem TerrainRender;
            internal WindSimulationSystem Wind;
            internal PlanetarySystem Planet;
            internal ClimatePrefab ClimatePrefab;
            internal WaterRenderSettingsPrefab WaterPrefab;
            internal TerrainRenderSettingsPrefab TerrainPrefab;
            internal EditorConfigurationContext(World world) {
                Prefabs=world.GetExistingSystemManaged<PrefabSystem>(); Climate=world.GetExistingSystemManaged<ClimateSystem>();
                Water=world.GetExistingSystemManaged<WaterSystem>(); WaterRender=world.GetExistingSystemManaged<WaterRenderSystem>();
                TerrainRender=world.GetExistingSystemManaged<TerrainMaterialSystem>(); Wind=world.GetExistingSystemManaged<WindSimulationSystem>();
                Planet=world.GetExistingSystemManaged<PlanetarySystem>();
                if(Prefabs==null || Climate==null || Water==null || WaterRender==null || TerrainRender==null || Wind==null || Planet==null ||
                    Climate.currentClimate==Entity.Null || WaterRender.currentWaterRenderSettings==Entity.Null || TerrainRender.currentTerrainRenderSettings==Entity.Null)
                    throw new QueryException("EDITOR_CONFIGURATION_UNAVAILABLE","Wait for the map's native climate, water and terrain settings to load.");
                ClimatePrefab=Prefabs.GetPrefab<ClimatePrefab>(Climate.currentClimate);
                WaterPrefab=Prefabs.GetPrefab<WaterRenderSettingsPrefab>(WaterRender.currentWaterRenderSettings);
                TerrainPrefab=Prefabs.GetPrefab<TerrainRenderSettingsPrefab>(TerrainRender.currentTerrainRenderSettings);
            }
            internal object Target(string group, int index) {
                switch(group) {
                    case "climate": return ClimatePrefab;
                    case "water_render": return WaterPrefab;
                    case "terrain_render": return TerrainPrefab;
                    case "season":
                        if(index<0 || index>=ClimatePrefab.m_Seasons.Length || ClimatePrefab.m_Seasons[index]==null)
                            throw new QueryException("INVALID_ARGUMENT","season_index must reference an existing season from get_editor_configuration.");
                        return ClimatePrefab.m_Seasons[index];
                    default: throw new QueryException("INVALID_ARGUMENT","Unknown configuration group.");
                }
            }
            internal string Baseline() => Climate.currentClimate+"|"+WaterRender.currentWaterRenderSettings+"|"+TerrainRender.currentTerrainRenderSettings+"|"+
                JsonUtility.ToJson(ClimatePrefab)+"|"+JsonUtility.ToJson(WaterPrefab)+"|"+JsonUtility.ToJson(TerrainPrefab)+"|"+Values().ToString(Formatting.None)+"|"+Wind.constantWind.ToString()+"|"+WindPressure(Wind);
            internal JObject Values() {
                var values=new JObject();
                foreach(var pair in EditorConfigurationRules.Fields) if(!pair.Key.StartsWith("season.",StringComparison.Ordinal)) values[pair.Key]=Read(pair.Key,-1);
                var seasons=new JArray();
                for(int i=0;i<ClimatePrefab.m_Seasons.Length;i++) {
                    var row=new JObject { ["season_index"]=i,["name"]=ClimatePrefab.m_Seasons[i]?.name };
                    foreach(var pair in EditorConfigurationRules.Fields) if(pair.Key.StartsWith("season.",StringComparison.Ordinal)) row[pair.Key]=Read(pair.Key,i);
                    seasons.Add(row);
                }
                values["seasons"]=seasons; return values;
            }
            internal JToken Read(string path,int index) {
                switch(path) {
                    case "water.SeaLevel": return Water.SeaLevel;
                    case "water.seaWindStrength": return WaterRender.seaWindStrength;
                    case "water.seaWindDirection": return WaterRender.seaWindDirection;
                    case "wind.direction_degrees": return (math.degrees(math.atan2(Wind.constantWind.y,Wind.constantWind.x))+360)%360;
                }
                var parts=path.Split('.'); var target=Target(parts[0],index);
                var field=target.GetType().GetField(parts[1]) ?? throw new QueryException("EDITOR_SCHEMA_MISMATCH","Native field unavailable: "+path);
                var value=field.GetValue(target);
                if(value is float2 v) return new JArray(v.x,v.y);
                if(value is Color c) return new JArray(c.r,c.g,c.b,c.a);
                return JToken.FromObject(value);
            }
        }
        private JObject GetEditorConfiguration(World world) {
            RequireEditor(); var c=new EditorConfigurationContext(world);
            var schema=new JArray(EditorConfigurationRules.Fields.Select(p=>new JObject {
                ["path"]=p.Key,["minimum"]=p.Value.Min,["maximum"]=p.Value.Max,["components"]=p.Value.Components,
                ["type"]=p.Value.Boolean?"boolean":p.Value.Components>1?"number_array":p.Value.Integer?"integer":"number",
                ["season_index_required"]=p.Key.StartsWith("season.",StringComparison.Ordinal) }));
            return new JObject { ["values"]=c.Values(),["fields"]=schema,
                ["climate_prefab"]=c.ClimatePrefab.name,["water_render_prefab"]=c.WaterPrefab.name,["terrain_render_prefab"]=c.TerrainPrefab.name,
                ["legacy_water_sources"]=c.Water.UseLegacyWaterSources,["sea_wind_enabled"]=c.WaterRender.seaWindEnabled,
                ["workflow"]="preview_editor_configuration -> apply_editor_configuration -> get_editor_configuration_operation; then native map save",
                ["units"]="Native fields: seasonal chance/amount 0..100; temperature Celsius; season start normalized year [0,1); float2 temperature is [night,day]; colors RGBA [0,1]; sea level meters; directions degrees.",
                ["environment_workflow"]="list_editor_environment_presets -> preview_editor_environment -> apply_editor_configuration",
                ["limitations"]="Parameter edits preserve season identities. Whole loaded climate/water/terrain presets can be selected through preview_editor_environment. No external texture imports, individual weather/season asset replacement, or global water reset. Weather overrides are transient and separate from saved climate configuration." };
        }
        private static JArray ValidateEditorChanges(JObject args,EditorConfigurationContext c) {
            var input=args["changes"] as JArray;
            if(input==null || input.Count<1 || input.Count>128) throw new QueryException("INVALID_ARGUMENT","changes must contain 1..128 settings.");
            var result=new JArray(); var keys=new HashSet<string>(StringComparer.Ordinal);
            foreach(var item in input) {
                if(!(item is JObject row) || row.Properties().Any(p=>p.Name!="path" && p.Name!="value" && p.Name!="season_index"))
                    throw new QueryException("INVALID_ARGUMENT","Use path, value and optional season_index only.");
                var path=(string)row["path"];
                if(path==null || !EditorConfigurationRules.Fields.TryGetValue(path,out var rule)) throw new QueryException("INVALID_ARGUMENT","Unsupported path; read get_editor_configuration.fields.");
                var seasonal=path.StartsWith("season.",StringComparison.Ordinal);
                int index=-1;
                if(seasonal) {
                    if(row["season_index"]?.Type!=JTokenType.Integer) throw new QueryException("INVALID_ARGUMENT","season_index is required for season fields.");
                    index=ComponentInspector.Int(row,"season_index",-1,0,63); c.Target("season",index);
                } else if(row["season_index"]!=null) throw new QueryException("INVALID_ARGUMENT","season_index is only valid for season fields.");
                if(!keys.Add(path+":"+index)) throw new QueryException("INVALID_ARGUMENT","Duplicate configuration field.");
                var value=row["value"];
                if(rule.Boolean) {
                    if(value?.Type!=JTokenType.Boolean) throw new QueryException("INVALID_ARGUMENT",path+" requires a boolean.");
                } else {
                    var numbers=rule.Components>1 ? value as JArray : new JArray(value?.DeepClone());
                    if(numbers==null || numbers.Count!=rule.Components || numbers.Any(v=>(v.Type!=JTokenType.Integer && v.Type!=JTokenType.Float) || !rule.Accept((double)v)))
                        throw new QueryException("INVALID_ARGUMENT",path+" has an invalid value, dimension or range.");
                    value=rule.Components>1 ? new JArray(numbers.Select(v=>new JValue((float)v))) : rule.Integer?new JValue((int)value):new JValue((float)value);
                }
                var normalized=new JObject { ["path"]=path,["value"]=value.DeepClone() };
                if(seasonal) normalized["season_index"]=index;
                result.Add(normalized);
            }
            if(result.Any(r=>(string)r["path"]=="water.SeaLevel") && c.Water.UseLegacyWaterSources)
                throw new QueryException("LEGACY_WATER_SOURCES","Convert legacy water sources in the native editor before editing sea level.");
            var starts=c.ClimatePrefab.m_Seasons.Select(s=>(double)s.m_StartTime).ToArray();
            foreach(var r in result.Where(r=>(string)r["path"]=="season.m_StartTime")) starts[(int)r["season_index"]]=(double)r["value"];
            if(result.Any(r=>((string)r["path"]).StartsWith("season.") || ((string)r["path"]).StartsWith("climate."))) {
                if(!EditorConfigurationRules.ValidSeasonStarts(starts)) throw new QueryException("INVALID_SEASONS","Climate needs at least two existing seasons, with distinct start times separated by 0.0001 of a year.");
                double max=c.ClimatePrefab.m_MaxSunElevationAngle, start=c.ClimatePrefab.m_SunElevationClampStart;
                foreach(var r in result) { if((string)r["path"]=="climate.m_MaxSunElevationAngle") max=(double)r["value"]; if((string)r["path"]=="climate.m_SunElevationClampStart") start=(double)r["value"]; }
                if(start>max) throw new QueryException("INVALID_ARGUMENT","Sun clamp start must not exceed maximum sun elevation.");
            }
            return new JArray(result.OrderBy(r=>(string)r["path"],StringComparer.Ordinal).ThenBy(r=>(int?)r["season_index"]??-1));
        }
        private JObject PreviewEditorConfiguration(JObject args,World world) {
            RequireEditor(); RequireEditorIdle(world);
            var c=new EditorConfigurationContext(world); var changes=ValidateEditorChanges(args,c); var request=RequestKey(args);
            var fingerprint=changes.ToString(Formatting.None);
            var prior=m_EditorConfigurations.Values.FirstOrDefault(o=>o.Request==request);
            if(prior!=null) { if(prior.Fingerprint!=fingerprint) throw new QueryException("IDEMPOTENCY_CONFLICT","request_id belongs to different settings."); return prior.Json(); }
            if(m_EditorConfigurations.Count>=1024) throw new QueryException("EDITOR_OPERATION_LIMIT","Save and reload before more configuration operations.");
            var before=new JObject(); var after=new JObject();
            foreach(var r in changes) { var path=(string)r["path"]; var index=(int?)r["season_index"]??-1; var key=path+(index<0?"":"["+index+"]"); before[key]=c.Read(path,index); after[key]=r["value"].DeepClone(); }
            var op=new EditorConfigurationOperation {Session=m_Session,Request=request,Fingerprint=fingerprint,Baseline=c.Baseline(),Changes=changes,Before=before,After=after};
            m_EditorConfigurations.Add(op.Id,op); return op.Json();
        }
        private EditorConfigurationOperation EditorConfigurationById(JObject args) {
            if(!m_EditorConfigurations.TryGetValue((string)args["operation_id"]??"",out var op) || op.Session!=m_Session) throw new QueryException("EDITOR_OPERATION_NOT_FOUND","Configuration operation is not in this map session.");
            op.Refresh(); return op;
        }
        private JObject CancelEditorConfiguration(JObject args) {
            RequireEditor(); var op=EditorConfigurationById(args); if(op.State=="preview_ready") op.State="cancelled"; return op.Json();
        }
        private JObject ApplyEditorConfiguration(JObject args,World world) {
            RequireEditor(); var op=EditorConfigurationById(args);
            if(RequestKey(args)!=op.Request) throw new QueryException("IDEMPOTENCY_CONFLICT","Use the preview request_id.");
            if(op.State=="completed" || op.State=="outcome_unknown") return op.Json();
            if(op.State!="preview_ready") throw new QueryException("EDITOR_OPERATION_NOT_READY",op.State);
            RequireEditorIdle(world); world.EntityManager.CompleteAllTrackedJobs();
            var c=new EditorConfigurationContext(world);
            if(c.Baseline()!=op.Baseline) throw new QueryException("EDITOR_BASELINE_CHANGED","Map settings changed after preview; cancel and make a new preview.");
            if(op.Presets!=null) return ApplyEditorEnvironment(op,world,c);
            ValidateEditorChanges(new JObject { ["changes"]=op.Changes.DeepClone() },c);
            var copies=new Dictionary<string,PrefabBase>(); var registered=new HashSet<PrefabBase>(); bool dispatched=false;
            try {
                // Prepare detached copies first, including climate curve rebuild, before changing any live reference.
                foreach(var r in op.Changes) {
                    var parts=((string)r["path"]).Split('.'); var group=parts[0]=="season"?"climate":parts[0];
                    if(group!="climate" && group!="water_render" && group!="terrain_render") continue;
                    if(!copies.TryGetValue(group,out var copy)) { copy=((PrefabBase)c.Target(group,-1)).Clone("CityWeaver_"+group+"_"+op.Id); copies.Add(group,copy); }
                    object target=parts[0]=="season" ? ((ClimatePrefab)copy).m_Seasons[(int)r["season_index"]] : (object)copy;
                    var field=target.GetType().GetField(parts[1]); var v=r["value"];
                    object value=field.FieldType==typeof(float2)?(object)new float2((float)v[0],(float)v[1]):field.FieldType==typeof(Color)?new Color((float)v[0],(float)v[1],(float)v[2],(float)v[3]):v.ToObject(field.FieldType);
                    field.SetValue(target,value);
                }
                if(copies.TryGetValue("climate",out var climateCopy)) ((ClimatePrefab)climateCopy).RebuildCurves();
                foreach(var copy in copies.Values) {
                    // Registration may partially succeed before returning false; never destroy a possibly registered prefab.
                    registered.Add(copy);
                    if(!c.Prefabs.AddPrefab(copy)) throw new QueryException("EDITOR_PREFAB_REGISTRATION_FAILED","Native editor could not register settings copy.");
                }
                op.State="applying"; dispatched=true;
                foreach(var pair in copies) {
                    var entity=c.Prefabs.GetEntity(pair.Value);
                    if(pair.Key=="climate") {
                        var p=(ClimatePrefab)pair.Value; c.Climate.currentClimate=entity;
                        c.Planet.latitude=p.m_Latitude; c.Planet.longitude=p.m_Longitude; c.Planet.sunLimit=p.sunLimitRadians;
                    } else if(pair.Key=="water_render") c.WaterRender.currentWaterRenderSettings=entity;
                    else c.TerrainRender.currentTerrainRenderSettings=entity;
                }
                foreach(var r in op.Changes) {
                    var path=(string)r["path"];
                    switch(path) {
                        case "water.SeaLevel": c.Water.SeaLevel=(float)r["value"]; break;
                        case "water.seaWindStrength": c.WaterRender.seaWindStrength=(float)r["value"]; break;
                        case "water.seaWindDirection": c.WaterRender.seaWindDirection=(float)r["value"]; break;
                        case "wind.direction_degrees": var angle=math.radians((float)r["value"]); c.Wind.SetWind(new float2(math.cos(angle),math.sin(angle)),40f); break;
                    }
                }
                c.WaterRender.ApplyMaterialParams();
                world.GetExistingSystemManaged<EditorHierarchyUISystem>()?.SetViewportDirty();
                var live=new EditorConfigurationContext(world); var actual=new JObject();
                foreach(var r in op.Changes) {
                    var path=(string)r["path"]; var index=(int?)r["season_index"]??-1;
                    var value=live.Read(path,index); actual[path+(index<0?"":"["+index+"]")]=value;
                    if(!EditorConfigurationEqual(value,r["value"],path=="wind.direction_degrees")) throw new QueryException("EDITOR_READBACK_MISMATCH","Readback differs for "+path);
                }
                op.After=actual; op.State="completed";
            } catch(Exception ex) { op.State=dispatched?"outcome_unknown":"failed"; op.Error=ex.Message; }
            finally { foreach(var copy in copies.Values) if(!registered.Contains(copy)) UnityEngine.Object.Destroy(copy); }
            return op.Json();
        }
        private static bool EditorConfigurationEqual(JToken actual,JToken expected,bool angle=false) {
            if(actual is JArray a && expected is JArray b) return a.Count==b.Count && a.Zip(b,(x,y)=>EditorConfigurationEqual(x,y)).All(x=>x);
            if(actual.Type==JTokenType.Boolean) return JToken.DeepEquals(actual,expected);
            var delta=Math.Abs((double)actual-(double)expected); if(angle) delta=Math.Min(delta,Math.Abs(360-delta));
            return delta<0.001;
        }
    }
}
