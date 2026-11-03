using System;
using System.Collections.Generic;

namespace CityWeaver
{
    internal static class VehicleModelRules
    {
        internal static bool MatchesName(string name,string search)=>!string.IsNullOrWhiteSpace(name)&&name.IndexOf(search??"",StringComparison.OrdinalIgnoreCase)>=0;
        internal static void Finite(float value,float min,float max,string field){if(float.IsNaN(value)||float.IsInfinity(value)||value<min||value>max)throw new ArgumentException(field+" is outside its finite range.");}
        internal static void Hierarchy(string[] names,int[] parents)
        {
            if(names.Length!=parents.Length||names.Length>256)throw new ArgumentException("Invalid skeleton size.");
            var seen=new HashSet<string>(StringComparer.Ordinal);
            for(int i=0;i<names.Length;i++){
                if(string.IsNullOrWhiteSpace(names[i])||!seen.Add(names[i]))throw new ArgumentException("Bone names must be nonempty and unique.");
                if(parents[i]<-1||parents[i]>=names.Length||parents[i]==i)throw new ArgumentException("Invalid bone parent.");
                int cursor=i;var chain=new HashSet<int>();while(cursor>=0){if(!chain.Add(cursor))throw new ArgumentException("Cyclic bone hierarchy.");cursor=parents[cursor];if(cursor>=names.Length||cursor< -1)throw new ArgumentException("Invalid bone parent.");}
            }
        }
        internal static int[] Match(string[] source,string[] donor)
        {
            var lookup=new Dictionary<string,int>(StringComparer.Ordinal);for(int i=0;i<donor.Length;i++)if(string.IsNullOrWhiteSpace(donor[i])||lookup.ContainsKey(donor[i]))throw new ArgumentException("Ambiguous donor bones.");else lookup.Add(donor[i],i);
            var result=new int[source.Length];var seen=new HashSet<string>(StringComparer.Ordinal);
            for(int i=0;i<source.Length;i++)if(!seen.Add(source[i])||!lookup.TryGetValue(source[i],out result[i]))throw new ArgumentException("Bone names do not match the donor rig.");
            if(source.Length!=donor.Length)throw new ArgumentException("Donor and source bone sets differ.");return result;
        }
        internal static void Weight(float weight,int index,int count){Finite(weight,0,1,"bone weight");if(weight>0&&(index<0||index>=count))throw new ArgumentException("Mesh weights reference missing bones.");}
    }
}
