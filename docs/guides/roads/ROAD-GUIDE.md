# MCP 铺路（1.0.0）

暂停城市时，可创建 16–256 米的单段道路或多段路线。支持直线、二次/三次贝塞尔曲线、地面、高架、隧道与连续坡道；端点可连接已有节点，也可通过 `edge_id + edge_position` 拆分既有路段形成路口。现有道路可单条或批量原地替换/拆除，还可控制各路段左右侧是否生成分区单元。

## 使用流程

1. `list_road_prefabs` 找到准确道路预设名称和解锁状态。
2. 使用查询接口读取道路/节点的实际位置，确定起终点世界坐标（米）。坐标不会自动吸附：要连接现有路网，明确提供端点 `node_id`，该节点须位于所给坐标 8 米内。
3. `preview_road` 输入 `request_id`、`road_prefab` 和端点。单段可用 `start`/`end` 以及 `control` 或 `control_1`/`control_2`；多段用 `points`。新端点可给 `elevation_m`（-50..50），已有节点/边接入点的高度由实体决定。它切换到临时工具并生成可见预览，不永久铺路。必须处于默认选择工具、没有其他预览且城市暂停。
4. 用返回的 `operation_id` 调用 `get_road_operation`。只有 `preview_ready` 才可提交；返回最终端点、长度、游戏实际预览费用、错误。
5. 用户授权该路线后，`build_road` 传入 `operation_id`、稳定的 `request_id` 和 `max_cost`。提交后继续查询，直到 `completed`，获得实际道路实体 ID。
6. 放弃方案时使用 `cancel_road_preview`。预览 5 分钟到期，切换工具也会取消。
7. `preview_road_upgrade` 输入 `request_id`、`edge_id`、`road_prefab`，保留目标道路几何、端点和高程并替换类型；随后仍用 `build_road` 提交。
8. `preview_road_demolition` 输入 `request_id`、`edge_id`，预览退款及原生删除结果；随后仍用 `build_road` 提交。
9. `preview_road_batch_upgrade` 或 `preview_road_batch_demolition` 输入 1–64 个不重复的 `edge_ids`，把整批变更作为一个预览和一次提交；批量替换还需 `road_prefab`。原生网络管线可能合并相邻兼容路段，提交后必须使用 `created_road_ids` 返回的新实体 ID。
10. `preview_road_zoning` 输入 1–64 个 `edge_ids`，并设置 `left_enabled` 和/或 `right_enabled`。省略的一侧保持原状；左右以每条边的 `start_node_id → end_node_id` 方向为准。
11. `preview_intersection_control` 输入 1–64 个至少连接三条道路的 `node_ids`。`mode` 可为 `traffic_lights`、`all_way_stop`、`uncontrolled` 或 `automatic`；最后一种清除显式覆盖，恢复游戏自动选择。
12. `preview_intersection_roundabout` 输入一个至少连接三条道路的 `node_id` 和 `enabled`。启用时由游戏原生网络系统把该节点转换为环岛、计算半径与环岛车道，并清除信号灯/全向停车覆盖；相连道路必须支持原生环岛。
13. `preview_road_features` 输入 1–64 个 `edge_ids`。可独立设置左右宽人行道、左右 `none/grass/trees` 绿化、宽中央隔离带及中央 `none/grass/trees` 绿化；省略项保持原状，不被道路预制件支持的组合会直接拒绝。
14. `preview_road_ring` 输入道路预制件、圆心、12–160 米半径和 `auto/clockwise/counterclockwise` 方向，以四段三次贝塞尔道路生成闭合圆环。`auto` 按城市左右行交通选择单向道路方向。它是独立环形道路；现有路口转原生环岛仍使用 `preview_intersection_roundabout`。
15. `preview_road_autoroute` 输入道路预制件和起终点，可规划 16–2048 米地面路线。规划器读取地形和道路最大坡度，按道路宽度留出建筑物净空，以 A* 在 `max_detour_m` 走廊中搜索，再简化为不超过 248 米的原生直线路段。`strategy` 可选 `shortest`、`balanced` 或 `gentle`。`zoning_alignment` 默认为 `true`：新端点吸附到 `grid_size_m`（该值必须是 8 米分区网格的整数倍），只走水平/垂直方向并保持 90° 转弯；已有网络接入点也必须对齐 `grid_size_m`。提交前会再次检查规划几何；永久应用后等待游戏生成原生分区格，只有块方向、全局 8 米格网相位和缓冲区尺寸验证通过才返回 `completed`，并在操作中返回 `zoning_validation=verified` 及单元格统计。游戏预览仍负责碰撞、拆迁与费用。
16. `inspect_road_zoning` 输入 1–64 个永久道路 `edge_ids`，读取每条道路实际拥有的 `Game.Zones.SubBlock → Block → Cell`。返回分区块方向、尺寸、8 米单元格网相位，以及可用临街格和 `Blocked/Shared/Occupied/Redundant` 数量。`orderly_geometry=true` 表示分区块均为正交方向、所有格子共享同一全局 8 米格网相位且缓冲区尺寸正确；具体建筑预制件能否落位仍由游戏决定。
17. `preview_road_grid` 从西南角 `origin` 生成规则或分级街区路网。`road_prefab` 是默认道路；可分别用 `horizontal_road_prefab`、`vertical_road_prefab` 指定内部横向和纵向道路，并用优先级最高的 `perimeter_road_prefab` 指定全部外围道路。省略任一可选预制件时回退到默认道路。设置 `auto_connect=true` 后，会从 `connection_sides` 指定的北、东、南、西外围节点向外搜索既有道路；每个方向至多选择一条不同目标道路，优先复用既有节点，否则精确拆分路段，并以保持街区内部完整的正交路径接入。`connection_search_radius_m` 为 16–256 米，`connection_road_prefab` 默认使用外围道路，`minimum_connections` 和 `maximum_connections` 为 1–4；未找到最低数量目标时返回 `NO_ROAD_CONNECTION`，不会进入预览。`columns`、`rows` 分别为 1–5 个街区，`block_width_m`、`block_height_m` 为 32–240 米且必须是 8 米整数倍。起点自动吸附到全局 8 米格网；街区与连接支路在同一次原生预览/提交中完成，总计最多 64 个定义路段。街区核心验证统一 8 米格网；接入不同相位的既有路网时，连接路段分别验证轴向、缓冲区尺寸和自身分区格相位。
18. `preview_road_parallel` 输入 1–32 条按路线顺序连接的永久道路 `edge_ids`，以路线行进方向为基准在 `left` 或 `right` 侧生成平行道路。`offset_m` 为 4–128 米的中心线距离，并必须大于源路和目标路半宽之和再加 1 米；过小返回 `PARALLEL_OFFSET_TOO_SMALL`。省略 `road_prefab` 时逐段继承源路预制件，因此支持混合道路类型。直线和三次贝塞尔源路都按切线法向偏移，相邻路段用连续斜接点连接；过急反转返回 `PARALLEL_SHARP_TURN`。开放及闭合路线均支持；开放路线可设置 `connect_ends=true`，在两端以 `connection_road_prefab`（默认使用目标道路类型）连接回原路网。设置 `avoid_obstacles=true` 后会采样建筑边界及其他永久道路，从请求间距开始按 4 米递增，直到 `max_offset_m`，并保留 `clearance_m` 净空。平行路和端部连接在同一次原生预览/提交中完成。
19. `preview_road_reverse` 输入一条永久单向路的 `edge_id`，通过原生道路替换管线交换首尾节点并反转曲线方向，同时保留道路预制件、几何和高程。双向道路会被拒绝；提交后只有 ECS 中端点和曲线均确认反向才返回 `completed`。
20. `preview_road_batch_reverse` 输入 1–64 条永久单向路的 `edge_ids`，把全部方向反转作为一次原生预览和提交。每条路独立保留预制件、几何和高程；重复 ID 或任意双向路会在创建预览前拒绝整批请求。
21. `preview_intersection_rules` 用 `edge_id + node_id` 指定一个路口入口；`left_turn`、`right_turn`、`straight` 可设为 `allow`/`forbid`，`crosswalk_enabled` 控制该入口斑马线。省略字段保持原值，方向会按城市左右行驶规则映射。
22. `preview_road_interchange` 接收两条平面投影相交、高差至少 4 米的永久道路，自动选择对称接入点并生成四条三次贝塞尔匝道。`ramp_distance_m` 为 32–160 米；规划器延长曲线控制柄来满足匝道坡度，四条匝道共用一次原生事务。
23. `preview_road_parking` 以 `none`、`parallel` 或 `angled` 把同一道路家族切换到游戏提供的原生停车变体。它会真正改变车道布局；没有对应变体、变体未解锁或一次请求混入多个道路家族时直接拒绝。停车费是行政区政策，不属于单条道路。
24. `inspect_road_lanes` 返回实际子车道、速度、转向、公交专用、流量和瓶颈数据。停车同时报告记录总数及 `usable_parking_lane_count`；普通道路可能拥有 `VirtualLane` 停车占位，只有非虚拟且未禁用的记录计入可用停车道。`analyze_road_traffic` 可按瓶颈、车道流量偏移和累计交通数据排序并给出扩容、平行分流或路口优化建议。
25. `repair_congested_corridor` 是拥堵修复高层流程：先分析瓶颈，再按 `upgrade`、`parallel`、`reroute` 或 `auto` 执行原生道路预览与 `build_road`。`upgrade` 对 2–64 条不重复道路会合并为一次 `preview_road_batch_upgrade`，避免前一条升级后后续旧 edge ID 失效；`reroute` 必须提供起终点且只为走廊创建一次绕行；`parallel` 可设置方向、间距和避障。`auto` 会跳过 `keep` 与 `monitor_or_optimize_intersection`，只对明确的扩容/分流瓶颈执行写入。工具不拆除原路、不清车、不改限速，也不在 `outcome_unknown` 时换 request ID 重提。
26. `preview_road_policies` 原子修改道路名及选定汽车车道的限速、公交专用和转向旗标。提交前再次比对预览快照；任一目标变化会拒绝整批提交，写入中出错会回滚已写项目。路边停车使用 `preview_road_parking`。
26. `preview_road_undo` 对同一城市会话内已完成的独立新路、拆除、反向、同源预制件升级和直接策略生成精确逆操作。拆分既有道路的创建操作会被安全拒绝自动撤销，因为游戏的完成集合包含既有道路替换片段；这类操作应按返回道路类型和目标显式拆除。
27. `preview_road_elevation` 输入 1–64 个永久道路 `edge_ids` 和 `clearance_m`，按实时地形高度整体移动道路中心线。它保留道路的平面曲线、预制件、边实体及共享节点拓扑；提交时原子更新所有唯一节点、四点贝塞尔曲线和高程组件，并触发游戏重建道路几何与车道。预览后任一节点变化会拒绝提交，写入异常会恢复原节点、曲线和高程。地面道路完成更新后，游戏可能自动把紧邻地形贴合到道路基底；高架桥仍应使用新建道路的 8 米以上 `elevation_m`。

