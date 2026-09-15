# 1.18.0 灾害控制

- 新增 13 个灾害工具，总数 318；游戏端与 MCP 端工具一致性 318/318。
- 发现并真实初始化全部 8 个已加载灾害 prefab：天气类 `Hail Storm`、`Lightning Strike`、`Tornado`，火灾类 `Building Fire`、`Forest Fire`，破坏类 `Building Collapse`，水位类 `Flood`、`Tsunami`。
- 雷暴实测完成预览、应用、原生初始化、强度增长、热点随风移动、影响查询、位置/半径/强度/时长修改、临时状态清理和停止；城区返回 2 条 `StayIndoors` 危险记录。
- 冰雹通过真实建筑 `target_id` 触发并产生目标 `StayIndoors` 状态；原生初始化器按设计消费临时 `TargetElement` 缓冲区，关联影响仍可从 `InDanger` 读取。
- 建筑火灾、森林火灾和建筑倒塌分别以真实建筑/树木为目标完成预览、应用、原生初始化、读取、影响清理和停止。
- 洪水与海啸完成全局原生水位事件初始化，当前/最大强度、危险高度、方向和剩余时长修改后均成功读回并停止。
- 龙卷风在地图边缘以强度 1 运行，原生并发上限 1 正确拒绝第二个实例；事件随后停止并清理。
- 最终活动灾害为 0，城市恢复正常速度。实机记录：`artifacts/disaster-live-1.18.0.log`。
- Debug 构建经过官方后处理和 Windows/macOS/Linux Burst 编译，0 警告、0 错误；Node MCP 测试 8/8 通过。部署 DLL 与构建 DLL SHA-256 均为 `AF52551EFA93D1DB5720E34919632D010F33C4A2FF33E7711F55FD1C05BC426B`，模组日志无错误或异常。
# 1.17.0 城市管理

- 新增 10 个工具，总数 305；覆盖管理总览、城市配置/名称/资金、全市政策、城市修正值和原生统计历史。
- MCP 协议自动测试 8/8；官方后处理和 Windows、macOS、Linux 三平台 Burst 构建 0 警告、0 错误。
- “沃本”实机完成城市名、资金、无限资金、自然灾害和全市政策往返恢复；发现 6 项全市政策、30 类修正值和 15 个人口历史样本。
- 最终城市名、设置和政策已恢复，模拟为正常速度，日志无异常。记录：`artifacts/city-management-live-1.17.0.log`。
# 1.16.0 市民、家庭和企业完整操作

- 新增 25 个操作工具，总数 295；MCP 协议 8 项自动测试与运行中工具对齐 295/295 均通过。
- 官方后处理和 Windows、macOS、Linux 三平台 Burst 构建通过，0 警告、0 错误。
- “沃本”实机完成家庭、市民、企业创建和原生删除闭环；迁户、住房、位置、健康、就业、学校、财务、员工容量、资源库存、企业房产和交易成本 CRUD 全部回读通过。
- 当前存档实际发现 13 种家庭预设、2 种市民预设、46 种企业预设和 6 所学校；临时实体清理后模拟恢复正常，日志无异常。
- 记录：`artifacts/population-operations-live-1.16.0.log`、`artifacts/build-1.16.0.log`。
# 1.15.0 环境与景观

- 官方后处理构建通过，Windows、macOS、Linux Burst 产物均生成，0 警告、0 错误。
- MCP 270 个工具的 8 项自动测试通过。
- 真实城市验证 72 个景观预设（20 树木、52 植物）；批量放置 3 棵树、环形放置 8 株植物、移动、树状态修改、区域统计和完整清理均通过。
- 临时水源创建、更新、删除闭环通过，原地图水源数量恢复为 2。
- 空气、地面、噪声污染写入 1234、采样和恢复通过。
- 天气覆盖、恒定风向/压力写入和基线恢复通过；64×64 风场、128×128 土壤水采样通过。
- 记录：`artifacts/environment-landscape-live-1.15.0.log`、`artifacts/climate-live-1.15.0.log`。

## 1.14.0 公共交通剩余操作（2026-09-14）

