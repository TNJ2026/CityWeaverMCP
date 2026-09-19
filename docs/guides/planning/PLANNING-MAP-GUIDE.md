# 城市规划图与按图施工指南

本指南说明如何把当前地图数据变成可审查的城市规划图，以及用户确认后如何把同一份结构化规划安全映射回游戏。城市布局、开发单元和禁止条例见[从零建城工作流](../../workflows/new-city.md)；本页重点是规划工具的选择、数据流、审批哈希、原生预览和永久回读。

## 快速选择工具

| 目标 | 首选工具 | 是否改变城市 | 交付物 |
| --- | --- | --- | --- |
| 读取现状底图 | `get_planning_map_snapshot` | 否 | 道路、建筑、轨道、独立管网的实时几何快照 |
| 自动寻找一个规则道路网格位置 | `propose_grid_plan` | 否 | 候选位置、道路/分区绑定和结构化网格方案 |
| 生成带服务、交通和管网预留的方案 | `propose_city_plan` | 否 | 概念级多层规划；设施与网络仍需精确绑定 |
| 生成可拖拽缩放的全地图施工图 | `render_city_plan` | 否 | 静态 HTML 或 SVG，以及稳定的 `plan_id` |
| 将规划建筑绑定到精确道路和朝向 | `bind_city_plan_buildings` | 只产生并取消临时预览 | 更新后的 `plan`、精确坐标、朝向、道路边和原生预览证据 |
| 只检查单个网格能否铺路 | `prepare_grid_native_preview` | 只产生临时预览 | 原生费用、碰撞、警告、吸附结果和取消动作 |
| 提交单个网格并继续划区 | `advance_grid_construction` | 是 | 永久道路、分区预览、分区提交和阶段回读 |
| 连续部署一个已授权的独立网格 | `deploy_grid_district` | 默认只预览；显式 `approval_mode="automatic"` 时是 | 稳定阶段 ID、道路/分区/可选建筑及增长观察 |
| 按整张已批准规划分批施工 | `prepare_city_plan_construction` → `advance_city_plan_construction` | 准备阶段否；提交批次时是 | 虚拟施工沙盒、确定性批次、逐批原生预览和永久回读 |

### 三条常用路径

**只做规划图**

1. 读取当前会话、已购地图格、地形、水域、污染、现有道路与可用 prefab。
2. 使用 `propose_grid_plan`、`propose_city_plan` 或自行构造结构化 `plan`。
3. 用 `render_city_plan` 生成图面并检查 `validation`。
4. 向用户展示规划图；没有施工授权时到此停止。

**按整张规划图施工**

1. 先用 `render_city_plan` 审查概念布局。规划道路尚未落地时，沿路建筑只能保留概念位置，不能伪造道路绑定或精确朝向。
2. 用户确认道路后，先把尚未精确绑定的建筑标记为 `construction_status="skipped"`（或生成只含道路的阶段计划），重新渲染并按该阶段的 `plan_id` 建成道路骨架、回读永久道路；再回到完整计划，用 `bind_city_plan_buildings` 为带精确 prefab 的规划建筑逐一取得游戏原生候选、朝向和 `road_edge_id`。该工具只保留到验证完成并随即取消临时 preview，不会永久放置建筑。
3. 用绑定后返回的新 `plan` 再次调用 `render_city_plan`；建筑几何变化会产生新的 `plan_id`，必须重新展示并取得施工确认。
4. 将完全相同的 `bounds`、绑定后 `plan` 和新 `approved_plan_id` 交给 `prepare_city_plan_construction`，检查虚拟施工沙盒与批次顺序。
5. 对每一批执行最终位置原生预览，核对费用、碰撞、净空、警告和吸附结果，再提交并回读永久对象。
6. 任一批次失败、过期、取消、结果未知或永久回读不完整时停止；不得换 ID 盲目重试。

**单个网格先预检再施工**

1. 用 `prepare_grid_native_preview` 仅保留道路临时预览。
2. 用户确认费用和原生结果后，用 `advance_grid_construction(stage="commit_roads")` 提交道路。
3. 使用返回的永久道路 ID 调用 `advance_grid_construction(stage="preview_zoning")`，确认后再调用 `stage="apply_zoning"`。

**多个独立网格连续施工**

1. 规划阶段把每个规则开发单元分别写入 `plan.grids[]`，不要调用会产生游戏预览或永久对象的部署工具。
2. 用户要求逐批检查时，逐个执行 `prepare_grid_native_preview` → `advance_grid_construction`。
3. 用户已经明确授权单个网格在原生预览通过后自动连续提交时，才使用 `deploy_grid_district(approval_mode="automatic")`；默认 `approval_mode="staged"` 只停在道路 `preview_ready` 并返回下一步。
4. 各网格必须串行、范围不重叠；相邻网格不得重复生成共享外围道路。需要共享道路时，把它提升为开发单元外的集散路，再让各网格分别接入。

### 不可混淆的状态

- 规划图通过几何校验，不代表游戏原生 preview 会通过。
- `preview_ready` 只表示临时预览可提交，不代表已有永久对象。
- `completed` 仍需永久对象和连接关系回读；人口、交通、污染、财政及服务效果还需要运行模拟后验收。
- 静态网页的缩放和 SVG 像素不是施工坐标；施工只使用结构化 `plan` 中的世界米制坐标。

## 规划图渲染与坐标

`render_city_plan` 是只读高层 MCP 工具。它以全部可购买地图格的世界坐标边界作为固定底图，按 X/Z 同比例（1 米对 1 米）复刻全地图的陆地、水域、地图格、实时道路、建筑、交通轨道和独立公用管网，再叠加尚未施工的规划。默认输出一个自包含静态 HTML 文件和稳定的 `plan_id`；文件无需 MCP 或 Web 服务即可直接打开。调用不会暂停城市、创建原生临时实体或授权施工。

### 网页交互与视图

