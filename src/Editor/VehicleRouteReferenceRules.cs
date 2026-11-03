using System;
using System.Collections.Generic;

namespace CityWeaver
{
    internal static class VehicleRouteReferenceRules
    {
        // Compare the complete identity (including generation), never an entity index alone.
        internal static int Remap<T>(ref T primary, ref T secondary, T before, T after) where T : struct
        {
            var eq=EqualityComparer<T>.Default;
            if(eq.Equals(before,default(T))||eq.Equals(after,default(T))||eq.Equals(before,after))
                throw new ArgumentException("Distinct, non-null prefab identities are required.");
            int count=0;
            if(eq.Equals(primary,before)){primary=after;count++;}
            if(eq.Equals(secondary,before)){secondary=after;count++;}
            return count;
        }
    }
}
