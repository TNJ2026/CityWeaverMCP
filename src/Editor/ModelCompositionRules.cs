using System;
using System.Linq;
namespace CityWeaver
{
    internal static class ModelCompositionRules
    {
        internal static void Sources(string[] names)
        {
            if(names==null||names.Length<2||names.Length>16||names.Any(string.IsNullOrWhiteSpace)||names.Any(n=>n.Length>256)||names.Distinct(StringComparer.Ordinal).Count()!=names.Length)
                throw new ArgumentException("Composition requires 2..16 distinct exact imported model names.");
        }
        internal static void Render(int materials,int lodCount)
        {
            // Conservative single-LOD contract; no automatic combining or LOD inference.
            if(materials<1||materials>8||lodCount!=0)throw new ArgumentException("Composition requires single-LOD render modules with 1..8 materials each.");
        }
    }
}