- 新增 17 个 MCP 工具，总数 249；线路新增日夜班表、票价、目标车辆数、线路编号、均匀发车、站点命名、车辆请求查询/创建/取消和运营车辆返场，设施新增升级目录、名称、启停、政策和升级安装/移除预览。
- Release 构建、官方 Unity Entities/Jobs 后处理及 Windows/macOS/Linux Burst 构建通过，0 警告、0 错误；MCP 协议、桥接、认证和参数测试 8/8 通过，部署 DLL 与构建 DLL 的 SHA-256 一致，游戏桥接报告 1.14.0。
- “沃本”临时公交线路实测通过：4 站、24,718.3672 米；编号、均匀发车、日/连续班表、票价、原生车辆数范围 4..17、站点名，以及车辆请求创建/查询/取消全部读写闭环成功。
- 临时 `BusStation02` 实测通过：原生选址/放置、名称、启停、政策写入、`BusStation02 Extra Platforms` 升级安装和移除、拆除成功。测试发现并修复了升级实体删除后操作轮询丢失设施身份的问题。
- 临时 `BusDepot01` 与公交线路在最快速度下生成 2 辆真实运营公交车；`release_transport_line_vehicle` 对其中一辆返回 `return_to_depot_requested=true`。测试线路、车站和车辆段均已拆除，线路/设施数量恢复为 0，模拟恢复正常速度，当前模组日志无错误或异常。
- 记录见 `artifacts/transport-controls-live-1.14.0.log`、`artifacts/transport-facility-live-1.14.0.log` 和 `artifacts/transport-release-live-1.14.0.log`。

## 1.13.0 地图和区域（2026-09-14）

- 新增 12 个地图格工具，总数 232；全平台构建、MCP 测试和 529 格真实地图读取通过。
- 验证地图边界、资源、可建设面积、邻接、坐标定位、气候、海平面及全解锁幂等路径；当前存档无未购格，首次购买仍缺实例。
- 详见 `docs/guides/areas/MAP-AREA-GUIDE.md`、本验证记录和 `artifacts/map-area-live-1.13.0.log`。

## 1.12.0 交通与出行控制（2026-09-14）

- 新增 20 个工具，总数 220；全平台官方后处理和 8 项 MCP 自动测试通过，部署桥接为 1.12.0。
- “沃本”实机完成车辆/Traveler/路径/交通/停车读取、重寻路、目标、汽车速度与公交车道标志往返、瞬时停车、原生市民行程队列、车辆删除和批量清理验证。
- 当前存档缺少自行车、列车、船舶、飞机、步行、等待和卡住的非空样本；完整边界见 `docs/guides/roads/TRAFFIC-MOBILITY-GUIDE.md` 与本验证记录。

## 0.3.0 live test and 0.3.1 correction (2026-09-13)

The loaded game reported 0.3.0 and a playable city. get_city_summary succeeded (population 233, 174 building instances). The deep smoke failed at list_game_systems before any demand/grid assertions: Unity NoAllocReadOnlyCollection throws NotSupportedException when LINQ uses its IEnumerable interface. This also affects queries that call SyncReads. Deep access is NOT yet validated.

0.3.1 replaces interface enumeration with foreach over the concrete World.Systems collection. Official staged build passed with 0 warnings/errors. Inspected compiled IL calls NoAllocReadOnlyCollection.GetEnumerator directly, rather than the throwing IEnumerable implementation. All 8 MCP transport/schema tests passed. Deployment and another live deep smoke remain pending a game restart; Blob/container coverage remains pending as well.

## 0.3.1 live results and staged 0.3.2 (2026-09-13)

System enumeration is fixed. Live expanded MCP regression passed. All 30 selected native fields in ResidentialDemandSystem, CommercialDemandSystem and IndustrialDemandSystem read successfully (arrays and NativeValue). read_entity_field successfully returned a citizen health field. Reports: artifacts/native-0.3.1.json and artifacts/expanded-0.3.1.json.

Deep grid probe continued across all layers: 14/15 layers passed two-page checks; GroundWaterSystem failed because it exposes kTextureSize instead of a TextureSize property. Report: artifacts/deep-0.3.1.json. 0.3.2 adds a specific adapter based on the installed game's OnCreate implementation and validates resolution against allocation length. Staged official build passed (0 warnings/errors); 8 bridge tests passed. New DLL deployment and final groundwater live verification remain pending restart.

Component audit checked 1229 types: 901 existing instances read successfully, 326 had no sample, Deleted/Temp excluded. No top-level read failures. The old nested-marker detector did not recognize the new unavailable/reference/pagination markers, so its empty nested_markers array is NOT evidence of full nested readability. Detector updated for the next run. Raw Blob payloads and every native container variant remain unverified with real instances.

## 0.3.2 final live verification (2026-09-13)

Deployed official build with 0 warnings/errors; deployed DLL SHA-256 matched build output. Live bridge reported 0.3.2.

