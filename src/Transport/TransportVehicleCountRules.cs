using System;

namespace CityWeaver
{
    internal static class TransportVehicleCountRules
    {
        // Select the middle of the entire plateau, not its rounded lower boundary.
        internal static float Select(float minimum, float maximum, int requested, Func<float, int> count)
        {
            bool increasing = count(maximum) >= count(minimum);
            double lower = minimum, upper = maximum;
            for (int i = 0; i < 48; i++)
            {
                double mid = (lower + upper) * .5;
                int value = count((float)mid);
                if (increasing ? value < requested : value > requested) lower = mid;
                else upper = mid;
            }
            double first = upper;
            lower = minimum; upper = maximum;
            for (int i = 0; i < 48; i++)
            {
                double mid = (lower + upper) * .5;
                int value = count((float)mid);
                if (increasing ? value <= requested : value >= requested) lower = mid;
                else upper = mid;
            }
            float result = (float)((first + lower) * .5);
            if (count(result) != requested)
                throw new InvalidOperationException("Requested vehicle count has no representable policy setting.");
            return result;
        }
    }
}
