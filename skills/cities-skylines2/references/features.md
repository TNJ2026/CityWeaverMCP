# 功能地图

按用户目标选择这一表中的入口，然后读取项目对应指南与实际工具 schema。这里仅保留 Agent 路由，不复制完整参数定义；完整清单由 MCP `tools/list` 和运行中 `get_query_capabilities` 提供。文件路径相对 `D:/Develop/game/CityWeaverMCP` 或已定位的项目根目录。

| 目标 | 功能与入口示例 | 项目指南 |
| --- | --- | --- |
| 城市概览 | `get_game_status`、`get_city_summary`；连接、人口、幸福度、健康、资金、建筑分类 | `mcp/README.md` |
| 规划图、建筑精确绑定、网格预检与分阶段施工 | `get_planning_map_snapshot`、`render_city_plan`、`propose_grid_plan`、`propose_city_plan`、`bind_city_plan_buildings`、`prepare_grid_native_preview`、`advance_grid_construction`、`deploy_grid_district`、`prepare_city_plan_construction`、`advance_city_plan_construction`；静态网页显示全部可购买地图格，规划与施工仅限已购区域；建筑绑定用临时原生预览取得精确朝向和道路边后立即取消；规则子网格优先保存在 `plan.grids[]`，只有不能无损表示时才使用逐路方案并记录 `grid_exceptions` | `docs/guides/planning/PLANNING-MAP-GUIDE.md` |
| 当前镜头与施工聚焦 | `get_camera_view`、`capture_game_view`、`focus_camera`；读取当前游戏镜头覆盖范围、捕获游戏画面，并在施工目标不可见时平滑聚焦；玩家输入立即取消自动移动 | `docs/guides/planning/CAMERA-VIEW-GUIDE.md` |
| 建筑、分区与道路联合验收 | 容量与实际使用、分区成长、服务工作区、主干道范围与沿街依赖 | `docs/workflows/CITY-CONSTRUCTION-CHECKLIST.md` |
| 城市管理 | `set_city_name`、`set_city_configuration`、`set_city_money`、`set_city_policy`；名称、配置、全市政策、资金、修正值、统计历史 | `docs/guides/city/CITY-MANAGEMENT-GUIDE.md` |
| 道路与路口 | `list_road_prefabs`、`preview_road`、`preview_road_route`、`preview_road_grid`、`preview_road_autoroute`；曲线、平行路、环路、自动接入、立交、高架/隧道、升级、拆除、反向、装饰、停车变体、路口规则、道路政策和部分撤销 | `docs/guides/roads/ROAD-GUIDE.md` |
| 建筑 | `list_building_prefabs`、`list_building_upgrades`、`plan_building_workflow`、`execute_building_plan`、`deploy_building_plans`、`preview_building_placement`、`preview_building_upgrade`；支持端到端放置及升级范围、主体侧吸附和范围内道路侧候选 | `docs/guides/buildings/BUILDING-GUIDE.md`、`docs/guides/city/CITY-SERVICE-GUIDE.md` |
| 建筑附属区域 | `list_building_areas`、`preview_building_area`、`get_building_area_operation`、`apply_building_area_operation`；填埋储存区、专门产业采集区及其他 owner prefab 允许的区域 | `docs/guides/buildings/BUILDING-AREA-GUIDE.md` |
| 高层建设编排 | `deploy_service_cluster`、`deploy_industrial_campus`、`deploy_transit_corridor`、`build_utility_backbone`、`repair_congested_corridor` 固定跨领域阶段顺序；阶段失败或未知结果停止后续阶段 | `docs/workflows/efficient-deployment.md` |
| 土地分区 | `analyze_zoning_cells`、`preview_zoning`、`apply_zoning`；按道路侧向、深度筛选，批量划区、替换、清除 | `docs/guides/areas/ZONING-GUIDE.md` |
| 行政区 | 边界创建、重画、删除、命名、政策、点定位和服务覆盖；`set_district_name`、`set_district_policy`、`set_service_districts` | `docs/guides/areas/DISTRICT-GUIDE.md` |
| 公交线路 | `list_transport_line_prefabs`、`list_transport_lines`；创建、站序、线路与站名、颜色、班表、票价、车辆数、编号、均匀发车、请求车辆与返场、删除 | `docs/guides/transport/TRANSPORT-GUIDE.md` |
| 公交设施和轨道 | `list_transport_facility_prefabs`、`list_transport_facilities`、`list_transport_facility_upgrades`、`preview_transport_facility_upgrade`、`list_transport_track_prefabs`、`preview_transport_track`；设施建筑事务、升级范围/道路侧候选及轨道连接和拆除 | `docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md` |
| 航道与渔港码头 | `list_waterways`、`preview_waterway` 管船舶航道；`list_pier_pathway_prefabs`、`list_pier_pathways`、`preview_pier_pathway` 管渔港控制点的高架 Pathway 延长，两类网络不可混用 | `docs/guides/transport/WATERWAY-GUIDE.md` |
| 铁路站区规划与验收 | 联合选址、真实曲线接轨、永久道路绑定、水电、线路及实际发车分层验证 | `docs/guides/transport/RAIL-STATION-CHECKLIST.md` |
| 电水污水与管网 | `list_utility_facility_prefabs`、`list_utility_facilities`、`list_utility_connection_points`、`find_compatible_utility_targets`、`connect_utility_facility`、`build_utility_backbone`、`list_utility_networks`；按真实设施端口和连接层完成电力、供水、污水、通信、独立管网、资源管道查询和建设 | `docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md` |
| 公共服务 | `list_city_service_prefabs`、`list_city_service_facilities`、`analyze_service_coverage`、`analyze_education_demand`、`analyze_attraction_impact`、`deploy_service_cluster`；医疗、消防、警察、教育、垃圾、殡葬、维护、公园、邮政、停车、福利、研究、应急，支持选址与建筑事务 | `docs/guides/city/CITY-SERVICE-GUIDE.md` |
| 道路拥堵修复 | `analyze_road_traffic`、`repair_congested_corridor`；按瓶颈选择道路升级、平行分流或自动绕行，所有写入经过原生 preview/apply | `docs/guides/roads/ROAD-GUIDE.md` |
| 城市财政 | `get_city_economy`、`get_tax_settings`、`list_service_budgets`、`list_service_fees`、`get_loan_status`；税率、预算、服务费、贷款预览与应用 | `docs/guides/economy/ECONOMY-GUIDE.md` |
| 发展需求 | `get_zone_demand`、`get_resource_demand`；人口、住房、就业、教育、分区需求与原生影响因子，无限需求控制 | `docs/guides/city/DEVELOPMENT-GUIDE.md` |
| 进度解锁 | `list_unlockable_prefabs`、`unlock_prefab`、`set_experience_points`、`set_development_points`；XP、里程碑、发展树、节点购买、原生解锁 | `docs/guides/city/PROGRESSION-GUIDE.md` |
| 市民家庭企业 | `list_citizen_prefabs`、`list_household_prefabs`、`list_company_prefabs`；查询与创建/删除，迁户、住房、健康、就业、学校、财务、企业房产与员工容量 | `docs/guides/economy/POPULATION-ECONOMY-GUIDE.md` |
| 资源经济 | 生产、库存、物流、企业利润与交易成本；`set_resource_amount`、`set_company_trade_cost`；区分库存金额与城市资金 | `docs/guides/economy/POPULATION-ECONOMY-GUIDE.md` |
| 交通与出行 | `list_vehicles`、`list_travelers`、`list_citizen_trips`、`analyze_traffic_flow`、`analyze_parking`；路径、车流、停车、目标、速度、重寻路、行程队列、车辆清理 | `docs/guides/roads/TRAFFIC-MOBILITY-GUIDE.md` |
| 地图区域 | `get_map_overview`、`list_map_tiles`、`analyze_buildable_area`、`preview_map_tile_purchase`；边界、邻接、资源、气候、可建面积、购买与全图解锁 | `docs/guides/areas/MAP-AREA-GUIDE.md` |
| 地形 | `sample_terrain`、`preview_terrain`、`apply_terrain`；抬高、降低、整平、平滑、坡面、整图陆地抬升与全图平整 | `docs/guides/areas/TERRAIN-GUIDE.md` |
| 环境与景观 | `list_landscape_prefabs`、`list_landscape_objects`、`list_water_sources`、`get_climate_state`；植物放置/移动/删除、生长，水源增删改，污染、天气覆盖、风和土壤水 | `docs/guides/areas/ENVIRONMENT-LANDSCAPE-GUIDE.md` |
| 灾害 | `list_disaster_prefabs`、`get_disaster_readiness`、`preview_disaster`、`list_active_disasters`、`get_disaster_impacts`；触发、参数调节、移动、停止与影响标记清理 | `docs/guides/disasters/DISASTER-GUIDE.md` |
| 通用 ECS 数据 | `list_component_types`、`get_component_schema`、`query_entities`、`count_entities`、`get_entity_components`、`get_city_data`；组件筛选、缓冲区分页、实体关系 | `mcp/QUERY-GUIDE.md` |
| 深层系统与环境栅格 | `list_game_systems`、`get_system_schema`、`read_entity_field`、`list_environment_layers`；私有字段、原生容器、系统状态与环境图层，具体可读性看返回标记 | `docs/guides/inspection/DEEP-QUERY-GUIDE.md` |