- smoke-deep: PASS for all 15 discovered CellMap layers, including GroundWaterSystem. Validated resolution versus allocation length, two-page reads and missing-field error. artifacts/deep-0.3.2.json.
- probe-native: PASS for all 30 selected fields across residential/commercial/industrial demand systems, no unavailable results; citizen m_Health read by entity field path. artifacts/native-0.3.2.json.
- smoke-expanded: PASS for prior discovery/schema/counts/component/buffer/reference/prefab/pagination/filter behavior. artifacts/expanded-0.3.2.log.
- Component audit: 1229 types checked, 895 successful existing-instance samples, 332 with no instances, Deleted/Temp excluded, zero top-level errors or unsupported samples. 29 samples contained nested unavailable/reference/pagination markers. These are NOT fully decoded component exports. mcp/component-audit.json and artifacts/component-audit-0.3.2.log.
- Runtime log inspection after the query tests showed no query error entries.

Tests use samples from one loaded city, not every entity or every value. NativeQueue/map/set variants and raw Blob payload access still lack dedicated actual-instance verification; unknown pointer layouts, independent BlobArray/BlobPtr and GPU-only textures remain explicit limitations. All implemented query paths remain read-only; no city mutation was performed.

## 0.4.0 road implementation (pending game deployment)

Added McpRoadToolSystem as an ordinary ToolBaseSystem registered before ToolOutputSystem, using game-standard one-shot CreationDefinition/NetCourse and the native ApplyTool stage. No permanent road entities or player money are written directly. Stock ToolBaseSystem, ToolSystem, ToolOutputSystem, SystemOrder, NetToolSystem, ToolApplySystem and TerrainSystem signatures/flow were inspected from the installed Game.dll to match this game version.

Supports paused-city straight ground routes 16..256m, exact unlocked road prefabs, optional explicit existing node endpoints, temporary preview/status/cancel, single-dispatch commit with stable request keys and a cost ceiling. Validates game errors/warnings, endpoint changes, money, unexpected building changes, and verifies permanent edge entities after applying. Requests return promptly and are advanced by game tool frames. Operation records are session-local and capped at 128.

Official staged build passed (0 warnings/errors). Eight existing MCP tests pass with added checks for all 22 tools, correct mutation annotations, coordinate/endpoint/request-ID validation, required max_cost and exact request forwarding. Added mcp/road-operation.mjs for actual preview/status/cancel/build polling. These checks do not validate the runtime game creation pipeline. Deployment, preview cancellation, actual construction, money changes, idempotent replay and node connectivity remain pending.

## 0.4.0 discovery failure and 0.4.1 staged correction

Live 0.4.0 loaded correctly and listed 90 road prefabs, but marked all locked. Checked the actual Small Road prefab through get_entity_components: Locked exists but enabled=false. Installed Game.dll confirms Locked implements IEnableableComponent. No preview or permanent road was created in this test.

0.4.1 centralizes lock checks as HasComponent<Locked> && IsComponentEnabled<Locked>, used by catalogue, preview admission and final endpoint/prefab validation. Added smoke-road-discovery.mjs to compare every reported prefab lock state with independently read ECS enabled state. Official staged build: 0 warnings/errors; MCP transport/parameter/annotation tests passed. Runtime lock regression and placement pipeline remain pending deployment/restart.

## 0.4.1 live restart, discovery and preview/cancel verification

User authorized agent-controlled game exit/start. Using the installed Computer Use skill, saved current city to a new local save 摩顿汉普斯特德 (existing 111 retained), exited via the game's desktop-exit command, deployed 0.4.1 with matching DLL hashes, clicked Continue in Paradox Launcher, and paused the loaded city via UI.

- Road discovery regression PASS: all 90 prefab lock states match ECS enabled state (50 unlocked, 40 locked).
- Native pipeline preview PASS: Small Road from (100,1050) to (164,1050), terrain height 511.9453, length 64m, one generated edge, actual cost 256, no validation errors.
- Preview request replay returned same operation. Different route with same key rejected (IDEMPOTENCY_CONFLICT).
- Commit below quoted cost rejected (COST_LIMIT), commit_dispatched remained false.
- Cancel reached cancelled; later commit rejected ROAD_NOT_READY.
- Preview/cancel left money unchanged at 1535509 and permanent Road+Edge count unchanged at 79.

Reports: artifacts/road-discovery-0.4.1.json, artifacts/road-preview-validation.json. Actual permanent application, charged cost, road IDs and node connectivity remain pending authorization for the concrete 64m test route. No permanent road was created in the above tests.

## 0.4.1 actual road placement PASS (2026-09-13)

