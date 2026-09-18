# 调用、事务与诊断

## MCP 与 CLI

优先直接调用已连接的 MCP 工具并查看输入 schema。若只有终端，项目的 CLI 会启动同一个 STDIO MCP 服务，Node.js 需为 20 或以上，依赖由项目 `mcp/package-lock.json` 管理。

PowerShell 示例（仅查询）：

```powershell
Set-Location 'D:/Develop/game/CityWeaverMCP/mcp'
node ./query.mjs get_game_status
node ./query.mjs get_query_capabilities
node ./query.mjs query_buildings '{"building_type":"residential","limit":10}'
```

CLI 的业务结果在 `ok`、`meta`、`data`；检查错误包和退出码，不将启动成功当作查询成功。JSON 参数保持一个完整参数；不要把不可信游戏文本拼成 shell 源码。

未安装 Node 依赖时在 `mcp/` 执行 `npm ci`。不为普通使用自动构建、部署或重启游戏。游戏桥接凭据保存在用户 LocalLow 的 `ModsData/CityWeaver/bridge.json`；客户端自动读取，不能将文件中的令牌输出、提交或复制进技能。测试端点可通过 `CSII_BRIDGE_FILE` 指定。

需要完整工具 schema 时，可用已安装 MCP SDK 的 Client 执行 `listTools()`；源定义在 `mcp/server.mjs`，游戏路由在 `src/Core/GameQueryService.cs`。工具与游戏能力不一致时先处理版本差异，不把旧工具参数用于新操作。

## 事务工具对应关系

以下是主工作流；领域别名和最新参数仍以 schema 为准。不要凭命名规律发明工具。

| 对象 | 预览 | 状态 | 提交 | 取消 |
| --- | --- | --- | --- | --- |
| 道路/路口 | 对应 `preview_road_*` / `preview_intersection_*`，基础道路是 `preview_road` | `get_road_operation` | `build_road` | `cancel_road_preview` |
| 建筑 | 对应 `preview_building_*` | `get_building_operation` | `apply_building_operation` | `cancel_building_preview` |
| 地形 | `preview_terrain` | `get_terrain_operation` | `apply_terrain` | `cancel_terrain_preview` |
| 分区 | `preview_zoning` | `get_zoning_operation` | `apply_zoning` | `cancel_zoning_preview` |
| 财政 | `preview_tax_change` / `preview_service_budget` / `preview_service_fee` / `preview_loan_change` | `get_economy_operation` | `apply_economy_operation` | `cancel_economy_preview` |
| 地图格 | `preview_map_tile_purchase` | `get_map_tile_operation` | `apply_map_tile_purchase` | `cancel_map_tile_purchase` |
| 灾害 | `preview_disaster` | `get_disaster_operation` | `apply_disaster_operation` | `cancel_disaster_preview` |

行政区、公交线路、公交设施、公用设施、管网和景观可能复用领域或底层建筑/道路事务。先读对应指南，确认返回的 operation 类型和配套状态/提交工具，不按表中其他领域套用。

道路 CLI 辅助器支持基础道路、路线、升级与拆除的预览及轮询：

```text
node road-operation.mjs preview route.json
node road-operation.mjs status OPERATION_ID
node road-operation.mjs build OPERATION_ID COMMIT_REQUEST_ID MAX_COST
node road-operation.mjs cancel OPERATION_ID
```

`route.json` 应按目标工具 schema 写入实际发现的 prefab、坐标及请求 ID。该辅助器只按 `edge_id`、`road_prefab`、`points` 判断有限几种预览，不支持自动选择所有道路工具。其他工具使用 MCP 或 `query.mjs`。辅助器最多轮询约 25 秒；最终仍在处理中时继续查询原 operation，而非重新创建。

## 状态和验证

- 异步操作状态由返回对象的 **`state`** 字段指示（如 `queued` → `generating_preview` → `preview_ready` → `commit_queued` / `applying` → `completed`），切勿读取不存在的 `status` 字段。
- 轮询间隔可用约 0.5–1 秒，每轮等候保持有界。超出一轮等待时间只说明尚未得到终态，不能据此判断未应用。
- 提交调用（`apply_building_operation`、`apply_city_service_operation`、`build_road` 等）必须提供合法的 **`request_id`**（8..100 字符，符合正则 `^[A-Za-z0-9_-]+$`）以及 `operation_id`，否则会引发 `INVALID_ARGUMENT` 报错。
- 模拟速度控制使用 `set_simulation_speed`，其参数必须为全小写字符串枚举：`{ speed: "paused" | "normal" | "fast" | "fastest" }`，不得使用大写、数字或 `simulation_speed` 字段。
- 回读速度用 `get_game_status` 的 `paused` 与 `selected_speed`。**`selected_speed` 的数字不是枚举下标**：实测 `paused` = 0、`normal` = 1、`fast` = 2、`fastest` = **4**（跳过 3）。按 0/1/2/3 反推会把 `fastest` 读成 `fast`，导致脚本「还原」速度时静默降速。改过速度的脚本必须还原，`tools/lib/simulation-speed.mjs` 是这一映射在 tools 层的单一来源，并带离线断言。
- 原生工具切换防护：连续执行不同类型的写操作或预览时，若游戏保持完全暂停，游戏可能停留在上一工具状态报错 `TOOL_BUSY`。在切换工具间歇，可调用 `{ speed: "normal" }` 让游戏推进 200~500ms 后再次暂停，以促使原生系统安全释放并重置为 `DefaultToolSystem`。
- 提交前错误、锁定、资金不足、原值冲突需要处理原因。费用上限不可为绕过校验而随意放大。
- 成功后读回永久对象、位置、政策或金额；观察到的数量与 API 实体计数口径一致。网络拆分/合并、地形变化、灾害影响应按实际返回结果解释。
- 对用户报告已完成、部分完成、失败或结果未知，并提供足以继续查询的 operation ID；不把计划或预览写成已完成。

