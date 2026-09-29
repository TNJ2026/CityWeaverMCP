using System;

namespace CityWeaver
{
    internal static class EditorAssetRules
    {
        internal static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        internal static bool Coordinate(double value) => Finite(value) && Math.Abs(value) <= 100000;
        internal static double PlacementHeight(double terrain, double water, double depth, double offset, bool hovering, bool floating, bool shoreline)
        {
            if (hovering || ((floating || shoreline) && depth >= .2)) return Math.Max(terrain, water + offset);
            return floating || shoreline ? terrain : terrain + offset;
        }
        internal static bool Terminal(string state) => state == "completed" || state == "failed" || state == "cancelled" || state == "expired" || state == "outcome_unknown";
        internal static bool CanCommit(string state, bool cancelled, DateTime expires, DateTime now, long cost, long ceiling, int errors, int warnings)
            => state == "preview_ready" && !cancelled && now < expires && cost >= 0 && ceiling >= cost && errors == 0 && warnings == 0;
        internal static bool SimplePolygon(double[] xs, double[] zs)
        {
            if (xs == null || zs == null || xs.Length != zs.Length || xs.Length < 3 || xs.Length > 128) return false;
            int n = xs.Length; double area = 0;
            double Cross(int a, int b, int c) => (xs[b]-xs[a])*(zs[c]-zs[a])-(zs[b]-zs[a])*(xs[c]-xs[a]);
            bool On(int a,int b,int c) => Math.Abs(Cross(a,b,c)) < 0.000001 && xs[c]>=Math.Min(xs[a],xs[b])-0.000001 && xs[c]<=Math.Max(xs[a],xs[b])+0.000001 && zs[c]>=Math.Min(zs[a],zs[b])-0.000001 && zs[c]<=Math.Max(zs[a],zs[b])+0.000001;
            for(int a=0;a<n;a++) {
                int b=(a+1)%n;
                if(!Coordinate(xs[a]) || !Coordinate(zs[a]) || Math.Abs(xs[a]-xs[b])+Math.Abs(zs[a]-zs[b])<0.01) return false;
                area+=xs[a]*zs[b]-xs[b]*zs[a];
                for(int c=a+1;c<n;c++) {
                    int d=(c+1)%n; if(a==c || a==d || b==c || b==d) continue;
                    if(On(a,b,c)||On(a,b,d)||On(c,d,a)||On(c,d,b) || (Cross(a,b,c)*Cross(a,b,d)<0 && Cross(c,d,a)*Cross(c,d,b)<0)) return false;
                }
            }
            return Math.Abs(area)>=2;
        }
    }
}