User explicitly authorized the previously presented 64m route by saying 铺路. Ran mcp/smoke-road-build.mjs with artifacts/road-build-authorized.json and max_cost=256. Operation d6ba763cb299439ab67517deeef1fc0a completed. New permanent Road+Edge: 886cea0ee3aa4425bf74e55fb4522f73:57944:13, prefab Small Road, endpoints (100,511.9453125,1050) and (164,511.9453125,1050), curve length exactly 64m.

Road+Edge count: 79 -> 80. Player money: 1534318 -> 1534062, exactly 256 charged. Both generated endpoint nodes contain ConnectedEdge entries referencing this road. Replaying identical operation/request/max_cost returns the same completed operation and road ID with no extra road or charge. Runtime log has one apply-dispatch entry and one completed entry. Entity detail confirms no Temp marker and generated road geometry, SubLane, zone SubBlock and utility components.

Reports: artifacts/road-build-validation.log and artifacts/created-road-details.json. The actual placement is in the running city; no automatic post-build save was performed. Test road is standalone; attachment to an existing network, additional road types and non-flat scenarios remain untested. Prior save 摩顿汉普斯特德 remains the pre-build backup. Original objective of a working basic road creation MCP path is verified.

## 2026-09-13：0.4.1 连接既有路网实测

用户授权连接测试路。两个东侧候选连接预览因 GAME_VALIDATION_WARNING 失败，均未提交。北侧连接预览无错误后提交成功：
- operation_id：b70f6e2b7c534e0287990d109fd357dc，状态 completed。
- 新道路：886cea0ee3aa4425bf74e55fb4522f73:59653:35，Small Road，101.845482 米。
- 起点：已有测试路节点 57943:15，(164, 1050)；终点：既有路网节点 57224:1，(146.662262, 1150.35889)。
- 费用 416，余额 1534062 → 1533646；永久 Road+Edge 数 80 → 81。
- 新 Edge 准确引用指定的两个旧节点；起点 ConnectedEdge 同时含测试路和新连接路，终点同时含连接路和既有道路 81116:1、95692:1。
- 新路无 Game.Tools.Temp，具有 11 条 SubLane。路网快照与节点证据保存于 artifacts/connect-*-verified.json。
- 当前仍暂停；未自动保存建设后的存档。道路拓扑连通已验证，未声称验证车辆实际行驶。

## 0.5.0–0.7.1 road coverage (2026-09-13)

- 0.5.0 live PASS: quadratic curve (2 permanent edges, cost 512), cubic curve (1 edge, cost 736), two-segment polyline (2 edges, cost 640), and mid-edge split T-junction (3 replacement/connector edges, cost 448). The old split edge disappeared and all three edges reference the same new junction node. Exact replay did not change the road count.
- 0.6.0 live PASS: +15m elevated route (3 edges, cost 4224, Elevation x/y=15), -15m tunnel (1 edge, cost 6500, negative Elevation and AlwaysLit), and a ground-to-+15m ramp route (5 edges, cost 5824).
- 0.7.0 first live upgrade changed a 160m Small Road to Alley Oneway in place. The initial completion verifier expected a replacement entity and reported APPLY_OUTCOME_UNKNOWN despite the successful change. ECS inspection established that the native pipeline retains the same edge entity.
- 0.7.1 corrected the verifier and live PASS: create returned completed; upgrade returned completed with the same permanent edge ID and preserved endpoints, curve and elevation; demolition returned completed and the entity then returned ENTITY_NOT_FOUND. Exact upgrade/demolition submission replay returned the cached completed result. Separate requests rejected same-prefab upgrade as NO_CHANGE, a locked target prefab as ROAD_LOCKED, a deleted edge as ENTITY_NOT_FOUND, and any preview while simulation was running as CITY_MUST_BE_PAUSED.

## 0.8.0 batch road management and zoning (2026-09-13)

