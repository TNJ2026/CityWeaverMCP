# 高效建设与增长循环

本指南对应项目脚本 `tools/deploy-district.mjs`、`tools/survey-space.mjs`。它优化 MCP 往返和建设批次，不修改游戏内部时间倍率，也不绕过原生 preview 校验。

## 快速选址

```powershell
node tools/survey-space.mjs --auto-find residential --anchor -1138,528 --mode quick
```

`quick` 模式并发读取地块、地形、风和污染，但不分页扫描全城建筑；报告会显示 `UNVERIFIED`。把候选点交给道路或建筑原生 preview 后，才能确认没有实体碰撞。首次选址、复杂旧城或需要列出冲突建筑时使用 `--mode full`。

## 领域高层编排

当一次请求跨越多个建设阶段时，使用 MCP 高层工具而不是在客户端并发拼接底层调用：

- `deploy_service_cluster`：按服务建筑逐项完成影响分析、选址、原生预览、提交和回读，可将完成的设施分配到指定行政区。
- `deploy_industrial_campus`：先建工业网格，再建可选工业建筑，最后为已建成 owner 创建填埋储存区或专门产业采集区；区域 prefab 必须来自 `list_building_areas`。
- `deploy_transit_corridor`：先放交通设施，再创建轨道，最后按真实 `stop_ids` 创建线路。

三个工具都保持写事务串行，返回 `phases` 和费用。某阶段 `failed`、`cancelled`、`expired` 或 `outcome_unknown` 时停止后续阶段；未知结果只能查询原 operation，不能换新的 `request_id` 盲目重试。它们不执行跨领域自动拆除或退款回滚，恢复速度只在流程结束时按 `resume_speed` 处理。

### 基础设施与拥堵高层流程

- `build_utility_backbone` 接受 `connections` 和 `segments`。前者按设施真实端口、`connection_layers` 和候选目标调用 `connect_utility_facility`；后者按 `preview_utility_network` → `apply_utility_operation` 建设明确的管线段。连接完成后才进入下一段，费用按连接/段/总额限制累计。
- `repair_congested_corridor` 先调用 `analyze_road_traffic`。`strategy=upgrade` 在 2–64 条不重复道路且目标 prefab 相同的情况下合并为一次原生批量升级，`parallel` 使用避障平行道路，`reroute` 使用带起终点的单条自动路径，`auto` 只处理明确标记为 `upgrade_or_parallel_relief` 的瓶颈，跳过 `keep` 和 `monitor_or_optimize_intersection`。每个动作都经过道路原生预览和 `build_road`，不会清车、拆路或自动回滚。

两个工具都返回逐阶段 `phases`、原生 `operation_id` 和费用；每段开始前校验城市会话仍未变化，接驳会把 `max_total_cost` 的剩余额度传给底层提交。失败或 `outcome_unknown` 会停止后续写入。重复相同 `request_id` 与参数返回缓存结果，不同参数会报幂等冲突。

## 一次批量建设

### 先规划或预检但不施工

用户尚未授权永久建设时，不要直接调用 `deploy_grid_district`：

1. `propose_grid_plan` 在当前已购区域内结合道路、建筑、水域和坡度选择候选，并绑定实时道路 prefab、城市主题和分区类型。
2. `render_city_plan` 只生成 SVG/交互规划图，不创建游戏临时实体。
3. 需要验证游戏能否接受道路几何时，调用 `prepare_grid_native_preview`。它只创建并轮询道路临时 preview，返回真实费用、警告、错误、过期时间和取消动作；不提交道路、不预览分区。
4. 分区 preview 不能与这一步并行：必须等道路经另一次明确施工授权永久落地并返回真实 edge ID，才能调用 `preview_zoning`。

授权施工后优先调用 `advance_grid_construction`，并沿用每一步返回的 `next_action`：`commit_roads` 提交已有道路预览并回读永久 edge ID，`preview_zoning` 检查实际 Zone Cells 后只生成分区预览，`apply_zoning` 再单独提交。这样可在每个不可逆阶段之间停下来复核；失败或结果未知不会继续，也不会自动拆除已完成道路。

规划图通过、道路 preview_ready 都不表示已建成。修改方案时先取消旧预览，再用新的 `request_id` 创建新预览；同一方案重试则复用原 `request_id`。

### MCP 高层工具

需要由提示词直接指定 `N×N` 和道路类型时，可以使用 `deploy_grid_district`，不必让客户端自己串联多个底层工具。调用必须提供稳定 `request_id`。安全默认 `approval_mode="staged"` 只创建并返回道路原生预览、取消动作和 `advance_grid_construction` 下一步，不产生永久对象；只有用户已明确授权“预览通过后自动连续提交”时，才能显式使用 `approval_mode="automatic"`。

```json
{
  "request_id": "west-homes-grid-001",
  "approval_mode": "staged",
  "origin": { "x": -2000, "z": 544 },
  "columns": 3,
  "rows": 3,
  "road_prefab": "<精确内部道路 prefab>",
  "horizontal_road_prefab": "<精确同宽横向道路 prefab>",
  "vertical_road_prefab": "<精确同宽纵向道路 prefab>",
  "perimeter_road_prefab": "<精确外围道路 prefab>",
  "connection_road_prefab": "<精确接驳道路 prefab>",
  "auto_connect": true,
  "zone_type": "Exact Live Residential Zone",
  "survey_mode": "quick"
}
```