静态网页通过 `render.format="static_html"` 启用并作为默认格式；兼容值 `interactive_html` 生成相同的单文件页面。网页支持鼠标/触摸拖拽、滚轮或按钮缩放到 10 倍，以及一键复位；也支持道路、建筑、分区、轨道、管网以及“现状/规划”图层开关。传入规划 `bounds` 时页面打开即对准规划范围（底部仍保留全图底图，平移与缩放范围不变），“复位”回到该规划取景，“全图”回到整张地图；只影响取景，不改变 SVG 的 X/Z 等比例。地图对象可点击或用键盘选择并查看类型、图层和状态，但获得键盘焦点时不绘制浏览器默认的黑色焦点框。`render.view="combined"` 把地下对象以虚线叠加在同一张图中。`format="svg"` 仍可用于只需要图片的调用。

### 水域与地形

默认还会用 `read_surface_water_mask` 按原生水深采样全部地图格，以半透明水域底图呈现河流、湖泊、河湾、海域和小型积水。水岸线采用 Marching Squares，并在相邻采样点间按水深阈值插值，不再绘制成采样方块；湖中岛等干地区域会作为 SVG 孔洞保留。`water_cell_size_m` 控制请求精度，默认 8 米、最小 2 米。为避免全地图产生不受控的采样量，超过 750,000 个采样点时会自动适度降低实际分辨率，并在结果的 `requested_cell_size_m`、`cell_size_m` 和 `adaptive_resolution` 中明确报告。水体名称仍只是按轮廓形态推断，并不是游戏提供的水体分类。可用 `include_water=false` 关闭。

自动网格选址会把采样水体作为高优先级冲突项，优先选择 `surface_water_conflicts=0` 的干地区域；这仍是按采样分辨率进行的前置筛查，正式施工继续以游戏原生 preview 为准。

规划图还会通过 `sample_terrain` 读取全地图高度，并以默认 64 米网格估算坡度：5°–12° 显示为中等坡度，超过 12° 显示为陡坡。自动网格仍只在已购区域内选址，并按 `maximum_slope_degrees`（默认 12°）和地块高差避让陡坡；可用 `include_terrain=false` 关闭，或通过 `terrain_cell_size_m` 调整采样精度。坡度是采样估算值，不替代地形施工与道路原生 preview。

山地采用二维地形表达：全图高程从浅绿、黄褐、棕色到灰色分为七档，颜色越深通常表示相对海拔越高；其上使用棕色等高线描绘山峰、山脊和山谷，并继续叠加黄色中坡与红色陡坡警示。等高距按当前地图高差从 10、20、50、100、200、500 或 1000 米中自动选择，使全图最多约 30 级等高线；每第五级使用较粗主等高线。网页中选择“地形高程”或“等高线”可查看当前高程范围与实际等高距。它是按采样网格插值的施工规划底图，不是游戏地形网格的逐顶点无损导出。

### 世界坐标、道路宽度与建筑占地

传入的 `bounds` 是规划授权与后续施工哈希使用的边界，不再裁切网页底图。渲染结果中的 `bounds` 是全地图显示边界，`planning_bounds` 是原调用的规划边界；未购买地图格只作为灰色上下文展示，任何落在其中的规划仍会被校验为不可施工。静态网页只保存世界坐标到 SVG 的等比例映射，不会从屏幕像素反推施工坐标。

道路宽度也使用相同的世界比例：SVG 道路笔画宽度严格等于 `width_m × 当前世界到 SVG 的比例尺`，不再设置视觉最小宽度或最大宽度。全地图视角下小路可能很细，放大后会按真实比例显示；网页另外使用透明点击热区改善选择操作，但它不参与可见宽度。现有道路的 `width_m` 来自实时道路 prefab 的 `NetGeometryData.m_DefaultWidth`，自动绑定的规划网格会采用实时发现的 prefab 宽度；手写规划道路则必须填写正确的 `width_m`，否则只能按所填数值绘制。

住宅、商业、工业和办公之外的建筑以空心占地框显示。占地框使用 `0.35` SVG 单位细实线，宽、深严格采用 `size_m.x × size_m.z` 的世界比例，并围绕建筑中心按 `rotation_degrees` 旋转；不设置最小显示尺寸。概念建筑用灰色表示，已取得候选绑定但尚未通过原生预览时用黄色，`native_preview_verified` 或 `permanent_verified` 用绿色，失败用红色；`rotation_degrees=null` 只为图面占位按 0° 绘制，不代表朝向已经确定。独立建筑名称会去除英文 prefab 和说明文字后，以自动适配的小号中文显示在框内，并在 SVG 最上层的独立标签层绘制，避免被道路或管线覆盖；住宅、商业、工业、办公、道路和管线不在图面显示名称。现有建筑尺寸来自实时 prefab 的 `ObjectGeometryData.m_Size`，规划建筑必须使用实时发现或选址结果返回的尺寸。空心框表示基础建筑物理占地，不会自动包含尚未写入方案的升级组合、附属区域、停车区、车辆排队区或施工缓冲；这些空间需要作为单独规划对象或扩大明确的预留框。地图米制参考格使用低亮度细线（默认 `0.6` SVG 单位、`0.35` 透明度），地图格边界同样降低透明度，避免压过建筑、道路和标签。

### 渲染前几何校验

几何校验会把建筑旋转占地与规划道路中心线及道路实际宽度一起计算；相交时返回 `PLANNED_BUILDING_ROAD_OVERLAP` 警告并标在对应建筑上。该检查是施工图预检，不能替代游戏原生建筑放置 preview。

标记为 `construction_status="built"` 或名称以“已建｜”开头的独立管网，会按网络类型、精确 prefab 和世界坐标路径与当前永久管网比对。规划路径每 8 米采样、允许 4 米几何误差；匹配率不足 98% 时返回 `BUILT_UTILITY_GEOMETRY_MISMATCH`。道路内嵌水电管网不会出现在独立管网列表中，因此不应伪装成已经铺设的独立管线。