- Build and MCP transport/schema tests PASS with 0 warnings, 0 errors and 34 tools. Base discovery/query regression and expanded discovery/schema/counts/fields/buffers/reference regression PASS against the live 0.8.0 bridge.
- Live destructive loop PASS: created two adjacent 80 m `Small Road` edges for 640; batch-upgraded both to `Alley Oneway` for -280; disabled both zoning sides for 0; restored both sides for 0; batch-demolished the resulting road for -10; confirmed the final result entity was gone.
- The native network pipeline merged the two adjacent compatible upgraded edges into one 160 m result edge. The operation now returns the actual post-apply IDs in `created_road_ids`; callers must replace stale input IDs after any batch upgrade or zoning operation.
- Batch validation covers one adjacent two-edge route and both zoning sides. The 64-edge maximum, mixed prefabs, disjoint selections and complex intersections are implemented but have not all received live instances.
- Live intersection-control loop PASS on a temporary three-edge T junction: `traffic_lights → all_way_stop → uncontrolled → traffic_lights → automatic`, all through preview/commit with 0 cost. The verifier checks the resulting TrafficLights component and AllWayStop semantics because the native pipeline normalizes redundant upgrade bits. The three temporary roads were then batch-demolished.
- On the same T junction, one approach successfully applied `forbid` to left turn, right turn and straight movement while removing its crosswalk, then restored all three movements and the crosswalk. Both operations completed through the native preview/apply pipeline at 0 cost. Endpoint-side selection used the current city's right/left-hand traffic setting. The native pipeline removed redundant allow/add-crosswalk flags on restoration, and the semantic verifier confirmed the resulting absence of prohibitions.
- Official deployment builds completed with 0 warnings/errors. All 8 MCP protocol/schema tests pass with 25 tools.
- Post-mutation regression PASS: base smoke, expanded discovery/schema/counts/fields/buffers/references/pagination/filter smoke, all 15 environment-grid probes, all 30 selected demand-system native/private fields, and 90-road-prefab lock-state comparison. Full component audit checked 1229 types: 899 readable existing-instance samples, 328 without an instance, Deleted/Temp intentionally rejected, zero read errors, and 29 samples with explicit nested pagination/unavailable/reference markers.
- Native roundabout and road-feature regression PASS on the live city. A temporary three-arm Small Road intersection was converted to the native `Game.Net.Roundabout` node, produced a computed 9 m radius, and was restored. Both-side wide sidewalks, left grass, right trees, wide median and median trees were enabled and cleared through the native upgrade pipeline. All temporary roads were demolished. Native preview costs were 40/-10 for side features, 0/0 for roundabout enable/disable and 0/0 for median enable/disable.
- Standalone ring-road regression PASS. `preview_road_ring` built a 30 m radius counterclockwise one-way circle as four cubic road edges for native cost 624. Topology inspection found exactly four shared nodes, every node had degree two, the directed edge chain returned to its starting node, and signed x/z area was +1800 m². The test ring was demolished afterward.
- Automatic route regression PASS. `preview_road_autoroute` planned a 600 m Small Road route with the balanced strategy on a 32 m grid as three definition segments of 224, 224 and 152 m. The native network pipeline split these into five permanent edges; topology inspection found exactly two terminal nodes and every intermediate node had degree two. Native cost was 2400 and all five returned edges were demolished. The test corridor contained zero building obstacles, so long-route planning, terrain sampling, slope checks, simplification, native subdivision and cleanup are live-verified; avoidance around a real occupied building footprint remains unverified in this empty city.
- Zoning-alignment regression PASS after correcting the endpoint/search-lattice mismatch found by the first live run. With `zoning_alignment=true` and `grid_size_m=32`, requested endpoints `(1850,2700)` and `(2450,2700)` snapped to the same global 32 m lattice, every planned endpoint was an exact lattice point, and all three planned segments were horizontal or vertical. The resulting 608 m route became five permanent native edges for cost 2432, retained a continuous two-terminal topology, and was then fully demolished. This constrains road geometry for orderly zoning; actual Zone Block/Cell generation remains owned by the game.
- Native zoning-cell inspection PASS with the new read-only `inspect_road_zoning` tool (35 tools total). The same aligned 608 m route produced five permanent edges owning 20 native `Game.Zones.Block` entities and 912 `Game.Zones.Cell` elements. All 20 blocks were axis-aligned, every buffer length matched `Block.m_Size.x * m_Size.y`, and every cell center shared global 8 m lattice phase `(4,4)`. The report found 912 clear cells, 152 clear Roadside frontage cells, and zero Blocked, Shared, Occupied or Redundant cells, so `orderly_geometry=true`. The five test edges were fully demolished afterward. This validates actual game-generated zoning geometry for one empty, straight aligned corridor; building-prefab placement and obstructed/intersection cases retain their explicit limits.
- Autoroute completion now fails closed around zoning verification. Installed `Game.Zones.BlockSystem` source confirms its updated-edge query explicitly excludes `Temp`, so exact native Zone Cells cannot exist during the road preview. The tool therefore rechecks grid/cardinal geometry both before `preview_ready` and immediately before Apply, then keeps the committed operation in progress until permanent `SubBlock → Block → Cell` data exists. Live regression returned `completed` only with `zoning_validation=verified`, `zoning_orderly=true`, 20 blocks, 912 cells and 152 clear frontage cells; the route was then demolished. Missing native blocks time out as `ZONING_VALIDATION_TIMEOUT`; a generated non-orderly lattice becomes `ZONING_ALIGNMENT_FAILED`/`outcome_unknown` because application was already dispatched.
- Rectangular street-grid regression PASS with the new `preview_road_grid` mutation (36 tools total). A 2×2 layout with 96×80 m blocks snapped requested origin `(3002,3003)` to the global 8 m zoning lattice and created all 12 planned `Small Road` segments for native cost 4224. ECS topology inspection found exactly nine shared nodes: four degree-2 corners, four degree-3 edge junctions and one degree-4 center intersection. The permanent roads generated 36 native zoning blocks and 1,584 cells, including 168 clear Roadside frontage cells; post-apply verification returned `zoning_validation=verified` and `zoning_orderly=true`. Independent `inspect_road_zoning` agreed, and all 12 test edges were batch-demolished afterward.
- One-way reversal regression PASS with the new `preview_road_reverse` mutation (37 tools total). `list_road_prefabs` now exposes native speed, one-way classification and default direction from `RoadData`. A temporary 80 m `Alley Oneway` was reversed through the native replacement pipeline for cost 0; the permanent edge retained its entity ID while ECS `Edge.m_Start/m_End` swapped exactly, and the completion verifier also confirmed the inverted curve endpoints and unchanged prefab. A separate `Small Road` request was rejected with `ROAD_NOT_ONEWAY`. Both temporary roads were demolished afterward.
- Atomic batch one-way reversal regression PASS with `preview_road_batch_reverse` (38 tools total). Two disjoint 80 m `Alley Oneway` edges with opposite initial geometry directions were reversed in one native preview/apply for total cost 0. Both retained their entity IDs; each result independently matched its planned swapped nodes, inverted curve endpoints and original prefab. A mixed request containing one valid one-way edge and one `Small Road` returned `ROAD_NOT_ONEWAY` before creating a tool preview, establishing whole-request validation. All three temporary roads were batch-demolished afterward.
- Hierarchical street-grid regression PASS with `preview_road_grid` using mixed per-segment prefabs in one native atomic operation. A 2×2 grid created 12 permanent edges with exact planned distribution: 8 perimeter `Medium Road`, 2 internal horizontal `Alley Oneway`, and 2 internal vertical `Gravel Road`; `Small Road` remained the compatible default fallback. ECS inspection found nine shared nodes with degrees `[2,2,2,2,3,3,3,3,4]`. Native zoning verification returned 48 blocks, 1,728 cells and 172 clear frontage cells with `zoning_validation=verified` and `zoning_orderly=true`; cost was 4,704. The legacy single-prefab 2×2 grid also passed unchanged, and every test edge was batch-demolished afterward.
- Automatic existing-network connection regression PASS inside the same `preview_road_grid` transaction. Four temporary approach roads were placed 80 m outside a hierarchical 2×2 grid; `auto_connect` found all requested north/east/south/west targets, reused their exact terminal nodes, and created four orthogonal `Small Road` connectors alongside the 12 grid segments. The permanent type distribution was 8 `Medium Road`, 2 `Alley Oneway`, 2 `Gravel Road`, and 4 connectors. The native network coalesced each connector with its approach road, leaving 16 permanent edges and 13 nodes; all four boundary access intersections and the center were degree 4, with four degree-1 approach terminals and four degree-2 corners. Per-edge native zoning verification passed with 64 blocks, 2,688 cells, 256 clear frontage cells and cost 5,984. A separate request with no target in range returned `NO_ROAD_CONNECTION` before preview. The ordinary and hierarchical grid regressions both passed afterward, and spatial cleanup removed all test roads.
- Parallel-road regression PASS with the new `preview_road_parallel` mutation (39 tools total). A connected L route made from one `Small Road` and one `Gravel Road` was automatically oriented and copied 32 m to its left while inheriting both source prefabs. The 90-degree source corner produced the exact continuous miter `(4928,3032)`, and two 32 m end connectors closed the new route back to the source network in the same native operation; cost was 1,088. An independent cubic source curve was copied on its right for cost 288: five permanent-curve samples stayed on the requested side with measured separations `32.000, 31.009, 30.398, 30.589, 32.000` m. A four-edge 40 m ring was copied outward as a closed four-edge route at 24 m offset; all resulting endpoint radii were approximately 64.001 m and native cost was 1,536. An 8 m request was rejected with `PARALLEL_OFFSET_TOO_SMALL`. All test roads were removed, the automatic-grid connection regression and base MCP smoke passed afterward, protocol tests remained 8/8, and the deployment build had zero warnings/errors.
- Expanded parallel-road live matrix PASS. Six additional permanent cases covered reversed input ordering with forced `Medium Road` (cost 1,408), the exact 17 m minimum accepted offset with both end connections (768), the 128 m maximum offset (640), a 12 m elevated source copied with both ECS elevation values preserved (3,760), a -16 m tunnel source copied with both elevations preserved (5,200), and a continuous three-segment route containing two oblique turns (1,408). Five fail-before-preview cases verified `PARALLEL_CONNECTION_TOO_SHORT`, `DUPLICATE_ROAD_EDGE`, `PARALLEL_ROUTE_DISCONNECTED`, `UNKNOWN_ROAD_PREFAB`, and rejection of `connect_ends` on a closed route. Together with the earlier mixed-prefab L route, cubic curve and closed ring, parallel-road coverage now includes nine permanent scenarios and six explicit rejection scenarios. Spatial ECS cleanup returned zero test edges.

