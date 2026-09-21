## 1.18.0 灾害控制（2026-09-14）

- 13 个灾害工具实机覆盖发现、应急能力、取消预览、应用、读取、修改、影响追踪、停止和两级清理；318/318 工具一致。
- 全部 8 个已加载预设完成原生初始化：`Hail Storm`、`Lightning Strike`、`Tornado`、`Building Fire`、`Forest Fire`、`Building Collapse`、`Flood`、`Tsunami`；覆盖天气、火灾、破坏、水位四类事件，龙卷风并发限制得到真实拒绝结果。
- 最终活动灾害 0、模拟正常速度；记录见 `../artifacts/disaster-live-1.18.0.log`。
- 官方后处理与三平台 Burst 构建 0 警告、0 错误，Node 测试 8/8。
## 1.17.0 城市管理（2026-09-14）

- 新增 10 个 MCP 工具，总数 305；协议自动测试 8/8，覆盖配置、名称、资金、全市政策、修正值及统计历史。
- “沃本”实机完成全部可写字段往返，`Advanced Pollution Management` 通过原生政策事件切换并恢复；读取 15 个人口历史样本。
- 官方后处理与三平台 Burst 构建 0 警告、0 错误；实机日志：`../artifacts/city-management-live-1.17.0.log`。
## 1.16.0 市民、家庭和企业完整操作（2026-09-14）

- 新增 25 个工具，总数 295；覆盖市民 10、家庭 7、企业 8 项完整操作。协议自动测试 8/8，运行中能力对齐 295/295。
- 官方后处理与三平台 Burst 构建 0 警告、0 错误。
- “沃本”临时实体闭环真实验证通过，包括双向家庭/员工/学生/建筑占用/房产租户关系，以及企业交易成本新增、修改和删除；最终清理测试实体并恢复正常速度。
- 实机日志：`../artifacts/population-operations-live-1.16.0.log`。
## 1.15.0 环境与景观（2026-09-14）

- 270 个 MCP 工具，8 项自动测试通过；官方后处理与三平台 Burst 构建 0 警告、0 错误，构建和部署 DLL 哈希一致。
- 实机完成景观放置/移动/状态/删除、水源 CRUD、三类污染写入恢复、天气覆盖、风设置恢复、风场与土壤水采样。
- 实机日志：`../artifacts/environment-landscape-live-1.15.0.log`、`../artifacts/climate-live-1.15.0.log`。
# 验证记录

## 1.14.0 公共交通剩余操作（2026-09-14）

- 新增 17 个 MCP 工具，总数 249。线路侧覆盖班表、票价、目标车辆数、编号、均匀发车、站点名、车辆请求生命周期和运营车辆返场；设施侧覆盖升级枚举、名称、启停、政策与升级安装/移除预览。
- Release 官方后处理与三平台 Burst 构建 0 警告、0 错误；8 项 MCP 自动测试全部通过；构建/部署 DLL 哈希一致，真实游戏桥接报告 1.14.0。
- 临时 4 站公交线路完成全部新增线路控制的读写回归。车辆数设置使用该路线原生允许范围 4..17；票价在暂停状态立即读回，并由原生政策继续维护；车辆请求完成创建、列出和取消。
- 临时 `BusStation02` 完成名称、停用/启用、政策写入及 `BusStation02 Extra Platforms` 升级安装/移除闭环。升级实体删除后，事务仍可按已登记的交通设施操作身份轮询至 `completed`；车站随后拆除。
- 临时 `BusDepot01` 使测试线路在最快速度下生成 2 辆公交车；其中一辆成功设置原生返场标志。全部测试对象清理后，公共交通线路与设施均为 0，模拟速度为正常。
- 实机日志：`artifacts/transport-controls-live-1.14.0.log`、`artifacts/transport-facility-live-1.14.0.log`、`artifacts/transport-release-live-1.14.0.log`。

## 1.13.0 地图和区域（2026-09-14）

