# 城市公共服务设施指南

版本 1.8.0 增加服务覆盖分析工具，用于在放置学校、医院等设施前评估候选位置。所有写操作沿用游戏原生建筑工具管线，必须先暂停模拟，并经过“预览—检查—应用”三步；只有操作状态为 `completed` 才表示永久修改完成。

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

新增设施优先使用 MCP 1.19.0 的统一高层流程：`plan_building_workflow` 会自动把学校、医院、公园等识别为 `city_service`，选址并调用对应覆盖分析；检查计划后用 `execute_building_plan` 提交。不需要人工审阅每个候选时，可用 `deploy_building_plans` 串行部署最多 32 个设施。未提交计划用 `cancel_building_plan` 释放。计划仅在当前 MCP 进程和城市会话内有效，仍受原生预览约五分钟有效期限制。

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

请求具有会话内幂等性。应用前若预览已过期、城市恢复运行、费用超过 `max_cost`，或者目标被其他操作修改，接口会拒绝提交。升级和原生重建可能改变实体 ID；完成后应使用操作返回的 `result_entity_ids` 或重新查询设施。

## 已验证边界

游戏 1.6.0f1 的真实城市测试覆盖全部 13 类设施的预设发现、选址、放置、实例读取和拆除，并验证一次普通设施移动。`FireHouse01` 的车库扩展完成安装和移除，证明公共服务升级包装器可完成完整事务。

垃圾填埋场属于带区域/从属对象的特殊设施。一次对其升级模块执行移除时游戏进程退出，因此该特定组合不作为已验证支持；普通消防站升级移除已经通过。灾害触发、渡轮航线依赖设施以及需要先建设地铁轨道的 `RoadEdge` 建筑仍依赖对应游戏条件，不由本批接口自动创建这些前置网络。

可重复测试脚本位于 `mcp/smoke-city-services-live.mjs`、`mcp/smoke-city-services-transactions.mjs` 和 `mcp/smoke-city-service-upgrade-cycle.mjs`。