## 1.0.0 road completion (2026-09-13)

- Obstacle-aware parallel-road preview PASS. A requested 24 m separation detected a conflict, selected 28 m in 4 m increments, completed through the native pipeline, and was removed afterward.
- Atomic road/lane policy PASS for a real highway name and selected car-lane speed, public-only and turn flags. Snapshot conflict checking rejected a stale inverse without partial writes; a fresh transaction restored the source. Direct parking-lane writes were removed after the game `ParkingLaneDataSystem` proved they are recomputed from road composition and district policies.
- Persistent parking conversion PASS. A 120 m `Alley` was upgraded through `preview_road_parking` to `Alley - Double Sided Parking`; inspection found four non-virtual parking lanes with 6.9 m free space. `preview_road_undo` restored the original prefab through a native same-origin upgrade. The ordinary Alley retained four `VirtualLane` parking records with zero free space, so 1.0.0 reports both total and usable parking-lane counts. The test road was removed.
- Creation undo PASS on an independent permanent road: preview produced a batch demolition inverse, commit removed the created edge, and the result completed. Automatic creation undo now rejects operations that split existing road edges because the native completion set includes replacement pieces belonging to the original network.
- Four-ramp grade-separated interchange PASS. A temporary 255 m two-way highway was built 12 m above an existing four-lane highway. With 96 m approaches, the planner generated four slope-valid cubic one-way ramps totaling 651.527 m; native preview cost was 3,792 and application completed as 16 permanent ramp pieces. The native pipeline also split the existing lower highway into three connected replacements. All 16 ramp pieces and all five temporary elevated-road pieces were explicitly batch-demolished; the lower highway replacements remain continuous.
- MCP protocol/schema tests PASS 8/8 with 46 tools. Staged and deployed official builds completed with 0 warnings and 0 errors.
- Final deployed bridge reported 1.0.0 in a loaded paused city. A post-deployment parking conversion again completed, `inspect_road_lanes` returned `parking_lane_count=4` and `usable_parking_lane_count=4`, and cleanup completed. Base live MCP smoke passed; built and deployed DLL SHA-256 hashes matched; the runtime log scan found no CitiesSkylines2Mod error or exception entry.

