# CityWeaver

简体中文 | [English](README.md)

CityWeaver 是《都市：天际线 II》的代码模组与本地 MCP 桥接项目，可查询、规划并建设实时城市。游戏模组在游戏内运行；独立的 Node.js STDIO MCP 服务负责连接 Agent。模组本身不调用大模型 API。

可选的 [cities-skylines2 技能](skills/cities-skylines2/SKILL.md)可供支持兼容技能的 Agent 客户端进行工具路由并遵守操作约束；英文 Agent 可先读[英文规划与施工指南](skills/cities-skylines2/references/planning-construction.en.md)。请按所用客户端的说明安装和调用（`$cities-skylines2` 只是一种调用示例）；技能不能代替模组或 MCP 服务。完整工作流见[文档目录](docs/README.md)和 [MCP 指南](mcp/README.md)。可用工具清单以已连接服务运行时的 `tools/list` 为准，而不是 README 中的固定列表。

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

玩家安装分为两部分：从 Paradox Mods 获取游戏模组，从本仓库获取独立的本地 MCP 服务。模组**目前尚未上架 Paradox Mods**；上架前，可先按下文[基于本项目开发](#基于本项目开发)的步骤构建游戏模组。上架后，凡 Agent 的工具能完成的 MCP 配置与检查，都可交给本地 Agent：

1. 在游戏的 Paradox Mods 界面订阅并启用 **CityWeaver**，如有提示则重启游戏，并加载可玩的城市。如果 Agent 能操作游戏界面，也可请它协助；否则由你完成这一部分。已发布模组仅安装游戏内桥接，不包含 MCP 服务或 AI 客户端，也**不需要**代码模组工具链或 .NET SDK。
2. 在有本机命令权限的 Agent 客户端中，发送下方的 [MCP 配置提示词](#提示词样例)。提供现有仓库路径，或请 Agent 获取 [CityWeaverMCP 仓库](https://github.com/TNJ2026/CityWeaverMCP)。让 Agent 检查或安装 Node.js 20 或以上版本、安装 MCP 依赖、定位 `mcp/server.mjs`，并配置名为 `cities-skylines2` 的本地 STDIO MCP 服务（命令为 `node`，唯一参数为脚本的**绝对路径**）。若 Agent 无法修改客户端设置或完成安装，应给出你仍需操作的准确步骤。手动配置时，在仓库根目录运行：

   ```powershell
   npm --prefix .\mcp ci
   (Resolve-Path .\mcp\server.mjs).Path
   ```

   具体设置界面或配置格式取决于客户端。例如使用 Codex 时：

   ```powershell
   $mcpServer = (Resolve-Path .\mcp\server.mjs).Path
   codex mcp add cities-skylines2 -- node $mcpServer
   ```

3. 向 Agent 发送下方的[连接提示词](#提示词样例)。让它在必要时重连或重启 MCP 客户端、发现实时工具、调用 `get_game_status`，并报告城市会话是否就绪。连接失败时发送[排障提示词](#提示词样例)；Agent 也可从仓库根目录执行 `node .\mcp\query.mjs get_game_status`，区分客户端配置问题与游戏桥接问题。只有 Agent 无法自行完成的操作才需要你接手。

模组会自动生成并发现本地连接凭据。不要提交或分享 `bridge.json` 及其中的令牌。故障排查和更多命令见 [MCP 指南](mcp/README.md)。

## 提示词样例

前三段提示词也可以在尚未连接 MCP 时使用。将 `<项目路径>` 替换为本机仓库路径，或让 Agent 根据上方链接获取仓库。服务采用 STDIO：Agent 客户端建立 MCP 连接时会启动 `node`，无需单独在后台运行 `node mcp/server.mjs`。如果安装了可选技能，可在开头添加“使用 `$cities-skylines2` 技能”。坐标、道路、分区名称和建筑 prefab 应从当前城市实时发现，不要猜测。

**配置并启动 MCP 服务**

> 这台 Windows 电脑上的 CityWeaverMCP 仓库位于 `<项目路径>`；如果尚不存在，请从 https://github.com/TNJ2026/CityWeaverMCP 获取到新的可写目录，不要覆盖现有文件。检查是否安装 Node.js 20 或以上版本；若当前环境允许，请安装，否则告诉我需要完成的操作。如有需要，在仓库根目录执行 `npm --prefix .\mcp ci` 安装 MCP 依赖，并取得 `mcp/server.mjs` 的绝对路径。将本 Agent 客户端配置为启动名为 `cities-skylines2` 的本地 STDIO MCP 服务：命令为 `node`，唯一参数为该脚本的绝对路径。如果你无法修改客户端的 MCP 设置，请给我需要填写的准确配置值。必要时重连或重启 MCP 客户端。不要构建或重新部署游戏模组、修改城市，也不要输出连接令牌。

**连接游戏**

> 连接已配置的 `cities-skylines2` MCP 服务，发现当前可用工具，然后调用 `get_game_status`。确认游戏桥接可访问且已加载可玩的城市会话，报告城市名称和会话状态。如果缺少 MCP 工具，请说明是否需要重连 MCP 或重启客户端。只读，不修改城市。

**排查 MCP 连接故障**

> 在不修改城市的前提下，排查这台 Windows 电脑上的 CityWeaver MCP 连接。依次检查：Node.js 版本及配置的 `node` 命令；`mcp/server.mjs` 的绝对路径和依赖是否已安装；Agent 客户端是否确实启动了 STDIO 服务并显示其工具；从仓库根目录执行 `node .\mcp\query.mjs get_game_status`；游戏是否启用 CityWeaver 模组并加载城市；本地 `bridge.json` 文件是否存在。不要显示或分享文件内容及令牌。区分 MCP 配置或启动错误、游戏桥接错误和城市尚未就绪，给出证据与最小安全修复方案；重新构建或部署模组前先询问我。

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

## 基于本项目开发

如要修改游戏模组代码，请从本仓库的源码工作副本开始，安装《都市：天际线 II》官方代码模组工具链、.NET SDK 8，以及官方后处理器需要的 .NET 6 运行时。这些开发依赖对于通过 Paradox Mods 安装已发布模组的玩家**不是必需的**。开发 MCP 服务及运行测试还需要 Node.js 20 或以上。

游戏端代码在 `src/`，本地服务代码在 `mcp/`；修改工具行为前请先查阅对应指南。仅修改 MCP 服务不需要重新构建游戏模组。

部署本地构建前先保存城市并退出游戏。不要同时启用 Paradox Mods 下载的 CityWeaver 和本地部署的 CityWeaver。

```powershell
.\build.ps1 -Configuration Release
# 游戏运行时只构建到 artifacts/staged，不部署：
.\build.ps1 -Stage
```

普通构建会运行官方 Mod Post Processor，并部署到 `%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\Mods\CityWeaver`。官方部署会替换该模组目录，所以源码应保留在其他位置。游戏运行时可能锁定 DLL；部署前先保存并退出游戏。

构建后启动或重启游戏，确认设置菜单出现 CityWeaver。加载城市后使用上面的只读连接提示词。运行 MCP 自动化测试前先执行 `npm --prefix .\mcp ci`，再运行 `npm --prefix .\mcp test`；实机检查见 [MCP 测试与诊断](mcp/README.md)。当前覆盖范围和已知实机验证缺口见[验证记录](docs/validation/VALIDATION.md)。

模组尚未发布到 Paradox Mods。准备发布时遵循[发布指南](docs/workflows/publishing.md)，并为独立 MCP 服务提供下载地址。
