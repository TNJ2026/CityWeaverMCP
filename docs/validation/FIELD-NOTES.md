# 尚未充分验证的经验与失败案例（Field Notes）

本文档记录在真实城市开发与运维过程中遇到的失败案例、未完全解明的底层机制以及处于假设阶段、尚未完成跨存档充分交叉验证的经验。随着后续实测验证，成熟结论将晋升合并至 `docs/guides/**`。

---

## 1. 失败案例：泛型分区全空导致城市生长停滞

- **问题现象**：
  在欧洲主题（`European`）地图中，使用 `preview_zoning` 分别施划泛型名称 `"Residential Low"` 与 `"Commercial Low"`。操作状态均返回 `completed`，且 `inspect_road_zoning` 能查到有效的 `Zone Block` 与 `ValidArea`，但在高速模拟下**持续数十个循环均没有任何建筑脚手架生成，人口与建筑数恒等于 0**。
- **排查与临时方案**：
  查阅 `get_city_configuration` 发现当前地图属于欧洲主题，进一步检查 `list_building_prefabs` 发现所有低密民宅和商铺预设均为 `EU_...`。改用带前缀的精确分区名（`"EU Residential Low"`、`"EU Commercial Low"`）后，建筑立刻大规模生成。
- **待验证假设**：
  1. 泛型名称（如 `"Residential Low"`）是否仅作为编辑器抽象基类存在，在任何实际游玩地图中均无法独立生成建筑？
  2. 北美主题（`NA`）是否同样严格要求 `"NA Residential Low"`？
  3. 自定义模组地图或混合主题资产包下，是否存在支持无前缀分区的回退逻辑？

---

## 2. 失败案例：市政服务规划候选点落入交叉路口中心（GAME_REJECTED_BUILDING）

- **问题现象**：
  调用 `plan_city_service_site` 寻找市政设施（如 `MedicalClinic02`、`ElementarySchool02`、`FireHouse01`、`PoliceStation02`）的放置点时，算法返回的综合评分第一名候选点（Candidate 0），其坐标偶尔与十字交叉路口的中心线坐标完全重合，或者距交叉路口节点小于 16m。直接调用 `preview_city_service_placement` 均 100% 报错 `GAME_REJECTED_BUILDING`。
- **排查与临时方案**：
  编写候选点自动回退算法（Fallback）：在尝试放置 Candidate 0 失败后，程序不中断，自动遍历 Candidate 1, 2, 3... 直至预览成功并提交。
- **待验证假设**：
  1. `plan_city_service_site` 在计算 roadside 投影时，是否缺少了对 `ConnectedEdge` 交叉节点侵入球的剔除？
  2. 安全路口退距的硬性阈值与道路类型（Small Road 16m、Medium Road 24m、Large Road 32m）之间的具体量化关系尚需建立精确边界模型。目前实测经验表明与路口保持 ≥ 32 米最为安全。

---

## 3. 失败案例：超宽体公共设施在短街区放置连续碰撞

- **问题现象**：
  公墓 `Cemetery02` 沿街面宽长达 111.6m（14 个分区格深度 6 格）。在内部街区长度为 100m~150m 或横向支路交叉密集的街区尝试放置时，算法返回的 10 余个候选点全部被游戏拒绝（`GAME_REJECTED_BUILDING`）。
- **排查与临时方案**：
  将公墓移至北侧平直、连续长度超过 200m 且无支路打断的外围专线上（Z ≈ 1066）一次性成功放置。
- **待验证假设**：
  1. 宽体建筑不仅要求沿街平直长度必须大于其面宽，其后方占地（进深）如果与相邻平行街区的后院缓冲区重叠，是否也会引发不可见的地面侵入判定？
  2. 地形坡度与路面高差超过多少米时会加剧宽体建筑的拒绝率？

---

## 4. 机制存疑：公交系统（Bus Line）在 Milestone 3 的解锁时机

