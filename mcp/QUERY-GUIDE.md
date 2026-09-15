# 扩展查询指南（0.2.0）

推荐步骤：get_game_status → get_query_capabilities → list_component_types / get_component_schema → query_entities → get_entity_components。

## 数据覆盖

| 方向 | category | 查询方式 |
| --- | --- | --- |
| 建筑与住宅 | buildings | 原有 query_buildings 或组件筛选；Renter 缓冲区关联租户，PrefabRef 关联建筑预设 |
| 市民 | citizens、workers、students | Citizen 原始状态、健康、出生日期等；HouseholdMember 关联家庭；其他关系先查 schema |
| 家庭 | households | Household 原始资源/消费/收入字段；HouseholdCitizen 缓冲区关联家庭成员 |
| 企业 | companies | CompanyData、资源、雇员、生产和租赁相关组件；按目录查找实际字段 |
| 路网 | roads、net_edges、net_nodes、lanes | Road 交通原始累计字段、道路拓扑、节点和车道组件；不直接解释为车辆/小时 |
| 车辆 | vehicles | 车辆类型标签、导航、当前位置、车主、载客等相关组件，具体内容取决于对象 |
| 公共交通 | transport_lines、public_transport_stations、cargo_stations | TransportLine、RouteVehicle、RouteWaypoint 等字段/缓冲区 |
| 区域 | districts | 区域实体、边界与政策相关组件 |
| 公共服务 | schools、hospitals、police_stations、fire_stations、deathcare | 对应服务组件、学生/患者等关联缓冲区、用电用水字段 |
| 基础设施 | power_plants、water_pumps、sewage_outlets、garbage_facilities | 生产/消费、服务状态和原始资源字段 |
| 其他设施 | parks、parking_facilities | 公园、停车设施组件及关联对象 |
| 资源 | resource_holders | Game.Economy.Resources 缓冲区；区分库存实体与城市统计 |
| 城市 | get_city_data | 城市实体公开组件、资金、资源、修正项等；按组件分页 |
| 预设与参数 | prefabs | 预设定义以及 Game.Prefabs 下的可读 ECS 参数组件 |
| 自定义筛选 | all | all_components / any_components / none_components 组合筛选 |

上述分类提供查找入口，不保证每个城市都存在相应对象，也不保证目录中每个组件都已逐一在真实游戏中验证。

## 示例：市民与家庭

```json
{"category":"citizens","limit":10,"include_components":["Game.Citizens.Citizen","Game.Citizens.HouseholdMember"]}
```

将结果中 HouseholdMember 的家庭 entity_id 传给 get_entity_components：

```json
{"entity_id":"使用返回的真实家庭ID","components":["Game.Citizens.Household","Game.Citizens.HouseholdCitizen"],"buffer_limit":20}
```

buffer 元素中的 Entity 引用均转换为可继续查询的会话 ID。

## 示例：住宅容量与实际租户

1. query_entities：category=buildings，all_components=["Game.Buildings.ResidentialProperty"]，include_components=["Game.Buildings.Renter"]。
2. 结果中的 prefab_entity_id 用于 get_entity_components，读取 Game.Prefabs.BuildingPropertyData。
3. m_ResidentialProperties 为预设住宅容量原始字段；Renter 列表可能混有不同租户类型，应继续判断租户是否具有 Household。
4. 不应直接把 Renter 缓冲区长度当作住户数，或把预设容量当作经过所有修正后的最终容量。

## 示例：查找环境相关数据

list_component_types 使用 search="Pollution"、"Water"、"Electricity" 或 "Resource"，查看字段结构，再用返回的组件名筛选对象。

这覆盖 ECS 组件和预设里的相关数据；空气/地面/噪声等完整环境栅格、渲染纹理及系统私有缓存不在通用接口范围内。

## 保持统计准确

- count_entities 返回实例数；市民实体数可能包含迁入者等状态，不必等于城市人口面板。
- 类别可重叠，不能盲目相加。all 也包含内部辅助实体，不是“城市对象总数”的业务指标。
- schema 保留源代码字段名，不能仅靠字段名称推断单位或统计周期。
- 先使用 count_entities 确认规模；query_entities 超过 200000 个候选实体会要求缩小范围。
- 缓冲区分页为实时读取；需要一致比较时暂停游戏，并检查 session_id / simulation_frame。
- 任何 unsupported、unavailable、truncated、缺失字段都应向用户说明，不能替换成零或猜测。
