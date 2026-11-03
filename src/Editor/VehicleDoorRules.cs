using System;
namespace CityWeaver
{
    internal static class VehicleDoorRules
    {
        // Side -1=left, +1=right, 0=unknown. Never guess a side for non-boarding vehicles.
        internal static int BoardingSide(bool boarding,bool left,bool right,float stopLocalX)
        {
            if(!boarding)return 0;
            if(left!=right)return right?1:-1;
            if(left&&right||float.IsNaN(stopLocalX)||float.IsInfinity(stopLocalX)||Math.Abs(stopLocalX)<.1f)return 0;
            return stopLocalX>0?1:-1;
        }
        internal static bool Open(bool right,bool boardingLeft,bool boardingRight,float speed)
            =>!float.IsNaN(speed)&&!float.IsInfinity(speed)&&Math.Abs(speed)<0.2f&&(right?boardingRight:boardingLeft);
        internal static float Step(float current,bool open,float delta,float duration)
        {
            if(float.IsNaN(current)||float.IsInfinity(current)||current<0||current>1||float.IsNaN(delta)||float.IsInfinity(delta)||delta<0||float.IsNaN(duration)||float.IsInfinity(duration)||duration<=0)throw new ArgumentException("Invalid door timing.");
            return open?Math.Min(1,current+delta/duration):Math.Max(0,current-delta/duration);
        }
    }
}