## 生成结构化规划

### 自动网格候选

`propose_grid_plan` 是只读选址工具。它读取当前已购地图格、道路和建筑，在已购区域内搜索能够完整容纳指定 `columns × rows` 网格的候选位置，并优先选择建筑冲突少且靠近现有路网的位置。返回内容包括结构化 `plan`、候选坐标、最近道路距离、评估候选数、缺失绑定和规划图。

工具会读取当前城市的道路 prefab 和分区类型目录。未指定 `road_prefab` 时，它会从已解锁、允许分区且非桥梁的道路中选择适合网格的候选；住宅、商业和办公小街区会优先窄路。未指定 `zone_type` 时，它会按 `district_kind`、`density` 和 `theme_preference` 筛选。

`theme_preference="auto"` 会先读取 `get_city_configuration.theme`：北美城市只匹配 `NA` 分区，欧洲城市只匹配 `EU` 分区。只有主题字段不可用时，EU/NA 等多个同等有效分区才返回 `bindings.zone.status="ambiguous"`；也可显式指定 `theme_preference="eu"|"na"` 或精确 `zone_type`。只有道路和分区都绑定时才返回可直接作为 `deploy_grid_district` 输入基础的 `preview_draft`；它仍不包含预算授权，`construction_ready` 仍为 `false`，并且必须先执行游戏原生 preview。

规则道路组只有同时满足以下条件，才能无损保存为一个 `plan.grids[]` 对象：轴对齐、横纵线完整、各方向间距恒定、内部道路等宽、四条外围道路能由同一外围 prefab 表达，并且单批不超过当前原生 `5×5` 上限。规划校验会把满足条件却展开成逐条道路的方案标记为 `REGULAR_GRID_EXPANDED_AS_ROADS` 错误；不能满足时必须在 `plan.grid_exceptions[]` 记录道路组、道路 ID 和具体原因。该记录只是解释为什么保留精确逐路几何，不能绕过其他道路、占地和原生预览校验。

```json
{
  "district_kind": "residential",
  "density": "low",
  "theme_preference": "auto",
  "columns": 2,
  "rows": 3,
  "block_width_m": 96,
  "block_height_m": 96,
  "render": {
    "view": "combined",
    "format": "static_html"
  }
}
```

### 自动多层规划

`propose_city_plan` 在 `propose_grid_plan` 的选址和主题绑定结果上继续生成概念级多层方案：连接既有道路的接入口、两处公共服务建筑预留、地下给排水骨干、电力接入走廊，以及住宅/商业/办公区的地下地铁走廊或工业区的地表货运铁路走廊。`infrastructure_profile` 可选 `grid_only`、`basic`、`transit_ready` 或 `complete`。

自动生成的服务建筑、轨道和管网带有 `planning_status="conceptual"`。概念建筑同时使用 `placement_status="conceptual"`、`rotation_source="unresolved"` 和 `rotation_degrees=null`，明确表示图上的角度尚未经过游戏计算。它们用于空间预留和方案比较，不猜测当前存档不存在的 prefab，也不假设设施中心点就是可用端口；施工前必须分别发现精确 prefab、连接层、端口与吸附目标，并走各领域原生 preview。

```json
{
  "district_kind": "residential",
  "density": "low",
  "columns": 2,
  "rows": 3,
  "infrastructure_profile": "complete",
  "power_level": "surface",
  "render": { "view": "combined", "format": "static_html" }
}
```

### 建筑角度与道路绑定

`bind_city_plan_buildings` 接收当前 `bounds`、完整结构化 `plan` 和可选的 `building_ids`。它只处理已经填写精确 `prefab` 的建筑，调用统一建筑规划器搜索当前永久道路上的候选，并以游戏返回的 `position`、`rotation_degrees`、`road_edge_id` 或 `snap_target_id` 更新规划。工具也会采用实时 prefab 返回的 `size_m`，并记录 `rotation_source`、`placement_status`、`placement_binding` 与 `native_preview` 证据。

每栋建筑的临时原生 preview 在确认可提交后立即取消，因此该工具不会建造建筑，也不会留下隐藏的预览实体。没有精确 prefab 的概念建筑保持 `rotation_degrees=null`，不得猜名称、道路边或朝向。失败项标为 `placement_status="failed"`，后续施工必须停止处理该项。

道路侧候选只能绑定当前会话中已经永久存在的道路。若规划包含尚未建设的新道路，实际流程必须拆成两个批准周期：先将未绑定建筑标记为 `construction_status="skipped"` 或制作只含道路的阶段计划，渲染、批准并建设道路骨架；道路永久回读后恢复完整建筑清单并绑定建筑；再渲染绑定后的计划并确认新的 `plan_id`。绑定改变任何几何或 prefab 都会改变规划哈希，旧审批不能复用。

## 完整规划按图施工

`prepare_city_plan_construction` 与 `advance_city_plan_construction` 让 `render_city_plan` 的结构化 `plan` 成为道路、可直接放置建筑及独立水电管网施工的唯一几何来源，而不是从 SVG 像素反推坐标。

### 标准流程

