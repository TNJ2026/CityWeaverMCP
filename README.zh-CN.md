# CityWeaver

简体中文 | [English](README.md)

CityWeaver 是《都市：天际线 II》的代码模组与本地 MCP 桥接项目，可查询、规划并建设实时城市。游戏模组在游戏内运行；独立的 Node.js STDIO MCP 服务负责连接 Agent。模组本身不调用大模型 API。

可选的 [cities-skylines2 技能](skills/cities-skylines2/SKILL.md)提供工具路由和操作约束。可将其安装到个人技能目录，并通过 `$cities-skylines2` 显式调用；但技能不能代替模组或 MCP 服务。完整工作流见[文档目录](docs/README.md)和 [MCP 指南](mcp/README.md)。可用工具清单以已连接服务运行时的 `tools/list` 为准，而不是 README 中的固定列表。

## 主要功能

| 分类 | 主要能力 | 指南 |
| --- | --- | --- |
| 实时城市查询 | 连接与会话状态、城市概览、实体查询、组件结构和详细数据读取 | [深层查询](docs/guides/inspection/DEEP-QUERY-GUIDE.md) |
| 规划与施工图 | 勘察已购土地、地形、水域和既有设施；渲染交互规划图，并区分规划、原生预览和永久施工 | [规划图](docs/guides/planning/PLANNING-MAP-GUIDE.md) |
| 道路与街区网格 | 预览和建设道路、路口、环路及连通网格；检查车道、交通、停车和道路分区格 | [道路](docs/guides/roads/ROAD-GUIDE.md) |
| 建筑与升级 | 实时发现 prefab、选址、预览、提交、回读永久实体，并管理支持的建筑附属区域 | [建筑](docs/guides/buildings/BUILDING-GUIDE.md) |
| 地图、行政区与分区 | 检查地图格和可建设土地；创建行政区，按道路侧分区格划区和验收 | [地图与区域](docs/guides/areas/MAP-AREA-GUIDE.md) · [分区](docs/guides/areas/ZONING-GUIDE.md) |
| 公共设施与管网 | 查询和连接供电、供水、污水等受支持的设施和网络 | [公共设施与管网](docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md) |
| 公共服务 | 为教育、医疗、应急、垃圾、殡葬、公园、邮政等受支持设施选址和管理 | [城市公共服务](docs/guides/city/CITY-SERVICE-GUIDE.md) |
| 公共交通 | 规划和管理线路、站点、车辆段、车站及受支持的铁路、地铁、电车与航道设施 | [线路](docs/guides/transport/TRANSPORT-GUIDE.md) · [基础设施](docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md) |
| 城市管理 | 读取需求、人口、就业、预算、政策、进度和经济数据，并执行受支持的管理操作 | [城市发展](docs/guides/city/DEVELOPMENT-GUIDE.md) · [经济](docs/guides/economy/ECONOMY-GUIDE.md) |
| 环境与灾害 | 勘察地形、资源、风、污染、天气和水域；查询和管理受支持的灾害工作流 | [环境](docs/guides/areas/ENVIRONMENT-LANDSCAPE-GUIDE.md) · [灾害](docs/guides/disasters/DISASTER-GUIDE.md) |

部分工具只读，另一些会修改城市并花费游戏内资金。可用性取决于已加载的游戏、解锁状态和运行时能力。施工须执行原生预览并回读永久结果；具体限制和实机验证状态见各指南。

## 快速开始

CityWeaver 目前尚未发布到 Paradox Mods。若从源码使用：

1. 安装《都市：天际线 II》官方代码模组工具链、.NET SDK 8 和 Node.js 20 或以上。保存城市并退出游戏，然后在仓库根目录运行 `./build.ps1 -Configuration Release`。该命令构建游戏模组并部署到游戏用户目录。`./build.ps1 -Stage` 只暂存构建产物，**不会**安装模组。
2. 在仓库根目录的 PowerShell 中安装 MCP 服务依赖，并注册到 Codex：

   ```powershell
   $mcpServer = Join-Path (Get-Location).Path 'mcp\server.mjs'
   npm --prefix .\mcp ci
   codex mcp add cities-skylines2 -- node $mcpServer
   ```

   使用其他支持 MCP 的客户端时，将 STDIO 服务命令设为 `node`，参数设为 `mcp/server.mjs` 的**绝对路径**。仅安装游戏模组不会自动安装此服务。