- **问题现象**：
  游戏在达成 Milestone 3（繁荣村庄）时，晋级广播提示公共交通已解锁。但通过后台调用 `list_transport_line_prefabs` 查询发现 `Bus Line` 依然显示 `locked: true`；同时开发树中的 `BasicTransportationNode` 状态为 `service_unlocked: false, purchasable: false`。
- **尚未充分验证的推测**：
  在游戏原生自然晋级逻辑中，完整的公交车库与运营系统可能固定归属于 Milestone 4（大村庄，8,300 XP），或者需要通过开发点（Development Points）主动在开发树中点亮激活。

---

## 5. 底层网格读取异常：部分环境系统单点采样报 QUERY_FAILED

- **问题现象**：
  调用 `sample_pollution` 或 `sample_wind` 传入坐标参数时报 `QUERY_FAILED`。
- **实战建议**：
  目前推荐优先通过 `get_climate_state` 读取全局恒定风向与气候属性作为工业区选址的权威依据。

---

## 6. 失败案例：`UNEXPECTED_ROAD_PREVIEW` 是模组自身误判，不是游戏拒绝（已定位并修复）

- **问题现象**：
  一条笔直、无重叠、地形平坦的道路，`preview_road_route` 返回 `state: failed`、`error: GAME_REJECTED_ROAD`，`errors` 里是 **2 的整数倍个** `UNEXPECTED_ROAD_PREVIEW`，且 `warnings` 为空、`errors` 里**没有** `GAME_VALIDATION_ERROR`。用 `get_road_operation` 逐段回读，`segments[]` 全是请求的 prefab、起终点都是 `new_node`、长度正常——怎么看都是合法路径。（埃格林三区规划里 9 条路同时中招，最长的一条 6 段路正好 6 个错误。）
- **根因（四组对照实测确认）**：
  用同一条 200 m 的新路做 A/B/C/D 对照：**中段穿越一条 prefab 不同的既有路**失败（2 个错误）、**穿越同 prefab 的既有路中段**通过、**穿越点正好落在既有路的既有节点上**通过、**T 形接入一条更宽道路的中段**失败（2 个错误）。机制是：中段接入会让游戏把**被接入的那条边拆成两半**，两半在预览里都是「新建」边（`m_Original == Entity.Null`），却带着**被拆旧路的 prefab**；`McpRoadToolSystem.ExpectedRoadPrefab()` 只认本次请求的 prefab 与各 segment 的 prefab，于是把这两条拆出的边判成异常。**一次接入正好 2 个错误**，这就是它的指纹。所以「横向街道能建、纵向街道也能建，只有两者交叉的那几条建不了」并不矛盾——差别只在交叉点是否落在既有节点上。
- **修复**：
  `ReadPreview` 的 create 分支不再直接报错，先调 `IsSplitRemnantOfExistingRoad(edge, prefab)`：扫描 `m_RoadQuery`，找「**共用同一个节点实体、且 prefab 相同**」的兄弟预览边。一次拆分必然产出同一旧边的两半，两半共享新插入的中间节点，因此判据稳定命中；而本次操作只会生成自己的 prefab，所以不会误放行。命中的边记入新增的 `split_remnant_edges` 字段（**不并入 `created_road_ids`**，否则撤销创建会把旧路拆出一个缺口），并参与预览签名稳定性校验，但不参与请求道路自身的数量校验。
- **不要改用「共节点处是否有同 prefab 的永久边」做判据**：环路起点那一侧根本没有同 prefab 的永久邻居（整条首段都被拆成 Temp 了），会漏判。直接用 `Edge.m_Start` / `Edge.m_End` 比对实体，还顺带避免了依赖 `ConnectedEdge` 缓冲是否对 Temp 节点维护。
- **通用教训**：`GAME_VALIDATION_ERROR` 与 `UNEXPECTED_ROAD_PREVIEW` 是两类完全不同的失败——前者是游戏验证拒绝（真的建不了），后者是模组自己的校验拒绝（**可能**其实能建）。看到只有后者时不要急着改规划几何，先用上面四组对照把「中段接入」这条线索验一遍。

