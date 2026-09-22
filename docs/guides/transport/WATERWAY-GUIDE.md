# 航道 MCP 接口

## 渔港码头控制点（Pathway，不是航道）

渔港主体可能自带高于水面的 `Narrow Boatway` Pathway 码头。其 `LocalConnect` 控制点需要先延长码头，才能尝试放置要求连接的附属建筑；`preview_waterway` 只建设船舶航道，不能接入该 Pathway。先在当前城市调用 `list_pier_pathway_prefabs` 和 `list_pier_pathways`，取得精确 prefab 名称及永久控制节点 ID。暂停城市后，以控制节点作为 `start_node_id`，传 `end`（世界 x/z）或另一永久 `end_node_id`，调用 `preview_pier_pathway`；等待 `get_pier_pathway_operation` 返回 `preview_ready`，核对碰撞、净空、错误与费用，再用独立提交 `request_id` 和费用上限调用 `apply_pier_pathway_operation`。只有 `completed` 且 `list_pier_pathways` 回读到永久边和节点连接，才算码头延长完成。取消未提交预览使用 `cancel_pier_pathway_preview`。首版仅支持单段直线；仍须实机验证附属建筑是否可吸附，不能把码头连接等同于渔业设施已经投产。

2026-09-21 渔港实机诊断：一段从永久 `Fishing Pier` 控制节点向水面延伸约 49 米的预览返回原生 `OverlapExisting`，没有提交，也没有新增永久码头。仅补建筑 owner 临时升级定义和新路径 `OwnerDefinition` 后，同几何实机预览仍被拒。对照原生 NetTool 发现，它还会把 owner 已有的附属边作为原对象加入预览，以免旧码头与新码头互判为重叠；源码已补齐这一环节并通过暂存构建。2026-09-22 在游戏 1.6.2f1、CityWeaver 1.23.2、奥本山存档中实机验证通过：从新建水产主楼（`Aquaculture Area Placeholder -Water`）15 米 `Fishing Pier` 的水侧控制节点沿原方向延长 120 米，原生预览 `preview_ready`、提交 `completed` 并回读到 120.0 米永久边与新末端控制节点，未再出现 `OverlapExisting`。遇到该错误仍应回读原操作和永久边，不能忽略碰撞强制提交。

是否可用于当前游戏，以运行中的 `get_query_capabilities` 为准。2026-09-20，在游戏1.6.2f1、CityWeaver 1.23.1、奥本山存档中，已完成标准货运港口、同型普通航道接入和货运航线施工，并读到首艘货船。此验证不覆盖所有港口资产、异宽航道接头或实际装卸吞吐。MCP 134项测试及官方后处理构建已通过。

## 渔港船道连接（Narrow Boatway / Pier Boatway 是航道 prefab）

`Narrow Boatway` 和 `Pier Boatway` 不在 `list_pier_pathway_prefabs` 中（`preview_pier_pathway` 会报 `PIER_PATHWAY_PREFAB_NOT_FOUND`），但它们是 `list_waterway_prefabs` 中的 Ship 型航道 prefab（宽 46 米、单段上限 1000 米、Floating、约 16/24 每米），**可以也必须用 `preview_waterway` 绘制**。入口类升级（如 `Openwater Fishing Area Entrance`）的 SubNet 含 Narrow Boatway 短 stub 和永久节点；从码头两侧 Pier Boatway 的自由末端节点出发，用带 `node_id` 的 `points` 接入入口 stub 节点即完成"码头 → 采集区"船道连接。2026-09-22 奥本山 1.23.2 实机验证：西侧 Pier Boatway 末端 → 3 段 Narrow Boatway（186/206/109 米，含 46° 折角，直线段）→ 捕鱼入口 stub 节点，预览 `preview_ready`、提交 `completed` 并回读到永久边链，费用 1,008。注意避开既有采集区（`OverlapExisting` 的 validation_entities 会列出被撞的 Area 实体及 owner）和既有船道 46 米全宽；折角约 82° 的手动连接先例也被原生接受。水上区域和船道须以 `list_waterways`、SubNet/SubArea 回读发现，`list_pier_pathways` 不包含 Boatway。

## 捕鱼路线（Fishing Line / WorkRoute）

