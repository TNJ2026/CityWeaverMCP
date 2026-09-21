# 建筑附属区域指南

自 CityWeaverMCP 1.20.0 起提供独立的建筑附属区域事务，适用于垃圾填埋场储存区、专门产业资源采集区，以及游戏 prefab 声明的其他建筑区域。它与行政区、土地分区不同：区域必须归属于一个永久建筑，且区域 prefab 必须由该建筑 prefab 的原生 `SubArea` 列表明确允许。

## 工具

- `list_building_areas`：传入 `building_id`，返回建筑现有附属区域及可创建的精确 `area_prefab`。储存区包含允许资源、容量和当前储量；采集区包含资源地图类型、是否要求自然资源、资源量和最大浓度。
- `preview_building_area`：统一预览入口，`mode` 为 `create`、`boundary` 或 `delete`。
- `get_building_area_operation`：轮询原生预览或提交状态、费用、错误和结果实体。
- `apply_building_area_operation`：在城市暂停时提交 `preview_ready` 操作，并用 `max_cost` 限制费用。
- `cancel_building_area_preview`：取消尚未提交的预览。

## 专门产业建设要求

基础游戏包含 9 类专门产业区。放置专门产业主建筑后才会启用它允许的采集区域工具；采集区域是主建筑的附属 `SubArea`，不是普通工业 zoning，也不是行政区。精确主建筑与 `area_prefab` 必须从当前城市发现。

主建筑发现使用 `list_building_prefabs(kind="specialized_industry")`，列出带 `PlaceholderBuildingData`、且入口自身或其兼容升级 prefab 的原生 `SubArea` 声明了 `ExtractorAreaData` 的入口。游戏的 ObjectTool 根据占位物关联的 Zone prefab 选择后续采集设施；`ExtractorFacilityData` 通常在这些后续建筑上，不能反过来用作入口筛选。返回的 `specialized_industry_owner=true`、`specialized_industry_entry_kind`、`extractor_area_on_owner`、`extractor_area_prefabs` 和 `extractor_area_upgrades` 是**入口候选及其原生声明**，不是已投产证明。若 `extractor_area_on_owner=false`，不能对入口直接创建采集区，应先建设声明该区域的兼容升级，再对永久升级建筑读取 `list_building_areas`。零建造费用或预览产生许多临时实体都不足以判断它可用。此类主建筑的放置预览会额外要求原生临时建筑接入真实道路、没有警告且不拆除既有对象；提交后还要回读永久建筑、附属生产建筑及道路边。直接带区域的入口还须回读附属区域缓冲区。任一条件失败或结果未知时停止，不换 `request_id` 重试。

施工预览还必须返回 `attachment_building_prefab`，并在临时实体中确认该附属生产建筑已生成；提交后永久结果须同时包含占位入口和附属建筑。只有占位入口、采集区和道路绑定而缺少附属建筑时，判为**未完成产业施工**，不能继续扩大采集区或报告投产。2026-09-21 的旧模组施工曾留下这种不完整占位物；升级模组不会自动修复旧存档，须先逐处核查并走经过原生预览的修复流程。

| 专门产业 | 必需自然资源 | 资源物理规则 | 建设要点 |
| --- | --- | --- | --- |
| Livestock Farming | 无 | 不依赖资源图层 | 主建筑需接道路；区域仍要有足够连续土地供内部采集路径和扩建。 |
| Grain Farming | Fertile Land | 可再生，但会受污染损害 | 区域边界尽量覆盖高浓度肥沃土地，避开工业/污水污染路径。 |
| Vegetable Farming | Fertile Land | 可再生，但会受污染损害 | 同 Grain；不要用低浓度边缘面积虚增区域。 |
| Cotton Farming | Fertile Land | 可再生，但会受污染损害 | 同 Grain；保留主建筑道路出口和货车集散空间。 |
| Forestry | Forest | 可再生，但会受污染损害 | 区域覆盖有效森林资源；道路、建筑和清地可能减少实际可采资源。 |
| Stone Quarrying | 无 | 可在没有自然资源覆盖的土地建设 | 优先选择低地价、地形可用且货运路径短的位置；大面积不等于高利润。 |
| Coal Mining | Ore | 矿藏有限，会随开采减少 | 区域覆盖 Ore 高浓度区；耗尽后会减产，应预留转型或迁移空间。 |
| Ore Mining | Ore | 矿藏有限，会随开采减少 | 同 Coal；不得把区域画在仅几何相邻但无矿藏的土地。 |
| Oil Drilling | Oil | 油藏有限，会随开采减少 | 区域覆盖地下 Oil；远离住宅和饮用水源，并提供直接货运道路。 |