---

## 7. 既有铁路 / 高压线走廊：规划生成器必须避让（埃格林北带实测）

- **问题现象**：
  埃格林三区规划北带 4 条路（住宅东环路、住宅东西街 8、住宅东西街 9、厂区北街）全部报 `GAME_VALIDATION_ERROR` 或 `NO_GENERATED_ROAD`，而位置、宽度、走向完全同构的南侧道路畅通。**规划生成器从未查询过既有轨网与管网**。
- **实测数据**（用 `get_planning_map_snapshot` 的 `tracks` / `utilities` 图层取证；注意几何在 **`curve.a` / `curve.d`**，不是 `points`）：
  - `Double Train Track`（宽 12 m）自西北向东南下降，**x ≥ −1629 之后恒为 z = 1438** 一路向东。
  - `High-voltage Line`（宽 **30 m**）在其北侧 z ≈ 1470 平行，向西北抬升；**电塔基座落在 utility 分段端点上**（x ≈ −1597 / −1431 / −1259 / −1087 / −915 / −743 / −571 / … 间距约 168 m，z ≈ 1469）。
- **可行 / 不可行判据（定点实测）**：
  1. **垂直穿越走廊**（铁路与高压线一起穿）**可以**——x = −1000、z 1380 → 1500 通过。
  2. **平行贴着走廊走不行**——沿 z = 1470 与高压线并行直接失败。
  3. **端点停在铁路两侧的护坡上不行**——x = −1608 止于 z = 1424 失败，止于 z = 1400 通过（同一位置、只差 24 m）。铁路可建净距约需 **≥ 24 m**（12 m 轨面宽度之外还有护坡）。
  4. **电塔是点障碍**——住宅东环路在 x = −1608，距 x ≈ −1597 的塔基仅 11 m，这就是它即使垂直穿越也建不起来的原因。
  - 结论：这一带的**实际北界约 z = 1400**；工业区北排 4 栋建筑（煤电厂 / 污水厂 / 变电站 / 填埋场，z 1464–1496）正好压在 30 m 宽的高压线走廊上，同样需要南移。
- **高架跨越不是好出路**：路线工具支持逐点 `elevation_m`（−50..50 m），但坡度上限约 12%（试 54 m 抬 12 m 直接报 `STEEP_SLOPE`）。为一条支路做长距离高架横跨铁路 + 高压线并不经济，正确做法是把规划北界收到走廊南侧。

---

## 8. 规划自身缺陷：横街与竖路的交叉点坐标差 8 m

- **问题现象**：
  三区规划的横向街道航点写 `x = −2160 / −1976 / −1792`，而竖向道路实际建在 `x = −2168 / −1984 / −1800`；`res-w7` 又用了第三套 `−2176 / −1992 / −1808`。**三套偏移同时存在于同一张图里。**
- **影响**：
  8 m 恰好是吸附栅格，也是 `MIN_ROAD_SEGMENT_LENGTH_M`。交叉点错开 8 m 会生成一段极短的连接段，或者干脆不连通——但**图上看不出来**，只有把坐标打出来逐对比才会发现。这**不是**上述 `UNEXPECTED_ROAD_PREVIEW` 的成因（原始坐标与修正坐标都同样失败），是独立的规划 bug。
- **建议**：交叉点坐标必须**由竖向道路的实际值单向推导**，不要让横街、竖路各自硬编码；生成器里加一条「任何两条路的交叉点必须共用同一组坐标」的断言。

---

## 9. 共线重叠的「重复路段」会毒化节点，此后任何接入都被拒（佩奇代尔六边形实测）

