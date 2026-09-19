# CityWeaver 开发与自动化工具

本目录提供项目维护、城市空间勘察和批量建设辅助工具。正式入口均使用 Node.js 20 或以上，并从项目根目录运行。城市查询和建设脚本通过 `mcp/bridge-client.mjs` 连接当前游戏，因此需要游戏已启动、模组桥接可用且城市已经加载。

## 正式入口

| 入口 | 类型 | 副作用 | 适用场景 |
| --- | --- | --- | --- |
| `survey-space.mjs` | 城市空间勘察 | 只读 | 建设前检查土地、地形、建筑碰撞、污染、风和资源，或搜索候选区域 |
| `deploy-district.mjs` | 街区部署 | 修改城市 | 一次完成空间检查、网格道路、可选连接路、分区、建筑批量放置和增长观察 |
| `launcher-cdp.mjs` | 启动器 UI 辅助 | 可能点击启动器 | 检查或操作开启了 Chrome DevTools 调试端口的游戏启动器页面 |

脚本中的 prefab 名称、实体 ID 和坐标都属于当前城市上下文。复用示例前必须重新发现目标；不要把历史存档中的实体 ID 用于其他会话。

## 空间勘察：`survey-space.mjs`

### 用法

```powershell
node tools/survey-space.mjs --origin -2000,544 --width 288 --height 192 --mode full
node tools/survey-space.mjs --archetype industrial_manufacturing_3x2 --origin -2000,544
node tools/survey-space.mjs --auto-find industrial --anchor -1138,528 --mode quick
```

### CLI 参数

| 参数 | 输入 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--origin X,Z` | 两个数值 | `0,0` | 待检查矩形的西南角；会吸附到 8 米网格 |
| `--width M` | 米 | `96` | 矩形宽度；会吸附到 8 米网格 |
| `--height M` | 米 | `96` | 矩形高度；会吸附到 8 米网格 |
| `--archetype NAME` | 预设键 | 无 | 从 `presets/district-archetypes.json` 读取 footprint；仍可用 width/height 覆盖 |
| `--auto-find TYPE` | `residential`、`commercial` 或 `industrial` | 无 | 生成并排序多个候选，不使用单一 origin 模式 |
| `--anchor X,Z` | 两个数值 | `-1138,528` | 自动搜索的城市参考点；工业候选按实时风向放到下风侧 |
| `--mode MODE` | `full` 或 `quick` | `full` | `full` 扫描建筑碰撞；`quick` 延后该扫描并返回 `UNVERIFIED` |
| `--verbose` | 开关 | 关闭 | 单一区域模式附加完整 JSON；自动搜索模式当前只输出候选摘要 |
| `--help`、`-h` | 开关 | 无 | 显示脚本内置帮助 |

### 输出

默认输出紧凑文本摘要。单一区域的内部报告包含：

- `mode`、`footprint` 和 `duration_ms`；
- `ownership`：涉及地图格及未购买采样点；
- `terrain`：最低/最高高度、高差、最大坡度和分类；
- `collisions`：是否执行扫描、冲突建筑数量和样本；
- `environment`：风向、空气/土壤/噪音污染；
- `resources`：地下水、沃土、森林、矿石和石油；
- `suitability`：住宅、商业、工业评分及 `PASS`、`UNVERIFIED` 或 `BLOCKED`；
- `issues`：未购地、坡度、碰撞、污染或查询失败等问题。

作为模块导入时可使用 `surveySpace(options)`、`findOptimalDistrictSite(options)` 和 `formatSurveySummary(report)`。程序化 options 还支持 `clearance_m`、`city_center`，自动搜索支持 `district_type`、`anchor`、`survey_mode`。勘察结果是快速代理，最终碰撞和合法性仍由对应游戏原生 preview 判断。

## 街区部署：`deploy-district.mjs`

该脚本会创建游戏原生道路预览；默认 `approval_mode=staged` 在 `preview_ready` 停止，不产生永久对象。只有用户明确授权建设并传入 `approval_mode=automatic`（CLI 为 `--automatic`）时才继续提交道路、可选分区和建筑。它记录原模拟速度，预览模式或失败时恢复原速度；自动施工成功时使用 `resume_speed`。

### 用法

```powershell
node tools/deploy-district.mjs --archetype residential_suburban_3x2 --origin -2000,544 --road "Exact Road Prefab" --zone "Exact Zone Prefab"
node tools/deploy-district.mjs --origin -2000,544 --cols 3 --rows 2 --road "Exact Road Prefab" --zone "Exact Zone Prefab" --survey-mode full
node tools/deploy-district.mjs --config tools/district-template.json --verbose
```

### CLI 参数

| 参数 | 输入 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--archetype NAME` | 预设键 | 无 | 只载入 `presets/district-archetypes.json` 中的几何与选址建议；仍须传入实时发现的道路/分区 prefab |
| `--config PATH` | JSON 文件 | 无 | 载入完整配置；与 archetype 同用时覆盖预设。使用 config 后其他配置型 CLI 参数不会再覆盖 JSON |
| `--request-id ID` | 稳定字符串 | 按完整参数确定性派生 | 同一逻辑重试复用；相同 ID 搭配不同参数会被拒绝 |
| `--automatic` | 开关 | 关闭 | 明确授权预览通过后自动连续提交；省略时只产生道路预览 |
| `--origin X,Z` | 两个数值 | 必填 | 网格西南角，吸附到 8 米网格 |
| `--cols N` | 整数 | `3` | 街区列数；当前 `preview_road_grid` 的有效范围为 1–5 |
| `--rows N` | 整数 | `3` | 街区行数；当前 `preview_road_grid` 的有效范围为 1–5 |
| `--block-w M` | 米 | `96` | 单块宽度，必须是 8 米整数倍 |
| `--block-h M` | 米 | `96` | 单块高度，必须是 8 米整数倍 |
| `--road NAME` | prefab 名 | 必填 | 从当前城市发现的精确道路 prefab 名称 |
| `--zone TYPE` | 精确 prefab | 无 | 从当前城市 `list_zone_types` 返回值中选择；不翻译通用别名 |
| `--survey-mode MODE` | `full` 或 `quick` | `full` | 建设前勘察模式；`quick` 仍依赖原生 preview 做最终碰撞校验 |
| `--building-prefab NAME` | 精确 prefab | 无 | 在新道路旁批量规划并放置该建筑 |
| `--building-count N` | 整数 | `32` | 建筑批次上限，最终数量取决于有效候选 |
| `--growth-cycles N` | 1–60 | 无 | 建成后执行增长观察循环 |
| `--growth-interval-ms N` | 250–120000 ms | `2000` | 增长样本间隔 |
| `--resume SPEED` | `paused`、`normal`、`fast`、`fastest` | `fastest` | 成功完成后的模拟速度 |
| `--verbose` | 开关 | 关闭 | 在摘要后输出完整 JSON |
| `--help`、`-h` | 开关 | 无 | 显示脚本内置帮助 |