- 新增 12 个地图格 MCP 工具，总数 232，并与既有行政区、土地分区、地形和环境栅格接口整合。
- Release 官方后处理与三平台 Burst 构建 0 警告、0 错误；8 项 MCP 自动测试全部通过；部署桥接报告 1.13.0。
- “沃本”读取 529/529 个地图格、约 205.52 平方公里地图面积和 `-7168..7168` 米世界边界；逐格边界、九类特征、四邻接、中心点反查、资源排名、可建设面积、海平面、气候、分区及地形采样通过。
- 运行中全解锁正确拒绝；暂停后 529/529 全解锁幂等成功；已拥有格购买正确拒绝；最终模拟恢复正常。
- 当前存档没有未购地图格，成功购买报价、取消、扣款和首次解锁分支仍缺真实非空实例。记录见 `artifacts/map-area-live-1.13.0.log`。

## 1.12.0 交通与出行控制（2026-09-14）

- 新增 20 个 MCP 工具，总数 220；覆盖车辆、Traveler、市民行程、连接车道、交通流、停车、重寻路、目标/速度/车道偏好和清理。
- Release 官方后处理及 Windows/macOS/Linux Burst 构建通过，0 警告、0 错误；8 项 MCP 自动测试通过，部署桥接报告版本 1.12.0。
- “沃本”最终样本读取 102 辆车辆、84 辆移动中车辆、18 辆停放车辆、41 条有车道路、975 条停车车道和 3177 条连接车道。
- 实机通过完整车辆路径读取、车辆和 Traveler 重寻路、车辆同目标重设、汽车最高速度往返、公交车道偏好标志往返、瞬时速度清零、原生市民行程入队/取消、单车删除和批量停放车辆清理；模拟最终恢复正常。
- 类别筛选非空覆盖汽车、个人车、公共交通、配送和服务车辆；当前存档没有自行车、列车、船舶、飞机、出租车、货运、步行/等待/卡住实例，相应分支仅完成接口和空结果验证。
- 当前地图候选市民在恢复模拟后会被游戏清理，未取得稳定居民从 `TripNeeded` 入队到 Human/车辆生成的完整实例链。记录见 `artifacts/traffic-mobility-live-1.12.0-final.log`、`artifacts/traffic-mobility-filters-1.12.0.json` 和 `artifacts/citizen-trip-live-1.12.0.log`。

## 1.11.0 市民、家庭、企业与资源物流（2026-09-14）

- 新增 12 个 MCP 工具，总数 200；覆盖市民/家庭/企业详情、全城 41 类资源经济、资源持有者以及四种暂停写入。
- Release 编译及官方 Windows/macOS/Linux Burst 后处理通过，0 警告、0 错误；8 项 MCP 自动测试通过，部署桥接报告版本 1.11.0。
- “沃本”真实读取到 8 名市民、3 个家庭、45 家企业、77 个资源持有者和全部 41 种资源。
- 运行中修改正确拒绝；暂停后市民健康 52→53→52、家庭 Money 688→689→688、企业利润 127→128→127、资源库存 688→689→688，全部回读并恢复，最终模拟正常。
- 当前样本没有 `Worker` 和 `Student` 实例，相关空筛选已验证；非空工作/学校关系仍待人口发展后的存档补测。
- 记录保存在 `artifacts/population-economy-live-1.11.0.log`。

## 1.10.0 城市进度、里程碑与解锁（2026-09-14）

- 新增 10 个 MCP 工具，总数 188；覆盖 XP、里程碑奖励、发展点、发展树、地图格许可以及单项/全量原生解锁。
- Release 编译、Unity Entities/Jobs/Burst 后处理和 8 项 MCP 自动测试均通过，0 警告、0 错误；部署后的真实桥接报告版本 1.10.0。
- “沃本”读取到 20 个里程碑、71 个发展节点、2111 个可锁定预设和 529 个已拥有地图格；满级存档正确返回 `completed=true`，不再透出原生负进度缓存。
- 运行中 XP 与发展点写入均返回 `CITY_MUST_BE_PAUSED`；暂停后 XP 307→308→307、发展点 0→1→0 往返成功，最终恢复正常速度。
- 存档已将全部 2111 个预设解锁，因此购买节点和单项解锁验证了幂等分支；`UnlockAllSystem` 的原生全量解锁调度已实际执行。含锁定内容存档上的首次购买/首次单项解锁事件落地仍未取得实例覆盖。
- 记录保存在 `artifacts/progression-live-1.10.0.log`。

