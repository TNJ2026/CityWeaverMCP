# MCP 1.37.2 缺失依赖加载错误修复

游戏本体仍为1.6.2f1（767.21d1）[6300.26419]。错误窗口指出CityWeaverMCP缺少CityWeaver,Version=1.36.100.0；本地Mods/CityWeaverMCP实际为1.37.2，游戏日志也确认加载此旧程序集。该副本仍强引用独立直升机的兼容运行库，初始化时不能解析依赖，MCP桥接未启动。

用户保存并退出后，已移出完整旧目录并安装已发布的1.37.4正式包。此为本地正式安装，不是Paradox订阅安装。SDK订阅尝试在确认当前播放集前被本地检查阻止，未提交Subscribe；播放集和订阅配置保持不变。

- 来源：artifacts/publishing/CityWeaverMCP-1.37.4，已发布条目159998、平台5的冻结包。
- 旧版六文件移至artifacts/backups/mcp-load-repair-20261102-164034-732/old-local-CityWeaverMCP-1.37.2，逐一SHA256匹配。
- 新版四文件：CityWeaverMCP.dll、Windows Burst DLL、README及KNOWN-LIMITATIONS。全部与正式包哈希匹配，旧PDB及其他平台二进制随旧目录移出。
- 文件及程序集版本均为1.37.4.0；与通过依赖审计的暂存DLL逐字节一致。专项程序集检查通过：无CityWeaver/PassengerHelicopters强引用，通用持久化类型及可选管理API保留，无已移除模型或道路资源。
- 安装前再次备份当前播放集及最新城市存档，安装后播放集哈希不变。未修改直升机模组或线上发布资料。

当前仅完成安装及文件/依赖验证，尚待重新启动游戏，核对CityWeaverMCP1.37.4实际加载、桥接启动和城市连接；不据此宣称旧存档迁移已通过。

证据：artifacts/mcp-load-repair-installed-1.37.4-20261102.json、mcp-load-repair-1.37.4-plan-20261102.json、mcp-load-repair-1.37.4-dependency-test-20261102.log。安装程序：artifacts/mcp-load-repair-1.37.4/Apply-LocalRelease.ps1。