1. 先调用 `render_city_plan`，向用户展示图片并保存返回的 `plan_id`。
2. 用户确认后，用完全相同的 `bounds`、`plan` 和该 `approved_plan_id` 调用 `prepare_city_plan_construction`。任何坐标、prefab、依赖或顺序变化都会产生不同哈希并以 `PLAN_APPROVAL_MISMATCH` 拒绝。
3. 准备结果先建立不写入游戏的虚拟施工沙盒，检查道路拓扑，并把道路、建筑和独立水电管网编译为确定性原生批次。它把网格展开为稳定对象 ID 用于图面和回读；当前 `preview_road_grid` 单次原生预览最多支持 `5×5` 个街区，因此更大的规划网格必须先拆成多个不超过该上限的施工网格，而不是把城市规划本身限制为固定的 NxN 模板。
4. 普通路线按 `construction_order` 和 `depends_on` 排序；执行器以 240 米为安全上限等分长直线，避免原生端点吸附和浮点换算后恰好 256 米的边界段被拒绝；只有整条路线超过原生 16 点限制时才拆成相邻批次。虚拟沙盒不会在地下或其他位置创建游戏道路。路段长度四个口径的分工见[游戏物理规则](../../reference/GAME-PHYSICS-RULES.md) §1.4。
5. 沿 `next_action` 调用 `advance_city_plan_construction(action="preview_batch")`。该步骤只从已批准规划读取 prefab 和最终世界坐标，按批次类型调用道路、建筑、市政服务、交通设施、公用设施或独立管网的游戏原生 preview，不允许调用方另传任意施工坐标。
6. 检查返回的真实费用、警告、错误和吸附结果后，再沿 `next_action` 调用 `action="commit_batch"`。提交完成后工具按领域回读永久道路、建筑或管网；建筑还核对最终位置、旋转及永久 `road_edge_id`，全部符合才返回 `completed_verified` 并给出下一批。
7. `failed`、`cancelled`、`expired`、`outcome_unknown` 或永久回读不完整都会停止序列并保持城市暂停；不得更换 request ID 盲目重试。

### 施工前硬约束

- 所有待施工对象及其完整占地必须位于当前已购地图格内。
- 住宅、商业、工业和办公开发单元不得跨越铁路、公路、有轨电车轨道或地上地铁线；完整禁止条例以[从零建城工作流](../../workflows/new-city.md)为准。
- 同一网格内部道路必须等宽；更宽的集散路应位于网格外围或开发单元外，宽度变化应落在外围节点或路口。
- 规划道路、建筑基础占地、升级附属建筑预留和必要净空不得互相冲突。
- 带精确 `prefab` 的建筑必须有有限的 `rotation_degrees`；需要道路侧放置的 prefab 还必须有原生候选返回的精确 `road_edge_id`。视觉贴路、手填道路 ID 或概念角度均不能通过施工门禁。
- 以上几何检查通过后，仍必须逐批执行最终位置的游戏原生 preview。

### 接入锚点与网格道路规则

修复或扩建既有城市时，规划道路点可带当前城市会话中实时发现的 `edge_id` 或 `node_id`（两者不能同时提供）。施工器会把这些锚点原样传给最终位置的原生道路预览，使端点精确拆分既有道路或接入既有节点；仅靠两条线在图面相交不会自动形成永久路口。锚点绑定城市会话，换存档或重启游戏后必须重新发现、重新渲染并再次确认规划。

规划器选择既有道路接入点时必须遵循统一优先级：先复用已有路口的永久 `node_id`，其次复用已有转角、预留端点或规划角点上的永久 `node_id`，最后才在没有路口的道路中段使用 `edge_id + edge_position` 创建新节点。只有更高优先级候选不存在、超出接驳范围，或因坡度、净空、碰撞、道路方向及容量无法通过原生预览时，才能降级，并应在规划结果中保留降级原因。中段拆分还必须校验相邻路口退距、排队空间、分区格影响和接入口密度；几何距离最近不能单独作为降级依据。

规划规则网格时，内部横向和纵向道路应使用同一 prefab，或至少使用实际宽度相同的变体；每条内部道路在网格边界之间保持连续等宽，禁止在网格内部扩宽、收窄或插入宽度过渡段。需要扩容时只能优先拓宽外围道路，或在开发单元外设置更宽的集散路。网格到外部道路的连接道路可以宽于内部道路，但必须从外围节点开始，并把宽度变化留在网格边界或外围路口。渲染与施工预检应分别比较内部、外围和连接道路 prefab 的实时 `width_m`，发现内部宽度不一致时不得静默通过。

同一已批准规划内，较早批次拆分道路后可能使较晚批次保存的 `edge_id` 或 `node_id` 失效。每批原生预览前，施工器会在规划坐标 2 米内回读当前永久道路；失效的道路边锚点会刷新为同一位置的新边，节点锚点会解析为同一位置当前永久道路的边锚点，并在 `anchor_rebindings` 中报告旧节点/道路边、新 ID 和距离。规划坐标、道路 prefab 或城市会话不会因此改变；坐标附近没有可用道路时停止并要求重新渲染规划。

### 批次、依赖与永久回读

执行层支持 `level="surface"` 的道路、可直接放置建筑，以及电力、清水、污水、合流、雨水和资源独立管网。建筑会按 `category` 选择普通建筑、市政服务、交通设施或公用设施的原生流程；`category="auto"` 会实时发现。分区和轨道仍需使用各自领域的施工工作流。所有待施工对象必须提供稳定 `id` 和实时发现的精确 `prefab`。

建筑和管网同样支持 `construction_status`、`construction_order`、`depends_on` 与 `max_cost`。默认执行次序是道路、建筑、管网；显式依赖可把设施放在接驳管线之前。地下管线未写 `elevation_m` 时，执行器会在原生 preview 前按实时 prefab 的允许高程范围选择地下默认值；连接永久节点或边的端点继承目标高度。

```json
{
  "id": "outer-ring-south",
  "prefab": "Exact Live Road Prefab",
  "construction_order": 10,
  "construction_status": "planned",
  "depends_on": [],
  "max_cost": 25000,
  "points": [
    { "x": -2048, "z": 64 },
    { "x": -768, "z": 64 }
  ]
}
```

继续建设已有城市时，把已经回读确认的道路或整组网格标记为 `construction_status="built"`；仅作为图面参考、明确不应施工的对象标记为 `"skipped"`。两者都参与规划哈希和依赖解析，但不会进入待施工清单。闭合环路可以保留为一个结构化对象；执行器会按 256 米路段限制细分，并仅在超过16个原生点时拆成连续批次。

