# CitiesSkylines2Mod

Agent 使用技能：[cities-skylines2](skills/cities-skylines2/SKILL.md)，负责功能路由和核心操作约束；完整指南与城市工作流统一维护在 [docs](docs/README.md)。技能目录可放入个人技能目录；本机已安装至 `C:/Users/cheng/.codex/skills/cities-skylines2`，可通过 `$cities-skylines2` 显式使用。维护时先更新仓库文档和技能入口，再同步安装副本。

使用本机官方 `csiimod` 模板创建的《都市：天际线 II》最小代码模组。

已扩展 MCP 查询与道路操作桥接，使用方式、数据口径及测试命令见 [MCP 开发说明](mcp/README.md)。
0.2.0 增加组件发现、29 类实体查询、通用字段和缓冲区读取，详见 [扩展查询指南](mcp/QUERY-GUIDE.md)。
0.3.2 增加私有字段、原生容器、系统状态和环境栅格查询，详见 [深层查询指南](docs/guides/inspection/DEEP-QUERY-GUIDE.md)。15 个环境图层和 30 个私有原生字段已通过实际游戏验证；其余覆盖边界见 [验证记录](docs/validation/VALIDATION.md)。
MCP 工具清单以运行时 `tools/list` 为准。规划工具可基于当前已购区域、水域、坡度和既有设施生成 SVG/交互规划图，并把只读方案、道路原生预检和永久施工分开，见 [城市规划图指南](docs/guides/planning/PLANNING-MAP-GUIDE.md)。建筑附属区域现可列出、创建、重画和删除垃圾填埋场储存区、专门产业采集区及其他 prefab 允许的区域，详见 [建筑附属区域指南](docs/guides/buildings/BUILDING-AREA-GUIDE.md)。新增统一建筑工作流，可对普通建筑、市政服务、交通设施和公用设施执行精确 prefab 发现、候选回退、原生预览、影响分析、提交及实体回读；支持单栋“先规划后执行”和最多 32 栋的一次性部署，见 [建筑指南](docs/guides/buildings/BUILDING-GUIDE.md)。灾害接口支持原生预设发现、应急能力、预览/触发、移动、强度与持续时间调节、停止、影响追踪和灾后标记清理，见 [灾害指南](docs/guides/disasters/DISASTER-GUIDE.md)。城市名称、配置、全市政策、资金、城市修正值和统计历史见 [城市管理指南](docs/guides/city/CITY-MANAGEMENT-GUIDE.md)。树木、植物、水源、污染、天气覆盖、风场和土壤水见 [环境与景观指南](docs/guides/areas/ENVIRONMENT-LANDSCAPE-GUIDE.md)。地图格、地图边界、气候、资源、可建设面积、扩张购买以及与行政区/分区/地形的整合见 [地图和区域指南](docs/guides/areas/MAP-AREA-GUIDE.md)。车辆、行人、市民行程、道路流量、停车、目标、速度、重寻路与车辆清理见 [交通与出行控制指南](docs/guides/roads/TRAFFIC-MOBILITY-GUIDE.md)。道路接口覆盖直线与贝塞尔路线、平行道路、环路、自动接入既有道路的分级街区网格、地形/建筑避障、地面/高架/隧道/坡道、四匝道分离式立交、道路升级/拆除/反向、道路分区格生成、原生停车道路变体、道路装饰、路口与入口规则、道路名/限速/公交专用车道策略、车道和交通读取，以及会话内安全撤销，见 [铺路指南](docs/guides/roads/ROAD-GUIDE.md)。土地分区支持逐格读取、左右侧与深度筛选、批量划区、替换和清除，见 [分区指南](docs/guides/areas/ZONING-GUIDE.md)。行政区支持创建、重画边界、删除、命名、政策与市政服务覆盖范围，见 [行政区指南](docs/guides/areas/DISTRICT-GUIDE.md)。公共交通支持线路创建、站序替换、命名、颜色、班表、票价、车辆数、编号、均匀发车、车辆请求、运营车辆返场、状态读取和删除，见 [公共交通线路指南](docs/guides/transport/TRANSPORT-GUIDE.md)；车站、车辆段、机场、港口支持命名、启停、政策、升级和完整建筑事务，火车/地铁/电车轨道支持建设和拆除，见 [公共交通基础设施指南](docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md)。电力、供水、污水、资源管道以及公共设施的查询、选址、放置、移动、升级和拆除见 [公共设施与管网指南](docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md)。医疗、消防、警察、教育、垃圾、殡葬、维护、公园、邮政、停车、福利、研究和应急设施的查询与完整建筑事务见 [城市公共服务设施指南](docs/guides/city/CITY-SERVICE-GUIDE.md)。城市收支、税率、服务预算、服务费与贷款见 [城市经济管理指南](docs/guides/economy/ECONOMY-GUIDE.md)。人口、住房、就业、教育与分区需求见 [城市发展与需求指南](docs/guides/city/DEVELOPMENT-GUIDE.md)。XP、里程碑、发展树和原生解锁操作见 [城市进度与解锁指南](docs/guides/city/PROGRESSION-GUIDE.md)。市民、家庭、企业和资源物流见 [人口与资源经济指南](docs/guides/economy/POPULATION-ECONOMY-GUIDE.md)。完整文档索引见 [文档目录](docs/README.md)。

