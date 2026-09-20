# 城市公共服务设施指南

垃圾填埋场本体继续按本指南选址和放置；其垃圾储存边界属于建筑附属区域，应在建筑建成后通过 `list_building_areas` 发现允许的区域 prefab，再按 [建筑附属区域指南](../buildings/BUILDING-AREA-GUIDE.md) 创建或调整。区域需远离住宅和饮用水源，并为垃圾车出入口与后续扩容保留通道。

自 MCP 1.8.0 起增加服务覆盖分析工具，用于在放置学校、医院等设施前评估候选位置。所有写操作沿用游戏原生建筑工具管线，必须先暂停模拟，并经过“预览—检查—应用”三步；只有操作状态为 `completed` 才表示永久修改完成。

## 覆盖范围

`kind` 支持以下值：

| kind | 设施 |
| --- | --- |
| `healthcare` | 诊所、医院 |
| `fire` | 消防站、消防瞭望塔、消防直升机设施 |
| `police` | 警察局、监狱及相关设施 |
| `education` | 小学、中学、大学及专门院校 |
| `garbage` | 垃圾填埋、焚烧、回收和处理设施 |
| `deathcare` | 墓地、火葬场 |
| `maintenance` | 道路、公园等维护车库 |
| `park` | 公园、广场、运动与景观设施 |
| `post` | 邮局、邮件分拣设施 |
| `parking` | 停车场、停车楼、自行车停车设施 |
| `welfare` | 福利办公室 |
| `research` | 研究设施 |
| `emergency` | 应急避难与灾害设施 |
| `all` | 上述全部类别 |

`list_city_service_prefabs` 返回可放置预设、建造价格、占地格数、放置模式和适用的容量参数。`list_city_service_facilities` 返回现有永久实例；`get_city_service_facility` 进一步返回效率、服务状态、车辆、病人、学生、占用者和非零库存资源。

## 查询与选址

