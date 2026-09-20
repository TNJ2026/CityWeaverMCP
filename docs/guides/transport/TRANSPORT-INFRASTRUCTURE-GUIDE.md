# 公共交通基础设施与轨道

自 MCP 1.14.0 起提供 25 个 MCP 工具，用于发现、规划、放置、移动、升级、启停、命名、设置政策和拆除公共交通设施，并创建、连接和拆除火车、地铁及有轨电车轨道。全部结构写操作沿用预览、读取状态、提交、再验证的事务流程。

## 设施

### 道路公交站牌、顶棚与有轨电车站点

独立道路站点不是公交站建筑。`list_road_stop_prefabs` 枚举当前加载的、支持 `RoadEdge` 放置的公交及有轨电车 `StaticObjectPrefab`，排除车站建筑和升级。可按 `transport_type="Bus"` 或 `"Tram"` 筛选，默认 `"all"`。返回 `requires_tram_track`，不要将这些站点名称传给建筑放置工具。

有轨电车沿用同一套选址、预览、提交、查询和取消接口。选择带有永久电车轨道车道的道路；兼容检查读取实时 `SubLane`、`TrackLane` 和 `TrackLaneData.m_TrackTypes`，所以也支持通过道路升级添加的轨道。无电车轨道时报 `TRAM_TRACK_REQUIRED`；提交前及永久回读再次检查，永久对象还必须具有 `Game.Routes.TramStop`。这里不负责铺轨，不接受纯独立轨道边，也不保证所选道路侧能上下客；具体方向、站台净空和接驳由原生预览及后续线路寻路验证。

1. 查询目录和永久道路，选定精确 `stop_prefab` 与 `road_edge_id`。
2. `plan_road_stop_site` 接收这两个字段、`edge_parameter`（道路曲线参数，0.05–0.95，默认0.5）和 `road_side`（相对道路曲线起终方向的 `left` 或 `right`）。候选位置读取道路当前的 `EdgeGeometry`、`NetCompositionData` 和 `NetCompositionArea`，按游戏原生尺寸规则吸附到指定侧人行道的可建区域；不使用道路预制件的半宽作为位置，不选择中央分隔带。没有足够宽的可建人行道时返回 `ROAD_STOP_NO_BUILDABLE_SIDEWALK`。候选临路位置不是原生通过证明。
3. 暂停后，以完全相同的四个字段及稳定 `request_id` 调用 `preview_road_stop_placement`。接口重新计算候选，避免传入任意坐标配错误道路 ID。
4. 轮询 `get_road_stop_operation`，只有 `preview_ready`、`can_commit=true`、无错误及警告才调用 `apply_road_stop_operation(operation_id, request_id, max_cost)`。
5. `completed` 额外要求永久对象具有 `TransportStop`、`ConnectedRoute` 缓冲区以及指向目标永久道路的 `Attached.m_Parent`；返回 `result_stop_ids` 可用于线路站序。超时或 `outcome_unknown` 只能先查原操作，不能换 ID 重建。
6. 未提交预览使用 `cancel_road_stop_preview`。预览若会删除现有对象则拒绝；本工具不会替换旧站或自动修改线路。

替换公交站建筑时，先建新道路站点并用线路工具验证完整站序可寻路，再拆旧站，避免先拆导致环线失效。这里只验收道路吸附，线路可达和乘客步行接驳仍须通过线路原生寻路与运营观察确认。

验证脚本：`node mcp/smoke-road-stop.mjs placement.json`。文件包含 `stop_prefab`、`road_edge_id`、`edge_parameter` 和 `road_side`；自动识别公交或电车，要求已暂停，执行预览/取消、幂等冲突及预算拒绝检查，不永久施工。电车测试可另传一个已知无轨道路 ID 作为第三个命令行参数，验证 `TRAM_TRACK_REQUIRED`。2026-09-20 已在奥本山存档验证 `NA_BusStop02`：小型道路与大型道路左侧的预览、永久放置及 `Attached.m_Parent` 回读通过，两个站点成功接入既有公交环线。此记录不代表有轨电车、其他道路断面或所有资产已完成实机验证。

`list_transport_facility_prefabs` 枚举当前游戏实际加载并已解锁的客运/货运车站、车辆段、机场、港口和交通枢纽。结果包含精确 prefab 名、运输类型、轨道类型、容量、占地、物理尺寸、建造费用和原生放置模式。

