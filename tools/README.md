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

该脚本会修改当前城市。只有用户明确要求建设时才能运行。它记录原模拟速度，失败时尝试恢复；成功时使用 `resume_speed`，默认设为 `fastest`。

### 用法

```powershell
node tools/deploy-district.mjs --archetype residential_suburban_3x2 --origin -2000,544
node tools/deploy-district.mjs --origin -2000,544 --cols 3 --rows 2 --zone residential_low --survey-mode full
node tools/deploy-district.mjs --config tools/district-template.json --verbose
```

### CLI 参数

| 参数 | 输入 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--archetype NAME` | 预设键 | 无 | 载入 `presets/district-archetypes.json` 中的街区预设 |
| `--config PATH` | JSON 文件 | 无 | 载入完整配置；与 archetype 同用时覆盖预设。使用 config 后其他配置型 CLI 参数不会再覆盖 JSON |
| `--origin X,Z` | 两个数值 | 必填 | 网格西南角，吸附到 8 米网格 |
| `--cols N` | 整数 | `3` | 街区列数；当前 `preview_road_grid` 的有效范围为 1–5 |
| `--rows N` | 整数 | `3` | 街区行数；当前 `preview_road_grid` 的有效范围为 1–5 |
| `--block-w M` | 米 | `96` | 单块宽度，必须是 8 米整数倍 |
| `--block-h M` | 米 | `96` | 单块高度，必须是 8 米整数倍 |
| `--road NAME` | prefab 名 | `Small Road` | 默认道路 prefab；应先从当前城市发现精确名称 |
| `--zone TYPE` | 通用键或精确 prefab | 无 | 如 `residential_low`、`commercial_low`、`industrial`；通用键按城市主题映射 |
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
- `presets/district-archetypes.json`：正式街区预设，当前包含低密住宅 `3x2`、商业 `3x3`、工业 `3x2` 和中密住宅 `4x3`。预设值是规划起点，prefab 和适用性仍需实时验证。
- `district-template.json`：可复制修改的通用部署配置示例，其中空 `node_id` 不能直接作为既有道路连接使用。
- `deploy-industrial-plan.json`：某次城市会话使用过的工业部署配置，含会话绑定道路实体 ID；只能作为结构示例，执行前必须替换坐标和 ID。
- `upgrade-prefabs.json`：历史游戏会话导出的 prefab/升级数据快照，不是部署输入，也不代表当前运行版本。

## 测试与临时脚本

```powershell
node tools/tests/test-physics-rules.mjs
node tools/tests/test-spatial-survey.mjs
```

- `test-physics-rules.mjs` 是离线数学和配置校验测试，不连接游戏。
- `test-spatial-survey.mjs` 使用固定坐标查询实时城市，属于只读实机测试；换地图后断言可能不成立。
- `scratch/deploy_civic_hub.mjs` 和 `scratch/deploy_deathcare.mjs` 是固定方案、固定坐标的一次性写入脚本，不是正式入口。未经逐行检查当前目标、费用和用户授权不得运行。
- `ilspy/` 是本地反编译工具及依赖，已被 Git 忽略，不属于城市自动化接口。

## 核心参数限制与几何边界

脚本与自动化工具调用时，必须严格遵守底层引擎与几何库的边界约束：

| 约束项 | 参数/范围 | 限制与行为 |
| --- | --- | --- |
| 单段道路长度 | $16\text{m} \sim 256\text{m}$ | $< 16\text{m}$ 报 `SEGMENT_TOO_SHORT`；$> 256\text{m}$ 报 `SEGMENT_TOO_LONG`，长路线需用 `subdivideRoute` 切分 |
| 管网折线段长度 | $\le 200\text{m}$，2~16 个点 | 单次预览折线点数在 2 到 16 之间，单段管线长度建议不超过 200m |
| 节点吸附容差 | $\le 8\text{m}$ | 连接既有道路或管网 `node_id` 时，输入坐标必须在该节点 8 米范围内，否则拒绝吸附 |
| 8 米格网模数 | `x % 8 == 0, z % 8 == 0` | 街区西南角起点（`origin`）及街区长宽（`block_w`, `block_h`）必须严格为 8 的倍数 |
| 建筑路口退距 | $\ge 32\text{m}$ | 建筑中点距离相邻道路交叉口节点必须 $\ge 32\text{m}$，且路段长度需满足 $\ge \text{建筑面宽} + 16\text{m}$ |
| 主题分区预设 | `list_zone_types` 精确值 | `--zone` 或 JSON 中的 `zone` 必须为主细分风格名称（如 `EU Residential Low`），严禁未映射的泛型名称 |
| 模拟速度枚举 | 全小写字符串 | 仅接受 `"paused"`, `"normal"`, `"fast"`, `"fastest"` 四种全小写枚举 |

## 安全边界

- 只读诊断不授权运行 `deploy-district.mjs` 或任何 `scratch` 写入脚本。
- `quick` 勘察、数学评分和预设模板都不能替代游戏原生 preview。
- 工具超时或返回未知结果时查询原 operation 与永久对象，不用新请求 ID 盲目重试。
- 运行配置文件前检查所有坐标、实体 ID、prefab、预算和恢复速度；历史文件不能直接用于新存档。
