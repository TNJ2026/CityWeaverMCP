# 城市规划图

`render_city_plan` 是只读高层 MCP 工具。它把指定范围内的实时道路、建筑、交通轨道和独立公用管网作为背景，再叠加尚未施工的规划，输出 SVG 图片或交互式 HTML 资源和稳定的 `plan_id`。调用不会暂停城市、创建原生临时实体或授权施工。

第二版交互输出通过 `render.format="interactive_html"` 启用，支持道路、建筑、分区、轨道、管网以及“现状/规划”图层开关；地图对象可点击或用键盘选择并查看类型、图层和状态。`render.view="combined"` 把地下对象以虚线叠加在同一张图中。

默认还会用 `read_surface_water_mask` 按原生水深采样当前已购区域，以半透明水域底图呈现河流、湖泊、河湾和小型积水。水岸线采用 Marching Squares，并在相邻采样点间按水深阈值插值，不再绘制成采样方块；湖中岛等干地区域会作为 SVG 孔洞保留。`water_cell_size_m` 控制精度，默认 8 米、最小 2 米。为避免超大已购区域产生不受控的采样量，超过 750,000 个采样点时会自动适度降低实际分辨率，并在结果的 `requested_cell_size_m`、`cell_size_m` 和 `adaptive_resolution` 中明确报告。水体名称仍只是按轮廓形态推断，并不是游戏提供的水体分类。可用 `include_water=false` 关闭。

自动网格选址会把采样水体作为高优先级冲突项，优先选择 `surface_water_conflicts=0` 的干地区域；这仍是按采样分辨率进行的前置筛查，正式施工继续以游戏原生 preview 为准。

规划图还会通过 `sample_terrain` 读取已购区域高度，并以默认 64 米网格估算坡度：5°–12° 显示为中等坡度，超过 12° 显示为陡坡。自动网格按 `maximum_slope_degrees`（默认 12°）和地块高差避让陡坡；可用 `include_terrain=false` 关闭，或通过 `terrain_cell_size_m` 调整采样精度。坡度是采样估算值，不替代地形施工与道路原生 preview。

## 从规划图按比例施工道路

`prepare_city_plan_construction` 与 `advance_city_plan_construction` 让 `render_city_plan` 的结构化 `plan` 成为道路、可直接放置建筑及独立水电管网施工的唯一几何来源，而不是从 SVG 像素反推坐标。

1. 先调用 `render_city_plan`，向用户展示图片并保存返回的 `plan_id`。
2. 用户确认后，用完全相同的 `bounds`、`plan` 和该 `approved_plan_id` 调用 `prepare_city_plan_construction`。任何坐标、prefab、依赖或顺序变化都会产生不同哈希并以 `PLAN_APPROVAL_MISMATCH` 拒绝。
3. 准备结果先建立不写入游戏的虚拟施工沙盒，检查道路拓扑，并把道路、建筑和独立水电管网编译为确定性原生批次。它把网格展开为稳定对象 ID 用于图面和回读，但施工时仍把每个 `1×1` 至 `5×5` 网格保留为一次原生 `preview_road_grid`，不会逐路重复预览。
4. 普通路线按 `construction_order` 和 `depends_on` 排序；执行器以 240 米为安全上限等分长直线，避免原生端点吸附和浮点换算后恰好 256 米的边界段被拒绝；只有整条路线超过原生 16 点限制时才拆成相邻批次。虚拟沙盒不会在地下或其他位置创建游戏道路。
5. 沿 `next_action` 调用 `advance_city_plan_construction(action="preview_batch")`。该步骤只从已批准规划读取 prefab 和最终世界坐标，按批次类型调用道路、建筑、市政服务、交通设施、公用设施或独立管网的游戏原生 preview，不允许调用方另传任意施工坐标。
6. 检查返回的真实费用、警告、错误和吸附结果后，再沿 `next_action` 调用 `action="commit_batch"`。提交完成后工具按领域回读永久道路、建筑或管网；建筑还核对最终位置与旋转，全部符合才返回 `completed_verified` 并给出下一批。
7. `failed`、`cancelled`、`expired`、`outcome_unknown` 或永久回读不完整都会停止序列并保持城市暂停；不得更换 request ID 盲目重试。

修复或扩建既有城市时，规划道路点可带当前城市会话中实时发现的 `edge_id` 或 `node_id`（两者不能同时提供）。施工器会把这些锚点原样传给最终位置的原生道路预览，使端点精确拆分既有道路或接入既有节点；仅靠两条线在图面相交不会自动形成永久路口。锚点绑定城市会话，换存档或重启游戏后必须重新发现、重新渲染并再次确认规划。

同一已批准规划内，较早批次拆分道路后可能使较晚批次保存的 `edge_id` 或 `node_id` 失效。每批原生预览前，施工器会在规划坐标 2 米内回读当前永久道路；失效的道路边锚点会刷新为同一位置的新边，节点锚点会解析为同一位置当前永久道路的边锚点，并在 `anchor_rebindings` 中报告旧节点/道路边、新 ID 和距离。规划坐标、道路 prefab 或城市会话不会因此改变；坐标附近没有可用道路时停止并要求重新渲染规划。

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