铺路通过自定义 `ToolBaseSystem`、一次性 `CreationDefinition + NetCourse` 和游戏原生 ApplyTool 阶段运行。费用由 `ToolApplySystem` 扣除，道路、节点、车道等交由原生网络管线生成。提交时重新检查锁定状态、节点位置、预览稳定性、游戏错误/警告、资金及费用上限；不绕过开发者 ignoreErrors。

既有道路的纵向移动是单独的原子 ECS 事务，因为游戏 1.6.0 的网络替换预览会把移动后的课程端点重新吸附到原节点高度。该事务仍通过 `Updated` 标记交给游戏网络系统重建派生几何与车道，并在返回 `completed` 前核对全部节点和曲线端点。

## 道路治理注意

- 使用 `preview_road_ring` 建设多节点圆环后，应读取各环上节点的实际控制状态。若游戏自动加上信号灯并造成环流互锁，可对对应节点使用 `preview_intersection_control` 设置 `uncontrolled`；原生单节点环岛则优先使用 `preview_intersection_roundabout`。
- 环上接入口的斑马线可能阻断持续车流。确认行人流量确实造成问题后，可用 `preview_intersection_rules` 对具体入口关闭 `crosswalk_enabled`，同时规划替代步行过街路径，而不是全城统一禁用。
- 主干道和圆环需要稳定通行能力时，检查实际可用停车车道。可用 `preview_road_parking` 切换无停车变体，或在道路支持时用 `preview_road_features` 添加草带、树带；提交后用 `inspect_road_lanes` 验证 `usable_parking_lane_count`。

