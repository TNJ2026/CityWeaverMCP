using System;
using System.Collections.Generic;
using Colossal.Mathematics;
using Unity.Mathematics;

namespace CityWeaver
{
    internal static class RoadCopyCurveRules
    {
        // 0 = interior split, -1 = existing start node, 1 = existing end node,
        // 2 = unsafe short approach. Native junction generation can otherwise move
        // the old degree-two endpoint far into its adjacent road to make room.
        internal static int ConnectionEndpoint(float projectedStart,float projectedEnd,float requestedStart,float requestedEnd,float tolerance,float clearance,
            bool preserveStart=false,bool preserveEnd=false)
        {
            if(!math.isfinite(projectedStart) || !math.isfinite(projectedEnd) || !math.isfinite(requestedStart) || !math.isfinite(requestedEnd) ||
                !math.isfinite(tolerance) || !math.isfinite(clearance) || tolerance<=0 || clearance<0) return 2;
            bool nearStart=projectedStart<clearance, nearEnd=projectedEnd<clearance;
            // Preserve the requested placement beside protected degree-two seam
            // nodes. Actual junctions still require the original clearance rule.
            if((!nearStart || preserveStart) && (!nearEnd || preserveEnd))
            {
                if(nearStart && requestedStart<=math.min(tolerance,.25f)) return -1;
                if(nearEnd && requestedEnd<=math.min(tolerance,.25f)) return 1;
                return 0;
            }
            if(!nearStart && !nearEnd) return 0;
            bool start=nearStart && requestedStart<=tolerance, end=nearEnd && requestedEnd<=tolerance;
            if(start && end) return requestedStart<=requestedEnd ? -1 : 1;
            return start ? -1 : end ? 1 : 2;
        }
        internal static bool OnCurve(Bezier4x3 reference,Bezier4x3 candidate,float tolerance)
        {
            if (!math.isfinite(tolerance) || tolerance<0 || !math.all(math.isfinite(reference.a)) || !math.all(math.isfinite(reference.b)) ||
                !math.all(math.isfinite(reference.c)) || !math.all(math.isfinite(reference.d))) return false;
            float previous=-1;
            for(int i=0;i<=32;i++)
            {
                var p=MathUtils.Position(candidate,i/32f);
                if(!math.all(math.isfinite(p))) return false;
                var distance=MathUtils.Distance(reference.xz,p.xz,out float t);
                if(!math.isfinite(distance) || !math.isfinite(t) || distance>tolerance) return false;
                if(t+.005f<previous) return false;
                var expected=MathUtils.Position(reference,t);
                if(math.abs(p.y-expected.y)>.5f) return false;
                previous=t;
            }
            return true;
        }

        internal static bool Covers(List<float2> intervals)
        {
            if(intervals.Count==0) return false;
            intervals.Sort((a,b)=>a.x.CompareTo(b.x));
            float end=0;
            foreach(var interval in intervals)
            {
                if(!math.all(math.isfinite(interval)) || interval.x<-.001f || interval.y>1.001f || interval.y<interval.x ||
                    interval.x>end+.002f || interval.x<end-.002f) return false;
                end=math.max(end,interval.y);
            }
            return end>=.998f;
        }
    }
}