- **问题现象**：
  六边形城镇施工到内部格网纵路 `lattice-v-037`（`(160,-1248) → (160,-1136)`，112 m 直路）时报 `state: failed / errors: ["GAME_VALIDATION_ERROR"]`。更诡异的是：**在失败跨段的正中间新建一条 24 m 短路却完全正常**。
- **定位过程（三组对照）**：
  1. **不是区域性障碍**：沿 z=-1192 对全部 14 个格网列各测一条 24 m 纵路，**14/14 全部通过** —— 排除了地形、水域、不可建区。
  2. **与端点强相关**：凡**碰到节点 (160,-1248)** 的预览全部失败（含 48 m 短段、反向、`x=156` 偏 4 m 的版本）；凡碰到 (160,-1136) 的全部通过。
  3. **结论**：该节点自身处于「不可再接入」状态。
- **根因**：`hex-yard-5` 的南边（`(272,-1248) → (48,-1248)`，**Small Road**）与 `hex-radial-ESE`（`(-400,-1248) → (496,-1248)`，**Medium Road**）**共线且区间重叠 224 m**。游戏把两条路都建了出来，于是节点 (160,-1248) 两侧各出现**一对同向平行重复边**（西侧 Small+Medium 各一条、东侧亦然），该节点无法再接受第三条边。
  - 交叉验证：`hex-yard-5` 北边与 `hex-yard-3` 顶边在 z=-1360 也重叠 112 m，但**两条同 prefab（Small）**，游戏按替换处理，**没有**产生重复边、也没有毒化节点。
  - 即：**「同 prefab 重叠」会被游戏合并，「不同 prefab 重叠」才会留下重复边并毒化节点。**
- **判据（可脚本化）**：
  对规划里所有轴对齐路段两两做「同方向 + 垂直偏移 ≤0.5 m + 区间重叠 >0.5 m」检测；命中且 **prefab 不同** 的对，就是高危项。
  现场核验用 `get_planning_map_snapshot`（`include_roads:true`）按 `curve.a`/`curve.d` 两端点归并成 `node→node` 多重集，**同一节点对出现 >1 条边**即已被毒化。
- **修复**：把重复的那条拆掉。本例删掉 `hex-yard-5` 南边的两段 Small Road（`...:366828:1`、`...:366825:1`），覆盖由 Medium 径向路完整承担，**不损失任何通达性**；拆除后 `lattice-v-037` 预览立刻通过。
- **生成器教训**：`yard`（街区环路）的边绝不允许与 `radial`/`ring` 共线。生成器应加断言：**任意两条路的共线重叠长度必须为 0**（不只是交叉点坐标一致）。

---

## 10. `request_id` 是**幂等键**而非「重试令牌」：真实失败后必须换新 id 才能重跑

- **问题现象**：
  清掉上面第 9 条里的重复路段后，**直连 `preview_road` 用新 request_id 一次通过**；但施工器按原 `next_action` 重试同一批次时，**依旧秒回 `GAME_VALIDATION_ERROR`**，且看起来「没真正跑」（间隔仅约 100 ms）。
- **根因（源码确认）**：
  `RoadQueries.PreviewRoad` 先做 `if (m_RoadRequestIds.TryGetValue(key, out var oldId)) { var old = m_RoadOperations[oldId]; if (old.Fingerprint != fingerprint) throw REQUEST_ID_CONFLICT; **return old.Json();** }`。
  即 **request_id 命中就直接返回那次操作（连同它的终态）**，不会重新生成预览。zoning / district / economy / transport 各处是同一套写法。
- **推论**：
  - 工具描述里的「reuse it for retries」只适用于**超时/结果未知**的重试（避免把同一次意图变成两次预览）；
  - **已经确定失败（如 `GAME_REJECTED_ROAD`）的批次，重试必须换一个新的 request_id**，否则永远拿到缓存的失败结果。
  - 旁证：`m_RoadOperations.Count >= 4096` 会报 `ROAD_OPERATION_LIMIT`（需重载城市重置日志），说明这张表是**会话级累积**的。
