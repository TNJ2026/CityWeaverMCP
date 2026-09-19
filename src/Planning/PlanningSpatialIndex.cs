using System;
using System.Collections.Generic;
using Unity.Mathematics;

namespace CityWeaver
{
    // Request-local index: never retain ECS data across a construction commit.
    internal sealed class PlanningSpatialIndex<T>
    {
        private readonly float cellSize;
        private readonly Dictionary<(int, int), List<T>> cells = new Dictionary<(int, int), List<T>>();
        public PlanningSpatialIndex(float cellSize = 128) { this.cellSize = math.max(1, cellSize); }
        public void Add(float2 min, float2 max, T item)
        {
            var a = (int2)math.floor(min / cellSize); var b = (int2)math.floor(max / cellSize);
            for (int x = a.x; x <= b.x; x++) for (int z = a.y; z <= b.y; z++)
            {
                if (!cells.TryGetValue((x, z), out var bucket)) cells[(x, z)] = bucket = new List<T>();
                bucket.Add(item);
            }
        }
        public IEnumerable<T> Query(float2 min, float2 max)
        {
            var a = (int2)math.floor(min / cellSize); var b = (int2)math.floor(max / cellSize);
            var seen = new HashSet<T>();
            for (int x = a.x; x <= b.x; x++) for (int z = a.y; z <= b.y; z++)
                if (cells.TryGetValue((x, z), out var bucket)) foreach (var item in bucket) if (seen.Add(item)) yield return item;
        }
    }
}
