using System;
using System.Collections.Generic;
using Game.Prefabs;
using Unity.Entities;

namespace CityWeaver
{
    [Serializable]
    public sealed class McpVehicleDoorProperties : ComponentBase
    {
        [Serializable] public sealed class Door
        {
            public string bone;
            public bool right;
            public float angle;
            public float duration=1;
        }
        public Door[] m_Doors=Array.Empty<Door>();
        // PrefabBase.Clone uses Unity JsonUtility, which omits this mod-defined field.
        // The asset serializer persists it, but private render clones need an explicit deep copy.
        internal static Door[] CopyDoors(Door[] source)
        {
            if(source==null)return Array.Empty<Door>();
            var copy=new Door[source.Length];
            for(int i=0;i<source.Length;i++){
                var door=source[i];if(door==null)throw new ArgumentException("Null door configuration.");
                copy[i]=new Door{bone=door.bone,right=door.right,angle=door.angle,duration=door.duration};
            }
            return copy;
        }
        public override void GetArchetypeComponents(HashSet<ComponentType> components) { }
        public override void GetPrefabComponents(HashSet<ComponentType> components) { }
    }
}