水产建筑的捕鱼路线是 `Fishing Line` prefab 的 WorkRoute 实体，由游戏内 `RouteToolSystem`（requireRoutes=WorkRoute、requireNet=Waterway、serviceUpgrade=true）手绘创建。MCP 工具组：`list_work_routes` / `get_work_route`（**仅列出 WorkRoute**）、`preview_work_route` / `get_work_route_operation` / `apply_work_route_operation` / `cancel_work_route_preview` / `delete_work_route`。删除工具仅接受 WorkRoute，不接受公交、铁路等普通路线。它给路线实体加 `Deleted`，让游戏系统级联清理航点、路段和车辆，同时摘除主楼 `SubRoute` 与泊位 `ConnectedRoute` 注册；须先暂停城市。预览是模组保守预检，不是原生临时路线预览，详情见 [WORKROUTE-GUIDE.md](../routes/WORKROUTE-GUIDE.md)。

2026-09-22 实机曾确认：已有 MCP 捕鱼路线能挂接泊位/水上作业点、生成车道与路线段、派船出海，游戏内路线面板可见，读档后 owner 归属正常。这不代表任意新航点都会成功；一次明显越界的航点曾错误返回 `preview_ready`，现已加入地图边界、水域航段、owner 兼容性和工作船型号门禁，并在提交前重检。无现有同类路线时，船型从匹配 `WorkRouteData` 的已解锁 `WorkVehicleData` / `WatercraftData` prefab 发现。实现仍直接创建 ECS 路线/航点/路段，`AccessLane`/`RouteLane`/路段寻路和曲线由游戏系统反应式补齐。**`completed` 只表示永久路线已写入，不保证派船或生产；必须在模拟运行后回读 `PathInformation`、`PathElement`、`RouteVehicle`。** 使用建议：航点从泊位附近开始，后续沿可通行水域布置且不要重复首点；owner 传水产主楼。鱼群分布用 `read_environment_grid(system="Game.Simulation.NaturalResourceSystem")` 的 `m_Fish.m_Base/m_Used`（256×256、每格 56 米）。

## 工具与流程

1. `list_waterway_prefabs`：发现真实 Seaway 名称、宽度、长度限制、费用和锁定状态。
2. `list_waterways` / `get_waterway`：读取永久航道、Bezier 曲线、端点节点与 owner。
3. `preview_waterway`：暂停城市后，以 `waterway_prefab`、稳定 `request_id`、2–16 个 `points` 预览。可传逐段 `curves`（quadratic/cubic，null 为直线）和 `min_radius_m`。
4. `get_waterway_operation`：等待 `preview_ready`，核对 `can_commit`、错误、警告及费用。
5. `apply_waterway_operation`：传 `operation_id`、稳定提交 `request_id` 和整数 `max_cost`；轮询原操作，只有 `completed` 才确认应用。
6. 按 `created_waterway_ids` 回读永久航道及网络连接；港口建成后发现真实 Ship 货运站点，另走运输线路预览/提交，验证寻路和运营。

不提交时调用 `cancel_waterway_preview`。拆除用 `preview_waterway_delete(waterway_edge_ids)`，最多64条；拒绝单独拆除具有 Owner 的设施内部航道。

## 几何与恢复边界

- 新端点高度来自实时水面，不接受 `elevation_m`。使用 `node_id` 精确连接航道节点，或 `edge_id` 在已有航道8米内分接；两者不能同时提供。
- 端点验证拒绝普通道路或轨道。曲线长度遵守当前 prefab 限制，至少16米；不自动切割超长路线。
- 曲线模式默认最小采样半径150米，相邻段切线偏差不超过5度。既有航道接头的转弯角仍需设计检查和原生预览。
- `minimum_water_depth_m` 默认2米，是可调预筛阈值，不代表所有船舶的通航保证。沿曲线约每8米采样，在中心、两侧半幅和两侧边缘检查水深；提交前重采样。有限样本不能排除样本之间的浅滩，必须结合原生预览及运营验收。
- 不自动挖河、改变地形、购买地图格、放置港口或创建航线。原生网络错误、费用限制、暂停/工具忙限制继续生效。
- 与道路共用事务日志和 4096 次会话上限。满额时存档并重载，重新发现会话和实体ID；禁止通过改 request_id 绕过失败或未知结果。
- 临时对象必须是航道 prefab；应用后必须读到永久 `Game.Net.Waterway` / `WaterwayData`。`outcome_unknown` 先查原操作与永久对象，不盲目重建。

部署后可运行 `node mcp/smoke-waterway.mjs placement.json` 验证预览并取消，不永久施工。输入JSON就是 `preview_waterway` 参数，必须取自当前城市；脚本要求游戏暂停。

## 2026-09-20 实机预览与修复

奥本山1.23.0会话验证：Narrow Seaway独立300米直线原生预览通过，费用3040，已取消，未永久施工。Narrow Seaway分接Medium Seaway时出现两条 `UNEXPECTED_WATERWAY_PREVIEW`，已定位为原航道分割保留段，原航道未改动。1.23.1只允许与明确接入的原航道同prefab、长度不超过原边且9个采样点距原曲线不超过1米的保留段；不放宽任意错误prefab。