- **相关坑**：`planning-session.advanceStored` 的幂等缓存键是 `contentHash({state_version, action, batch_id, max_cost})`。日志里 `last_fingerprint` 相同时**直接回放 `last_result`**；所以「重排队同一批次」还必须**把 `state_version` 推进一格**，否则连本地这层也命中缓存。
- **修正既有注释**：`tools/scratch/build-region-plan.mjs` 顶部「同一批次重试必须复用同一个 request_id」的说法只在「结果未知」场景成立，重跑确定失败的批次应换新 id。

---

## 11. 分区怎么落到「多边形地块」上：只能按「路段 + 左/右侧」落色（佩奇代尔六边形实测，已验证）

**问题**：规划里的 `plan.zones` 是**地块多边形**（本城 54 个 112×112 m 方格），而原生的 `preview_zoning` / `apply_zoning`
**只接受 permanent road `edge_ids` + `road_side` + `depth_cells`**，没有任何「按单元格落色」的工具（全工具表 417 个里只有 `analyze_zoning_cells` 是只读的）。

**可用流程（已验证，0 错色）**：
1. 把规划道路按几何**映射到实时永久路段**：对每条实时 edge 取 `curve.a` / `curve.d` / 中点，判定是否落在某条规划折线上（容差 2.5 m）。
   本城 289 条实时路段里 287 条命中了 80 条规划路（另 2 条是既有高速），**游戏会在每个交叉口自动切分路段**，
   所以一条 224 m 的规划路段通常变成 2 条 112 m 永久路段 —— 这恰好让「一条路段 = 一个地块的临街面」成立。
2. 对全部永久路段调 `analyze_zoning_cells({edge_ids:[…≤12], road_side:'both', depth_cells:6})`，
   拿到每个单元格的 `position / side / depth / state / occupied / zone`。
3. **按点是否落入地块矩形**给单元格分类，再按 `(edge_id, side)` 聚合；同一组内若出现两种地块名说明有冲突（本城 258 组全部干净）。
4. 按 `(zone, side)` 分组 → 分块（≤48 条边）调 `preview_zoning` → `apply_zoning({operation_id, request_id})` → 轮询 `get_zoning_operation`。
5. 落色后**用同一套 analyze 读回**核对：本城规划地块内 12,855 格正确、**错色 0 格**。

**关键坑**：
- `analyze_zoning_cells` 单次最多返回 **4096 个 item**，超出会 `items_truncated: true`。40 条边一次会截断（6324 格），
  **必须降到 12 条边/次**才能拿全；否则分类样本不全会漏掉冲突。
- 判定「可修改」不能只看 `blocked`：原生口径是 `modifiable = 非 Blocked 且非 Shared 且非 Redundant 且非 Occupied`。
  只排除 `blocked` 会把 Shared 也算进来，从而凭空造出「冲突」。
- `preview_zoning` 的 `changed_cell_count` **不等于**最终落色格数（地块拐角的格子会被相邻路段先落色，本城 18 组共报 8,714 而读回是 14,313）。
  **要用读回值当结论**，不要用这个计数。
- `depth_cells: 6` 对 112 m 地块（路面 16 m，内部 96 m = 12 格）刚好两侧各 6 格铺满，中间只剩 1 格空隙 —— 这是规划节距与最大深度对齐的结果。
- 地块外侧的相邻走廊会被同组一并落色（本城 1,458 格）。这是「按路段落色」的必然副作用；
  用扇区模型（按中心角分扇区、比较 `kind`）核对即可：本城 1,458 格全部与所在扇区用途一致（0 不一致），216 格落在中央核心六边形内。

## 12. `render_city_plan` 的两个坑：plan schema 是 strict 的，HTML 不在返回值里

