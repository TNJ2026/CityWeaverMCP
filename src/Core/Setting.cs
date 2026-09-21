using Colossal;
using Colossal.IO.AssetDatabase;
using Game.Modding;
using Game.Settings;
using System.Collections.Generic;

namespace CityWeaver
{
    [FileLocation(nameof(CityWeaver))]
    [SettingsUIGroupOrder(kConnection, kGeneral)]
    public class Setting : ModSetting
    {
        private readonly Mod m_Mod;

        public const string kSection = "Main";
        public const string kConnection = "Connection";
        public const string kGeneral = "General";
        public Setting(IMod mod) : base(mod)
        {
            m_Mod = mod as Mod;
            SetDefaults();
        }

        [SettingsUISection(kSection, kConnection)]
        [SettingsUIValueVersion(typeof(LocalQueryBridge), nameof(LocalQueryBridge.GetStatusVersion))]
        public string BridgeStatus => LocalQueryBridge.IsRunning ? "运行中" : "未启动";

        [SettingsUIButton]
        [SettingsUIDisableByCondition(typeof(Setting), nameof(IsBridgeRunning))]
        [SettingsUISection(kSection, kConnection)]
        public bool StartBridgeService { set => m_Mod?.StartBridge(); }

        [SettingsUIButton]
        [SettingsUIDisableByCondition(typeof(Setting), nameof(IsBridgeRunning), true)]
        [SettingsUISection(kSection, kConnection)]
        public bool StopBridgeService { set => m_Mod?.StopBridge(); }

        [SettingsUIButton]
        [SettingsUIDisableByCondition(typeof(Setting), nameof(IsBridgeRunning), true)]
        [SettingsUISection(kSection, kConnection)]
        public bool RestartBridgeService { set => m_Mod?.RestartBridge(); }

        public bool IsBridgeRunning() => LocalQueryBridge.IsRunning;

        [SettingsUISection(kSection, kGeneral)]
        public bool EnableTestMessage { get; set; }

        [SettingsUIButton]
        [SettingsUISection(kSection, kGeneral)]
        public bool WriteTestMessage
        {
            set
            {
                if (EnableTestMessage)
                    Mod.log.Info("Hello from CityWeaver: settings button works.");
            }
        }
        public override void SetDefaults() { EnableTestMessage = true; }
    }

    public class LocaleEN : IDictionarySource
    {
        private readonly Setting m_Setting;
        private readonly bool m_Chinese;
        public LocaleEN(Setting setting, bool chinese = false)
        {
            m_Setting = setting;
            m_Chinese = chinese;
        }
        public IEnumerable<KeyValuePair<string, string>> ReadEntries(
            IList<IDictionaryEntryError> errors, Dictionary<string, int> indexCounts)
        {
            return new Dictionary<string, string>
            {
                { m_Setting.GetSettingsLocaleID(), "CityWeaver" },
                { m_Setting.GetOptionTabLocaleID(Setting.kSection), m_Chinese ? "基础设置" : "General" },
                { m_Setting.GetOptionGroupLocaleID(Setting.kConnection), m_Chinese ? "连接状态" : "Connection status" },
                { m_Setting.GetOptionGroupLocaleID(Setting.kGeneral), m_Chinese ? "开发验证" : "Development check" },
                { m_Setting.GetOptionLabelLocaleID(nameof(Setting.BridgeStatus)), m_Chinese ? "桥接服务" : "Bridge service" },
                { m_Setting.GetOptionDescLocaleID(nameof(Setting.BridgeStatus)), m_Chinese ? "显示游戏内本机桥接服务是否正在运行。" : "Shows whether the in-game local bridge service is running." },
                { m_Setting.GetOptionLabelLocaleID(nameof(Setting.StartBridgeService)), m_Chinese ? "启动桥接服务" : "Start bridge service" },
                { m_Setting.GetOptionDescLocaleID(nameof(Setting.StartBridgeService)), m_Chinese ? "启动本机桥接服务并生成新的连接端点。" : "Start the local bridge service and create a new endpoint." },
                { m_Setting.GetOptionLabelLocaleID(nameof(Setting.StopBridgeService)), m_Chinese ? "停止桥接服务" : "Stop bridge service" },
                { m_Setting.GetOptionDescLocaleID(nameof(Setting.StopBridgeService)), m_Chinese ? "停止桥接服务并移除当前连接端点。" : "Stop the bridge service and remove its current endpoint." },
                { m_Setting.GetOptionLabelLocaleID(nameof(Setting.RestartBridgeService)), m_Chinese ? "重启桥接服务" : "Restart bridge service" },
                { m_Setting.GetOptionDescLocaleID(nameof(Setting.RestartBridgeService)), m_Chinese ? "停止后重新启动桥接服务，生成新的端口和认证令牌。" : "Restart the bridge service with a new port and authentication token." },
                { m_Setting.GetOptionLabelLocaleID(nameof(Setting.EnableTestMessage)), m_Chinese ? "启用测试消息" : "Enable test message" },
                { m_Setting.GetOptionDescLocaleID(nameof(Setting.EnableTestMessage)), m_Chinese ? "允许下方按钮写入一条模组日志。" : "Allow the button below to write a mod log message." },
                { m_Setting.GetOptionLabelLocaleID(nameof(Setting.WriteTestMessage)), m_Chinese ? "写入测试日志" : "Write test log" },
                { m_Setting.GetOptionDescLocaleID(nameof(Setting.WriteTestMessage)), m_Chinese ? "点击后检查模组日志，确认设置界面已连接。" : "Click and check the mod log to verify the settings UI is connected." }
            };
        }
        public void Unload() { }
    }
}