## 1.9.0 城市发展与需求（2026-09-14）

- 新增 7 个 MCP 工具，总数 178；覆盖分区与资源需求、人口、住房、就业、教育和原生无限建筑需求控制。
- Release 编译及官方 Unity Entities/Jobs/Burst 后处理通过，0 警告、0 错误；真实游戏桥接报告版本 1.9.0。
- 真实城市“沃本”中，6 个查询接口全部成功；返回全部 41 种资源和住宅、商业、工业、办公各 19 个有符号需求因子。
- 无限需求控制在模拟运行时正确拒绝；住宅、商业、工业三组分别完成开启/关闭，全开后运行模拟可见住宅、商业、工业、办公建筑需求为 100。原生工业开关不改变仓储需求，此边界已写入接口说明。
- 测试后全部无限需求开关关闭，模拟恢复正常速度。结果保存在 `artifacts/development-reads-1.9.0.jsonl` 和 `artifacts/development-live-1.9.0.log`。

## 1.8.0 城市经济管理（2026-09-14）

- 新增 12 个 MCP 工具，总数 171；覆盖经济总览、税率、服务预算、服务费、贷款及经济操作生命周期。
- Release 编译和官方 Unity Entities/Jobs/Burst 后处理通过，0 警告、0 错误；部署后的真实游戏桥接报告版本 1.8.0。
- 基础实机事务验证通过：取消预览、运行中拒绝、重复请求幂等、原值冲突；总税率、街区税率、教育税率、资源税、服务预算、服务费和贷款借入/还清均完成修改与恢复。
- 扩大矩阵在真实城市“沃本”逐项测试 71 个目标：总税率 1、四类街区税率 4、五级教育税率 5、全部有效资源/产业组合 48、可调服务预算 11、可调服务费 2。71 项全部应用并恢复，失败 0；最终税率、预算、服务费、贷款和资金与基线一致，模拟恢复正常速度。
- 结果保存在 `artifacts/economy-live-1.8.0.log` 和 `artifacts/economy-matrix-1.8.0.log`；完整矩阵可用 `mcp/smoke-economy-matrix.mjs` 重复运行。

## 1.7.0 城市公共服务设施（2026-09-14）

- 新增 12 个 MCP 工具，总数 159；MCP 协议、参数和桥接测试 8/8 通过。
- Release 编译和官方 Unity Entities/Jobs/Burst 后处理通过，0 警告、0 错误；部署后的游戏桥接报告版本 1.7.0。
- 真实城市发现 139 个已解锁可放置公共服务预设。医疗、消防、警察、教育、垃圾、殡葬、维护、公园、邮政、停车、福利、研究和应急共 13 类均完成原生选址、放置、实例详情读取和拆除；普通设施移动完成。
- `FireHouse01 Garage Extension` 在临时 `FireHouse01` 上完成安装和移除，验证公共服务操作日志在升级预览改变目标结构后仍可持续轮询。临时消防站随后拆除，设施数恢复为原有 2 座，模拟恢复正常速度。
- 早期对带区域的 `Landfill01` 升级模块执行移除时，游戏在应用派发后退出。该特殊组合没有列为通过；恢复存档后确认填埋场没有残留升级。普通消防站升级移除未复现退出。
- 结果保存在 `artifacts/city-services-discovery-1.7.0.log`、`artifacts/city-services-transactions-1.7.0.log`、`artifacts/city-service-upgrade-cycle-1.7.0.log`。可重复脚本不包含会话固定 ID。

2026-09-13：