`render_city_plan` 和施工编译器共享相同的网格展开与 `cplan-*` 哈希算法，因此图片缩放、SVG 分辨率和显示宽度不会影响游戏中的米制坐标。

渲染结果同时返回 `validation`：

- 检查规划道路、分区、轨道、管线和建筑完整占地是否位于当前已购地图格内。
- 检查规划建筑之间的占地包围框重叠，并把错误或警告关联到 `object_id`。
- 交互图用错误/警告描边标记对应对象，选择对象时显示具体问题。
- 几何校验只是前置筛查，不替代道路、建筑、分区、轨道或管网的游戏原生 preview。

## 单网格原生预检（不施工）

`prepare_grid_native_preview` 把已经绑定精确道路和分区名称的网格草案送入游戏原生道路 preview。它会核对当前城市中的道路 prefab、分区类型和城市主题，在需要时暂时暂停城市，等待道路预览进入终态，然后恢复原来的模拟速度。

这个入口只创建临时道路预览：不会调用 `build_road`、`preview_zoning` 或任何 apply 工具，也不会产生永久道路、分区或建筑。返回的 `construction_ready` 固定为 `false`；预览成功时会给出费用、警告、到期时间和可直接传给 `cancel_road_preview` 的 `cancel_action`。

传入 `render` 时，工具还会返回带原生预检标注的全地图静态网页或 SVG。道路颜色、顶部摘要和对象详情会显示 operation 状态、实际费用、警告、错误及吸附后的原点；这仍然只是临时预检结果。

分区不能在此阶段同时形成原生预览。原因是 `preview_zoning` 必须接收永久道路的 edge ID，而临时网格尚未拥有这些 ID。因此返回的 `zoning_intent.state` 为 `blocked_until_roads_built`：只有用户另行授权并提交道路、回读永久 edge ID 后，才能开始分区 preview。这个顺序不是跳过 preview，而是把道路预检与后续分区预检明确拆开。

```json
{
  "request_id": "xinnan-west-grid-preview-001",
  "origin": { "x": -936, "z": -280 },
  "columns": 2,
  "rows": 3,
  "block_width_m": 96,
  "block_height_m": 96,
  "road_prefab": "Alley",
  "zone_type": "NA Residential Low",
  "auto_connect": true,
  "connection_search_radius_m": 96,
  "minimum_connections": 1,
  "maximum_connections": 2,
  "depth_cells": 6,
  "overwrite": true
}
```

重复调用必须复用同一个 `request_id`；工具会返回第一次的结果，不会再次创建预览。若要修改坐标、网格尺寸或 prefab，先取消旧预览，再使用新的 `request_id`。

## 单网格预检后的分阶段施工

用户明确授权永久施工后，用 `advance_grid_construction` 从 `prepare_grid_native_preview` 的结果继续。它每次只推进一个阶段，避免把道路提交与尚未产生的分区格混成一次不可检查的动作：

1. `stage="commit_roads"`：传入道路预检的 `operation_id`、独立提交 `request_id` 和明确 `max_cost`。工具只接受 `preview_ready`，提交后轮询到 `completed`，并返回游戏实际创建的 `created_road_ids`。
2. `stage="preview_zoning"`：传入上一步的永久 `edge_ids` 和当前城市中的精确 `zone_type`。工具先检查实际 Zone Block/Cell，再创建独立原生分区预览；此阶段不会永久划区。
3. `stage="apply_zoning"`：传入上一步 `preview_ready` 的分区 `operation_id` 和新的提交 `request_id`，应用后轮询到 `completed`。

每个成功阶段都会返回可直接调用的 `next_action`。各阶段都检查城市会话，暂时暂停写入并恢复原速度；`outcome_unknown` 或有界轮询超时时会停止后续写入并保持暂停，必须查询原 operation，不能换 ID 重提。道路已经完成但后续分区失败时不会自动拆路或退款。

道路提交示例：

```json
{
  "stage": "commit_roads",
  "request_id": "xinnan-west-grid-road-commit-001",
  "expected_session_id": "prepare 返回的 session_id",
  "operation_id": "prepare 返回的 road_preview.operation_id",
  "max_cost": 25000,
  "zone_type": "NA Residential Low",
  "road_side": "both",
  "depth_cells": 6,
  "overwrite": true
}
```

优先沿用返回的 `next_action` 进入下一阶段；其中已经填入永久道路 ID、会话 ID、原生 operation ID 和派生的稳定请求 ID。

## 规划数据结构与支持图层

结构化 `plan` 可以包含以下数组；未使用的图层可省略或传空数组。

| 字段 | 图面内容 | 当前按图施工支持 |
| --- | --- | --- |
| `grids` | 规则道路网格及其分区意图 | 支持；单批原生网格预览上限为 `5×5` 街区 |
| `grid_exceptions` | 无法由一次原生网格无损表达的道路组及原因 | 不施工；用于防止规则网格被无说明地退化为逐路施工 |
| `roads` | 规划道路折线；现状道路可显示贝塞尔曲线 | 支持地表道路 |
| `buildings` | 建筑位置、旋转和物理占地 | 支持可直接放置的普通建筑、公共服务、交通设施和公用设施 |
| `zones` | 住宅、商业、工业、办公或其他分区多边形 | 图面支持；施工走独立分区工作流 |
| `tracks` | 火车、地铁和有轨电车轨道，区分地表与地下 | 图面支持；施工走独立交通工作流 |
| `utilities` | 电力、清水、污水、合流、雨水和资源独立管网 | 支持 |

默认图片把地表与地下拆成两个面板。现有对象使用较低饱和度，规划对象使用较强描边。图片是规划示意，不代表游戏原生 preview 已通过。

### 2×3 住宅网格示例