### JSON 配置扩展

CLI 只暴露常用参数。`--config` 或模块调用 `deployDistrict(options)` 还支持：

| 字段 | 说明 |
| --- | --- |
| `request_id`、`approval_mode` | 稳定工作流 ID；`staged` 只预览，`automatic` 才连续提交 |
| `horizontal_road_prefab`、`vertical_road_prefab`、`perimeter_road_prefab` | 分别指定横向、纵向和外围道路 |
| `auto_connect`、`connection_sides`、`connection_search_radius_m` | 自动搜索现有道路连接及方向、范围 |
| `connection_road_prefab`、`minimum_connections`、`maximum_connections` | 连接道路类型与要求连接数量 |
| `arterial_connector` | `{ road_prefab, points: [{ x, z, node_id? }] }`；额外建设一条集散连接路线 |
| `depth_cells` | 分区进深，默认 6 格 |
| `clearance_m`、`check_conflicts` | 勘察净距；设 `check_conflicts=false` 会跳过脚本勘察，但不会绕过原生 preview |
| `max_cost` | 道路等操作的提交费用上限 |
| `building_batch` | `building_prefab`、`road_side`、`spacing_m`、`maximum_buildings`、`max_cost`、`auto_level_foundations`、`max_terrain_relief_m`、`reserve_upgrade_prefabs` |
| `growth_loop` | `cycles`、`interval_ms`、`speed`、`stop_on_negative_cash`、`min_balance`、`max_unemployment_rate` |

### 执行顺序与输出

执行顺序为：几何校验 → 读取状态并暂停 → 空间勘察 → 网格道路 preview/apply → 可选连接路 → 可选 zoning → 可选建筑批次 → 恢复目标速度 → 可选增长观察。道路、分区和建筑写入保持串行；后续步骤失败不会自动撤销此前已完成的永久对象。