- 本机游戏程序集：1.6.0f1；按当前程序集接口实现。
- 官方 C# 编译及 Mod Post Processor：通过，0 警告、0 错误（暂存构建）。
- `npm test`：8 项通过，包含真实 MCP STDIO 握手及工具调用；游戏端在这些自动测试中使用本机测试服务模拟。
- 当时使用 Codex 作为 MCP 测试客户端：已注册 `cities-skylines2`，使用本机 Node 可执行文件和本项目 `mcp/server.mjs`；这不是其他 Agent 客户端的必需配置格式。
- MCP 诊断：当前旧版游戏运行时，正确返回 `BRIDGE_NOT_FOUND`，不会伪造城市数据。
- 14:17 后游戏退出，MCP 版本已重新构建并部署，0 警告、0 错误；构建 DLL 与部署 DLL 的 SHA-256 一致。
- 14:21 主菜单真实 MCP 测试通过：SDK 初始化和五项工具发现成功；游戏返回 connected=true、city_loaded=false、game_mode=MainMenu；能力查询成功；城市概况查询正确返回 CITY_NOT_READY。
- 14:21:55 加载城市并暂停后，真实 MCP smoke 测试全部通过：状态、能力、城市概况、住宅第一页与第二页、实体详情、跨会话 ID 拒绝、超范围参数校验。
- 测试城市：摩顿汉普斯特德；paused=true，模拟帧 102444；人口 92，资金 1919404，建筑总数 65，住宅建筑 62。结果来自运行中的模组，非模拟数据。
- SDK 客户端实际启动本项目 STDIO MCP 服务并查询游戏；完整输出保存在本机 `live-smoke.log`（不纳入版本控制）。
- 当时的测试客户端已注册该服务；已有会话可能需要重启 MCP 连接或重新打开客户端，才能在工具目录中发现新增服务。
- 尚未专项验证：实际切换两个存档后的隔离、快照自然过期、大城市负载；目前已验证伪造旧会话 ID 被拒绝，尚不等同于完整的存档切换测试。

此前的基础模组已在游戏内验证加载日志、设置按钮及模拟回调。该验证不代表新增 MCP 功能已经在游戏内通过。

## 0.2.0 扩展查询

- 新增组件目录/结构发现、通用实体筛选计数、公开组件与共享组件字段读取、缓冲区分页、城市实体及实例分类统计。
- 总计 11 个 MCP 工具、29 个查询分类；其中 get_city_data 汇总 27 个实例分类，排除 all 与 prefabs。
- 官方构建及后处理通过：0 警告、0 错误。
- 自动测试 8 项通过，增加了新工具转发、类型名、分类、过滤条件长度和缓冲区参数验证。此处游戏端仍为测试服务，不能代替真实字段读取验证。
- 已部署新版并校验 DLL 哈希一致。
- 14:34 真实城市扩展 smoke 全部通过：目录及 schema、市民/家庭/企业/道路/车辆/服务设施样本、分类计数、普通字段、家庭成员缓冲区及分页、家庭到市民的引用、住宅到预设容量数据的引用、实体分页、错误过滤条件拒绝。空分类只验证空结果，不视为值读取通过。
- 14:34:41–14:34:51 遍历目录的 1229 种类型，针对每种类型查询一个已有实体：878 种成功返回样本（534 普通组件、197 缓冲区、143 标签/仅私有字段类型、4 共享组件），349 种当前城市没有匹配实例；Deleted 和 Temp 两种按设计拒绝查询。错误 0，顶层 unavailable/unsupported 样本 0。
- 878 种成功样本中 Game.Areas.Batch 的部分嵌套数据明确标为 unsupported；因此“成功读取样本”不代表完整导出全部内存字段。未遍历每个实体或每个缓冲区元素，也未测试大城市性能。
- 详细本机结果：expanded-smoke.log、component-audit.log；component-audit.json 包含类型级抽样名单与计数，可重复运行 audit-components.mjs。
# 1.3.0 administrative-district validation

- 95 MCP tools; all 8 bridge/schema tests pass.
- Live create/name/query/find/coverage/reshape/policy/service-assignment/cancel/delete round trip passes on game 1.6.0f1.
- Test district changed from four nodes/25,600 m² to five nodes/39,800 m², then was deleted.
- Service assignment and policy state were restored; the city returned to normal simulation speed.

# 1.4.0 public-transport-line validation