1. 用 `list_city_service_prefabs` 按 `kind` 和名称筛选预设。默认只列出当前已解锁预设。
2. 用 `plan_city_service_site` 指定 `building_prefab`、邻近坐标、搜索半径和候选数量。
3. 规划器按预设的原生放置规则选择道路侧、道路边、道路节点、岸线或水面候选。返回候选不等于最终可放置；原生工具会在预览阶段检查碰撞、地形、道路连接和专用限制。
4. 需要道路入口的候选必须执行[建筑指南的“道路绑定硬门禁”](../buildings/BUILDING-GUIDE.md#道路绑定硬门禁)：原样使用候选的 `position`、`rotation_degrees` 和 `road_edge_id`/`snap_target_id`，提交后回读永久实体的 `Game.Buildings.Building.m_RoadEdge`。只看建筑靠近道路、覆盖范围或 operation=`completed` 均不合格。

### 分散还是集中

公共服务采用“分级分散、小规模集中”：社区级设施分散到需求附近，区域级大型设施集中在交通和服务容量较强的节点，车流大、占地大或有环境影响的后勤设施放在城市外围或工业物流区。不要把所有服务堆在一个市政中心，也不要完全随机分散。

| 设施 | 推荐布局 | 选址重点 |
| --- | --- | --- |
| 小学 | 分散在住宅开发单元内部或边缘 | 靠近实际学生需求，选择安静、可步行到达的本地道路，避免校门正对繁忙路口 |
| 中学 | 服务 2–3 个相邻住宅开发单元 | 位于片区集散路附近，兼顾步行、公交和接送流量 |
| 大学及专门院校 | 区域级集中 | 靠近公交、地铁或铁路节点以及中高密住宅，预留扩建和大型人流空间 |
| 诊所 | 分散到社区级节点 | 填补医疗盲区，缩短日常就医距离和车辆响应路线 |
| 医院 | 区域级集中 | 选择道路容量较高、公交可达且有扩建余地的位置，避免救护车只有一条易堵路径 |
| 小型警察局 | 分散到多个片区 | 优先覆盖响应路线较长、治安需求较高或被河流、高速分隔的区域 |
| 警察总部、监狱 | 区域中心或城市外围 | 使用集散路连接，避免大型占地和集中车流进入住宅内部道路 |
| 消防站 | 分散，重点覆盖工业区、高密区和远端片区 | 响应时间取决于真实道路路线；跨河、铁路、高速等阻隔两侧应分别评估 |
| 消防总部、直升机设施 | 区域级集中 | 作为高容量或特殊响应补充，不替代社区消防站的道路覆盖 |
| 公园、广场和运动设施 | 分散到住宅及商业步行范围 | 比较吸引力、附近同类设施和公共交通，不只追求几何中心 |
| 邮局 | 分散到人口和企业节点 | 兼顾居民、商业和道路可达性，避免重复覆盖 |
| 邮件分拣、垃圾处理、维护车库 | 工业或物流区外围 | 车辆多、占地大或有环境影响，应直接接入集散路并绕开住宅内部道路 |
| 应急避难设施 | 多点分散 | 避免单点灾害或道路中断使全城同时失去服务 |

可以把互补且与住宅兼容的设施组成小型公共服务走廊，例如小学、诊所、公园和社区警务设施共享公交与步行网络。建筑入口应沿不同道路或错开布置，不要让上学接送、警车、消防车和救护车全部汇入同一个路口。大型医院、大学或总部可以靠近该走廊的区域节点，但应独立评估道路容量和未来升级占地。

规划候选时至少检查：

1. 当前人口、学生或服务请求形成的覆盖盲区，而非只选地图几何中心。
2. 设施现有容量、利用率、车辆数和未来兼容升级所需占地。
3. 服务车辆到目标片区的真实道路路线、桥梁或高速阻隔，以及路口拥堵。
4. 路网是否有替代进出方向；单栋建筑仍按原生入口规则连接，但片区不应依赖一个易堵的唯一出口。
5. 公交、步行、停车和接送条件是否匹配设施使用者。
6. 噪音、污染、敏感人群和周边分区是否兼容；垃圾、维护、监狱等不宜与住宅混放。
7. 建筑与交叉口的退距；宽体建筑优先选择长直路段，并逐个尝试规划器返回的候选。
8. 建设费、维护费、重复覆盖和灾害冗余是否可接受。
9. 候选是否占用已预留的主干道、第二出口、公交走廊或未来道路延伸线；覆盖和沿街落位合格仍不足以证明选址合理。
10. 建筑本体、兼容升级组合占地和相邻道路未来扩宽净空能否同时保留；设施入口应避开主干道汇合口。

集中或分散是规划起点，不是固定答案。最终数量和位置应以当前设施状态、需求、道路到达时间及模拟后的实际效果决定；覆盖代理相近时优先选择道路更可靠、扩建空间更充足且维护成本可承担的候选。

### 道路选址退距与候选回退（Setback & Fallback）机制

1. **路口安全退距**：`plan_city_service_site` 生成的候选点有时会紧贴道路交叉节点，甚至落在路口中心线，直接放置可能触发 `GAME_REJECTED_BUILDING`。32m 可作为宽体设施的保守起始值，但不是所有道路和 prefab 的硬性 API 阈值；应优先选择平直路段，并以 `preview_city_service_placement` 的原生校验为最终依据。
2. **长开间与宽体建筑选址**：大体量或宽开间建筑（如宽度 111.6m 的公墓 `Cemetery02`、大型综合高中、综合医院等）要求路段平直且长度充裕。所属路段长度建议满足 ≥ 建筑面宽 + 16 米，切忌放置在短路段（如 < 64 米）、急弯路段或断头路尽头。
3. **候选列表顺序回退（Fallback）**：调用 `plan_city_service_site` 时可通过 `candidate_count` 请求多个候选（例如 `candidate_count: 5`）。自动化脚本在调用 `preview_city_service_placement` 时，应实现候选列表的顺序遍历与失败回退循环；若前序候选因碰撞或地质原因被原生引擎拒绝，再尝试下一候选，直至成功获得 `preview_ready` 或候选耗尽。

### 覆盖分析

`analyze_service_coverage` 接受 `facility_id` 或候选 `position`，并以 `radius_m`（默认 500 米）计算直线距离代理，返回范围内住宅建筑数、估算租户/家庭数、同类设施数量及最近设施距离。它适合比较多个候选点、识别明显盲区和重复建设。

该结果的 `coverage_model` 固定为 `euclidean_radius_proxy`：它不是游戏内部隐藏的固定服务半径，也不模拟道路寻路、服务区分配、容量分流或实时服务效果。最终放置合法性仍以 `preview_city_service_placement` 为准，建成后的实际服务状态使用 `get_city_service_facility` 观察。

其他设施分析工具：

- `analyze_transport_catchment`：按站点、交通设施或候选位置统计住宅建筑、附近站点、线路连接数和候车人数。
- `analyze_education_demand`：按学校或候选位置统计当前建筑中的学生、教育等级匹配数，以及附近学校容量和已注册学生。
- `analyze_attraction_impact`：按娱乐/地标位置统计附近公园、唯一建筑、建筑和公共交通站点。

三者均为只读规划代理，不替代原生路径寻找、客流模拟、旅游吸引力、土地价值或教育分配系统。

读取实例时，`facility_id` 含当前城市会话和 ECS 实体版本。重新加载存档或实体结构发生变化后，应重新列举设施，不能复用旧 ID。

## 放置、移动、升级和拆除

新增设施优先使用 MCP 1.21.0 的统一高层流程：`plan_building_workflow` 会自动把学校、医院、公园等识别为 `city_service`，选址并按 `consider_service_coverage` 决定是否调用对应覆盖分析；检查计划后用 `execute_building_plan` 提交。不需要人工审阅每个候选时，可用 `deploy_building_plans` 串行部署最多 32 个设施。未提交计划用 `cancel_building_plan` 释放。计划仅在当前 MCP 进程和城市会话内有效，仍受原生预览约五分钟有效期限制。

教育设施使用 `analyze_education_demand`，公园/娱乐设施使用 `analyze_attraction_impact`，其他服务设施使用 `analyze_service_coverage`。这些结果是选址代理；容量、道路可达性、专用网络、噪声/污染和模拟后的真实效果仍需结合 prefab 数据、原生预览与建成后状态判断。移动、升级和拆除继续使用下述领域工具。

典型流程：

1. 调用相应 `preview_city_service_*` 工具并提供唯一 `request_id`。
2. 轮询 `get_city_service_operation`，直到 `preview_ready` 或失败。
3. 检查 `cost`、`errors`、`warnings` 和候选位置。
4. 对 `preview_ready` 操作用相同 `request_id` 调用 `apply_city_service_operation`，并设置可接受的 `max_cost`。
5. 再次轮询，直到 `completed`、`failed` 或 `outcome_unknown`。

可用预览工具：

- `preview_city_service_placement`：放置新设施。
- `preview_city_service_move`：移动永久设施。
- `preview_city_service_upgrade`：安装 `list_building_upgrades` 返回的兼容升级。
- `preview_city_service_upgrade_removal`：移除已安装升级。
- `preview_city_service_delete`：拆除设施及游戏管理的从属对象。
- `cancel_city_service_preview`：取消尚未提交的预览。

从 1.22.1 起，`preview_city_service_upgrade` 和 `preview_building_upgrade` 支持 `placement_side`：`back`、`right`、`left`、`front`，默认 `back`。它控制带 `OwnerSide` 规则的升级模块贴在主体建筑哪一侧，并自动换算世界坐标和朝向。`placement_offset_m` 可让模块沿所选安装边横向移动，默认 `0`；`back/front` 的正值沿主体本地 `+X`，`right/left` 的正值沿主体本地 `+Z`。例如主体未旋转时，在背面向东平移 4 米可传 `placement_side: "back", placement_offset_m: 4`。操作结果通过 `upgrade_placement_side` 和 `upgrade_placement_offset_m` 回显实际请求；原生预览仍负责最终碰撞、地形和净空校验。安装多个大尺寸升级时，应先根据各模块实时 `size_m` 规划不同侧面，逐个执行“预览 → 提交 → 永久回读”，不要把所有模块叠放在默认后侧。固定位置的 `BuildingExtensionData` 升级不接受非零偏移，操作结果会返回 `upgrade_placement_side: fixed`。

`list_building_upgrades` 会针对当前主体的实时位置与朝向返回 `placement_geometry`。`placement_range` 来自游戏用于界面高亮和 `LongDistance` 校验的原生计算，包含圆形或圆角矩形参数、显示参数以及可直接绘图的 `validation_outline`；游戏要求升级建筑占地的四角全部位于该范围内。`owner_side_snap` 单独返回四条主体边吸附段、8 米吸附步长、可能出现的 4 米相位、端点裁剪或延伸量，以及每个原生候选点对应的 `placement_offset_m`。范围合规并不替代道路、地形、已有建筑和子对象碰撞的原生预览。

当升级的 `max_placement_distance_m` 非零时，`placement_geometry.road_side_candidates` 还会列出范围内可沿道路放置的候选，包括道路实体、道路侧、精确位置、旋转和地形状态。将候选原样传给 `preview_building_upgrade` 或 `preview_city_service_upgrade`，并设置 `placement_mode: "road_side"`；工具会保持附属建筑归属于原主体，同时把道路作为原生吸附目标。因此主体与升级模块之间可以隔着道路，但模块占地不能压住道路，且仍须通过原生碰撞和范围校验。

请求具有会话内幂等性。应用前若预览已过期、城市恢复运行、费用超过 `max_cost`，或者目标被其他操作修改，接口会拒绝提交。升级和原生重建可能改变实体 ID；完成后应使用操作返回的 `result_entity_ids` 或重新查询设施。

## 已验证边界

游戏 1.6.0f1 的真实城市测试覆盖全部 13 类设施的预设发现、选址、放置、实例读取和拆除，并验证一次普通设施移动。`FireHouse01` 的车库扩展完成安装和移除，证明公共服务升级包装器可完成完整事务。

垃圾填埋场属于带区域/从属对象的特殊设施。一次对其升级模块执行移除时游戏进程退出，因此该特定组合不作为已验证支持；普通消防站升级移除已经通过。灾害触发、渡轮航线依赖设施以及需要先建设地铁轨道的 `RoadEdge` 建筑仍依赖对应游戏条件，不由本批接口自动创建这些前置网络。

可重复测试脚本位于 `mcp/smoke-city-services-live.mjs`、`mcp/smoke-city-services-transactions.mjs` 和 `mcp/smoke-city-service-upgrade-cycle.mjs`。
# 高层服务设施批量部署

需要一次放置多座警察、消防、医院、学校、邮政或其他公共服务设施时，使用 `deploy_service_cluster`。它会逐座执行覆盖/需求分析、候选选址、原生 preview/apply 和实体回读；可选 `district_ids` 会在设施完成后设置服务行政区。返回 `phases`/`results` 和费用，失败或 `outcome_unknown` 会停止后续阶段，不能换 `request_id` 盲目重提。

批量选址、兼容升级、服务工作区及实际运营检查见 [城市建设检查清单](../../workflows/CITY-CONSTRUCTION-CHECKLIST.md)。