调用前先用 `list_road_prefabs`、`list_zone_types` 和 `list_building_prefabs` 发现当前城市的精确名称；尖括号内容必须替换，不能作为实际参数。该高层工具返回网格、连接道路、分区、建筑和增长循环的汇总；底层 operation 仍按各自领域轮询至 `completed`。`staged` 只授权网格道路预览；即使请求中带有连接路、建筑或增长循环，它们也会以 `deferred_phases` 返回，不能由 `advance_grid_construction` 隐式执行。

多个网格可以依次部署，但不能并行，也不能让相邻网格重复生成同一条外围道路。规划阶段应先把规则单元保存到同一结构化方案的 `plan.grids[]`；环路、主干道、绿带断路、局部延伸或不等距道路保留在 `plan.roads[]`。规则道路组满足一次原生网格条件却仍被逐路展开时，规划校验会报错；不能无损转换时必须在 `plan.grid_exceptions[]` 记录原因。若外围朝外侧不得划区，省略 `zone_type`，道路完成后按永久 edge ID、正确道路侧和实际 Zone Cells 单独走分区预览。

### 网格道路宽度规则

- 一个网格开发单元的内部横向和纵向道路应优先使用同一道路 prefab；至少必须保持相同的实际道路宽度。若因公交、停车或绿化需要使用不同变体，也只能选用同宽变体，并在原生预览后核对车道和分区格。
- 内部道路从一个网格节点到另一个网格节点必须保持连续等宽，不得在网格内部突然扩宽或收窄，也不得把某一段内部道路升级成不同宽度。需要增加通行能力时，优先调整外围道路、增设平行集散路或减少内部直连，而不是改变内部网格宽度。
- 允许拓宽网格外围道路。宽度变化应发生在网格边界节点或外围路口，并检查转向车道、路口净空、建筑退距和分区格是否被破坏。
- 网格连接外部道路的接驳路、集散路可以比内部道路更宽。接驳路应从网格外围节点出发，不得从网格内部中途扩宽后再穿出；其外部接入点继续遵循“已有路口 → 已有转角/端点 → 道路中段”的节点优先级。
- `horizontal_road_prefab`、`vertical_road_prefab`、`perimeter_road_prefab` 和 `connection_road_prefab` 都必须使用当前城市实时发现的精确 prefab。若横纵内部 prefab 的实际宽度不同，规划预检应拒绝或要求用户明确修改方案，而不是静默生成不等宽网格。

最小用法：

```powershell
node tools/deploy-district.mjs `
  --origin -2000,544 `
  --cols 3 --rows 2 `
  --road "<list_road_prefabs 返回的精确名称>" `
  --zone "<list_zone_types 返回的精确名称>" `
  --request-id district-preview-001 `
  --survey-mode quick
```

加入沿街建筑批量放置：

```powershell
node tools/deploy-district.mjs `
  --origin -2000,544 --cols 3 --rows 2 `
  --road "<list_road_prefabs 返回的精确名称>" `
  --zone "<list_zone_types 返回的精确名称>" `
  --request-id district-build-001 --automatic `
  --building-prefab "Exact Discovered Prefab Name" `
  --building-count 16
```

若建筑计划未来安装服务升级，可在 MCP `deploy_grid_district` 的 `building_batch.reserve_upgrade_prefabs` 或直接调用 `plan_building_row` 的 `reserve_upgrade_prefabs` 中传入兼容升级 prefab 名称。规划器会按宿主与升级模块的组合 footprint 扩大间距和碰撞检查；升级安装本身仍必须通过原生升级 preview。

脚本内部顺序为：

1. 读取城市状态并保存模拟速度。
2. 暂停城市，完成空间勘察。
3. `preview_road_grid` → `get_road_operation(preview_ready)` → `build_road` → `completed`。
4. 可选道路连接；Edge/Node 拓扑限并发预取并在本地匹配。
5. `preview_zoning` → `apply_zoning` → `get_zoning_operation(completed)`。
6. 可选 `plan_building_row` → `preview_building_batch_placement` → `apply_building_operation` → `completed`，最多 32 个建筑。
7. 恢复指定速度；任一步骤失败都恢复建设前速度。

所有 prefab、道路边和建筑 ID 都必须来自当前城市会话。`quick` 只减少诊断成本，不能省略最终原生 preview。

## 高速增长观察

```powershell
node tools/deploy-district.mjs `
  --config tools/deploy-industrial-plan.json `
  --growth-cycles 5 `
  --growth-interval-ms 3000
```

等价 JSON 配置：

```json
{
  "growth_loop": {
    "cycles": 5,
    "interval_ms": 3000,
    "speed": "fastest",
    "stop_on_negative_cash": true,
    "min_balance": 0,
    "max_unemployment_rate": 15
  }
}
```

每轮并发读取：

- `get_city_summary`：人口；
- `get_zone_demand`：各类需求和负向因子；
- `get_housing_statistics`：分密度住房总量、空置和入住；
- `get_employment_statistics`：岗位、空缺和失业率；
- `get_city_economy`：现金、余额和每小时变化。

返回的 `growth_loop.samples` 是观察数据，不是建设结果。`next_action` 为 `continue_or_start_next_batch`、`stop_and_repair_finances`、`stop_and_reassess_budget` 或 `stop_and_reassess_housing_jobs`。没有用户明确要求持续运行时，完成后恢复原模拟速度。

## 性能边界

- 只读查询可限并发（当前道路拓扑为 4 路）；道路、建筑、分区写操作保持串行。
- 不要用提高 `max_cost`、跳过 preview、重复提交新 request ID 或清车来“提速”。
- 事务超时或 `outcome_unknown` 时先查询原 operation 和永久对象，再决定是否继续。
