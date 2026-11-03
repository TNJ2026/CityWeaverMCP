using System;
using System.Linq;

namespace CityWeaver
{
    internal static class AssetImportPolicy
    {
        internal static bool Mode(string mode)=>mode=="Game" || mode=="Editor";
        internal static bool Context(string startedMode,string currentMode,bool sameSession,bool worldCreated,bool paused,bool loading) =>
            Mode(startedMode) && startedMode==currentMode && sameSession && worldCreated && paused && !loading;
        internal static bool OwnedModel(string name,string subPath)
        {
            const string prefix="CityWeaver_";
            if(name==null || !name.StartsWith(prefix,StringComparison.Ordinal) || name.Length!=prefix.Length+32 || subPath==null)return false;
            var id=name.Substring(prefix.Length);
            return id.All(c=>c>='0'&&c<='9'||c>='a'&&c<='f') &&
                subPath.Replace('\\','/').Trim('/')=="ImportedData/CityWeaver/"+id;
        }
    }
}
