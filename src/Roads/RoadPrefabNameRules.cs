using System;
using System.Text.RegularExpressions;

namespace CityWeaver
{
    internal static class RoadPrefabNameRules
    {
        private static readonly Regex LaneLabel = new Regex(@"(?<![\p{L}\p{N}])([1-9][0-9]{0,2})(?:\s+|-)\s*lanes?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        internal static int AdvertisedLaneCount(string name)
        {
            if (string.IsNullOrEmpty(name)) return 0;
            var match = LaneLabel.Match(name);
            return match.Success && int.TryParse(match.Groups[1].Value, out var count) && count <= 128 ? count : 0;
        }
    }
}
