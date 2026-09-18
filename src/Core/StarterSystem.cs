using Game;

namespace CityWeaver
{
    // Verify the simulation update path once without changing city data.
    public partial class StarterSystem : GameSystemBase
    {
        protected override void OnUpdate()
        {
            Mod.log.Info("StarterSystem received its first simulation update.");
            Enabled = false;
        }
    }
}
