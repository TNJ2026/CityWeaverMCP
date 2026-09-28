using System;
using System.Collections.Generic;

namespace CityWeaver
{
    internal static class ResourceNetworkConnectivity
    {
        internal static bool Reaches<T>(T start, ISet<T> goals, Func<T, bool> valid,
            Func<T, IEnumerable<T>> adjacent, int limit = 4096)
        {
            var pending = new Queue<T>();
            var seen = new HashSet<T>();
            pending.Enqueue(start);
            while (pending.Count > 0 && seen.Count < limit)
            {
                var item = pending.Dequeue();
                if (!seen.Add(item) || !valid(item)) continue;
                if (goals.Contains(item)) return true;
                foreach (var next in adjacent(item)) pending.Enqueue(next);
            }
            return false;
        }
    }
}