官方机制还规定：专门产业不增加普通工业 zoning 需求；企业不会按普通公司逻辑破产，而是在利润下降或资源耗尽时缩减产量和雇员。采集车辆只在产业区域内部沿模拟生成的路径运行，不使用普通道路；资源汇集到主建筑后，外运车辆才依赖主建筑的道路和城市货运网络。因此必须同时验收“区域内部采集路径”和“主建筑对外道路物流”。[官方经济与生产说明](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)

### 通用物理规则

1. **先主建筑，后区域**：先从 `list_building_prefabs(kind="specialized_industry")` 发现候选，完成原生预览、提交并回读 owner 主建筑。若区域在入口上，直接调用 `list_building_areas`；若区域只在升级上，先预览、建设并回读对应升级，再从永久升级实体读取允许的 `area_prefab`。不能先画无 owner 的资源区。
2. **资源覆盖优先**：需要资源的产业按实时资源图层和浓度决定边界。区域总面积不是产量代理，未覆盖资源的部分不能按有效采集面积计算。
3. **道路只服务主建筑物流**：内部采集车辆不在普通道路上行驶，但员工、服务车辆和成品/原料外运仍从主建筑道路入口出发。入口避免紧贴路口，并接入能承受货车的集散路。
4. **地形与边界**：边界必须是简单多边形并位于允许建设范围内；陡坡、水体、其他建筑、owner 连接和原生路径生成能力均由 preview 最终判定。
5. **污染与耗竭**：肥沃土地和森林可再生但怕污染；Ore 和 Oil 有限。扩区前读取当前资源量，不能以历史地图资源分布推断当前储量。
6. **运营验收**：区域 `completed` 只证明边界永久创建。恢复模拟后检查采集车辆、资源量、产量、员工、主建筑库存、外运车辆、道路排队和利润；任一项为零时先排查资源、owner 关系和路径。

### Bridges & Ports 海洋专门产业

当当前城市加载 Bridges & Ports 时，还可能发现 Fishing Industry 和 Offshore Oil Industry。两者都以主建筑为 owner，再通过升级菜单建设附属设施和网络：

- Fishing 可包含内陆鱼场，或由 fishing pier、fishing area、offshore farm 和鱼类仓储组成的开放水域系统。开放水域方案必须有符合 prefab 要求的岸线/水深、连续 Boatway/Route，以及主建筑和仓储的道路物流。
- 开放水域入口可能不直接带采集区；先检查 `extractor_area_upgrades`，按当前城市返回的精确升级名称建设可扩区的附属建筑，不能把水面入口当作陆地采集区 owner。岸线候选须绑定真实普通道路并经过原生预览；只有永久升级的区域能力与水上路径均验收后，才逐步扩到原生允许的最大有效边界。
- 若水上升级采用 `Floating` 且声明了远距离放置范围，不要直接套用贴主体的 `owner_side`：主体已有的码头和 Boatway 可能占据贴边候选。先回读原生 `placement_geometry.floating_supported`、水面及现有子航道，使用 `plan_special_building_site` 传入 `owner_building_id`、精确升级名称和 `mode=floating`，再将候选原样交给 `preview_building_upgrade(placement_mode=floating)`。此工具只筛掉越界或四角无水的候选；原生预览仍可能因子航道、净空或专用吸附失败而拒绝，失败时停工回读，不提交。
- Offshore Oil 由主建筑、pier、pipeline、storage tank、offshore rig 和 oil tanker line 组成。钻井平台处于水上不等于已经联网；输油管、油轮路径、存储和主建筑外运道路分别验证。
- 这些海洋产业的管线、Boatway 和 Route 是专用网络，不能用视觉接近代替连接；桥梁、岸线、航道和水深共同决定可用路径。
- 渔港的可延长码头控制点可能属于高架 `PathwayData`（如游戏实时返回的 `Narrow Boatway`），并非 `Game.Net.Waterway` 航道。连接型附属建筑若要求码头先延伸，应先按 `WATERWAY-GUIDE.md` 的码头 Pathway 流程延长、提交和回读，再预览附属建筑；不得用航道工具直接代替码头。
- DLC 资产及内部名称可能随版本变化，必须通过当前城市 prefab、升级和 owner 的 SubArea/SubBuilding 声明发现，不能把官网展示名称直接作为 MCP 参数。

