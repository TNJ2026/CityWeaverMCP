# 功能地图

按用户目标选择这一表中的入口，然后读取项目对应指南与实际工具 schema。这里仅保留 Agent 路由，不复制完整参数定义；完整清单由 MCP `tools/list` 和运行中 `get_query_capabilities` 提供。文件路径相对 `D:/Develop/game/CityWeaverMCP` 或已定位的项目根目录。

| 目标 | 功能与入口示例 | 项目指南 |
| --- | --- | --- |
| 城市概览 | `get_game_status`、`get_city_summary`；连接、人口、幸福度、健康、资金、建筑分类 | `mcp/README.md` |
| 城市管理 | `set_city_name`、`set_city_configuration`、`set_city_money`、`set_city_policy`；名称、配置、全市政策、资金、修正值、统计历史 | `docs/guides/city/CITY-MANAGEMENT-GUIDE.md` |
| 道路与路口 | `list_road_prefabs`、`preview_road`、`preview_road_route`、`preview_road_grid`、`preview_road_autoroute`；曲线、平行路、环路、自动接入、立交、高架/隧道、升级、拆除、反向、装饰、停车变体、路口规则、道路政策和部分撤销 | `docs/guides/roads/ROAD-GUIDE.md` |
| 建筑 | `list_building_prefabs`、`plan_building_workflow`、`execute_building_plan`、`deploy_building_plans`、`plan_building_site`、`plan_building_row`、`preview_building_placement`；支持端到端编排放置、批量、移动、替换、升级/移除、重建、拆除、命名与政策 | `docs/guides/buildings/BUILDING-GUIDE.md` |
| 建筑附属区域 | `list_building_areas`、`preview_building_area`、`get_building_area_operation`、`apply_building_area_operation`；填埋储存区、专门产业采集区及其他 owner prefab 允许的区域 | `docs/guides/buildings/BUILDING-AREA-GUIDE.md` |
| 高层建设编排 | `deploy_service_cluster`、`deploy_industrial_campus`、`deploy_transit_corridor`、`build_utility_backbone`、`repair_congested_corridor` 固定跨领域阶段顺序；阶段失败或未知结果停止后续阶段 | `docs/workflows/efficient-deployment.md` |
| 土地分区 | `analyze_zoning_cells`、`preview_zoning`、`apply_zoning`；按道路侧向、深度筛选，批量划区、替换、清除 | `docs/guides/areas/ZONING-GUIDE.md` |
| 行政区 | 边界创建、重画、删除、命名、政策、点定位和服务覆盖；`set_district_name`、`set_district_policy`、`set_service_districts` | `docs/guides/areas/DISTRICT-GUIDE.md` |
| 公交线路 | `list_transport_line_prefabs`、`list_transport_lines`；创建、站序、线路与站名、颜色、班表、票价、车辆数、编号、均匀发车、请求车辆与返场、删除 | `docs/guides/transport/TRANSPORT-GUIDE.md` |
| 公交设施和轨道 | `list_transport_facility_prefabs`、`list_transport_facilities`、`analyze_transport_catchment`、`list_transport_track_prefabs`、`preview_transport_track`；站点/车辆段/机场/港口的建筑事务，火车/地铁/电车轨道连接和拆除 | `docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md` |
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
- “建一个住宅街区”：地图/地形与现有道路发现 → 路网规划和建设 → 实际分区格检查 → 划区。让模拟自然生成建筑，或仅在用户要求直接放置时使用建筑事务。
- “建诊所/电站/车站”：优先对应领域 prefab 与容量发现，普通沿街候选走一般选址；岸线、水面、轨道边等采用特殊选址并保留吸附目标与高度。升级模块不能作为独立建筑。
- “扩展填埋场/专门产业”：先找到 owner 建筑并调用 `list_building_areas`，只使用其返回的精确区域 prefab；自然资源、污染、道路和货运条件先评估，再走独立区域 preview/apply 事务。行政区和分区工具不能替代建筑附属区域。
- “降低税率/调整贷款”：先读取实际范围和原值，再走经济事务。贷款 `amount` 是目标总额，不是增量。
- “撤销刚才的道路”：查询原会话操作并尝试 `preview_road_undo`；不是所有道路操作都可逆，尤其拆分既有边的建设不能假定支持自动恢复。
- “触发灾害”：先发现 prefab 家族。火灾/倒塌需要真实目标；天气接受位置或目标；洪水/海啸是全局水位事件。应用后需要模拟推进才能观察原生事件；停止和清理状态都不是物理复原。