成功结果包含 `success`、`city`、`district_type`、`spatial_survey`、`grid`、`arterial`、`zoning`、`buildings`、`growth_loop`、`total_cost`、`duration_ms` 和 `notes`。CLI 默认输出摘要，`--verbose` 输出该完整对象。失败写入 stderr、退出码为 1，并尝试恢复建设前速度；调用方仍需查询已完成 operation 和永久对象，不能假设跨领域自动回滚。

## 启动器辅助：`launcher-cdp.mjs`

该脚本不通过 MCP，也不操作城市数据。它连接 `http://127.0.0.1:9222/json/list`，选择第一个 `page`，再通过 WebSocket 调用启动器页面。启动器必须以 Chrome DevTools 远程调试端口 9222 运行。

```powershell
node tools/launcher-cdp.mjs inspect
node tools/launcher-cdp.mjs resume
node tools/launcher-cdp.mjs play
node tools/launcher-cdp.mjs ignore-warning
```

| mode | 行为 | 输出 |
| --- | --- | --- |
| `inspect` | 读取页面文本和按钮属性，不点击 | `{ text, buttons[] }` JSON 字符串 |
| `resume` | 点击 `data-testid="gameButton-resume"` | `{ clicked, text? / reason? }` |
| `play` | 按按钮文字或 aria-label 查找并点击 Play/Resume | `{ clicked, text? }`；找不到时返回按钮文字列表 |
| `ignore-warning` | 点击 `data-testid="cancelButton"` | `{ clicked, text? / reason? }` |

省略 mode 时使用 `inspect`。未知 mode、端口不可用或找不到 page 时进程失败。后三种模式会操作启动器 UI，只能在用户要求启动或继续游戏时使用。

## 支持文件

- `lib/physics-rules.mjs`：内部几何规则库，不是 CLI。导出网格/道路常量，以及 `snapToCell`、`snapPoint`、`horizontalDistance`、`calculateGrade`、`validateRoadSegment`、`subdivideRoute`、`calculateGridFootprint`、`checkAABBOverlap`、`evaluateWindRelationship`、`calculateSafeIndustrialLocation` 和 `validateDistrictConfig`。
- `presets/district-archetypes.json`：正式街区几何预设，当前包含低密住宅 `3x2`、商业 `3x3`、工业 `3x2` 和中密住宅 `4x3`。为避免跨主题猜名，预设不保存道路或分区 prefab；调用时必须实时发现并显式提供。
- `lib/plan-targets.mjs`：规划目标解析库，不是 CLI。导出 `loadTargets`、`selectTargets`、`describePlan`、`describePlanWithStamp`、`assertScriptResolved`、`assertCityMatches`、`cityGuardOptions`、`matchesPlannedBuilding`、`createRunId`、`parseArgs`、`PlanTargetError`、`DEFAULT_PREVIEW_POLICY`，以及统一失败处理的 `formatFailure`、`runMain`。
- `presets/weford-public-services.json`：Weford 公共服务施工的唯一权威目标清单。用命名方案（`public-services` / `master`）指向仓库根 `plans/` 下两套坐标不通用的规划文件；每个目标用 `plans` 声明归属、用 `plan_ids` 绑定各方案中的唯一建筑、用 `scripts` 声明参与哪些脚本。清单里不保存任何坐标、路网 ID 或会话 ID：坐标从规划文件解析，原生候选由 `preview` 脚本在运行时现场请求，取候选参数放在 `preview_candidate_policy`。顶层 `expected_city` 声明这些坐标属于哪个城市，各脚本启动时比对当前城市，不符即中止。
- `lib/simulation-speed.mjs`：模拟速度的状态捕获与还原，不是 CLI。导出 `SIMULATION_SPEEDS`、`describeSimulationSpeed`、`speedToRestore`。记录一条实测事实：`set_simulation_speed` 收字符串枚举，而 `get_game_status` 报的数字索引**不是** 0/1/2/3 —— `fastest` 是 4。脚本改过速度就必须用这里还原，不要再抄一份映射。
- `district-template.json`：可复制修改的通用部署配置示例，其中空 `node_id` 不能直接作为既有道路连接使用。
- `deploy-industrial-plan.json`：某次城市会话使用过的工业部署配置，含会话绑定道路实体 ID；只能作为结构示例，执行前必须替换坐标和 ID。
- `upgrade-prefabs.json`：历史游戏会话导出的 prefab/升级数据快照，不是部署输入，也不代表当前运行版本。

## 测试与临时脚本

```powershell
node tools/tests/test-physics-rules.mjs
node tools/tests/test-spatial-survey.mjs
node tools/tests/test-plan-targets.mjs
node tools/tests/test-town-plan.mjs
node tools/tests/test-region-plan.mjs
```