```json
{
  "bounds": {
    "min_x": -2200,
    "min_z": 400,
    "max_x": -1600,
    "max_z": 1000
  },
  "include_existing": true,
  "plan": {
    "grids": [
      {
        "origin": { "x": -2080, "z": 520 },
        "columns": 2,
        "rows": 3,
        "block_width_m": 96,
        "block_height_m": 96,
        "road_prefab": "Exact Road Prefab",
        "zone_type": "Exact Residential Zone",
        "zone_kind": "residential"
      }
    ],
    "buildings": [
      {
        "prefab": "Exact School Prefab",
        "label": "规划小学",
        "kind": "service",
        "position": { "x": -1850, "z": 650 },
        "rotation_degrees": 90,
        "rotation_source": "road_normal",
        "placement_status": "native_preview_verified",
        "road_edge_id": "session-guid:1234:1",
        "size_m": { "x": 64, "z": 48 }
      }
    ],
    "utilities": [
      {
        "network_type": "water",
        "level": "underground",
        "points": [
          { "x": -2080, "z": 540 },
          { "x": -1888, "z": 540 }
        ]
      },
      {
        "network_type": "electricity",
        "level": "surface",
        "points": [
          { "x": -2140, "z": 480 },
          { "x": -1900, "z": 480 }
        ]
      }
    ],
    "tracks": [
      {
        "track_type": "subway",
        "level": "underground",
        "points": [
          { "x": -2040, "z": 460 },
          { "x": -2040, "z": 900 }
        ]
      }
    ]
  },
  "render": {
    "title": "西区 2×3 住宅片区",
    "width": 1600,
    "height": 1000,
    "view": "combined",
    "format": "static_html"
  }
}
```

所有 prefab 和分区名称仍应从当前城市发现。SVG 中的规划几何可作为后续施工输入参考，但正式建设必须重新走对应领域的原生 preview、费用检查和永久结果回读。

## 限制与数据边界

- `get_planning_map_snapshot` 按指定矩形读取实时几何，并对每层应用 `max_features_per_layer` 上限；返回 `truncated=true` 时应缩小范围后重新读取。
- 公用管网快照只包含独立网络边，不把道路内嵌管线展开成独立管道。
- 公共交通图层当前绘制物理轨道，不展开运营线路的完整原生寻路径径。
- SVG 是俯视规划图；高度通过地表、高架和地下分类表达，不能替代纵断面工程图。
- 自动规划中的概念对象、采样地形和采样水域都属于前置分析，不替代最终位置的游戏原生 preview。

## 附录 A：Weford 公共服务施工脚本

这 5 个脚本处理当前存档的公共服务施工，已从 `mcp/` 迁到 `tools/scratch/`，并改为数据驱动：**目标清单与坐标不再写在脚本里**，统一来自 `tools/presets/weford-public-services.json` 与它指向的 `plans/` 规划文件。脚本本身不含任何坐标、路网 ID 或会话 ID。

| 脚本（`tools/scratch/`） | 作用与副作用 |
| --- | --- |
| `plan-public-service-relocation.mjs` | 只读重新选址；按规划坐标请求公共服务候选，不提交施工。 |
| `preview-public-service-plan.mjs` | 只读探针：**运行时**按规划坐标现场取原生候选，逐个试建临时预览，命中后立即取消；不产生永久实体。 |
| `refresh-public-service-road-bindings.mjs` | 只读刷新规划建筑附近的实时道路候选。 |
| `build-public-services-from-plan.mjs` | **写入游戏**；从规划文件抽取待建服务，走规划图分阶段施工流程并可能永久提交建筑。只有用户明确授权当前存档施工后才能运行。 |
| `verify-public-services-phase.mjs` | 只读回读规划范围内的设施与城市摘要，用于阶段验收。 |

统一入口：

```text
node tools/scratch/<脚本>.mjs [--plan public-services|master] [--plan-file <路径>] [--allow-city-mismatch]
```

**规划只对一个城市有效。** 这两套坐标是照着「韦福德」那个存档量的，清单用 `expected_city` 声明城市名；各脚本启动时先用 `get_game_status` 的 `city_name` 比对，不符即报 `CITY_MISMATCH` 并在动到游戏之前中止。这道闸不能省——在别的城市上跑，原生规划器不会报任何错，只是在目标区域找不到可接入道路，于是每个目标都返回 0 候选：看起来像「没路」或「规划器坏了」，实际是「根本不是这个城」。确需对别的城市试跑可加 `--allow-city-mismatch` 显式放行；把 `expected_city` 留空则跳过比对。

### 两套并存的规划方案

`plans/` 下有两个坐标不通用、设施集合也不同源的规划文件，已纳入版本控制。配置用命名方案表达它们，默认 `public-services`：

| 方案键 | 规划文件（`plans/`） | 覆盖 |
| --- | --- | --- |
| `public-services`（默认） | `weford-public-services-construction-plan.json` | 16 项待建 + 1 项已建；含 `Hospital01`；不含 `MedicalClinic02` / `CityPark03` / `CommunityPool01` |
| `master` | `weford-master-plan.json` | 9 项标 `built` + 4 项水电设施；含 `MedicalClinic02` / `CityPark03` / `CommunityPool01`；不含 `Hospital01` |

清单里每个目标用 `plans` 字段声明自己属于哪套方案，脚本只处理当前方案适用的项。**属于本方案、尚未建成、却在规划文件里找不到坐标的目标会在脚本开始时显式报错并列出项名**，不会跑到中途才失败。

规划文件的必需结构：`bounds`（施工与验收范围）加 `plan.buildings[]`，每栋建筑至少有 `id`、`prefab`、`position`（`x`/`z` 为米制世界坐标）。目标清单通过 `plan_ids.<方案键>` 精确绑定每套方案中的建筑；显式 ID 不存在时立即报错，不会回落到同 prefab 的另一栋建筑。仅兼容未声明 `plan_ids` 的旧清单时才按 prefab 回落，因此规划内 `id` 必须非空且唯一，重复 prefab 尤其必须配置精确 ID。施工跳过和阶段验收同时核对 prefab 与目标位置，不能因为规划范围内存在另一栋同 prefab 建筑而误判完成。

