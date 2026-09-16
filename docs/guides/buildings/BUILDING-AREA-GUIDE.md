# 建筑附属区域指南

CityWeaverMCP 1.20.0 提供独立的建筑附属区域事务，适用于垃圾填埋场储存区、专门产业资源采集区，以及游戏 prefab 声明的其他建筑区域。它与行政区、土地分区不同：区域必须归属于一个永久建筑，且区域 prefab 必须由该建筑 prefab 的原生 `SubArea` 列表明确允许。

## 工具

- `list_building_areas`：传入 `building_id`，返回建筑现有附属区域及可创建的精确 `area_prefab`。储存区包含允许资源、容量和当前储量；采集区包含资源地图类型、是否要求自然资源、资源量和最大浓度。
- `preview_building_area`：统一预览入口，`mode` 为 `create`、`boundary` 或 `delete`。
- `get_building_area_operation`：轮询原生预览或提交状态、费用、错误和结果实体。
- `apply_building_area_operation`：在城市暂停时提交 `preview_ready` 操作，并用 `max_cost` 限制费用。
- `cancel_building_area_preview`：取消尚未提交的预览。

## 标准流程

1. 读取 `get_game_status` 和 `get_query_capabilities`，确认运行中版本包含 `building_area_operations`。
2. 用建筑领域查询找到永久 `building_id`，再调用 `list_building_areas`。不要猜测或翻译 `area_prefab`。
3. 根据用途检查位置。填埋区应远离住宅、饮用水源和未来扩建通道；专门产业采集区应覆盖返回的 `map_feature` 对应自然资源，且为加工建筑、道路和货运留出空间。
4. 暂停城市，调用 `preview_building_area`，轮询到 `preview_ready`。边界是 3–64 个不重复的简单多边形点；首点可不重复，工具会闭合边界。
5. 核对 `errors`、`warnings`、`surface_area_m2`、资源/容量信息和 `cost`，再用同一操作和明确 `max_cost` 调用 apply。
6. 轮询到 `completed`，使用 `result_area_id` 或重新调用 `list_building_areas` 回读永久 owner、prefab、边界和模拟统计。`applying` 或 `outcome_unknown` 时禁止换请求 ID 盲目重提。

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
- `list_building_areas` 的 `resource_amount`、`max_concentration`、`stored_amount` 等是当前模拟值。创建完成只证明边界已提交；必须运行模拟后再判断产量、容量利用率和实际效果。
- 该工具不自动铺路、建货运网络、清理污染、购买地图格或调整地形。缺少前置条件时先处理对应领域，再重新预览。
# 工业园高层流程

`deploy_industrial_campus` 将工业网格、工业建筑和附属区域串成固定顺序。`areas[].building_id` 或 `building_index` 指定 owner；省略 `area_prefab` 时工具读取 `list_building_areas` 的 `available_area_prefabs`，不会猜测 prefab。每个区域仍单独 preview/apply，阶段结果和 `result_area_id` 会返回；失败不触发自动拆除。