- **strict schema**：`plannedRoad` 只允许 `id/label/prefab/planning_status/construction_status/native_preview/level/width_m/points/
  district/road_class/axis/role/widening_policy/construction_order/depends_on/max_cost`；
  `plannedBuilding` 不允许 `industrial`；`plannedZone` 只允许 `id/kind/label/district/area_m2/polygon`。
  **施工用的计划 JSON 带了很多施工期字段（如 `kind:'road'`），直接丢给渲染器会被 `<tool_use_error>` 级别的 zod 拒收**，
  必须先按白名单投影一份干净副本（`plan.roads/buildings/zones`，`grids/tracks/utilities` 可留空）。
  注意 `computeCityPlanId(bounds, plan)` **只哈希 `{bounds, plan}`**，所以改写 `render`（标题/尺寸/视图）不会让 plan_id 失效。
- **HTML 不随返回值返回**：`content[0]` 是一段 JSON 文本，页面本体写在 `data.artifact_path`
  （`artifacts/planning-store/artifacts/<sha256>.html`），需要自己读出来另存。`render-nistar-plan.mjs` 里
  「从 `resource.mimeType === 'text/html'` 取 HTML」的写法在本环境已经不成立。
- **渲染时会重新跑几何自检**，用的是**落位后的坐标**：本城因此报 68 条 `PLANNED_BUILDING_OVERLAP` /
  `PLANNED_BUILDING_ROAD_OVERLAP` 提示。原因是自检用「矩形外包框 + 道路净空」这一粗略模型，
  而大型设施（183 m 医院、175 m 学院）的外包框远大于实际模型。
- **误读警告**：不要据此认为建筑压了路。判据是：出图阶段概念几何自检 0 问题 + 70 座全部通过原生预览并被游戏接受 +
  66 座绑定的 `road_edge_id` 在竣工后仍存在于 287 条永久路段中。

## 13. 低压电网铺在**路上**：产电建筑不贴路就会「有电发不出」（佩奇代尔风机实测）

**现象**：三座小型风力发电机（`WindTurbine02`）建成、落位通过原生预览，但 `last_electricity_production: 0`，
`road_edge_id: null`，持续数小时不发电。

**排除法**（先做排除，别急着改东西）：

- 不是风：`sample_wind` 实测风口 `speed` 0.19–0.22，而**城镇中心反而更高 0.24**；`efficiency_factors` 是随风变化的
  `[0.10…0.22]` 系数，`electricity_capacity = 40000 × 该系数`，所以「容量只有几千」并不等于故障。
- 不是电网富余：同城燃煤电厂 `last_electricity_production = 132,958`，一直在满发。
- 不是选址器说的碰撞：`plan_building_site` 对风机返回的候选都在**路中心线外 48 m**，`approximate_collision: false`。
- 不是「没绑定」这件事本身：绑定时原生解析对它们返回 `rotation_source: 'native_snap'`、`road_edge_id: null`，
  绑定器仍判 `state: 'bound'` —— 也就是说**「绑定成功」不代表「接上了路」**。

**根因**（`list_utility_connection_points` 一句话定位）：

```
facility WindTurbine02 → 1 个端口  connection: low_voltage  layers: "Road, PowerlineLow"
facility SmallCoalPowerPlant01 → connection: high_voltage layers: "PowerlineHigh"
                              + connection: low_voltage  layers: "Road, PowerlineLow"
```

**低压电网层的载体是 `Road`** —— 建筑必须紧贴一条道路，低压电才能从路面导入地块。
原风场距最近道路 414–502 m（`hex-ring` 东北边），无路可贴，于是建成也发不出电。
燃煤电厂有 `road_edge_id` 且一直正常发电，正是因为它贴着路。

**几何判据**（从 66 座已接入建筑反推，全部 `cos = 1.000`）：

- 建筑朝向 `forward = (sin(rotation_degrees), cos(rotation_degrees))`，在 (x, z) 平面上**恒指向它接入的那条路**。
- 接入距离 = **地块半深 + 路半宽**：`dist(建筑中心, 路中心线) = lot_half_depth + road_half_width`。
  实测水塔 24.4（地块 4×4=32→半深 16，Small Road 半宽 8）、消防站 28.3、派出所 36.3、抽水站 40.2、
  污水处理厂 56.3 —— 且没有一条 `road_edge_id` 是「挨着但留缝」的。

