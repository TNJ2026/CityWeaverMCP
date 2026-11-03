using Newtonsoft.Json.Linq;
using Unity.Mathematics;

namespace CityWeaver
{
    internal static class ModelCompositionJson
    {
        // Mathematics vectors expose recursive swizzle properties; never serialize
        // them through reflection (JToken.FromObject / JsonConvert.SerializeObject).
        internal static JArray Position(float3 value)=>new JArray(value.x,value.y,value.z);
        internal static JArray Rotation(quaternion value)=>new JArray(value.value.x,value.value.y,value.value.z,value.value.w);
    }
}
