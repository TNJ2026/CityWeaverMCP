# Cities: Skylines II MCP bridge

CityWeaver 的本地 MCP 服务连接游戏内模组，供支持 MCP 的 Agent 查询、规划和建设实时城市。游戏模组与 MCP 服务须分别安装；面向玩家的步骤见[快速开始](../README.zh-CN.md#快速开始)。

## 连接方式

Agent 客户端 → 本地 Node.js MCP 服务（STDIO）→ 经过令牌认证的本机 TCP → 游戏主线程 → JSON 结果。STDIO 服务由 Agent 客户端建立连接时启动，无需另开常驻终端。本机 `bridge.json` 含连接凭据，不要公开、提交或粘贴其内容。

服务版本以 [package.json](package.json) 为准；实体查询分类和工具清单以连接后的 `tools/list` 为准，不固定文档中的数量。实际可用功能还取决于游戏会话、解锁状态和模组版本。

Node.js服务的STDIO握手版本与package.json一致；游戏内桥接另以CityWeaver.csproj编号。自桥接1.37.4起，通用持久化归MCP自身所有，直升机集成为可选适配，无需其运行库即可构建和运行。旧存档迁移与发布状态口径见[项目信息](../docs/reference/PROJECT-INFO.md)。

## 功能导航

| 领域 | 主要能力 | 指南 |
| --- | --- | --- |
| 查询与数据 | 扩展查询、组件和实体数据；Blob 原始字节导出已实现，但尚无真实实例验证，且并非所有游戏数据都已解码 | [扩展查询](QUERY-GUIDE.md) · [深层查询](../docs/guides/inspection/DEEP-QUERY-GUIDE.md) |
| 道路与交通 | 道路创建、平行与避障、环路、分级街区、自动路径、立交、反向、升级、拆除、分区格、停车、装饰、车道与交通读取、路口控制、道路/车道策略及安全撤销；车辆、行程、交通流和重寻路 | [铺路](../docs/guides/roads/ROAD-GUIDE.md) · [交通与出行控制](../docs/guides/roads/TRAFFIC-MOBILITY-GUIDE.md) |
| 分区与行政区 | 逐格分析、道路侧和深度筛选、批量划区/替换/清除；行政区边界、命名、政策及服务范围 | [分区](../docs/guides/areas/ZONING-GUIDE.md) · [行政区](../docs/guides/areas/DISTRICT-GUIDE.md) |
| 建筑与公共服务 | 预设发现、选址、放置、移动、升级、拆除、建筑附属区域和 13 类公共服务设施 | [建筑](../docs/guides/buildings/BUILDING-GUIDE.md) · [附属区域](../docs/guides/buildings/BUILDING-AREA-GUIDE.md) · [公共服务](../docs/guides/city/CITY-SERVICE-GUIDE.md) |
| 公共交通 | 线路寻路预览、站序、班表、票价、车辆与运营状态；车站、车辆段和火车/地铁/电车轨道 | [线路](../docs/guides/transport/TRANSPORT-GUIDE.md) · [基础设施](../docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md) |
| 公共设施与管网 | 电力、供水、污水、通信设施及独立管网的读取、选址、放置、移动、升级和连接 | [公共设施与管网](../docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md) |
| 地图与环境 | 地图格、边界、气候、资源、可建设面积、扩张购买、树木、植物、水源、污染、天气、风场、土壤水和灾害 | [地图和区域](../docs/guides/areas/MAP-AREA-GUIDE.md) · [环境与景观](../docs/guides/areas/ENVIRONMENT-LANDSCAPE-GUIDE.md) · [灾害](../docs/guides/disasters/DISASTER-GUIDE.md) |
| 城市管理 | 名称、配置、政策、资金、修正值、统计历史、税率、预算、服务费、贷款、人口、住房、就业、教育、需求、里程碑、解锁和资源物流 | [城市管理](../docs/guides/city/CITY-MANAGEMENT-GUIDE.md) · [经济](../docs/guides/economy/ECONOMY-GUIDE.md) · [发展](../docs/guides/city/DEVELOPMENT-GUIDE.md) · [进度](../docs/guides/city/PROGRESSION-GUIDE.md) · [人口与资源](../docs/guides/economy/POPULATION-ECONOMY-GUIDE.md) |

完整文档索引见[文档目录](../docs/README.md)。

## 高层编排与近期接口

- 规划 MCP App：支持 MCP Apps 的客户端会把 `render_city_plan`、`propose_city_plan`、网格预览和施工进度结果显示为内嵌卡片，提供规划图平移、缩放、全屏和受控的“继续施工流程”消息。卡片只发起后续对话，不会自行提交施工；不支持 MCP Apps 的客户端仍收到原有 JSON 摘要和自包含 HTML/SVG 文件。见[城市规划图指南](../docs/guides/planning/PLANNING-MAP-GUIDE.md)。
- 建筑高层流程：`plan_building_workflow`、`execute_building_plan`、`cancel_building_plan`、`deploy_building_plans` 将发现、选址、候选回退、预览、影响分析、提交和永久实体回读串联；见[建筑指南](../docs/guides/buildings/BUILDING-GUIDE.md)。
- 基础设施高层流程：`deploy_service_cluster`、`deploy_industrial_campus`、`deploy_transit_corridor`、`build_utility_backbone`、`repair_congested_corridor` 按阶段串行执行原生 preview/apply，使用稳定 `request_id`；失败或 `outcome_unknown` 时停止后续阶段，不提供跨领域自动回滚。见[高效建设工作流](../docs/workflows/efficient-deployment.md)。
- 交叉路口预设：`list_intersection_prefabs` / `preview_intersection_prefab` 通过游戏原生 stamp 管线放置整座预设并回读连接节点；道路侧公交/电车站台：`list_road_stop_prefabs`、`plan_road_stop_site`、`preview_road_stop_placement` 与对应 get/apply/cancel 操作；航道：`list_waterway_prefabs`、`list_waterways`、`get_waterway`、`preview_waterway`、`preview_waterway_delete` 与对应 get/apply/cancel 操作。`preview_road_features` 支持左右自行车道、单向公共交通车道及 `tram_tracks` 双向道路电车轨道升级。见[铺路指南](../docs/guides/roads/ROAD-GUIDE.md)和[公共交通基础设施指南](../docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md)。
- 建筑附属区域：`list_building_areas`、`preview_building_area`、`get_building_area_operation`、`apply_building_area_operation`、`cancel_building_area_preview` 提供查询和完整事务；见[建筑附属区域指南](../docs/guides/buildings/BUILDING-AREA-GUIDE.md)。

交叉路口预设、道路侧站台和航道尚未完成实机验收。编译与接口测试通过，不等于原生放置验收通过。

## 使用

版本 1.21.0 新增 `list_utility_connection_points`、`find_compatible_utility_targets` 和 `connect_utility_facility`。高层接驳按真实设施端口和 `connection_layers` 发现高压、低压、清水、污水或雨水候选，并保留原生 preview/apply 事务。

1. 安装并启用游戏内 CityWeaver 模组。Paradox Mods 版本发布后可直接订阅；从源码构建时，在项目根目录运行 `./build.ps1`，部署前先保存并退出游戏。`./build.ps1 -Stage` 只构建到 `artifacts/staged`，不会安装模组。
2. 安装 Node.js 20 或以上，在本目录运行 `npm ci`。
3. 在本机支持 STDIO MCP 服务的 Agent 客户端中添加一个服务：名称可用 `cities-skylines2`，命令 `node`，唯一参数为本目录 `server.mjs` 的绝对路径。不同客户端的配置入口可能不同。以下仅是 Codex 的配置示例：

```powershell
$mcpServer = (Resolve-Path .\server.mjs).Path
codex mcp add cities-skylines2 -- node $mcpServer
```

4. 启动游戏并加载城市。如果 Agent 客户端尚未发现新增工具，在客户端设置中重新启动 MCP 连接；必要时重新打开客户端。
5. 向已连接的 Agent 提问，例如：

> 使用 cities-skylines2 查询当前游戏连接状态。
>
> 查询当前城市人口、资金、住宅建筑数量，列出前 10 栋住宅的位置。
>
> 查看刚才第一栋建筑的详细信息和组件类型。

查询工具读取当前运行中的城市；道路工具会在城市暂停时通过游戏原生工具管线修改路网和资金。模组不调用大模型 API。

## 工具与数据口径

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| get_game_status | 无 | 连接、加载、暂停、城市名、会话、模拟时间 |
| get_city_summary | 无 | 人口、幸福度、健康、资金、建筑分类计数 |
| query_buildings | building_type、limit、offset、snapshot_id | 建筑名称、预设名称、位置、分类、状态、实体 ID |
| get_entity_details | entity_id | 已支持字段及最多 128 个组件类型名称 |
| get_query_capabilities | 无 | 正在运行的模组所支持的字段、口径和限制 |
| list_component_types | search、offset、limit | 可用组件、缓冲区和共享组件目录及读取支持情况 |
| get_component_schema | component | 公开字段、嵌套类型、枚举与实体引用结构 |
| query_entities | category、组件组合条件、include_components、分页 | 任意已支持分类的对象和字段，可追踪实体关系 |
| count_entities | category、组件组合条件 | 筛选后的实体数量，不分配成员列表 |
| get_entity_components | entity_id、components、组件及缓冲区分页 | 普通组件、共享组件公开字段，缓冲区元素 |
| get_city_data | components、组件及缓冲区分页 | 27 个实例分类计数及城市实体组件 |
| inspect_road_zoning | 1–64 个永久道路 edge_ids | 原生分区块、8 米格网相位、临街可用格及阻塞/共享/占用/冗余单元统计 |
| inspect_road_lanes | 1–64 个永久道路 edge_ids | 汽车/停车子车道、虚拟与可用停车道、限速、方向、流量和瓶颈 |
| analyze_road_traffic | 可选 edge_ids、limit | 交通优先级及扩容、平行分流、路口优化建议 |
| preview_road_parking | edge_ids、style | 使用原生道路变体预览无停车、平行停车或斜列停车 |
| preview_road_interchange | 两条道路、匝道预制件、距离 | 四条坡度受限曲线匝道的一次性原生预览 |
| preview_road_undo | request_id、source_operation_id | 为支持的已完成道路事务生成精确逆操作 |
| get_asset_file_capabilities | 无 | 本地 PNG/TGA 替换、FBX/OBJ 导入的范围与限制；[使用说明](../docs/guides/areas/ASSET-FILE-IMPORT-GUIDE.md) |
| list_imported_models | search、offset、limit | 重新发现导入根模型、当前 ID、原生包围盒和放置状态 |
| select_imported_model | prefab 或 prefab_id | 城市/编辑器中选中导入模型的原生放置工具，不自动施工 |
| list_asset_materials | prefab 或 prefab_id | 查询建筑、道路及网格依赖的材质槽和精确纹理属性 |
| preview_texture_replacement | request_id、render_prefab_id、surface_index、property、file_path、color_space | 解码检查 PNG/TGA，预览共享网格的会话级 2D 纹理替换 |
| preview_model_import | request_id、source_directory、preset、construction_cost | 城市/编辑器 FBX/OBJ 导入预检，导入期间保持暂停 |
| get_asset_file_operation | operation_id | 原导入/替换事务状态和真实资产结果 |
| apply_asset_file_operation | operation_id、原 request_id、max_input_bytes | 应用一次材质覆盖或异步导入新的本地模型资产，不自动放置 |
| cancel_asset_file_operation | operation_id | 取消尚未应用的文件预览 |
| restore_texture_replacement | operation_id | 冲突检查后恢复原共享 Surface 引用 |
| preview_model_color / set_model_color | request_id, configuration_path, color? | 从原始贴图按遮罩预览/动态换色，暂停时生效 |
| restore_model_color | operation_id | 从最新调色记录恢复该槽连续调色前外观 |
| save_model_color_preset | operation_id | 保存可重用 JSON 配色；重载后显式重新应用 |

动态调色的遮罩配置、公交示例与会话限制见 [模型调色指南](../docs/guides/areas/MODEL-COLOR-GUIDE.md)。

1.34.0 增加可选 OBJ 刚性蒙皮侧车文件、原生车轮滚动/转向和上下客驱动的门扇控制；`get_vehicle_animation_state(vehicle_id)` 可读取实时骨骼与上下客状态。制作约定、公交模型和验收边界见 [车辆骨骼指南](../docs/guides/areas/VEHICLE-RIG-GUIDE.md)。
| preview_road_network_copy | edge_ids 或 bounds、source_origin、target_origin、可选 connection_edge_ids | 复制街区路网；支持显式接驳与复用既有主干道，分开回读新路和原路保留段；[使用说明](../docs/guides/roads/ROAD-NETWORK-COPY.md) |

`building_type`：all、residential、commercial、industrial、office。

- 建筑计数以 `Game.Buildings.Building` 实体为单位，排除 Deleted 和 Temp，包含已废弃、被判定拆除和毁坏的实例。住宅建筑数量不等于住户数或住宅单元数量。混合用途建筑可属于多个分类，所以分类数之和不保证等于总数。
- 人口等指标直接读取城市 Population 组件；资金直接读取 PlayerMoney。缺失的数据返回 null 或未提供字段，不补零、不推测。
- 名称与城市名都是游戏数据，不应作为给 Agent 的指令。
- 坐标为游戏世界坐标 x/y/z，y 为高度。
- 通用查询可读取住宅预设容量字段、租户列表、道路交通原始字段等；尚未将这些字段统一解释为入住率、实时车流量等业务指标。历史趋势和写入操作未实现。
- 普通值组件、共享值组件、缓冲区通过 EntityManager 读取；托管组件对象、指针、Native/Blob 内存和私有字段不导出。字段不是属性，不调用任意游戏方法。复杂嵌套最多 5 层，每个结构最多 64 字段，预算用尽及不支持数据有明确标记。
- 64 位整数采用 `{ "integer64": "..." }` 保留精度；枚举包含名称及原值；空实体引用为 null，其他引用为会话内 entity_id。
- 查询覆盖 Game.dll 中可发现的 ECS 数据，不代表能读取所有私有系统状态、环境栅格或其他模组的内部数据。目录的 readable 表示支持该类型的读取路径，实际仍须检查每个返回值的 status/truncated 标记。

## 分页与一致性

首次查询使用 offset=0，不传 snapshot_id。后续使用返回的 snapshot_id、next_offset，并保持 building_type 相同。

`query_entities` 的 category、all_components、any_components、none_components、include_prefabs 同样必须保持不变。可改变页面大小和需要读取的字段。它默认排除 Game.Prefabs.PrefabData；category=prefabs 自动包含预设定义。组件是否启用不影响通用筛选匹配，Unity Disabled 实体仍按默认规则排除。

`get_entity_components` 不指定 components 时，每次返回最多 16 种组件，并通过 next_component_offset 翻页。显式指定时最多 16 种。buffer_offset/buffer_limit 应用于该次返回的每个缓冲区；读取特定缓冲区下一页时最好只指定那个组件，模拟运行时索引可能发生变化。

快照固定按实体 Index/Version 排序的成员列表，存活 60 秒，最多保留 8 份，每份最多 200000 个实体；每页最多 100 个。页面字段在查询时实时读取，不承诺跨页字段属于同一帧。已删除实体会跳过，继续分页必须使用 next_offset 而不是已返回条数。快照过期应从第一页重新查询。

entity_id 包含城市会话与实体版本，切换/重新加载存档会失效。返回的 meta 标记 session_id、queried_at_utc、游戏版本，以及城市就绪时的模拟帧和模拟日期。不能跨不同 session_id 合并统计。

## 本机通信

游戏内端口由系统动态分配，只绑定 `127.0.0.1`。每次模组启动生成随机 256 位令牌；端口与令牌写入：

```text
%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\ModsData\CityWeaver\bridge.json
```

MCP 对该文件使用 100ms 的短时缓存，以减少高频工具调用中的重复磁盘读取；缓存到期后重新读取，连接失败时立即失效并在下一次请求读取新端点，因此仍支持游戏重启后快速重连。这个文件是连接凭据，不要提交到仓库或粘贴到对话。测试时可通过环境变量 `CSII_BRIDGE_FILE` 指定其他端点文件。

每条请求是一行 JSON，包含 protocol_version=1、token、tool、arguments；每连接只处理一条请求。1.36.86 起，请求限制 128 KiB，模组和客户端响应限制均为 8 MiB；端点通过 `max_request_bytes`、`max_response_bytes` 公布容量，连接旧模组时仍使用旧上限。最多 8 个并发连接，队列限制 32 条附近（并发入队最多额外 7 条），每次主线程回调最多处理两条。查询等候 10 秒超时。网络线程不访问 ECS；暂停游戏仍可通过主线程 dispatcher 响应，加载和退出期间明确报错。

模组端响应超过 8 MiB 会返回 RESPONSE_TOO_LARGE，需缩小复制范围、limit、components 或 buffer_limit；不会悄悄丢弃字段。街区道路复制可按区域选择最多 2048 段，或显式指定最多 1024 个道路 ID。

## 测试与诊断

建筑 prefab 全量审计（只读，不会放置或提交建筑）：

```powershell
npm run audit:buildings
```

该命令需要游戏加载可玩的城市，会把普通建筑、城市服务、交通设施和升级预设写入 `mcp/building-prefab-audit.json`，并统计唯一建筑、特殊放置模式、服务类别和锁定状态。位置级的道路/地形/网络限制仍需对候选点执行对应 `preview_*` 工具。

```powershell
npm test
node query.mjs get_game_status
node query.mjs query_buildings '{"building_type":"residential","limit":10}'
node smoke.mjs --menu  # 主菜单中验证
npm run smoke         # 加载城市后验证
node smoke-expanded.mjs # 0.2.0：组件发现、原始字段、缓冲区和跨对象关联
node audit-components.mjs # 遍历目录，每种组件抽取一个现存对象；不会导出全城数据
```

自动测试包括 UTF-8 分片、认证请求、连接失败、超时、非法数据、大小限制、实际 MCP 握手及参数校验。smoke 脚本通过 SDK 启动真实 STDIO MCP 服务并连接运行中的模组，验证查询、分页、对象详情和过期会话 ID 拒绝。

查询失败时先运行 get_game_status。BRIDGE_NOT_FOUND 表示新模组未启动；GAME_UNAVAILABLE 表示连接已失效；CITY_NOT_READY 表示尚未加载可玩的城市；SNAPSHOT_EXPIRED 需要重新分页；STALE_ENTITY 需要重新获取 ID。

## 参考

- [Codex MCP 配置示例](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)

### 静态模型导出

1.31.0 新增 `export_model` / `get_model_export_operation`：暂停城市或编辑器后，将车辆、建筑或静态物件的预制体导出为 OBJ、MTL 和可读取的 PNG 贴图。支持实体 ID 或精确预制体选择，独立输出目录不覆盖已有文件。动画、实例涂装及游戏 shader 不在导出范围内；状态变体和缺失贴图见 manifest。详见 [资产文件指南](../docs/guides/areas/ASSET-FILE-IMPORT-GUIDE.md)。

### 车辆外观替换

1.32.0 新增 `list_vehicle_models`、`get_vehicle_model`、`preview_vehicle_replacement`、`apply_vehicle_replacement`、`get_vehicle_replacement_operation`、`restore_vehicle_replacement`、`cancel_vehicle_replacement`。适用于原生各类车型，支持静态/带骨骼源模型、骨骼与动画映射、灯光及原车特效配置；同车型全体实例生效，本次会话可恢复。动画需要源模型具备对应数据。详见 [车辆外观替换指南](../docs/guides/areas/VEHICLE-MODEL-REPLACEMENT-GUIDE.md)。

### 1.36.5 transport diagnostics

`complete` retains the native route/path completion flag; it is not proof that all stops still exist. Line responses add `path_complete`, `stops_valid`, `missing_stop_count`, `service_ready`, and `service_status`. `service_ready` requires active policy, native complete path and valid stops; it does not certify schedule, road connectivity, airport efficiency or fleet availability. CityWeaver helicopter routes with persistently missing stops are automatically put out of service through the native policy after a 512-frame grace period. Repair stops and explicitly reactivate; they do not automatically resume.

Vehicle `passenger_count` and `passenger_ids` now exclude pets, matching the native passenger panel. Use `pet_count` / `pet_ids` for pets and `passenger_buffer_count` for the old raw buffer-length semantics. `passengers_truncated` and `pets_truncated` independently describe the bounded ID arrays.