上述海洋产业结构来自[官方 Bridges & Ports 页面](https://www.paradoxinteractive.com/games/cities-skylines-ii/add-ons/cities-skylines-ii-bridges-and-ports)及[官方港口开发日志](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/bridges-and-ports-dev-diary-ports)。

## 标准流程

1. 读取 `get_game_status` 和 `get_query_capabilities`，确认运行中版本包含 `building_area_operations`。
2. 用建筑领域查询找到永久 `building_id`，再调用 `list_building_areas`。不要猜测或翻译 `area_prefab`。
3. 根据用途检查位置。填埋区应远离住宅、饮用水源和未来扩建通道，并保持原生规则要求的 owner 邻接或连接；专门产业采集区应覆盖返回的 `map_feature` 对应自然资源，且为加工建筑、道路和货运留出空间。长方形边界便于扩容和保留通道，但优先级低于 owner 连接、道路出入口和资源覆盖。
4. 暂停城市，调用 `preview_building_area`，轮询到 `preview_ready`。边界是 3–64 个不重复的简单多边形点；首点可不重复，工具会闭合边界。
5. 核对 `errors`、`warnings`、`surface_area_m2`、资源/容量信息和 `cost`，再用同一操作和明确 `max_cost` 调用 apply。
6. 轮询到 `completed`，使用 `result_area_id` 或重新调用 `list_building_areas` 回读永久 `area_id`、owner 关系、prefab、边界和模拟统计。恢复模拟后再检查储量或产量变化，以及服务车辆能否通过 owner 的道路入口正常工作；`applying` 或 `outcome_unknown` 时禁止换请求 ID 盲目重提。

创建示例参数：

```json
{
  "request_id": "landfill_area_001",
  "mode": "create",
  "building_id": "<session>:<index>:<version>",
  "area_prefab": "<list_building_areas 返回的精确名称>",
  "boundary": [
    { "x": 100, "z": 100 },
    { "x": 220, "z": 100 },
    { "x": 220, "z": 200 },
    { "x": 100, "z": 200 }
  ]
}
```

重画边界使用 `mode=boundary`、`area_id` 和完整新边界；删除使用 `mode=delete` 与 `area_id`。两者不接受 `building_id` 或 `area_prefab`，防止在编辑时改变所有权或区域类型。

## 边界与限制

- 所有写事务串行，预览有效期五分钟；创建、重画和删除都要求城市已暂停且默认工具空闲。
- 原生区域系统负责地形高度、碰撞、资源要求、费用、临时实体和永久提交。MCP 不直接改写永久区域 ECS，也不把采矿区域强行绑定到填埋场。
- 区域 prefab 必须来自 owner 建筑 prefab 的原生声明。不要用行政区或 zoning 替代，也不要通过通用 ECS 直接改写永久 `Owner`、`SubArea` 或 `Node`。
- `list_building_areas` 的 `resource_amount`、`max_concentration`、`stored_amount` 等是当前模拟值。创建完成只证明边界已提交，不证明区域与 owner 的运营关系或车辆出入口有效；必须运行模拟后再判断产量、容量利用率和实际效果。
- 该工具不自动铺路、建货运网络、清理污染、购买地图格或调整地形。缺少前置条件时先处理对应领域，再重新预览。

## 官方资料边界

本文于 2026-09-18 复核官方公开资料。官网能确认产业类型、资源依赖、耗竭/再生、内部车辆和 Bridges & Ports 的设施拓扑，但不提供所有当前 prefab 的精确占地、最大边界、坡度、容量或费用。规划阶段使用官方规则筛选，施工阶段必须以 `list_building_prefabs`、`list_building_areas`、实时资源图层和原生 preview 返回值为准。
# 工业园高层流程

`deploy_industrial_campus` 将工业网格、工业建筑和附属区域串成固定顺序。`areas[].building_id` 或 `building_index` 指定 owner；省略 `area_prefab` 时工具读取 `list_building_areas` 的 `available_area_prefabs`，不会猜测 prefab。每个区域仍单独 preview/apply，阶段结果和 `result_area_id` 会返回；失败不触发自动拆除。
