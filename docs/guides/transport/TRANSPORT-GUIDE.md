# 公共交通线路指南

自 MCP 1.14.0 起提供 25 个公共交通线路工具，直接复用游戏原生路线预览、寻路、政策、车辆请求、错误检查和提交管线。

## 能力

- 枚举线路预制体，并读取运输类型、客运/货运属性、默认班次和最小站距。
- 枚举地图中的站点与外部连接，按运输类型及客货属性筛选。
- 创建公交、有轨电车、地铁、火车、轮渡、轮船和航空客货线路；线路必须使用兼容站点，网络连通性由游戏原生寻路验证。
- 读取线路站序、路径距离、逐站候车人数与累计等待数据、车辆数与车辆明细、票价、班次、颜色、运行状态和政策。车辆明细包含预制体、位置、运行状态、发车帧、请求数、乘客数及可用的客货容量。
- 整体替换站序，可用于增站、删站和重排站点。
- 修改线路名称、编号、颜色、启停状态、日夜运营时段、票价、目标车辆数、均匀发车系数及原生线路政策。
- 修改站点名称；读取线路的待处理/已调度车辆请求，主动请求兼容车辆、取消请求，或让指定线路车辆按原生流程退线返回车辆段。
- 预览并删除线路。

## 安全工作流

创建、替换站点和删除均采用两阶段操作：

1. 暂停城市。
2. 调用预览工具并保存 `operation_id`。
3. 轮询 `get_transport_line_operation`，直到状态为 `preview_ready` 或 `failed`。
4. 检查原生验证错误；仅对 `preview_ready` 操作调用 `apply_transport_line_operation`。
5. 继续轮询到 `completed`，读取 `result_line_id`。

重复使用同一 `request_id` 和同一参数会返回原操作；同一 ID 配合不同参数会被拒绝。未提交的预览可用 `cancel_transport_line_preview` 清理。城市重新加载后实体 ID 和操作 ID 会失效。

## 工具

| 类别 | 工具 |
|---|---|
| 发现 | `list_transport_line_prefabs`、`list_transport_stops`、`list_transport_lines`、`get_transport_line` |
| 预览/提交 | `preview_transport_line`、`preview_transport_line_stops`、`preview_transport_line_delete`、`get_transport_line_operation`、`apply_transport_line_operation`、`cancel_transport_line_preview` |
| 属性 | `set_transport_line_name`、`set_transport_line_active`、`set_transport_line_color`、`set_transport_line_schedule`、`set_transport_line_ticket_price`、`set_transport_line_vehicle_count`、`set_transport_line_number`、`set_transport_line_unbunching`、`set_transport_stop_name` |
| 政策 | `list_transport_line_policies`、`set_transport_line_policy` |
| 车辆调度 | `list_transport_vehicle_requests`、`request_transport_line_vehicle`、`cancel_transport_line_vehicle_requests`、`release_transport_line_vehicle` |

`set_transport_line_active` 使用游戏原生“停止运营”政策。政策写入、线路启停及预览提交要求城市暂停。颜色会同步到当前线路车辆；后续生成车辆由线路状态继承颜色。

## 当前边界

车辆请求仍需兼容车辆段和连通网络；模组提交原生请求，具体车辆生成、路径、上下客和换乘继续由游戏模拟执行。目标车辆数受当前线路 prefab 的原生政策滑块范围限制。退线会设置游戏自身的 `AbandonRoute` 状态，不会瞬间删除载客车辆。