### 拥堵走廊改造与空间受限回退

- 高速或城市入口处的排队可能只是下游汇合口、交叉口或停车入口队列的队尾。先沿行驶方向追踪到真实瓶颈，再决定改入口、路口还是下游走廊。
- 分流道路应接入有剩余容量的下游网络，并形成至少两个有效连接；只有一个连接的断头支路，或重新汇入同一饱和路口的通道，只会延后或搬移队列。
- 骨架道路、第二出口和公交走廊应先于沿线设施及分区锁定。空间允许时优先保留直线和 90° 转角的正交走廊，但不得为追求几何整齐而切断既有建筑入口或绕过原生坡度、净空和碰撞校验。
- 扩宽被原生净空校验拒绝时，依次评估同宽非对称道路、无停车变体、转向或信号优化、正交平行通道。非对称道路必须用 `inspect_road_lanes` 核对道路方向与实际车道方向，不能仅凭 prefab 名称推断新增容量位于拥堵方向。
- 道路事务 `completed` 只证明永久施工完成。放行后应跨一个完整、可比较的高峰观察入口及下游走廊；若队列集中到下一个汇合口，应记录为瓶颈转移并转入路口治理。

### 重载工业集疏运专用通道与防平行干涉原则

1. **高速直连工业专用干线（重卡零穿城）**：
   - 工业区投产后会引发密集的重载原材料与产成品货运卡车流动。严禁让工业区出入口依赖居住区街道或生活型集散干道。
   - 最佳实践：从外部高速公路出入口端点直接引出 4 车道双向道路（如 `Medium Road`），以顺滑路径直插工业园区主入口，形成点对点的封闭集疏运通道。货流完全独立于居住生活区，彻底杜绝重型货车穿行居民区扰民及制造早晚高峰拥堵。