## 自动网格候选

`propose_grid_plan` 是只读选址工具。它读取当前已购地图格、道路和建筑，在已购区域内搜索能够完整容纳指定 `columns × rows` 网格的候选位置，并优先选择建筑冲突少且靠近现有路网的位置。返回内容包括结构化 `plan`、候选坐标、最近道路距离、评估候选数、缺失绑定和规划图。

工具会读取当前城市的道路 prefab 和分区类型目录。未指定 `road_prefab` 时，它会从已解锁、允许分区且非桥梁的道路中选择适合网格的候选；住宅、商业和办公小街区会优先窄路。未指定 `zone_type` 时，它会按 `district_kind`、`density` 和 `theme_preference` 筛选。

`theme_preference="auto"` 会先读取 `get_city_configuration.theme`：北美城市只匹配 `NA` 分区，欧洲城市只匹配 `EU` 分区。只有主题字段不可用时，EU/NA 等多个同等有效分区才返回 `bindings.zone.status="ambiguous"`；也可显式指定 `theme_preference="eu"|"na"` 或精确 `zone_type`。只有道路和分区都绑定时才返回可直接作为 `deploy_grid_district` 输入基础的 `preview_draft`；它仍不包含预算授权，`construction_ready` 仍为 `false`，并且必须先执行游戏原生 preview。

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
    "format": "interactive_html"
  }
}
```

## 自动多层规划

`propose_city_plan` 在 `propose_grid_plan` 的选址和主题绑定结果上继续生成概念级多层方案：连接既有道路的接入口、两处公共服务建筑预留、地下给排水骨干、电力接入走廊，以及住宅/商业/办公区的地下地铁走廊或工业区的地表货运铁路走廊。`infrastructure_profile` 可选 `grid_only`、`basic`、`transit_ready` 或 `complete`。

自动生成的服务建筑、轨道和管网带有 `planning_status="conceptual"`。它们用于空间预留和方案比较，不猜测当前存档不存在的 prefab，也不假设设施中心点就是可用端口；施工前必须分别发现精确 prefab、连接层、端口与吸附目标，并走各领域原生 preview。

```json
{
  "district_kind": "residential",
  "density": "low",
  "columns": 2,
  "rows": 3,
  "infrastructure_profile": "complete",
  "power_level": "surface",
  "render": { "view": "combined", "format": "interactive_html" }
}
```

## 原生预检（不施工）

`prepare_grid_native_preview` 把已经绑定精确道路和分区名称的网格草案送入游戏原生道路 preview。它会核对当前城市中的道路 prefab、分区类型和城市主题，在需要时暂时暂停城市，等待道路预览进入终态，然后恢复原来的模拟速度。

这个入口只创建临时道路预览：不会调用 `build_road`、`preview_zoning` 或任何 apply 工具，也不会产生永久道路、分区或建筑。返回的 `construction_ready` 固定为 `false`；预览成功时会给出费用、警告、到期时间和可直接传给 `cancel_road_preview` 的 `cancel_action`。

传入 `render` 时，工具还会返回带原生预检标注的局部 SVG 或交互规划图。道路颜色、顶部摘要和对象详情会显示 operation 状态、实际费用、警告、错误及吸附后的原点；这仍然只是临时预检结果。

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

## 预检后的分阶段施工

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

## 支持图层

- 道路：现有贝塞尔曲线与规划折线，区分地表、高架和隧道。
- 建筑：现有实例位置、旋转、物理尺寸，以及规划建筑占地。
- 分区：规划住宅、商业、工业、办公或其他区域多边形。
- 交通：火车、地铁和有轨电车轨道，区分地表与地下。
- 公用管网：电力、清水、污水、合流、雨水和资源管道。

默认图片把地表与地下拆成两个面板。现有对象使用较低饱和度，规划对象使用较强描边。图片是规划示意，不代表游戏原生 preview 已通过。

## 2×3 住宅网格示例

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
    "title": "西区 2×3 住宅组团",
    "width": 1600,
    "height": 1000,
    "view": "combined",
    "format": "interactive_html"
  }
}
```

所有 prefab 和分区名称仍应从当前城市发现。SVG 中的规划几何可作为后续施工输入参考，但正式建设必须重新走对应领域的原生 preview、费用检查和永久结果回读。

## 数据边界

- `get_planning_map_snapshot` 按指定矩形读取实时几何，并对每层应用 `max_features_per_layer` 上限；返回 `truncated=true` 时应缩小范围。
- 公用管网快照包含独立网络边，不把道路内嵌管线展开成独立管道。
- 公共交通当前绘制物理轨道，不展开运营线路的完整原生寻路径径。
- SVG 是俯视规划图；高度通过地表、高架和地下分类表达，不替代纵断面工程图。