**新增或替换规划文件的做法**：`render_city_plan` 只返回自包含 HTML 与 `plan_id`，结构化 `plan` 由调用方持有，不会自动落盘。把决定沿用的 `bounds` + `plan` 存进 `plans/`，在清单的 `plans` 目录里登记路径与方案键，再跑一次 `node tools/tests/test-plan-targets.mjs`。`artifacts/` 仍是一次性产物目录（会被 Git 忽略），不要在那里放权威规划。

### 复现与安全

- 参数错误、未知方案键、目标解析失败、城市不符、游戏桥未启动都会在动到游戏之前中止：stdout 输出单个 `{"event":"fatal","code":...,"message":...,"details":{...}}` JSON，退出码为 1。`code` 可直接判断分支（`PLAN_KEY_UNKNOWN`、`PLAN_TARGET_MISSING`、`NO_PREVIEW_TARGETS`、`CITY_MISMATCH`、`BRIDGE_NOT_FOUND`），只有 `build-public-services-from-plan.mjs` 会额外带上 `completed` / `total_cost` 以便中断后清点。
- 城市闸门在写入之前生效：`build-public-services-from-plan.mjs` 先打印 `plan` 事件，随后立刻比对城市，比不过就直接 `fatal` 中止，不会开始任何预览或提交。判断「跑的是哪个城」看输出里的 `city` 字段（`refresh` / `verify` 会带，`CITY_MISMATCH` 的 `details` 里同时给出期望值与实际值）。
- `preview` 脚本的候选在运行时向原生规划器现场请求，`road_edge_id` 由当次会话产生，模型侧不保存。因此换存档、重载城市或道路拓扑变化**不会留下失效 ID**，脚本每次自动跟随当前路网；代价是它必须在游戏运行时执行，桥未启动即拒绝。取候选的半径、数量、尝试次数与道路侧在清单的 `preview_candidate_policy` 里调。
- `preview` 会为稳定执行原生预览临时把城市置为暂停，跑完**一律还原**成进来时的速度（中途出错也通过 `finally` 还原），并在输出的 `simulation` 段报告进来时的速度、还原目标与是否已还原。`refresh` / `verify` / `relocation` 不碰模拟速度；`build` 的暂停与还原由规划图施工流程负责，并同样在输出里报告。速度的数字口径（`fastest` 是 4 而非 3）见 `docs/workflows/operations.md` 的状态和验证一节。
- `--plan master` 只切换数据源，不改变脚本的副作用等级；`build-public-services-from-plan.mjs` 依然是唯一会写入游戏的脚本。
- 目标清单的改动以 `tools/presets/weford-public-services.json` 为唯一入口，不要在各脚本里另加 prefab 数组。`node tools/tests/test-plan-targets.mjs` 校验清单与两套方案的解析结果，并断言清单里不存在任何坐标、路网 ID 或会话 ID。
- 跨城市复用前，需同时替换清单、`plans/` 规划文件与清单里的 `expected_city`；清单其余部分与脚本无需改动。换城市后不更新 `expected_city`，脚本会在启动时直接以 `CITY_MISMATCH` 拦下，提醒你这一步还没做完。

## 附录 B：高原镇规划（埃格林，1 万人口）

`plans/egelin-plateau-town-plan.json` 是当前存档「埃格林」已购区域内一座 1 万人口城镇的结构化规划，由 `tools/scratch/generate-town-plan.mjs` 从一份街区级用途表展开而来（脚本只读、不连游戏，只写这一个 JSON）：

- 布局：20×10 个 96 米街区（1.84 km²）的完整街道格网，主街（`Medium Road` 24 米）横贯东西，东缘大道经接入道连到既有高速北向支线端点；西南侧另有产业与市政带（支路 + 电厂、填埋场、污水处理厂、抽水站、变电站、风电、通信塔）。
- 用途：低密住宅 139 街区、中密排屋 44、中密住宅 4、低密商业 6、服务预留 6、殡葬 1；服务预留区含 2 所小学、社区诊所、消防站、警察分局与中心公园，住宅带内另有 6 处街区级口袋公园/儿童活动场。
- 人口核算：低密按 18 户/街区、中密排屋 36 户/街区、中密住宅 50 户/街区估算，共 4,286 户；按 2.2–2.8 人/户得 9,429–12,001 人，中位 10,715 人。这是沿街面宽的估算口径，不是游戏最终人口。
- `plan_id` 由脚本用 `computeCityPlanId` 写入文件，与 `render_city_plan` / `prepare_city_plan_construction` 同一哈希；改任何几何都会换哈希，施工前必须重新渲染并重新确认。

重新渲染（只读，不暂停城市、不产生任何实体）：

```text
node tools/scratch/generate-town-plan.mjs
node mcp/render-live-plan.mjs artifacts/egelin-plateau-town-plan.html --plan plans/egelin-plateau-town-plan.json
```

规划几何已按当前 58 个已购地图格离线校验（`mcp/planning-validator.mjs`）为 0 错误 0 警告，规划范围内没有既有建筑。这仍只是施工图预检，正式建设必须逐批走游戏原生 preview。

`node tools/tests/test-town-plan.mjs` 是这份规划的回归测试：离线核对 `plan_id` 哈希、坐标有限性、8 米对齐、id 唯一性与人口口径，游戏在跑时追加「全部对象落在当前已购地图格内」以及道路 prefab、分区名、建筑 prefab 的实时目录比对。

## 附录 C：三区规划（埃格林：西丘住宅 · 路口商业 · 油场工业）