- 110 MCP tools; all 8 bridge/authentication/schema tests pass.
- Official Release build and Unity Entities/Jobs/Burst post-processing pass with 0 warnings and 0 errors. Build, staged, and deployed DLL hashes match.
- Live discovery on game 1.6.0f1 found 10 line prefabs and 12 outside-connection stops across Bus, Train, Ship, and Airplane networks.
- Native preview/apply/delete round trips pass for 7 available variants: bus; passenger and cargo airplane; passenger and cargo ship; passenger and cargo train. Tram, subway, and ferry have no compatible stops on this map, so their real path creation remains untested.
- Live mutation round trips pass for custom name, RGBA color, active/inactive state, the native Route Out of Service policy, complete stop-order replacement, preview cancellation, and duplicate-stop rejection.

# 1.5.0 public-transport-infrastructure validation

- 128 MCP tools; all 8 bridge/authentication/schema tests pass.
- Release build and Unity ECS/Jobs/Burst post-processing complete with 0 warnings and 0 errors.
- Live prefab discovery returned placeable transport stations/depots plus 24 native `TrackPrefab` definitions across Train, Subway and Tram.
- Live station coverage: `BusStation02` placement, permanent entity verification, three owned bus-stop records, relocation to another road, and demolition all completed.
- Live track-bearing station coverage: `SubwayStation01` placement returned two owned subway stops and one 200 metre owned subway track; demolition completed.
- Live depot coverage: `BusDepot01` placement returned depot state and 25 owned vehicle slots; demolition completed.
- Live track coverage: standalone Subway, Train and Tram tracks completed through native preview/apply. A second Subway segment attached to the first segment's permanent node and completed.
- Mixed batch demolition completed for four test track edges. Final verification found 0 test facilities, 0 test tracks, and the original 79 map-owned tracks unchanged.
- Track edge-split input reached the native preview pipeline; the attempted perpendicular mixed-composition junction was rejected by game validation. Callers must inspect preview errors and may need a compatible alignment/elevation/prefab.
- Detailed line reads pass for route distance, ordered waypoints, aggregate and per-stop waiting fields, vehicle list shape, policy state, and pending vehicle request. A passenger train was run at fastest speed for 30 seconds; without a depot or city station the game kept vehicle_request_pending=true and generated no vehicle, so non-empty vehicle instance fields remain implementation- and compile-verified but not instance-verified on this map.
- Every temporary test line was deleted. Final list_transport_lines returned 0 and simulation speed was restored to normal. The mod log contains no transport warnings, errors, or exceptions.
- Repeatable scripts and latest outputs: smoke-transport-live.mjs, smoke-transport-vehicle-live.mjs, transport-live-smoke.log, and transport-vehicle-live.log.

# 1.6.0 utility-infrastructure validation

- 147 MCP tools; all 8 bridge/authentication/schema tests pass.
- Release build and Unity ECS/Jobs/Burst post-processing complete with 0 warnings and 0 errors.
- Live discovery on game 1.6.0f1 found 11 usable utility-network prefabs and 26 placeable utility-facility prefabs.
- Native creation completed for low-voltage underground cable, water pipe, sewage pipe, combined water/sewage pipe, and resource pipe. Admission correctly rejected a segment longer than the selected prefab's 90 metre maximum.
- A water pipe upgraded from Small to Large in place. A second sewage segment connected to an existing permanent utility node. A perpendicular connection to the middle of an existing water edge reached preview-ready and was cancelled successfully.
- `TransformerStation01` and `TelecomTower01` each completed site planning, native placement, permanent instance readback, relocation and demolition.
- Mixed batch demolition completed for all six test utility edges. Final verification returned the original 41 map-owned utility edges and one pre-existing water pumping station.
- An attempted standalone high-voltage overhead line at the selected test coordinates was rejected by native game validation; underground electricity creation passed, and existing high-voltage line geometry reads passed. Overhead placement remains dependent on a valid map location.
- Latest outputs: `utility-network-live2-1.6.0.log`, `utility-advanced-live-1.6.0.log`, `utility-facilities-live-1.6.0.log`, and `utility-cleanup-live-1.6.0.log`.



