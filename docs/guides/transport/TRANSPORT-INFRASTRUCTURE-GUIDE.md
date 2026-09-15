# 公共交通基础设施与轨道

版本 1.14.0 提供 25 个 MCP 工具，用于发现、规划、放置、移动、升级、启停、命名、设置政策和拆除公共交通设施，并创建、连接和拆除火车、地铁及有轨电车轨道。全部结构写操作沿用预览、读取状态、提交、再验证的事务流程。

## 设施

`list_transport_facility_prefabs` 枚举当前游戏实际加载并已解锁的客运/货运车站、车辆段、机场、港口和交通枢纽。结果包含精确 prefab 名、运输类型、轨道类型、容量、占地、物理尺寸、建造费用和原生放置模式。

典型流程：

1. 用 `list_transport_facility_prefabs` 选定 prefab。
2. 用 `plan_transport_facility_site` 在目标区域搜索候选位置。规划器会根据 prefab 自动选择路旁、岸线、水面、道路边或道路节点规则。
3. 调用 `preview_transport_facility_placement`，轮询 `get_transport_facility_operation` 直到 `preview_ready`。
4. 调用 `apply_transport_facility_operation`，再读取操作直到 `completed`。
5. 用 `get_transport_facility` 检查永久实体、内部站点、车辆和自带轨道。

移动和拆除分别使用 `preview_transport_facility_move` 与 `preview_transport_facility_delete`，随后走相同的读取、提交和验证流程。预览未提交时可用 `cancel_transport_facility_preview` 清理。

`list_transport_facility_upgrades`、`preview_transport_facility_upgrade` 和 `preview_transport_facility_upgrade_removal` 覆盖兼容升级模块；名称、启停和政策使用 `set_transport_facility_name`、`set_transport_facility_active`、`list_transport_facility_policies` 与 `set_transport_facility_policy`。

## 轨道

`list_transport_track_prefabs` 返回游戏中的 `TrackPrefab`，包含 Train、Subway、Tram 类型及速度、宽度、最大坡度、允许长度、高程范围和单位长度费用。`list_transport_tracks` 与 `get_transport_track` 读取永久轨道、端点节点、曲线和所有者。

`preview_transport_track` 接受 2 到 16 个点，每两个相邻点形成一个原生直线轨道段：

- 新点使用 `x`、`z`，可用 `elevation_m` 指定相对地形高度。
- `node_id` 精确连接已有轨道节点。
- `edge_id` 在指定位置切分并连接已有轨道边；坐标必须在目标边 8 米内。
- 同一点不能同时指定 `node_id` 和 `edge_id`。

预览会检查 prefab 锁定状态、长度、高程、坡度、碰撞和游戏原生警告。提交使用 `apply_transport_track_operation`；完成后返回 `created_track_ids`。删除使用 `preview_transport_track_delete`，单次最多 64 条永久轨道。

## 约束

- 写操作要求城市已暂停且当前是默认选择工具。
- `request_id` 提供幂等保护；重试同一请求必须复用完全相同的参数。
- `operation_id` 和实体 ID 只在当前城市会话有效。
- 设施自带的内部轨道和站点由游戏作为子对象管理。删除设施时应让游戏处理其从属对象，不要单独拆除这些内部轨道。
- 轨道创建提供几何连接能力；可运营线路仍需兼容的车站、站点和完整可寻路网络，并通过公共交通线路工具建立路线。
