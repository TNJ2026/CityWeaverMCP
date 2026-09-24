# CityWeaver 架构与功能实现

本文面向维护者，描述当前源码的职责分层、请求如何进入游戏，以及主要功能在哪里实现。它不是工具参数手册；参数和可用性以运行时 MCP `tools/list`、`get_query_capabilities` 及各领域指南为准。

## 一张图看懂

```text
Agent / MCP 客户端
    │ MCP over STDIO
    ▼
mcp/server.mjs（Node.js，独立进程）
    ├─ 工具 schema、参数校验和结果封装
    ├─ 规划图、缓存、分阶段施工等高层编排
    └─ mcp/bridge-client.mjs
          │ 带随机令牌的本机 TCP；一行 JSON 请求/响应
          ▼
游戏进程中的 CityWeaver 模组
    ├─ src/Core/LocalQueryBridge.cs：认证、限流、主线程排队
    ├─ src/Core/GameQueryService.cs：会话、能力、工具分发
    └─ src/<领域>/*Queries.cs / Mcp*ToolSystem.cs
          │ 游戏系统、原生 Tool 流程和 Unity ECS
          ▼
Cities: Skylines II 的城市数据与模拟
```

Paradox Mods 包只安装游戏内模组；`mcp/` 中的 STDIO 服务须从仓库另行安装依赖，并由 MCP 客户端启动。模组本身不运行 AI 模型，也不提供对外公开的 MCP 端口。[玩家安装步骤](../README.zh-CN.md#快速开始)与[本地连接细节](../mcp/README.md)另有说明。

## 组件与边界

| 层 | 主要入口 | 职责 | 不负责 |
| --- | --- | --- | --- |
| 游戏内模组 | [`src/Core/Mod.cs`](../src/Core/Mod.cs)、[`src/Core/LocalQueryBridge.cs`](../src/Core/LocalQueryBridge.cs) | 随游戏加载，注册更新系统，监听本机动态端口，将请求交给游戏主线程 | MCP 握手、Agent 推理、跨机器服务 |
| 游戏查询/施工层 | [`src/Core/GameQueryService.cs`](../src/Core/GameQueryService.cs) 及各领域 `*Queries.cs`、`Mcp*ToolSystem.cs` | 会话检查、原生对象读取、预览/提交、永久对象回读 | 把所有游戏内部能力包装成稳定的官方 API |
| MCP 协议层 | [`mcp/server.mjs`](../mcp/server.mjs)、[`mcp/bridge-client.mjs`](../mcp/bridge-client.mjs) | STDIO 工具注册、Zod schema、连接凭据读取、错误和结构化结果转发 | 直接访问 Unity ECS 或游戏进程内存 |
| 高层工作流 | `mcp/*workflow*.mjs`、`mcp/planning-*.mjs`、`tools/deploy-district.mjs` | 组合底层工具，生成规划、排序候选、分批施工和验收 | 为跨领域的多次提交提供原子回滚 |
| 使用指导 | [`skills/cities-skylines2`](../skills/cities-skylines2/SKILL.md)、[`docs/guides`](guides)、[`docs/workflows`](workflows) | 为 Agent 和人说明选工具、物理约束及安全流程 | 替代运行时 schema、游戏原生校验或实机验证 |

### 一次请求的路径

1. MCP 客户端启动 `node <仓库绝对路径>/mcp/server.mjs`，通过 STDIO 发现和调用工具。`server.mjs` 校验输入；简单工具转发给 `queryGame`，规划/批量工具先在 Node 层编排。
2. `bridge-client.mjs` 从用户 LocalLow 下的 `ModsData/CityWeaver/bridge.json` 读取当前端口和令牌，只连接 `127.0.0.1`。每个连接发送一条带 `protocol_version`、`token`、`tool`、`arguments` 的 JSON 请求。该文件是连接凭据，不能提交或分享。
3. `LocalQueryBridge` 在网络线程完成认证、大小限制和排队，不在网络线程访问 ECS。主线程 dispatcher 的 `Pump()` 调用 `GameQueryService.Execute()`；即使模拟暂停，也能处理请求。
4. `GameQueryService` 检查城市是否就绪，将请求分发到相应领域，返回 `ok`、`meta`、`data` 或明确错误。`meta.session_id` 在重新加载城市时变化；实体 ID 和操作日志不得跨会话复用。
5. MCP 层将结果作为结构化工具响应返回。游戏内的 `completed` 是某次事务应用完成；人口、交通、生产等长期结果还需恢复模拟后另行观察。

这里的“调用游戏接口”不是一对一转调官方外部 API：模组在游戏进程内调用游戏系统、读取 ECS 组件，并按功能接入原生 Tool 管线；某些功能还有自行实现的预检或实体构造。

## 主要功能如何实现

| 功能域 | 游戏内实现 | MCP / 高层实现 | 关键边界 |
| --- | --- | --- | --- |
| 连接、状态和深层查询 | `Core/GameQueryService.cs`、`Inspection/` 读取实体、组件、系统及环境数据 | `bridge-client.mjs` 转发；`server.mjs` 提供 schema | 原始字段保留游戏单位；分页、快照和会话 ID 有有效期 |
| 道路、路口、航道及管线 | `Roads/RoadQueries.cs`、`Roads/McpRoadToolSystem.cs`；相关领域复用道路 Tool | `grid-preview-workflow.mjs`、`grid-construction-workflow.mjs`、`tools/deploy-district.mjs` | 原生临时实体、碰撞和费用校验后再 apply；建成后回读永久拓扑 |
| 建筑、升级和附属区域 | `Buildings/BuildingQueries.cs`、`McpBuildingToolSystem.cs`、`McpBuildingAreaToolSystem.cs` | `building-workflow.mjs` 负责候选、预览和逐项部署 | 建筑靠近道路不等于绑定道路；须验永久 `m_RoadEdge` 等条件 |
| 分区、行政区、地图格及地形 | `Areas/`、`Environment/` 与各自 Tool/operation | 网格和城市规划模块编排 | 并非每一种“预览”都使用相同原生临时管线；地形预览的语义需看专门指南 |
| 公共服务、公用设施和输送网络 | `Services/` | `city-workflows.mjs`、`infrastructure-workflows.mjs`、`utility-connection-workflow.mjs` | 设施完工还须验道路和真实管网连接、容量与模拟效果 |
| 公共交通、轨道、航道和捕鱼路线 | `Transport/` 的查询类与线路 Tool；`WorkRouteQueries.cs` | MCP 暴露发现、预览、提交、删除及分阶段交通走廊 | 捕鱼路线预览是保守水域/owner/船型预检，不是原生线路临时预览；建后验寻路和派船 |
| 城市、经济、人口、进度、灾害 | `City/`、`Economy/`、`Population/`、`Progression/`、`Disasters/` | MCP schema 与领域工具转发 | 有些是直接设置或事件触发，不应套用道路的费用/预览语义 |
| 地图快照、规划图与镜头 | `Planning/` 提供游戏地物、镜头和画面数据 | `planning-proposer.mjs`、`planning-renderer.mjs`、`planning-session.mjs` 等生成和绑定方案 | HTML/SVG 规划图不是游戏对象；需最终位置原生预览和施工回读 |

源码按领域拆分，但 `GameQueryService` 使用 C# `partial` 类统一分发。Node 侧并非所有工具都发往游戏：`render_city_plan`、`propose_city_plan`、`deploy_grid_district` 等会先读地图或调用多个底层工具，再返回一个高层结果。新增工具时应同时检查 MCP schema、游戏路由、`get_query_capabilities` 和相关指南，避免“能调用但发现列表遗漏”。

### 规划到施工的状态边界

```text
地图/地形/水域/现有设施读取
    → 概念规划与 HTML/SVG 施工图
    → 精确 prefab、坐标、连接点绑定
    → 最终位置的预览和费用/错误检查
    → 提交并等待 operation=completed
    → 永久对象、连接和模拟效果回读
```

规划图按全地图坐标绘制，可将方案几何映射到道路/建筑等建设请求；它本身不保证游戏接受。道路、建筑、设施等尽可能走各自的原生预览与应用流程。高层工作流逐批串行执行，遇到 `failed`、`expired` 或 `outcome_unknown` 应停下并查询原操作与永久对象，不用新 `request_id` 盲重试。事务没有跨领域自动回滚。详细状态机与错误处理见[调用、事务与诊断](workflows/operations.md)。

`mcp/planning-store.mjs` 将不可变规划/快照/证据及可更新施工日志保存在 `artifacts/planning-store/`（可由 `CITYWEAVER_PLANNING_STORE` 指向其他目录）。它跨 STDIO 进程保存施工进度，但规划快照不是游戏修订号；真正施工仍需检查当前会话和现场状态。[规划图指南](guides/planning/PLANNING-MAP-GUIDE.md)说明图层、绑定与可视化。

## 安全、版本和验证

- 传输仅限本机环回地址；模组启动时生成随机令牌和动态端口。令牌只用于本机桥接，不属于 MCP 工具参数。MCP Server 不应暴露该令牌。
- `mcp/server.mjs` 负责输入 schema；游戏侧还会复核会话、解锁、对象状态和具体施工条件。不要仅凭客户端校验推断游戏操作安全。
- 当前模组版本看 `CityWeaver.csproj`、桥接状态及 `Properties/PublishConfiguration.xml`；MCP 包版本看 `mcp/package.json`。协议和工具清单应以当前运行中的 `tools/list`、`get_query_capabilities` 为准。
- `npm --prefix ./mcp test` 验证 MCP 协议、schema 和工作流模拟测试；`./build.ps1 -Stage` 运行游戏模组编译及官方后处理，但两者均不能替代游戏内实测。保存并退出游戏后才用普通 `./build.ps1` 部署本地模组；不要同时启用 Paradox Mods 与本地副本。
- 发布包只包含游戏端模组；GitHub 仓库提供独立 MCP Server 的源码和安装说明。版本发布流程见[发布指南](workflows/publishing.md)。

如需理解某一工具的精确参数和验收规则，从[文档目录](README.md)进入该领域指南；如需扩展新功能，先确认它属于游戏内原生事务、ECS 直接操作，还是 Node 侧高层编排，再分别补充实现和测试。