- `test-physics-rules.mjs` 是离线数学和配置校验测试，不连接游戏。
- `test-spatial-survey.mjs` 使用固定坐标查询实时城市，属于只读实机测试；换地图后断言可能不成立。
- `test-region-plan.mjs` 校验 `plans/egelin-region-plan.json`（三区规划）。除了哈希、8 米对齐、id 唯一、边界包含这些常规项，重点是四条**图上看不出来**的不变量：**所有道路都必须是单段直线**（折线长度 = 首末直线距离，手写多段控制点造成的 ±4 m 起伏也会被拦下）、**路网必须是单一连通分量**（支路端点没真正落到相邻路上，整条路看着接上了其实谁都不连）、**分区进深必须落在 `[0, 48] m`（自路面外缘算起）**，以及**对外机动车出口必须是真的**（读 `access_points` 自述，反查坐标是否真落在 `via`/`to` 两条路的交点上、`to` 是否真属别的片区、两处出口间距是否 ≥400 m、每处接入路能否独立走到三区大道）。实机部分除了已购地图格与实时目录比对，还会**用实时道路折线**量主干道起点是否落在 8 米吸附容差内（不写死任何高速坐标，换存档也不会假通过）。
- `test-town-plan.mjs` 校验 `plans/egelin-plateau-town-plan.json`：离线检查 `plan_id` 与 `bounds+plan` 的哈希一致、坐标全部有限、8 米格对齐、id 唯一、规划对象都在规划边界内、户数与人口口径可复算；游戏在跑时追加实机检查——规划几何落在当前已购地图格内（0 错误），道路 prefab、分区名与建筑 prefab 都能在当前城市目录里找到。桥未启动时自动跳过实机部分。规划文件是按「埃格林」这个城画的，换存档后实机断言会（正确地）失败。
- `test-plan-targets.mjs` 离线校验 Weford 目标清单：两套方案各自的可解析项数、五个脚本的分组数量、缺失项能否被显式检出、`plans/` 规划文件的结构与 `id` 完整性、城市闸门（`CITY_MISMATCH` / `--allow-city-mismatch` / 未声明时跳过）、模拟速度映射的往返还原（`fastest` = 4 这条防线），以及「清单内不含任何坐标 / 路网 ID / 会话 ID」、「五个脚本都接了城市闸门、build 的闸门排在写入之前」、「preview 会还原它改过的速度」。不连接游戏。
- `scratch/deploy_civic_hub.mjs` 和 `scratch/deploy_deathcare.mjs` 是固定方案、固定坐标的一次性写入脚本，不是正式入口。未经逐行检查当前目标、费用和用户授权不得运行。
- `scratch/generate-town-plan.mjs` 是只读的城镇规划生成器，不连接游戏：把脚本内的一份「街区级用途表」（20×10 个 96 米街区）展开成 `render_city_plan` / 规划图施工流程可用的道路、分区与建筑 JSON，写入仓库根 `plans/egelin-plateau-town-plan.json`，并打印户数与人口核算；坐标、道路 prefab、街区用途都在脚本顶部集中定义。生成物已纳入版本控制，改动脚本后要重新生成并重新渲染。
- `scratch/generate-region-plan.mjs` 是只读的三区规划生成器（住宅/商业/工业各自独立、只用道路连通；片区**内部按黄金街区排成规整格子**，格子尺寸由 `GOLDEN_*` 与 `GRID` 反推，不手写坐标），写入 `plans/egelin-region-plan.json`。道路**全部是单段直线**（住宅区曾用正弦扰动的波形支路，已按用户要求拉直；`wavyLine` 函数保留未删，把某条路的 `kind` 改回 `'wave'`、去掉 `points`、补上 `axis/from/to/amp/phase/segments` 即可恢复）。五件事值得注意：①**吸附必须排在细分之前**——吸附会把端点挪动几十米，先细分的话那一段会重新超过 200 米上限；②生成器自带**路网连通性硬校验**，不通过直接抛错，不再靠人眼看图；③分区窗口直接用引擎实测口径 `[0, 48] m`（自路面外缘），改动这个窗口会同时改变分区面积与人口核算，测试按同一口径复算；④**`kind: 'line'` 不等于几何是直线**——控制点写成多段折线照样会弯（工业区原来就是刻意做的 ±4 m 起伏），回归测试因此单独断言「折线长度 = 首末直线距离」；⑤**片区边界必须是 8 的整数倍**——分区栅格化从 `min_x` 起步长 8，宽度不是 8 的倍数时最后一列会把多边形挤出边界（`DISTRICT_BOUNDS` 已按此取整）。另外，栅格线表里的 `to_x` / `tie_to` 用来把某条街**延长出去**（当前只有住宅第 7 条东西街：向东延到厂区西界的油场接入路，充当住宅区第二处对外机动车出口），延长段走在片区之间的空地上、两侧不划区，不会污染任何片区的分区面积。
- `scratch/zoom-plan-views.mjs` 是配套的只读截图辅助：把交互规划页的初始视图与放大上限按「片区/全区」逐个覆写，生成若干局部放大 HTML 供无头 Chrome 逐片核对。**画布尺寸必须取规划自己的 `render.width/height`**（本规划是 2200×1400，不是默认的 1600×1000），否则视图会整体跑偏到地图另一角。页面默认把放大上限锁在 10×，任何片区视图都会被 `clampView` 夹回「几乎全城」，所以脚本会连同上限一起放开。
- `scratch/survey-site.mjs` 是只读选址勘察：按矩形采样地形高程与地表水体、列出已购地图格，打印可建性网格与最大平地连通分量。踩过的两个参数坑：`sample_terrain` 单次上限 256 个坐标（要分块）、`read_surface_water_mask` 的 `limit` 上限 1024 且 `cell_size_m` 不得小于 64。
- `scratch/` 下的 5 个公共服务脚本（`plan-public-service-relocation`、`preview-public-service-plan`、`refresh-public-service-road-bindings`、`build-public-services-from-plan`、`verify-public-services-phase`）已改为数据驱动：目标来自 `presets/weford-public-services.json`，坐标来自仓库根 `plans/` 的规划文件，支持 `--plan public-services|master` 切换数据源。脚本内不含坐标、路网 ID 或会话 ID；`preview-public-service-plan.mjs` 的候选在运行时现场请求。五个脚本启动时都先比对清单 `expected_city` 与当前城市，不符即 `CITY_MISMATCH` 中止（可用 `--allow-city-mismatch` 显式放行）。`preview` 会临时暂停城市以稳定执行原生预览，跑完**一律还原**成进来时的速度（中途出错也还原），实测结果记在输出的 `simulation` 段；其余脚本静止不动速度，`build` 的暂停/还原由 `city-plan-construction-workflow` 负责并在输出里报告。其中 `build-public-services-from-plan.mjs` 是唯一会写入游戏的脚本。
- `ilspy/` 是本地反编译工具及依赖，已被 Git 忽略，不属于城市自动化接口。

