using Colossal.Logging;
using Game;
using Game.Modding;
using Game.SceneFlow;
using Colossal.IO.AssetDatabase;
using Game.Rendering;

namespace CityWeaver
{
    public class Mod : IMod
    {
        public static ILog log = LogManager.GetLogger($"{nameof(CityWeaver)}.{nameof(Mod)}").SetShowsErrorsInUI(false);
        private Setting m_Setting;
        private GameQueryService m_Queries;
        private LocalQueryBridge m_Bridge;

        public void OnLoad(UpdateSystem updateSystem)
        {
            log.Info(nameof(OnLoad));

            if (GameManager.instance.modManager.TryGetExecutableAsset(this, out var asset))
                log.Info($"Current mod asset at {asset.path}");

            m_Setting = new Setting(this);
            m_Setting.RegisterInOptionsUI();
            GameManager.instance.localizationManager.AddSource("en-US", new LocaleEN(m_Setting));
            GameManager.instance.localizationManager.AddSource("zh-HANS", new LocaleEN(m_Setting, true));


            AssetDatabase.global.LoadSettings(nameof(CityWeaver), m_Setting, new Setting(this));
            updateSystem.UpdateAt<StarterSystem>(SystemUpdatePhase.GameSimulation);
            updateSystem.UpdateBefore<McpCameraFocusSystem, CameraUpdateSystem>(SystemUpdatePhase.Rendering);
            updateSystem.UpdateBefore<McpRoadToolSystem, Game.Tools.ToolOutputSystem>(SystemUpdatePhase.ToolUpdate);
            updateSystem.UpdateBefore<McpTerrainToolSystem, Game.Tools.ToolOutputSystem>(SystemUpdatePhase.ToolUpdate);
            updateSystem.UpdateBefore<McpBuildingToolSystem, Game.Tools.ToolOutputSystem>(SystemUpdatePhase.ToolUpdate);
            updateSystem.UpdateBefore<McpBuildingAreaToolSystem, Game.Tools.ToolOutputSystem>(SystemUpdatePhase.ToolUpdate);
            updateSystem.UpdateBefore<McpDistrictToolSystem, Game.Tools.ToolOutputSystem>(SystemUpdatePhase.ToolUpdate);
            updateSystem.UpdateBefore<McpTransportLineToolSystem, Game.Tools.ToolOutputSystem>(SystemUpdatePhase.ToolUpdate);
            m_Queries = new GameQueryService();
            StartBridge();
        }

        internal void StartBridge()
        {
            if (LocalQueryBridge.IsRunning) return;
            if (m_Queries == null)
            {
                log.Warn("Cannot start query bridge before the query service is ready.");
                return;
            }
            m_Bridge?.Dispose();
            m_Bridge = new LocalQueryBridge(m_Queries);
            m_Bridge.Start();
        }

        internal void StopBridge()
        {
            m_Bridge?.Dispose();
            m_Bridge = null;
        }

        internal void RestartBridge()
        {
            StopBridge();
            StartBridge();
        }

        public void OnDispose()
        {
            log.Info(nameof(OnDispose));
            StopBridge();
            m_Queries?.Dispose();
            m_Queries = null;
            if (m_Setting != null)
            {
                m_Setting.UnregisterInOptionsUI();
                m_Setting = null;
            }
        }
    }
}
