# CityWeaver 1.37.5 更新准备

2026-11-03 将游戏内桥接候选版本从 1.37.4 更新为 1.37.5。Node.js STDIO 服务没有运行时代码变更，版本保持 1.36.12。Paradox Mods 配置继续使用既有条目 159998、CityWeaver 名称、Public 访问级别和游戏兼容字段 1.6.2*；本轮没有调用发布器、上传新版本或修改线上条目。

本次候选版清理已停用公交模型遗留的资产准备脚本、专用测试、说明和本地验证产物。通用车辆导入替换、配色、动画、线路车型引用及存档恢复接口保留。仓库源码、文档、产物和二进制经过严格标识扫描，残留匹配为 0。

验证结果：

- `npm --prefix .\mcp test`：221 项通过，0 失败，0 跳过。
- `.\build.ps1 -Configuration Release -Stage`：0 警告，0 错误。
- `.\tools\check-publish.ps1 -RequireStagedBuild -UpdateVersion`：通过，确认发布、项目、桥接及暂存程序集版本均为 1.37.5。
- 暂存入口 `artifacts/staged/CityWeaverMCP/CityWeaverMCP.dll`：程序集和文件版本 1.37.5.0，SHA-256 `5D5BD37632F64CD77B6931C138A7C623EC9881C7DF1D947FB1B137CE6706FD27`。
- 本机安装目录 `C:\Users\sc\AppData\LocalLow\Colossal Order\Cities Skylines II\Mods\CityWeaverMCP`：Release 产物 6 个文件逐项哈希一致，程序集和文件版本均为 1.37.5.0。
- 回退备份：`artifacts/backups/CityWeaverMCP-before-1.37.5-20261103-125404`，包含 6 个 1.37.4.0 文件。
- 游戏 1.6.2f1 正常载入 `Springfield City`；`Modding.log` 确认 `CityWeaverMCP, Version=1.37.5.0`，模组日志确认回环桥启动且收到首个模拟更新。
- MCP 实时验收：`get_game_status`、`get_query_capabilities`、`get_city_summary`、`get_city_economy` 均成功；桥接版本 1.37.5，城市和地图已载入。验收结束后模拟速度设为暂停。
- 当前 `Logs/*.log` 未发现 `ERROR`、`FATAL` 或 `Exception`。
- 隔离回归：禁用线上 `Transport Fever 3 Helicopters / 狂热运输3直升机客运` 后重新启动；`Modding.log` 仅加载本地 `CityWeaverMCP 1.37.5.0`，未加载 `CityWeaver 1.36.100.0`、`PassengerHelicopters` 或缓存包 `165769_7`。新会话发现 391 个 MCP 工具及 1236 个组件类型，城市状态、配置、概览和经济查询全部成功，验收结束后保持暂停。

当前已完成源码、资料、自动测试、暂存包、本机安装及现有存档的基础载入验收。尚未更新订阅版本或线上条目；发布前仍需退出游戏，复核待上传包内容，并在明确发布时使用 `PublishNewVersion`。
