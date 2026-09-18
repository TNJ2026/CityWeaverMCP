# 灾害 MCP 指南

自 MCP 1.18.0 起新增 13 个灾害工具。实现直接使用游戏加载的 `EventData` 与事件 archetype，覆盖 `WeatherPhenomenon`、`Fire`、`Destruction` 和 `WaterLevelChange` 四类原生事件；游戏原生初始化器继续负责预警、热点移动、雷击、起火、破坏、水位变化、疏散、应急响应与事件结束。

当前游戏内容实际发现 8 个可触发预设：天气类 `Hail Storm`、`Lightning Strike`、`Tornado`；火灾类 `Building Fire`、`Forest Fire`；破坏类 `Building Collapse`；水位类 `Flood`、`Tsunami`。带 `TrafficAccidentData` 但不带天气事件数据的交通事故不归入灾害接口，继续由交通接口管理。

## 发现与监控

- `list_disaster_prefabs`、`get_disaster_prefab`：读取精确 prefab 名称、事件类别、目标类型、破坏/起火/水位参数、危险行为、半径、时长、雷击间隔、发生条件、并发限制和当前实例数。
- `list_active_disasters`、`get_active_disaster`：读取事件阶段、中心、热点、速度、半径、强度、剩余预警/活动时间和影响统计。
- `get_disaster_impacts`：按事件追踪 `FacingWeather`、`InDanger`、`OnFire`、`Flooded` 与 `Destroyed`。
- `get_disaster_readiness`：汇总避难所及容量、预警系统、灾害设施和消防站灾害响应车辆容量。

## 触发流程

1. 用 `list_disaster_prefabs` 选择精确名称。
2. 调用 `preview_disaster` 并传入唯一 `request_id`。天气事件可用 `x/z` 或 `target_id` 定位，并覆盖现象半径、热点半径、初始强度、预警秒数和持续秒数；建筑火灾和倒塌需要建筑 `target_id`，森林火灾需要树木 `target_id`；洪水和海啸是全局水位事件，不接收位置或目标。
3. 暂停城市后，使用同一 `request_id` 调用 `apply_disaster_operation`。
4. 返回 `completed` 和 `result_disaster_id` 后恢复模拟，使原生灾害系统初始化并推进事件。

预览五分钟过期，每个城市会话最多保留 128 个操作。应用前会重新检查 prefab 和原生并发限制。未应用的预览可用 `cancel_disaster_preview` 取消。

## 运行中控制与恢复

- `update_disaster`：暂停时可修改天气事件的位置、现象/热点半径、当前强度和剩余时间；水位事件可修改当前/最大强度、危险高度、方向和剩余时间。目标型火灾与倒塌由原生目标状态推进，可停止或清理，不提供运行中参数改写。
- `stop_disaster`：给原生事件添加 `Deleted`，停止继续产生影响。
- `clear_disaster_effects`：默认只清理该事件关联的天气警告与疏散状态。`include_damage=true` 还会强制移除火灾、淹水和摧毁标记。

强制移除 `Destroyed` 只清理状态标记。需要游戏原生重建事务、费用和最终建筑校验时，应逐个使用 `preview_building_rebuild`。停止灾害也不会自动抹掉已经发生的物理损失。

`TargetElement` 是初始化输入缓冲区，原生事件系统消费后可能变为 0；是否命中目标应通过事件关联的 `InDanger`、`OnFire`、`Flooded` 或 `Destroyed` 读取结果判断。