## 选择工作流的要点

- “看看堵在哪里”：先交通分析，再沿道路/车道/车辆 ID 追踪。诊断请求本身不包含清车、改限速或扩路。
- “规划一个住宅街区”：已购地图格、地形、水域与现有道路发现 → `propose_grid_plan`（仅网格）或 `propose_city_plan`（概念服务、交通与管网）→ 精确道路和主题分区绑定 → `render_city_plan`；不施工。道路永久建成后，可用 `bind_city_plan_buildings` 把精确 prefab 建筑绑定到原生候选朝向与道路边；绑定会改变计划哈希，必须重新渲染和确认。
- “预检一个住宅街区”：在只读规划通过后调用 `prepare_grid_native_preview`，检查道路费用、警告和冲突；需要放弃时按返回动作取消。临时道路没有永久 edge ID，分区 preview 此时必须标记为等待道路落地。
- “施工已预检的住宅街区”：取得明确施工授权和道路预算后，调用 `advance_grid_construction` 的 `commit_roads`，随后沿返回的 `next_action` 依次执行 `preview_zoning` 与 `apply_zoning`；每个阶段使用独立稳定 `request_id`，不得跳过分区预览。
- “连续部署一个独立规则网格”：只有用户已经授权预览通过后自动提交时，才调用 `deploy_grid_district(approval_mode="automatic")`；默认 `staged` 只返回道路预览和 `advance_grid_construction` 下一步。多次部署必须串行，网格外围不能重叠。
- “按规划图施工道路”：先展示 `render_city_plan`，用户确认其 `plan_id` 后，用相同 `bounds`/`plan` 调用 `prepare_city_plan_construction` 建立不写游戏的虚拟路网沙盒；网格保留为单个原生批次，超长路线仅按原生点数上限拆批。再沿 `advance_city_plan_construction` 返回的 `preview_batch` / `commit_batch` 执行最终位置原生预览和提交。规划哈希不一致、未知结果或永久道路回读不完整时必须停止。
- “查看当前屏幕或跟随施工”：用 `get_camera_view` 读取世界坐标可见范围，需视觉核对时用 `capture_game_view`；施工自动聚焦被玩家输入取消后，不在同一批次抢回镜头。
- “给建筑安装可移动升级”：先从升级列表读取 `placement_geometry`；主体侧使用返回吸附点，隔路候选使用 `road_side_candidates` 原样进入对应 preview，不自行猜位置或道路 ID。
- “建一个住宅街区”：只有用户明确授权施工后，才从通过的预检进入带预算上限的道路提交和永久回读，再检查实际分区格并逐独立事务划区。让模拟自然生成建筑，或仅在用户要求直接放置时使用建筑事务。
- “建诊所/电站/车站”：优先对应领域 prefab 与容量发现，普通沿街候选走一般选址；岸线、水面、轨道边等采用特殊选址并保留吸附目标与高度。升级模块不能作为独立建筑。
- “扩展填埋场/专门产业”：新建专门产业先用 `list_building_prefabs(kind="specialized_industry")` 发现声明有采集区域的主建筑候选，原生预览并回读永久道路接入和 `SubArea` 后，再调用 `list_building_areas`；只使用其返回的精确区域 prefab。零成本、`Placeholder` 名称或大量预览临时实体都不是可运营证明。自然资源、污染、道路和货运条件先评估，再走独立区域 preview/apply 事务。行政区和分区工具不能替代建筑附属区域。
- “降低税率/调整贷款”：先读取实际范围和原值，再走经济事务。贷款 `amount` 是目标总额，不是增量。
- “撤销刚才的道路”：查询原会话操作并尝试 `preview_road_undo`；不是所有道路操作都可逆，尤其拆分既有边的建设不能假定支持自动恢复。
- “触发灾害”：先发现 prefab 家族。火灾/倒塌需要真实目标；天气接受位置或目标；洪水/海啸是全局水位事件。应用后需要模拟推进才能观察原生事件；停止和清理状态都不是物理复原。