## 核心参数限制与几何边界

脚本与自动化工具调用时，必须严格遵守底层引擎与几何库的边界约束：

| 约束项 | 参数/范围 | 限制与行为 |
| --- | --- | --- |
| 单段道路长度 | 16 米 ~ 256 米 | 基础道路/曲线超出范围报 `INVALID_ROAD_LENGTH`；自动路线中的短分段可能报 `ROUTE_SEGMENT_TOO_SHORT`。长路线应使用路线工具或 `subdivideRoute` 切分 |
| 管网折线段长度 | ≤ 200 米，2~16 个点 | 单次预览折线点数在 2 到 16 之间，单段管线长度建议不超过 200m |
| 节点吸附容差 | ≤ 8 米 | 连接既有道路或管网 `node_id` 时，输入坐标必须在该节点 8 米范围内，否则拒绝吸附 |
| 8 米格网模数 | `x % 8 == 0, z % 8 == 0` | 街区西南角起点（`origin`）及街区长宽（`block_w`, `block_h`）必须严格为 8 的倍数 |
| 建筑路口退距 | 建议从 32 米起评估 | 退距和路段长度由建筑 prefab、道路几何及原生预览共同决定；宽体建筑应优先选择长直路段 |
| 主题分区预设 | `list_zone_types` 精确值 | `--zone` 或 JSON 中的 `zone` 必须为主细分风格名称（如 `EU Residential Low`），严禁未映射的泛型名称 |
| 模拟速度枚举 | 全小写字符串 | 仅接受 `"paused"`, `"normal"`, `"fast"`, `"fastest"` 四种全小写枚举 |

## 安全边界

- 只读诊断不授权运行 `deploy-district.mjs` 或任何 `scratch` 写入脚本。
- `quick` 勘察、数学评分和预设模板都不能替代游戏原生 preview。
- 工具超时或返回未知结果时查询原 operation 与永久对象，不用新请求 ID 盲目重试。
- 运行配置文件前检查所有坐标、实体 ID、prefab、预算和恢复速度；历史文件不能直接用于新存档。