## 公共交通设施建设要求

下表描述稳定的设施族规则，不是固定 prefab 清单。资产包和 DLC 会增加同类车站、车辆段、枢纽和升级；施工前仍须以 `list_transport_facility_prefabs` 返回的当前城市真实 prefab、`placement`、尺寸、轨道类型和解锁状态为准。

| 系统 | 必要设施 | 前置网络与放置要求 | 关键物理规则 |
| --- | --- | --- | --- |
| 公交 | 公交车辆段；道路上的站牌/候车亭；可选公交站/枢纽 | 车辆段、车站和站点必须接入可寻路道路；站点只能依附兼容道路 | 公交与普通交通共享道路并受拥堵影响；公交专用道路或公交优先车道可减少干扰。同一站点可服务多条线路，但车辆叠加会造成排队。电动公交需要车辆段的兼容升级。 |
| 出租车 | 出租车车辆段；出租车候客站；可选调度中心升级 | 车辆段和候客站需要道路与城市路网 | 出租车不需要固定线路、容量低且会增加道路交通。未安装调度中心升级时只能从候客站接客；升级后才可在城市范围内接单。 |
| 客运火车 | Rail Yard；客运火车站；连续兼容铁轨 | 车辆段和车站内部轨道必须接入同一可寻路铁轨网络；城际服务还要连到铁路外部连接 | 可用单线、双线、单向线、高架、桥梁、隧道和路堑。火车可双向运行；连接双向/双线轨道可形成道岔，车站内部轨道接入时由游戏形成兼容道岔。 |
| 货运火车 | Rail Yard；货运火车站；铁轨；货车道路入口 | 同时需要可寻路铁轨与道路货运通道；对外货运需要铁路外部连接和货运线路 | 货运站兼具存储/分拨作用，即使没有货运线路也可能被本地卡车使用。吞吐会产生大量卡车，不得把唯一出入口放在住宅道路或紧贴拥堵路口。 |
| 有轨电车 | Tram Depot；站点；连续兼容电车轨道 | 车辆段必须接轨；轨道可嵌入兼容道路，也可独立铺设 | 支持单向/双向、地面、高架、桥梁、路堑和隧道。道路嵌轨会与路口及道路交通相互影响；独立路权减少冲突，但仍需站点步行可达。 |
| 地铁 | Subway Yard；地面/地下/高架车站；连续专用地铁轨道 | 车辆段与所有站台必须接入同一可寻路地铁网络 | 支持单向/双向、地面、高架、桥梁、路堑和隧道。地下站入口占地较小，但站体、轨道曲线、坡度、隧道净空和其他地下网络仍须通过原生预览。 |
| 客运船舶 | 客运港口，或港口主门 + Passenger Terminal；Seaway；船舶线路 | 港口须满足岸线/水深放置规则，并接到可达地图边缘的航道；陆侧需要道路和步行接驳 | 城际船运只有在港口、航道和外部连接形成连续路径后才能运行。客运码头建成不等于航线已创建。 |
| 货运船舶 | Cargo Harbor，或港口主门 + 仓储 + 码头/起重机；Seaway；货运船线路 | 同时需要岸线/水深、连续航道、道路货运入口和存储能力 | 港口会产生大量卡车；铁路升级还需连接兼容铁轨。仓储、泊位与陆侧道路任一断开都会限制吞吐。 |
| 航空客运 | 机场；航空线路 | 需要大块连续净空和道路接入；使用线路工具直接连接航空外部连接 | 不需要额外铺设航空网络。跑道两端的起降区会限制分区建筑高度，必须把整条限高走廊纳入选址和后续规划。 |
| 航空货运 | 机场 + 兼容货运航站升级；航空货运线路；道路货运入口 | 除机场条件外，还要为货运航站、卡车排队和扩建预留空间 | 容量通常低于火车和船舶但速度高；航空不受城市道路拥堵影响，机场陆侧卡车仍受道路容量约束。 |
| 渡轮（Bridges & Ports） | Ferry Stop 或 Ferry Terminal；兼容水上路径与线路 | 小型站可放在 quay 上，大型站使用岸线；所有站点必须存在连续可航行水路 | 渡轮用于城市内部客运。Ferry Terminal 可增加码头站位并升级公交换乘；桥梁、狭窄航道和水域几何不能阻断实际航路。仅在 DLC/资产已加载时适用。 |
| 多式联运枢纽 | 当前资产提供的组合站、站点或升级 | 每一种模式都必须分别连接自己的道路、轨道、航道或航空线路 | 建筑共址不代表网络自动互通；逐模式验证站点、车辆段、网络和线路。City Stations 等资产包会增加同类车站与升级，但不改变这一规则。 |

