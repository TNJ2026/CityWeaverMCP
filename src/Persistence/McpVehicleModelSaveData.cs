using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace CityWeaver
{
    // Value-only save payload: no Unity objects, temporary entity IDs or config-file paths.
    internal sealed class McpVehicleModelSaveData
    {
        internal bool LegacyImported;
        private readonly Dictionary<string,JObject> m_Items=new Dictionary<string,JObject>(StringComparer.Ordinal);
        private readonly HashSet<string> m_Disabled=new HashSet<string>(StringComparer.Ordinal);
        internal IEnumerable<string> Targets=>m_Items.Keys.ToArray();
        internal bool DefaultDisabled(string target)=>m_Disabled.Contains(target);
        internal JObject Get(string target)=>m_Items.TryGetValue(target,out var value)?(JObject)value.DeepClone():null;
        internal void Remove(string target)=>m_Items.Remove(target);
        internal void DisableDefault(string target){Remove(target);m_Disabled.Add(target);}
        internal void MergeDefaults(McpVehicleModelSaveData defaults)
        {
            foreach(var target in defaults.Targets)
                if(!m_Items.ContainsKey(target)&&!m_Disabled.Contains(target))Put(target,defaults.Get(target));
        }
        internal void Put(string target,JObject configuration)
        {
            if(string.IsNullOrWhiteSpace(target)||target.Length>1024)throw new ArgumentException("Invalid saved vehicle name.");
            var parts=configuration?["parts"] as JArray;
            if(parts==null||parts.Count<1||parts.Count>64||configuration.ToString(Formatting.None).Length>1024*1024)throw new ArgumentException("Invalid saved vehicle configuration.");
            foreach(var part in parts)
                if(!(part is JObject p)||string.IsNullOrWhiteSpace((string)p["render_prefab"])||p["render_prefab_id"]!=null)
                    throw new ArgumentException("Saved models require stable render names.");
            if(!m_Items.ContainsKey(target)&&m_Items.Count>=128)throw new ArgumentException("Too many saved vehicle replacements.");
            m_Items[target]=(JObject)configuration.DeepClone();
            m_Disabled.Remove(target);
        }
        internal string Encode()=>new JObject{["version"]=1,["legacy_imported"]=LegacyImported,["disabled_defaults"]=new JArray(m_Disabled.OrderBy(x=>x,StringComparer.Ordinal)),["vehicles"]=new JArray(m_Items.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>new JObject{["prefab"]=p.Key,["configuration"]=p.Value.DeepClone()}))}.ToString(Formatting.None);
        internal static McpVehicleModelSaveData Decode(string text)
        {
            var result=new McpVehicleModelSaveData();
            if(string.IsNullOrEmpty(text))return result;
            if(text.Length>16*1024*1024)throw new ArgumentException("Saved vehicle data exceeds limit.");
            var root=JObject.Parse(text);
            result.LegacyImported=(bool?)root["legacy_imported"]??false;
            if((int?)root["version"]!=1||!(root["vehicles"] is JArray items)||items.Count>128)throw new ArgumentException("Unsupported saved vehicle data.");
            foreach(JObject item in items)result.Put((string)item["prefab"],item["configuration"] as JObject);
            if(root["disabled_defaults"]!=null)
            {
                if(!(root["disabled_defaults"] is JArray disabled)||disabled.Count>128)throw new ArgumentException("Invalid disabled defaults.");
                foreach(var token in disabled)
                {
                    if(token.Type!=JTokenType.String||string.IsNullOrWhiteSpace((string)token)||((string)token).Length>1024)throw new ArgumentException("Invalid disabled default name.");
                    if(result.Get((string)token)==null)result.m_Disabled.Add((string)token);
                }
            }
            return result;
        }
    }
}