## 当前功能

- `src/Core`：模组入口、设置、启动系统、本地桥接和基础查询服务。
- `src/Inspection`：通用实体查询、组件结构、系统状态和深层数据读取。
- `src/Buildings`、`src/Roads`、`src/Areas`：建筑、道路、行政区、分区和地图操作。
- `src/Environment`、`src/Transport`、`src/Services`：地形环境、公共交通、公共服务和公用设施。
- `src/City`、`src/Economy`、`src/Population`、`src/Progression`、`src/Disasters`：城市管理、经济人口、进度和灾害。
- [`src/README.md`](src/README.md)：完整源码目录职责说明。
- `mcp/`：Node.js STDIO MCP 服务、诊断工具和自动测试。
- [`tools/`](tools/README.md)：空间勘察、批量街区部署、启动器辅助、规则库和测试工具。
- `CitiesSkylines2Mod.csproj`：保留官方引用、源码生成器和后处理构建流程。
- `Properties/`：官方发布模板；其中描述、游戏版本等仍为占位配置，发布前需填写。

## 本机环境（2026-09-13 检查）

| 项目 | 检查结果 |
| --- | --- |
| 游戏路径 | `E:\SteamLibrary\steamapps\common\Cities Skylines II` |
| 游戏用户数据记录的版本 | `1.6.0f1 (419.d6c6) [6216.19404]` |
| .NET SDK | `8.0.425` |
| 模组目标框架 / C# | `net48` / `9.0`，由官方 Mod.props 决定 |
| 工具链 Unity / Entities | `2022.3.62f2` / `1.3.10` |
| 官方后处理器运行时 | `.NET 6` |

官方工程读取用户级 `CSII_*` 环境变量，当前已正确指向 E 盘游戏；无需修改共享 Mod.props。

本机系统缺少 .NET 6。已将微软 .NET Runtime 6.0.36 x64 解压到 `.tools/dotnet`，并按微软发布元数据的 SHA-512 校验。
下载来源和哈希保存在 `.tools/runtime-source.json`。`.tools` 为本机工具目录，不纳入版本控制。
`build.ps1` 仅在构建期间设置进程内 DOTNET_ROOT / DOTNET_ROOT_X64，完成后恢复。
在其他电脑上需要先安装游戏官方工具链、.NET SDK，以及后处理器所需的 .NET 6 运行时；本机私有运行时不会随源码传递。

## 构建

在本目录运行：

```powershell
.\build.ps1
# 或
.\build.ps1 -Configuration Release
# 游戏运行时，只生成暂存产物
.\build.ps1 -Stage
```

构建会自动运行官方 Mod Post Processor，然后部署到：

```text
%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\Mods\CitiesSkylines2Mod
```

官方部署目标会替换该模组部署目录，因此请将源码保留在本项目中。

## 游戏内验收

1. 构建后启动或重启游戏，查看设置菜单中是否出现 CitiesSkylines2Mod。
2. 保持“启用测试消息”开启，点击“写入测试日志”。
3. 新建测试城市或加载测试存档，开始模拟。
4. 检查用户数据目录下的 `Logs`，应能找到加载消息、`settings button works` 和 `StarterSystem received its first simulation update`。
5. 关闭测试消息开关，再点击按钮应不产生测试消息；重启后检查开关是否保存。

基础版本已通过游戏内加载、设置按钮和模拟回调验证。设置持久化尚未专项验证。
MCP 版本已通过暂存构建与官方后处理（0 警告、0 错误），以及 8 项通信/MCP 自动测试。
MCP 版本已通过主菜单及暂停城市中的真实查询、建筑分页和实体详情联调，具体记录见 `docs/validation/VALIDATION.md`。尚未发布到 Paradox Mods。
0.2.0 已在真实城市中验证通用查询：目录发现 1229 种类型，878 种有实例的类型成功抽样（部分嵌套原生数据明确标记不支持），349 种无实例，Deleted/Temp 按设计排除。详细数据口径和验证边界见 MCP 文档。

## 参考

- [官方代码模组开发说明](https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-3-code-modding)
- [官方工具链 Wiki](https://cs2.paradoxwikis.com/Modding_Toolchain)
- [社区入门指南](https://github.com/ps1ke/Cities-Skylines-2-Modding-Guide/blob/origin/gh-pages/README.md)
- [社区 API 索引](https://ps1ke.github.io/Cities-Skylines-2-Modding-Guide/)

社区示例仅作参考，接口以本机游戏程序集和实际构建结果为准。