3. 启动游戏并加载可玩的城市，让 Agent 只读检查 CityWeaver 连接和游戏状态。如果看不到新工具，重启 MCP 连接或客户端。也可以在仓库根目录运行 `node .\mcp\query.mjs get_game_status` 检查本地桥接。

模组会自动生成并发现本地连接凭据。不要提交或分享 `bridge.json` 及其中的令牌。故障排查和更多命令见 [MCP 指南](mcp/README.md)。

## 提示词样例

将以下文字发给已连接 MCP 的 Agent。如果安装了可选技能，可在开头添加“使用 `$cities-skylines2` 技能”。坐标、道路、分区名称和建筑 prefab 应从当前城市实时发现，不要猜测。

**连接与只读状态**

> 使用 CityWeaver MCP 检查游戏连接、城市会话、地图主题、人口、资金和模拟速度。只读，不修改城市。

**城市诊断**

> 分析当前住宅、就业和商业需求，以及财政、医疗容量和最拥堵的道路。给出数据依据和修复优先级；先不要施工。

**规划图与网格预览**

> 仅在已购买区域内规划一个 2×3 的低密度住宅网格。检查地形、水域、既有道路、连接点和预算；生成施工图并执行原生预览。不要提交施工或购买地图格。

**公共服务选址**

> 根据当前人口、实时 prefab 和道路网络，为一座诊所寻找能连接道路的地点。检查完整占地和升级预留、费用、碰撞及服务覆盖。只展示候选和预览，等我确认后再建造。

**分阶段施工**

> 按已确认的施工图，在已购买区域分阶段建设道路和服务设施。每项修改都先执行原生预览，等待预览就绪，并检查费用、碰撞和错误；通过后提交，等待完成，再回读永久对象。遇到 failed、expired 或 outcome_unknown，立即停工并查询原操作，不要换 request_id 盲目重试。不要加钱或购买地图格。每阶段报告实际费用和剩余资金。

**只规划公交**

> 读取现有道路、住宅和就业位置，只规划公交站及往返线路，不建设轨道交通。先检查站点道路连接、线路可达性和预算，再展示预览及运营验收方法；暂不提交。

预览就绪、请求已提交或操作已完成，都不能证明城市的长期效果已经达成。人口、幸福度、污染和交通须在模拟运行后再次对比验证。详见[规划图指南](docs/guides/planning/PLANNING-MAP-GUIDE.md)和[调用、事务与诊断](docs/workflows/operations.md)。

## 项目组成

- `src/`：游戏端模组源码，涵盖查询、道路、建筑、分区、地图、交通、公用设施、公共服务、经济、人口、灾害和规划。见[源码目录](src/README.md)。
- `mcp/`：本地 Node.js STDIO MCP 服务、诊断工具和测试。见 [MCP 指南](mcp/README.md)。
- `tools/`：规划、空间勘察、网格部署、规则和测试工具。见[工具说明](tools/README.md)。
- `docs/`：详细工作流和功能指南，从[文档目录](docs/README.md)开始。
- `CityWeaver.csproj` 和 `build.ps1`：官方构建、后处理和部署流程。
- `Properties/`：Paradox Mods 发布元数据；见[发布指南](docs/workflows/publishing.md)。

规划工具可根据已购土地、水域、坡度和既有基础设施生成 SVG 或交互施工图。规划输出、原生预览与永久施工是三个不同阶段。MCP 服务还覆盖 prefab 发现、道路网格、分区、公共服务、公用设施、交通和多种只读城市诊断。具体要求与验收状态见各指南；构建或接口测试通过不等于实机放置已验证。

## 构建与验证

```powershell
.\build.ps1 -Configuration Release
# 游戏运行时只构建到 artifacts/staged，不部署：
.\build.ps1 -Stage
```

普通构建会运行官方 Mod Post Processor，并部署到 `%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\Mods\CityWeaver`。官方部署会替换该模组目录，所以源码应保留在其他位置。游戏运行时可能锁定 DLL；部署前先保存并退出游戏。

构建后启动或重启游戏，确认设置菜单出现 CityWeaver。加载城市后使用上面的只读连接提示词。自动化 MCP 测试运行 `npm --prefix .\mcp test`；实机检查见 [MCP 测试与诊断](mcp/README.md)。当前覆盖范围和已知实机验证缺口见[验证记录](docs/validation/VALIDATION.md)。

模组尚未发布到 Paradox Mods。准备发布时遵循[发布指南](docs/workflows/publishing.md)，并为独立 MCP 服务提供下载地址。
