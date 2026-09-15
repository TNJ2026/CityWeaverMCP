# 公共设施与管网指南

1.6.0 提供电力、供水、污水、通信设施以及独立公用管网的读取和原生建造事务。所有修改都要求城市暂停；预览只生成游戏临时实体，只有操作状态变为 `completed` 才表示永久修改完成。

## 设施

支持的设施类型包括发电厂、变电站、电池、抽水设施、污水设施、水塔和通信设施。

| 工具 | 用途 |
| --- | --- |
| `list_utility_facility_prefabs` | 枚举可放置设施、造价、占地、尺寸和原生放置标志 |
| `list_utility_facilities` | 按类型读取永久设施及实时生产、储量、污染、处理量和效率 |
| `get_utility_facility` | 读取一个设施的实例状态 |
| `plan_utility_facility_site` | 根据预制件自动选择道路侧、岸线、水面、道路边或道路节点选址 |
| `preview_utility_facility_placement` | 原生放置预览 |
| `preview_utility_facility_move` | 原生移动预览 |
| `preview_utility_facility_delete` | 原生拆除预览 |
| `get_utility_facility_operation` | 查询预览、费用、错误和结果实体 |
| `apply_utility_facility_operation` | 提交已通过验证的事务 |
| `cancel_utility_facility_preview` | 取消未提交预览 |

选址器给出候选位置和所需的 `road_edge_id` 或 `snap_target_id`，随后仍应调用预览工具，以游戏的碰撞、地形、水体和网络规则作为最终判定。岸线与水面设施可通过 `minimum_water_depth_m` 控制最低水深。

高噪音或高压设施应远离住宅，并通过适合的支路和电网连接；变电站能放置不代表高压与低压网络已经连通。污水设施和污水管路应与饮用水取水点、地下水及供水网络保持污染隔离；道路自带管线也不证明跨桥、跨高速或独立片区已经接通。具体距离和连接能力以当前 prefab、环境图层及原生预览为准。

## 生命线工程隔离与接驳铁律

在实机建造与管网联通中，必须严格遵循以下原则：

1. **按连接层隔离污水与供水**：
   - 排污设施（如 `SewageOutlet01`）应先读取 `list_utility_network_prefabs` 的 `connection_layers`，再选择兼容的管网。仅污水接驳可优先使用 `Small Sewage Pipe`。
   - `Combined Small Pipe` 属于同时承载给水和污水层的合流网络，不应在未确认设施兼容性和实际流量前断言会发生倒灌或全城污染；建成后使用 `get_utility_network` 检查 `fresh_flow`、`sewage_flow` 和污染字段。
   - 排污口通常不需要接入给水管，但最终仍以当前设施 prefab 的原生连接规则为准。
2. **变电站高压安全岛模式（Noise & Safety Isolation）**：
   - 变电站（例如 `TransformerStation01`）可能带来噪音或其他负面属性，宜与住宅保持缓冲距离；具体影响以当前 prefab 和环境数据为准。
   - **专用支路**：变电站应选址于靠近外部高压走廊的独立地块，单独修建一条 32m~64m 的专用本地街道（`Small Road`）将其连入城市路网，道路内嵌的低压配电网会自动覆盖变电站。
   - **高压电缆接驳**：从外部高压输电塔或高压线边敷设与当前 prefab 连接层和高程范围兼容的地下电缆，再以原生预览确认变电站接口；不要把 `PowerLine01`、`High-voltage Ground Cable` 或固定高程当作所有存档的必然名称和范围。

## 公用管网

支持高压架空线、高低压地下电缆、供水管、污水管、供排水合流管和资源管道。具体可用名称由当前游戏和已安装内容决定，应先调用 `list_utility_network_prefabs`。

| 工具 | 用途 |
| --- | --- |
| `list_utility_network_prefabs` | 枚举类型、连接层、宽度、坡度、长度、高程和单位造价限制 |
| `list_utility_networks` | 读取永久管网边、端点和节点 ID |
| `get_utility_network` | 读取曲线、高程以及可用的流量/容量图记录 |
| `preview_utility_network` | 预览 2–16 点连续折线，可新建节点、接入兼容节点或拆分兼容边 |
| `preview_utility_network_upgrade` | 将 1–64 条同类管网边升级为另一预制件 |
| `preview_utility_network_delete` | 批量拆除 1–64 条管网边 |
| `get_utility_operation` | 查询预览、费用、错误和永久结果边 |
| `apply_utility_operation` | 提交管网事务 |
| `cancel_utility_preview` | 取消未提交预览 |

新建点使用世界坐标 `x/z` 和相对地表的 `elevation_m`。地下管线通常要求 -50 至 -10 米，架空线通常要求 0 至 10 米，准确范围以预制件返回值为准。连接现有节点时提供 `node_id`；连接现有边时提供 `edge_id`，坐标必须在该边 8 米内。同一次折线的每段都必须满足预制件长度和坡度限制。

推荐调用顺序：

1. 枚举预制件并选择精确名称。
2. 暂停城市。
3. 调用预览工具，轮询操作直到 `preview_ready` 或终止状态。
4. 检查 `errors`、`cost` 和 `can_commit`。
5. 使用相同 `request_id` 和足够的 `max_cost` 提交。
6. 轮询到 `completed`，使用返回的永久实体 ID 继续查询或连接。

## 已验证范围

游戏 1.6.0f1 的真实城市中发现 11 种可用管网预制件和 26 种设施预制件。低压地下电缆、供水、污水、合流及资源管道均完成原生建造；供水管完成小管到大管升级；污水管完成接入现有节点；供水管边中点拆分达到 `preview_ready` 并成功取消。六段测试管线随后通过一次批量拆除恢复基线。

`TransformerStation01` 和 `TelecomTower01` 均完成选址、原生放置、永久实例读取、移动和拆除。岸线、水面、道路边及道路节点选址分派已实现；特殊设施是否能放置仍取决于当前地图是否存在符合水深、岸线、道路和空间条件的位置。