2. **路网防平行干涉与安全间距控制**：
   - 平行道路间距应依据源路和目标路的实际半宽、连接方式及障碍物计算。`preview_road_parallel` 要求 `offset_m` 在工具范围内，并大于相关道路半宽之和再加 1m；32m 是本次实测的可用示例，不是所有道路的固定阈值。
   - 过近的平行道路可能触发原生路基重叠或分区格冲突。需要伴行新建道路时优先调用 `preview_road_parallel`，设置合理的 `offset_m`、`clearance_m` 和 `avoid_obstacles=true`，再以原生预览结果为准。

## 重试与失败

- 相同预览请求 ID 和相同参数返回原操作；不同参数产生冲突。
- 一个操作只允许一次提交，同一提交请求 ID/预算重试返回当前状态。
- 网络超时后查询原操作，不使用新请求 ID 重建。
- `completed` 表示候选路段均已成为无 Temp 标记的永久道路。`outcome_unknown` 表示已派发但未能验证全部结果，必须检查现有道路，不能自动重放。
- 操作记录仅保存在当前城市会话内，最多 128 个。加载其他存档或重启后失效，旧提交不可自动重放。
- 不依赖跨帧阻塞 HTTP：工具快速返回操作 ID，游戏工具帧推进状态机，暂停模拟时也能运行。

## 本机诊断

`node mcp/road-operation.mjs preview route.json` 创建并轮询预览。

`node mcp/road-operation.mjs status OPERATION_ID` 查看状态。

`node mcp/road-operation.mjs cancel OPERATION_ID` 取消预览。

`node mcp/road-operation.mjs build OPERATION_ID REQUEST_ID MAX_COST` 明确提交并轮询。

2026-09-13 实际游戏验证：90 个道路预设锁定状态正确（50 已解锁）；直线、二次/三次曲线、多段路线、中点拆分路口、15 米高架、-15 米隧道、地面至 15 米连续坡道均已永久建成并检查 ECS 结果。替换测试把 160 米 `Small Road` 原地改为 `Alley Oneway`，实体 ID、端点、曲线和高度保持不变；拆除随后删除该实体。创建、升级和拆除的相同提交重放都未产生第二次修改。

已生成节点、车道、道路几何和分区组件。随后通过两端 `node_id` 追加约 101.85 米两车道道路，将测试路接入北侧既有双向道路，费用 416；新路两端和原有节点的 ConnectedEdge 双向引用均已验证。大量路段和复杂地形仍未覆盖，不等同于全部道路场景验证。建设结果当前在运行中的城市内，未由本测试自动保存存档。

2026-09-13 既有高速纵向移动验证：在“蒂拉格兰德”中一次提交移动 32 段 `Highway Twoway - 4 lanes` 和 33 个共享节点，最终中心线高度约为 521.695–522.445 米，全部道路和节点的 `Elevation` 为 10 米。32 段共用的边组合带有原生 `Elevated` 标志；对 127 个曲线控制点采样后，实际道路中心线最低仍高于地形约 2.062 米，没有地下点。32 段车道均可读取，连接节点数保持 33，模拟继续运行且桥接正常。