### MCP 关键参数规范与实战避坑

1. **`preview_road` 顶层端点参数**：单段道路输入必须为顶层的 `start: { x, z, node_id? }` 和 `end: { x, z, node_id? }`，多段道路输入必须为 `points: [...]` 数组。切勿嵌套包装成额外的内部对象。连接已有节点时提供 8 米范围内的 `node_id`。
2. **`preview_zoning` 参数名与主题精确绑定**：参数名必须是 `zone`（精确字符串）与 `edge_ids`（数组）。`zone` 必须通过 `list_zone_types` 获取（如欧洲风格使用 `"EU Residential Low"`），严禁使用泛型名称（如 `"Residential Low"`）。
3. **`max_cost` 事务预算保护**：所有需要预算的提交调用（`build_road`、`apply_city_service_operation` 等）必须提供不低于当前预览 `cost` 且不超过用户授权预算的 `max_cost`。费用或目标发生变化时重新预览，不要用固定倍数盲目放大预算。

## 错误处置

| 信号 | 下一步 |
| --- | --- |
| `BRIDGE_NOT_FOUND` / `GAME_UNAVAILABLE` | 检查游戏与模组是否运行；告知需要启动或重新加载的具体原因，不输出凭据 |
| `CITY_NOT_READY` | 等待已有加载完成，或说明需要加载城市；不擅自选择/覆盖存档 |
| `SNAPSHOT_EXPIRED` | 原筛选从第一页重新开始，丢弃旧快照分页状态 |
| `STALE_ENTITY` / 会话变化 | 重新发现对象与 ID，丢弃旧预览 |
| `BUSY` | 减少并发，有限重试；写操作保留请求身份 |
| `GAME_TIMEOUT` / 连接中断 | 查询连接及原事务/实际对象，防止重复应用 |
| `IDEMPOTENCY_CONFLICT` | 检查同一 ID 是否被用于不同参数，不用新 ID 绕过未知执行结果 |
| `*_CONFLICT` | 重新读取目标原值和其他更改，再决定是否重新预览 |
| `RESPONSE_TOO_LARGE` | 缩小实体 limit、组件数或 buffer_limit，按返回游标分页 |
| `outcome_unknown` | 停止提交，核验原事务及实际状态；无法判定则明确报告未知 |
| `GAME_REJECTED_BUILDING` | 原生引擎拒绝建筑落位。检查候选是否紧贴交叉路口（< 32 米）或路段过短。在脚本中执行候选列表的遍历回退（fallback）循环，尝试下一候选点 |
| `TOOL_BUSY` | 原生工具系统尚未重置。短暂恢复模拟速度（`normal` 推进 200~500ms）后重新暂停即可释放 |

## 验证与维护

- `npm test` 是本地协议、schema 和模拟桥接测试，不证明游戏运行正常。
- `node check-tool-parity.mjs` 读取实际游戏能力并比较 MCP 工具；游戏需运行，不修改城市。
- `smoke-*-live.mjs` 不一定只读，许多会建设、改资金或触发灾害。普通使用与技能验证不批量执行这些脚本；仅在用户授权相应实机测试范围时阅读并选择。
- 用户要求维护模组时，开发入口为 `src/Core/Mod.cs`、`src/Core/GameQueryService.cs`、各领域 `*Queries.cs`、`Mcp*ToolSystem.cs` 和 `mcp/server.mjs`。`build.ps1 -Stage` 仅暂存；普通 `build.ps1` 会部署并替换模组目录，且要求退出游戏。
- 技能入口源码位于项目 `skills/cities-skylines2`；完整工作流和领域指南位于 `docs`，个人目录中的同名技能是安装副本。更新时先维护仓库内容，再同步安装副本。新增功能更新功能地图；不要把历史工具总数当兼容性检查。