官方给出的陆上交通建设链是“车辆段/车场 → 站点或车站 → 道路/轨道 → 线路”。车站建成、轨道相接和线路存在是三个不同状态，缺一项都不能报告为已运营。[官方公共与货运交通说明](https://www.paradoxinteractive.com/zh-CN/games/cities-skylines-ii/features/public-cargo-transportation)

### 可定制港口与渡轮（Bridges & Ports）

- 港口从 Small/Medium/Large Port 主门开始；主门确定后不能更换尺寸。所有港口 sub-building 必须位于主门 `1 km` 半径内。
- 可运行货运港的最小逻辑组合为主门、与货物类型兼容的仓储、Port Quay/Cargo Crane、通向外部的 Seaway 和 Cargo Ship Route。仓储设施按资源类型限制可存货物。
- 港区车辆应通过主门或 Auxiliary Gate 出入；用非门控道路绕过 gate 会使港口效率降低 `50%`。Reach Stacker 只能行驶在 Port Road；普通道路仍可承担其他港区货运，但不能为 Reach Stacker 提供路径。
- Passenger Terminal 提供客船泊位；Intermodal Train Station 提供两条铁路接入。二者仍需分别建立船舶/铁路线路和连续网络。
- 渡轮小站可依附 quay，大型站依附 shoreline；Ferry Terminal 可增加码头或公交换乘升级。先验证水路，再创建站序和线路。

这些规则来自官方 2025 年港口开发日志；只有当前城市加载 Bridges & Ports 且实时 prefab 发现成功时才能据此施工。[官方港口与渡轮开发日志](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/bridges-and-ports-dev-diary-ports)

典型流程：

1. 用 `list_transport_facility_prefabs` 选定 prefab。
2. 用 `plan_transport_facility_site` 在目标区域搜索候选位置。规划器会根据 prefab 自动选择路旁、岸线、水面、道路边或道路节点规则。
3. 调用 `preview_transport_facility_placement`，轮询 `get_transport_facility_operation` 直到 `preview_ready`。
4. 调用 `apply_transport_facility_operation`，再读取操作直到 `completed`。
5. 用 `get_transport_facility` 检查永久实体、内部站点、车辆和自带轨道。

移动和拆除分别使用 `preview_transport_facility_move` 与 `preview_transport_facility_delete`，随后走相同的读取、提交和验证流程。预览未提交时可用 `cancel_transport_facility_preview` 清理。

`list_transport_facility_upgrades`、`preview_transport_facility_upgrade` 和 `preview_transport_facility_upgrade_removal` 覆盖兼容升级模块；名称、启停和政策使用 `set_transport_facility_name`、`set_transport_facility_active`、`list_transport_facility_policies` 与 `set_transport_facility_policy`。升级列表复用通用建筑升级几何，返回主体侧吸附点，并在原生范围允许时返回 `road_side_candidates`。主体侧模式使用返回的 `placement_side` 与 `placement_offset_m`；道路侧模式必须把候选的 `position`、`rotation_degrees` 和 `road_edge_id` 原样传给 `preview_transport_facility_upgrade`。隔着道路仍保持设施所有权，但不能覆盖道路，最终以原生预览为准。

## 航道

Seaway 查询、原生预览、提交、取消和拆除接口见 [航道 MCP 指南](WATERWAY-GUIDE.md)。当前源码已接入，运行游戏是否支持须检查 `get_query_capabilities`；不能用铁路或普通道路接口冒充航道。

标准货运港口的岸线候选、内部航道接驳及水电污水/首船验收，按 [港口施工与验收要点](WATERWAY-GUIDE.md#港口施工与验收要点) 执行。1.23.1已完成同型Medium Seaway接港实测；异宽Narrow→Medium接头仍有限制，不能根据同型成功推断异宽可用。

## 轨道

`list_transport_track_prefabs` 返回游戏中的 `TrackPrefab`，包含 Train、Subway、Tram 类型及速度、宽度、最大坡度、允许长度、高程范围和单位长度费用。`list_transport_tracks` 与 `get_transport_track` 读取永久轨道、端点节点、曲线和所有者。

`preview_transport_track` 接受 2 到 16 个点；未传 `curves` 时，相邻点形成直线段，传入时按下文“轨道曲线接驳”创建真实曲线：

- 新点使用 `x`、`z`，可用 `elevation_m` 指定相对地形高度。
- `node_id` 精确连接已有轨道节点。
- `edge_id` 在指定位置切分并连接已有轨道边；坐标必须在目标边 8 米内。
- 同一点不能同时指定 `node_id` 和 `edge_id`。

预览会检查 prefab 锁定状态、长度、高程、坡度、碰撞和游戏原生警告。提交使用 `apply_transport_track_operation`；完成后返回 `created_track_ids`。删除使用 `preview_transport_track_delete`，单次最多 64 条永久轨道。

## 约束

- 写操作要求城市已暂停且当前是默认选择工具。
- `request_id` 提供幂等保护；重试同一请求必须复用完全相同的参数。
- `operation_id` 和实体 ID 只在当前城市会话有效。
- 设施自带的内部轨道和站点由游戏作为子对象管理。删除设施时应让游戏处理其从属对象，不要单独拆除这些内部轨道。
- 轨道创建提供几何连接能力；可运营线路仍需兼容的车站、站点和完整可寻路网络，并通过公共交通线路工具建立路线。
- 道路、轨道或航道在画面上相交，不代表形成网络节点。必须使用完成结果中的节点/边和线路原生寻路回读证明连接。
- 车辆段容量限制可用车辆数；新增车站或线路不会自动增加车辆段容量。升级、增加车辆段或降低线路目标车辆数应依据实时需求。
- 站点入口要有可达步行路径；轨道网络连通但乘客无法走到站点时，线路仍不能形成有效服务。
- 客货运大型设施须为升级、站前集散、排队和服务车辆留空间。机场还要保留跑道端限高走廊，港口/渡轮还要保留连续航道和岸线净空。

## 官方资料边界

本文于 2026-09-18 复核了官方的[公共与货运交通机制](https://www.paradoxinteractive.com/zh-CN/games/cities-skylines-ii/features/public-cargo-transportation)、[Bridges & Ports 港口/渡轮机制](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/bridges-and-ports-dev-diary-ports)和[City Stations 资产范围](https://www.paradoxinteractive.com/games/cities-skylines-ii/add-ons/cities-skylines-ii-city-stations)。官方页面说明系统规则，但不保证每个版本、地图和资产包的精确占地、坡度、容量或内部 prefab 名称；这些字段必须在当前城市通过 MCP 实时发现并以原生 preview 为最终裁决。

## 交通走廊高层流程

`deploy_transit_corridor` 按“交通设施 -> 轨道 -> 线路”顺序串行建设。当前实现（`mcp/city-workflows.mjs`）只转发轨道 prefab 和连续点列，未转发 `curves`/`min_radius_m`；需要曲线时使用直接轨道接口。线路必须传入当前城市真实且兼容的 `stop_ids`；轨道预览或提交失败时不会创建线路。每阶段保留原生 operation ID，`outcome_unknown` 只能查询原操作。

## 轨道曲线接驳

`preview_transport_track` 支持 `curves` 数组，与 `points` 的每一段一一对应；元素为道路接口同格式的 quadratic/cubic 控制点，`null` 表示直线。省略数组时保持原来的折线行为。曲线链默认 `min_radius_m=150`，显式参数范围为 0–5000 米；这是设计检查值，不是现实铁路标准或游戏统一限制。

预览会检查水平曲率采样半径、退化尖点、相邻段切线偏差（最大 5 度），以及原有长度、坡度、碰撞规则。半径基于每段 257 个样本，不是解析最小值证明；施工应留出裕量。`curve_segments` 返回控制点和采样半径，直线半径为 null。连接现有轨道时还必须回读其端点切线，选择同向平缓并入；该接口尚未自动检查既有网络接头角度。原生施工完成后仍须回读实际曲线并检验连接和寻路，不能以预检替代竣工验收。

铁路站区的联合选址、附属端口、原生道路合并、永久曲线和实际调度检查见 [铁路站区检查清单](RAIL-STATION-CHECKLIST.md)。