## 1.1.0 terrain modification (2026-09-13)

- Added five MCP tools: `sample_terrain`, `preview_terrain`, `get_terrain_operation`, `apply_terrain`, and `cancel_terrain_preview` (51 tools total). The mutation system creates the same `CreationDefinition`/`BrushDefinition` records as the stock terrain tool, waits for `GenerateBrushesSystem`, then dispatches `ApplyTool`; `ApplyBrushesSystem` calls `TerrainSystem.ApplyBrush`, including water notification, min/max updates and asynchronous CPU height readback.
- Native implementation audit found `TerrainSystem.PreviewBrush` empty in game 1.6.0. The MCP preview therefore validates and journals an unmodified plan with live baseline height samples. Only `apply_terrain` changes terrain, and completion requires a changed CPU height sample. Uncommitted cancellation left the sampled height unchanged at 511.9453 m.
- Live raise/lower PASS: a 64 m, strength 0.5 single-point brush raised 511.9453 to 512.0078 m (+0.0625), and the matching lower brush restored 511.9453 exactly.
- Live level PASS: an 80 m, strength 1, two-pass brush changed 511.9453 to 520.0079 m; a level-to-baseline operation restored 511.9453.
- Live path and smooth PASS: a three-point, 200 m path generated native interpolated brushes and raised the samples by 2.2501, 6.8037 and 4.5001 m. A four-pass smooth brush lowered the center by 1.6161 m. A wider level brush restored all three samples to 511.9453.
- Live slope PASS: a three-point path with endpoints 511.9453 and 519.9453 produced samples 511.9855, 515.9230 and 519.9187 m, then restored all three to 511.9453.
- Validation PASS: missing level target, one-point slope and unpaused preview all failed before mutation with explicit codes. Replaying an identical completed apply request did not issue a second brush. All eight final test points read 511.9453 after cleanup. MCP protocol/schema tests remained 8/8 and the official deployment build completed with zero warnings/errors.
- Completion verifier regression fixed: a broad smooth brush can leave the exact peak sample unchanged while modifying its slopes. Preview now captures the center plus four quarter-radius samples for every requested path point; completion means the native brushes were consumed and CPU readback succeeded, while `change_observed` separately reports sampled numerical change. A live 800 m smooth brush kept the 590.0090 m summit unchanged but changed its radial samples and correctly completed with `change_observed=true`.
- Live mountain construction PASS at `(5200,5200)`: five nested native level brushes formed an approximately 800 m wide mountain from the 511.9453 m plain to a 590.0090 m summit, followed by an 800 m low-strength smooth brush. East radial samples at 50 m intervals were 575.6202, 560.4849, 547.8674, 539.5574, 527.9498, 515.2588, 512.0435 and 511.9453 m. North/south/west profiles returned to the original elevation at 400 m. All six operations completed and the runtime mod log contained no error or exception.
## 1.2.0 zoning operations (2026-09-14)