`plans/egelin-region-plan.json` 是「高原镇」的替代方案：**三片互不相邻的城区，彼此只用道路连通；片区内部按黄金街区排成规整格子**。由 `tools/scratch/generate-region-plan.mjs` 从「片区 + **栅格线表** + 建筑表」展开（脚本只读、不连游戏，只写这一个 JSON）。**道路坐标不再手写**，而是由 [`GAME-PHYSICS-RULES.md` §1.2](../../reference/GAME-PHYSICS-RULES.md) 的黄金间距反推出来，改间距只需要动栅格线表里的一处数字。

- 布局：住宅 1.23×1.12 km（西南上风侧，中间一条 112 m 宽东西向绿带放学校与公园，绿带内不划区）、商业 0.60×0.46 km（贴高速北向支线终点）、工业 0.86×0.35 km（东北下风向，压在实测油斑上）。三片之间最近间隔 184 m。
- 道路：36 条 / 25.25 km，**全部为单段直线**（弯曲比 1.000，由回归测试守住），单段 112–192 m。
  - 住宅区：**东西向 9 条本地路中心距 112 m**（`Small`↔`Small` → 路缘正好 96 m 黄金宽度）；**南北向 4 条集散路（`Medium Road`）间距 368/368/376 m**（doc §5 建议主干道 300–500 m），中间各插 1 条本地路把街区长边切到路缘 164–172 m（落在住宅 160–240 m 区间）。绿带处本地路断开，只留 4 条集散路穿过。
  - **住宅区有 2 处对外机动车出口**（doc §2：每个普通开发单元优先 2 个机动车出口；整片 1.2 km 只开一个口就是瓶颈）：南出口在东环路与三区大道的十字口 `(−1608, 544)`，北出口在「住宅北通道」东端与油场接入路的丁字口 `(−1080, 1328)`。北通道是**第 7 条东西街向东的延长段**（`res-w7`，`to_x: -1080`），走在两片区之间的空地上，两侧不划区，不占用住宅地块；它与东环路交叉，所以 4 条南北集散路都能就近上北通道。出口声明写在 `access_points` 里，测试反查坐标是否真落在两条路的交点上。
  - 商业区：**南北向 5 条带路边停车的商业街（24 m）中心距 120 m** → 路缘 96 m，其中只有 2 条穿过北端接上三区大道（doc：主干道沿线接入口应集中到集散路）；东西向 3 条本地路中心距 112 m → 路缘 96 m，最北那条与三区大道（`Large Road`）中心距 120 m = `96 + (32+16)/2`，路缘同样正好 96 m。
  - 工业区：**厂区主街用 6 车道 `Large Road`**（doc 要求工业货运走四/六车道集散路），与南北两侧本地路中心距 120 m → 路缘 96 m；4 条南北向本地路与西界油场接入路（`Medium Road`）中心距 184 m → 路缘 164–168 m。
  - 全城唯一高速接入点由「三区大道」承担；货车路径为 高速 → 三区大道 → 油场接入路 → 厂区主街，全程不穿住宅。
  - 两台风机挂在住宅北通道北侧（`x −1200 / −1376`）——原来它们挂在一条单独的「能源支路」上，但那条路与北通道在 `x −1440~−1080` 平行相距仅 24 m（两条 16 m 路的路缘只剩 8 m），已撤销合并。
- 分区：不手画多边形，而是按 8 米格逐格判断「到最近路缘的进深」再合并成长条矩形，共 140 块（规整网格让长条合并更彻底，块数比弯曲版少得多）。
- 人口核算：按分区类型汇总可划区面积后 `round(面积 ÷ 户均占地)`（低密 300 m²、中密排屋 170 m²、中密 120 m²），得 4,036 户；每户 2.2–2.8 人，中位 **10,090 人**（区间 8,879–11,301）。
- `plan_id` 同样由 `computeCityPlanId` 写入，改任何几何都会换哈希。

重新渲染与校验：

```text
node tools/scratch/generate-region-plan.mjs
node mcp/render-live-plan.mjs artifacts/egelin-region-plan.html --plan plans/egelin-region-plan.json
node tools/tests/test-region-plan.mjs
```

`tools/tests/test-region-plan.mjs` 的 45 项断言里有五条是这份规划特有的、**图上完全看不出来的**不变量：

1. **黄金街区：对开道路的路缘间距必须精确等于 96 m。** 测试读规划自述的 `golden_block.axes`（哪个轴走黄金宽度、哪个轴走街区长边），再按**实际坐标**逐组反查。这条能拦住「把中心距从 112 改成 104（少 8 m）」这类只差一格的错误——图上几乎看不出，实际两侧分区块会在中间重叠成 Shared 格。
2. **所有道路都必须是单段直线**（折线长度 = 首末直线距离）。哪怕只是手写控制点造成的 ±4 m 起伏，也会被拦下。
3. **路网必须是单一连通分量。** 支路端点如果没真正落到相邻路上，就会和环路错开十几米——图上看着接上了，实际整条路谁都不连，那片分区在游戏里永远没有车流。生成器自带同一套校验，不通过就直接抛错。
4. **分区进深必须落在 `[0, 48] m`（自路面外缘算起）。** 依据是反编译的 `Game.Zones.BlockSystem`：块中心 = 道路外缘 + 24 m（3 格 = 块深一半），`m_Size.y` 恒为 6 格。这条口径同时修正了 [`docs/reference/GAME-PHYSICS-RULES.md`](../../reference/GAME-PHYSICS-RULES.md) 里「中心线间距 96 m」的旧说法。
5. **对外机动车出口必须是真的。** 测试读 `access_points` 自述，再反查每处出口坐标是否真的落在 `via` 与 `to` 两条路的折线上、`to` 那条路是否**确实属于别的片区**（否则就是把片区内部路口当出口自欺），并要求住宅区 ≥2 处、两处间距 ≥400 m、每处接入路都能**独立**走到三区大道（不共用同一条瓶颈）。加了北出口后住宅区最远角的沿路距离从约 2,236 m 降到约 1,980 m。
