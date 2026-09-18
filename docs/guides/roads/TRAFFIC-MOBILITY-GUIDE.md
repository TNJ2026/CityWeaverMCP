# 交通与出行控制指南

自 MCP 1.12.0 起新增 20 个 MCP 工具，用于读取车辆、行人、市民行程、车道连接、道路流量和停车状态，并在城市暂停时请求原生重寻路、修改目标和行为、删除车辆或提交市民出行需求。

## 查询工具

| 工具 | 用途 |
| --- | --- |
| `list_vehicles` | 按车辆类别、用途和运行状态分页列出车辆 |
| `get_vehicle` | 读取车辆位置、速度、车道、道路、目标、路径状态、乘客和编组 |
| `get_vehicle_path` | 分页读取原生 `PathElement` 路径 |
| `list_travelers` | 按步行、乘车、等待或卡住状态列出 Human 实体 |
| `get_traveler` | 读取行人/乘客、市民关联、目标、车道与移动状态 |
| `get_traveler_path` | 分页读取行人的原生路径 |
| `list_citizen_trips` | 读取市民 `TripNeeded` 队列和当前已生成的出行者 |
| `inspect_lane_connections` | 读取连接车道的道路/轨道类型、端点和标志 |
| `analyze_traffic_flow` | 按道路汇总车辆数、停车数、卡住数、平均速度和拥堵评分 |
| `analyze_parking` | 汇总停车车辆和停车车道容量、费用、舒适度与出租车状态 |

`list_vehicles` 的 `vehicle_class` 支持 `all/car/bicycle/train/watercraft/aircraft/other`；`role` 支持 `all/personal/taxi/public_transport/cargo_transport/delivery/service/other`；`state` 支持 `all/moving/parked/stuck`。`list_travelers.mode` 支持 `all/walking/riding/waiting/stuck`。

## 控制工具

| 工具 | 用途 |
| --- | --- |
| `request_vehicle_reroute` | 将车辆路径标记为 `Obsolete`，交给游戏原生寻路重新计算 |
| `set_vehicle_target` | 使用 `VehicleUtils.SetTarget` 改目标并请求重寻路 |
| `set_vehicle_behavior` | 设置汽车/船舶/飞机导航最高速度、汽车公交车道偏好，或清零瞬时速度 |
| `remove_vehicle` | 对控制器及整组 `LayoutElement` 车辆添加原生 `Deleted` 清理标记 |
| `request_traveler_reroute` | 请求行人/乘客重新寻路 |
| `set_traveler_target` | 修改 Human 目标并请求重新寻路 |
| `set_traveler_speed` | 修改 `HumanNavigation.m_MaxSpeed` |
| `request_citizen_trip` | 向市民原生 `TripNeeded` 队列追加出行需求，由游戏选择步行、私家车或公共交通 |
| `cancel_citizen_trips` | 按目的或全部删除尚未执行的出行需求，不中断当前行程 |
| `manage_traffic` | 批量重寻路卡住车辆、清理卡住车辆或清理停放车辆 |

所有控制工具要求城市已加载并暂停。`entity_id` 仅在当前城市会话内有效；恢复模拟后车辆和临时 Human 可能很快完成行程或被清理，应重新查询 ID。

## 调用示例

```text
列出当前卡住的车辆，并按道路汇总最拥堵的 20 条路。
暂停城市，把这些卡住车辆全部请求重新寻路。
查看某辆车的完整路径、所在车道和道路。
让某位市民前往指定建筑，由游戏自己选择交通方式。
清理最多 50 辆卡住车辆。
```

```json
{"action":"reroute_stuck","limit":100}
```

```json
{"citizen_id":"<当前会话 ID>","target_id":"<建筑 ID>","purpose":"Sightseeing","priority":255}
```

## 原生语义与边界

- 出行生成通过游戏原生 `TripNeeded` 队列完成，不直接拼装缺少物理、车道和所有权数据的车辆实体。
- 改目标和重寻路保留游戏寻路、车道选择、交通方式选择及车辆初始化流程。
- 不提供任意坐标瞬移。直接改 Transform 会绕过车道占用、碰撞和车辆编组状态。
- 列车 `TrainNavigation.m_Speed` 是当前速度，不是稳定最高速度，因此不作为 `max_speed_mps` 写入；列车仍支持读取、目标、重寻路和删除。
- 船舶、飞机、列车、自行车及非空卡住样本需要相应设施或交通条件。接口与筛选已验证，当前“沃本”存档没有这些实例，无法声明非空实例覆盖。
- 当前地图以过境车辆为主。真实测试已验证原生市民行程入队和取消；恢复模拟后候选临时市民被游戏清理，尚未取得稳定居民从入队到 Human/车辆生成的完整实例链。

## 验证

- Release 官方后处理与 Windows/macOS/Linux Burst 构建：0 警告、0 错误。
- 8 项 MCP 自动测试通过，MCP 握手确认 220 个工具。
- “沃本”实机读取到 102 辆车辆、84 辆移动中车辆、18 辆停放车辆、41 条有车道路、975 条停车车道和 3177 条连接车道。
- 实机通过车辆路径读取、车辆/Traveler 重寻路、车辆同目标重设、导航速度往返、公交车道标志往返、瞬时速度清零、行程入队/取消、单车删除和批量停放车辆清理。
- 详细输出见 `artifacts/traffic-mobility-live-1.12.0-final.log`、`artifacts/traffic-mobility-filters-1.12.0.json` 和 `artifacts/citizen-trip-live-1.12.0.log`。