- Release build and official mod post-processing passed with 0 warnings and 0 errors; deployed DLL hash matched the Release artifact.
- MCP protocol tests passed 8/8 and exposed 80 tools. Runtime capabilities also reported all 80 tools.
- Loaded city `沃本` through `--continuelastsave`, paused it through the bridge, and enumerated 38 unlocked live zone definitions.
- Live test selected permanent `Medium Road` entity `d8762a5304e04365abef92e8c90eacc7:209370:1`. Depth analysis returned 30 cells per depth from 1 through 6, evenly split between left and right.
- A two-row test read 60 cells and changed 56 eligible cells: clear -> `EU Residential Low` -> overwrite with `EU Commercial Low` -> clear. Readback verified every transition and the final 60 cells were clear.
- Left-only preview/cancel passed. Duplicate apply was idempotent. Two previews of the same cells produced the expected `ZONING_CONFLICT` after the first was applied, with no partial write.
- Resumed simulation for 2.5 seconds to exercise native `Updated` processing, paused again, and verified zero non-clear test cells. Recent Player.log contained zero error/exception lines associated with CitiesSkylines2Mod.
# 1.3.0 行政区实机验证（2026-09-14）

- Release 编译及官方 Unity Entities/Jobs/Burst 后处理：0 警告、0 错误。
- MCP 协议、参数校验、桥接安全测试：8/8 通过；工具总数 95。
- 游戏 1.6.0f1，城市“沃本”：创建 4 点、25,600 平方米行政区并自动命名成功。
- 自交多边形拒绝、点定位、详情、覆盖成员查询均通过。
- 边界替换为 5 点后，游戏几何系统回算面积 39,800 平方米。
- 读取到 9 项地区政策；`Bicycle Traffic Restriction` 开启、读回及关闭恢复通过。
- 垃圾填埋场 `ServiceDistrict` 限定到测试行政区、读回及恢复为空（全部地区）通过。
- 原生创建预览取消成功；测试行政区删除成功，最终地区数恢复为 0。
- 当前会话模组错误日志为 0；部署 DLL 与 Release DLL 的 SHA-256 一致。
## 1.11.0 市民、家庭、企业与资源物流（2026-09-14）

- 新增 12 个工具，总数 200；全平台官方后处理和 8 项 MCP 测试通过。
- “沃本”读取到 8 名市民、3 个家庭、45 家企业、77 个资源持有者和 41 种资源；健康、家庭 Money、企业利润和库存均完成精确往返恢复。
- 当前没有工人和学生实例，空筛选已验证，非空关系待后续城市覆盖。详见 `docs/guides/economy/POPULATION-ECONOMY-GUIDE.md` 与 `artifacts/population-economy-live-1.11.0.log`。

## 1.10.0 城市进度、里程碑与解锁（2026-09-14）

- 新增 10 个工具，总数 188；Release 官方后处理与 8 项 MCP 测试通过，0 警告、0 错误。
- 真实城市“沃本”成功读取 20 个里程碑、71 个发展节点、2111 个可锁定预设和 529 个地图格；满级边界返回稳定的完成状态。
- XP 与发展点完成可恢复写入测试；节点购买和单项解锁在该全解锁存档验证幂等行为；原生全量解锁调度已运行。详见 `docs/guides/city/PROGRESSION-GUIDE.md` 与 `artifacts/progression-live-1.10.0.log`。