**坑：通用临街选址器对风机用了错误的占地模型。**
`plan_building_site` 返回的 `reserved_footprint_half_extents_m` 是 **31.8**（= 叶轮 63.6 m 的外包框），
而风机真实 `lot_cells` 只有 **2×2**（半深 8 m）。于是它把机组停在 `31.8 + 16 = 48 m` 处，
地块前缘离路缘还空着 24 m，低压层够不着 —— 而原生预览**照样 `preview_ready`**（叶轮在头顶，地面不碰撞）。
反面证据：把风机沿法线逐步靠近外环路，**24/28/32/36/40/44 m 全部 `preview_ready`**，说明碰撞根本不是瓶颈。

**修法**（已验证）：搬到目标道路后，沿「机组中心 → 路面最近点」方向把机组拉近到 **24 m**
（= 地块半深 8 + 路半宽 16），正面朝路、地块前缘与路缘齐平。搬迁用原生 `preview_building_move` +
`apply_building_operation`（`cost: 0`）。结果三台 `road_edge_id` 全部落到外环路 `hex-ring` 上，
`last_electricity_production` 由 0 变为 **满容量 8,386 / 7,329 / 8,822 kW（合计 24,537 kW）**。

**其他要点**：

- 判据一律以**实时端口 + 发电读数**为准，不以选址器建议的距离为准。
- 搬迁预览要求城市**暂停**；但**发电量统计与并网判定要放开模拟**才更新 —— 读数是 per-tick 的，
  暂停下永远是 0，别把它当成失败。
- 原生工具管线是**单线程**的：一次搬迁还在 `applying` 时立刻发起下一次会拿到 `TOOL_BUSY`
  （`Finish the current tool operation…`）。轮询必须把 `applying/committing/saving/building` 也算作「未完成」，
  并在两次操作之间留 ~0.9 s 沉淀。
- **同类潜在问题**：`SewageOutlet01` 的端口层是 `"Road, SewagePipe"`，同样需要贴路，
  本城该设施 `last_sewage_processed: 0`（污水已由 `WastewaterTreatmentPlant01` 全量承担 65,343/416,000）。
  凡是 `layers` 里含 `Road` 的端口，都要检查建筑是否真的贴到了路。


## 14. 高压输电线单段上限 180 m：跨距超限被判 `INVALID_UTILITY_LENGTH`（佩奇代尔实测，已验证）

**场景**：把唯一保留的变电站移到六边形外环外侧后，要用输电线把它接到地图西侧的**高压线入口**
（`外部连接点 - 电力` / `Powerline Outside Connection` @ (-7181, -592)，即既有高压线西端）。
变电站高压端口在 (-1041.9, -663.4)，既有高压线东端自由端点在 (-1374.7, -555.0)，相距 **349.9 m**。

**踩坑与误判**：一开始连续失败，连「城里已知可用的路段」也失败，很容易误判成「全局错误状态，
有残留的错误实体毒化了所有预览」。实际上要分三类返回看：

| 返回 | 含义 |
|---|---|
| `state=failed` + `errors=[]` + `error=NO_GENERATED_ROAD` | 该处**本来就有路面/线路**，没有新东西可生成 —— 正常，不是失败 |
| `state=failed` + `errors=[GAME_VALIDATION_ERROR]` + `error=GAME_REJECTED_ROAD` | **真正的引擎拒绝**（孤立线段、超长线段等） |
| `error=INVALID_UTILITY_LENGTH` | 单段长度不在预制体的 `edge_length_m` 范围内 |

⚠️ **不要拿「落在已有路面上的路段」当对照组** —— 它永远返回 `NO_GENERATED_ROAD`（errors 为空），
既证明不了工具可用，也证明不了被毒化。**正确的对照是「连到既有网络、但确实不存在的新线段」**。