同时修复岸线建筑基础预筛：仅干地样点参与基础高差，水下海床仍交原生岸线验证。原道路入口高程、道路兼容性及其他原生验证均保留。1.23.1重启实测返回10个岸线候选，其中一个通过原生预览并建成；但Narrow Seaway分接Medium Seaway仍出现一条 `UNEXPECTED_WATERWAY_PREVIEW`，异宽接头问题尚未完全解决。同型Medium Seaway接入既有航道及港口内部航道已完成施工，不得将同型成功推广为异宽也已修复。

## 港口施工与验收要点

1. **先准备陆侧，再重新选址。** 已授权的接港道路、局部台地完成后，用 `plan_transport_facility_site(mode="shoreline")` 重新获取候选。基础高差只检查干地，不把海床起伏当成建筑基础高差，也不能因此跳过港池水深检查。将候选完整的坐标（包括高度）、朝向和绑定ID原样传入预览；`road_edge_id` 与 `snap_target_id` 二选一。几何调整后必须重新发现候选。
2. **候选不等于可建位置。** 本次最接近概念位置的候选被原生拒绝，向西约50米的另一候选通过。1.23.1建筑错误数组可能仅显示出错对象的 prefab（如 `Medium Seaway`），不能据此断言“缺少航道”或“水深不足”；应检查原生预览、候选和具体几何，不忽略错误强制提交。
3. **港口内部航道与停靠点分别发现。** 主体完成后，使用 `list_waterways` / `get_waterway` 发现内部Seaway边和节点，再以 `edge_id` 或 `node_id` 精确连接；不要拿建筑中心、船舶停靠点坐标或概念港池出口代替航道端点。`get_transport_facility.owned_tracks=[]` 不代表没有内部航道，该字段不能代替航道查询。内部边的 owner、道路绑定及会话ID均须回读。
4. **调整航道资产后重查完整占地。** 本次普通航道宽210米，原128米宽规划水深走廊不足以证明它可施工。应按实际宽度重新检查已购区域、全宽水深和碰撞。Boatway不能仅因更窄就作为大型货船航道替代。分段贝塞尔需检查每段最小曲率半径及段间切线；终点切线过急也会触发 `WATERWAY_RADIUS_TOO_SMALL`。本次最小采样半径约235米、水深筛查4米是项目参数，不是所有船舶通航的统一标准。
5. **保留原生分割与取消语义。** 接入既有边会拆分原边，结果对象数量可能多于规划段数。本次5段规划返回7个永久航道ID，应逐一回读并核对端点拓扑，不能按数量重复补建。`USER_CHANGED_TOOL` 时先查原事务是否取消及是否提交；未提交且用户回到默认工具后，可记录原因并开启新预览。结果未知时只查询原操作，不能以新ID重建。
6. **线路与供能分别验收。** 用真实货运Ship停靠点和外部连接创建 `Cargo Ship Route`，经过原生往返寻路预览后提交；线路 apply 必须沿用 preview 的 `request_id`。港口永久 `m_RoadEdge` 应指向兼容普通道路。运行少量模拟后，检查 ElectricityConsumer 的连接标志及 fulfilled/wanted、WaterConsumer 的给水/污水连接与满足量；暂停时全零不能证明供能成功。`list_utility_connection_points` 面向公用设施，本次标准港口会返回 `UTILITY_FACILITY_NOT_FOUND`，不能因此判定港口断供。
7. **区分建设、派船与运营。** 线路 `completed`、永久回读、`complete=true`、启用及港口停靠点激活是建设验收；读到真实ShipCargo车辆才证明已经派船。首船生成不证明已经靠港、装卸或达到吞吐目标。若 `route_distance_m=-2`，保留未解析原值，不把它当作有效距离，也不单凭此字段判定线路失败。

### 本次验证证据（历史记录，不可复用实体ID）

- 港口永久施工：[harbor-facility-completed.json](../../../artifacts/harbor-facility-completed.json)。
- 航道完成及曲线：[harbor-waterway-completed.json](../../../artifacts/harbor-waterway-completed.json)；永久对象：[harbor-waterways-completed.json](../../../artifacts/harbor-waterways-completed.json)。
- 货运航线：[harbor-line-completed.json](../../../artifacts/harbor-line-completed.json)；首船与水电污水：[harbor-final-readback.json](../../../artifacts/harbor-final-readback.json)。
- 道路费用8,252、港口490,000、航道51,840，合计550,092。费用、坐标、资产与几何只描述此存档，不作为其他城市默认施工参数；实际靠港装卸尚未验收。