**`m_ErrorQuery` 的真身是 `Game.Tools.Error`**（工具层瞬时错误标记）。
排除残留毒化的正确办法：

- `list_component_types(search:'Error')` → `Game.Tools.Error` / `Game.Tools.Warning`（完全限定名，
  `count_entities` 不接受简称 `Error`）。
- `count_entities({all_components:['Game.Tools.Error']})` == **0** 即可排除残留错误实体。
  注意 `IsEmptyIgnoreFilter` **忽略**所有过滤器（含 `Deleted`/`Temp`），而 `count_entities` 会**排除**它们，
  两者不等价；本例实测为 0，说明从来就没有残留实体，纯粹是线段本身不合法。

**根因**：`High-voltage Line` 的 `edge_length_m = {min:0, max:180}`。349.9 m 一次拉通必然超限；
L 形路径也没用（两段里必有一段 > 180 m，实测 332.7 m）。工作流自带的 4 种路由（直连 + 两个 L 形 + 自适应避障）
共 16 次尝试**全部** `INVALID_UTILITY_LENGTH` —— 分段是必须的，不是可选的。

**修法（已验证）**：按 ≤170 m 自动分段（本例 3 段 × 116.6 m），并在**首尾点分别补上 `node_id`**
（首点 = 变电站高压端口 `...:405011:27`，尾点 = 既有高压线自由端点 `...:72519:1`），再
`preview_utility_network` → `preview_ready` → `apply_utility_operation`。
结果：3 段输电线建成，端口 `connected_edge_count = 1`，高压网络由 33 段变为 **36 段且仍是单一连通分量**。

**网络预制体对照（`list_utility_network_prefabs`）**：

| 预制体 | 网络 | 单段上限 | 高程范围 | 造价/米 | 连接层 |
|---|---|---|---|---|---|
| High-voltage Line | electricity | **180 m** | 0..10 | 20 | PowerlineHigh |
| High-voltage Ground Cable | electricity | 180 m | -50..-10 | 40 | PowerlineHigh |
| Low-voltage Line | electricity | 90 m | 0..10 | 4 | PowerlineLow |
| 各类水管 / 污水管 / 合流管 | water / sewage | 200 m | -50..-10 | 8..48 | Road, +Pipe |

架空线用 `elevation_m` 0 合法；地下管缆必须给 -10..-50。

**`connect_utility_facility` 是工作流层工具**：实现在 `mcp/utility-connection-workflow.mjs`，
**不在 mod 桥接通名单里** —— `queryGame('connect_utility_facility', …)` 会返回 `UNKNOWN_TOOL`。
但它可以直接用：`import { connectUtilityFacility } from '../../mcp/utility-connection-workflow.mjs'`。
它自动做「端口发现 → 最近既有网络端点 → 逐候选预览 → 提交」，并把模拟速度恢复原状，
是把设施接入**既有**网络时的首选；本例因跨距超限它无能为力，改用自己分段的直连脚本。

**全城供电的验收判据**：

- `Game.Buildings.ElectricityConsumer.m_Flags` 的枚举是 `None / Connected / NoElectricityWarning / BottleneckWarning` ——
  `NoElectricityWarning` 计数为 0 才是「全城有电」的硬证据（本例 1,200 座全部 `Connected`，
  `m_FulfilledConsumption` 与 `m_WantedConsumption` 相等）。
- `Game.Simulation.ElectricityFlowEdge`（含 `m_Flow` / `m_Capacity` / `m_Flags`）可按 `net_edges` 查潮流，
  本城实测该类实体为 0，说明这条通路不是可用的潮流读法，别依赖它。
- `query_entities` 分页时 `offset > 0` **必须**回传首次返回的 `snapshot_id`，否则报
  `INVALID_ARGUMENT Use snapshot_id for nonzero offsets`。
