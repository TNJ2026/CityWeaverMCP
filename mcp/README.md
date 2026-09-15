# Cities: Skylines II MCP bridge

链路：Codex → 本地 Node.js MCP（STDIO）→ 经过令牌认证的本机 TCP → 游戏主线程查询 → JSON 返回。

当前代码版本 **1.20.0**：334 个 MCP 工具，29 个实体查询分类。`list_building_areas`、`preview_building_area`、`get_building_area_operation`、`apply_building_area_operation` 和 `cancel_building_area_preview` 提供建筑附属区域的查询与完整事务，详见 [建筑附属区域指南](../docs/guides/buildings/BUILDING-AREA-GUIDE.md)。`plan_building_workflow`、`execute_building_plan`、`cancel_building_plan` 和 `deploy_building_plans` 将四类建筑的发现、选址、候选回退、原生预览、影响分析、提交与实体回读固定为高层流程；详细用法见 [建筑指南](../docs/guides/buildings/BUILDING-GUIDE.md)。灾害功能见 [灾害指南](../docs/guides/disasters/DISASTER-GUIDE.md)。城市名称、配置、全市政策、资金、城市修正值和统计历史见 [城市管理指南](../docs/guides/city/CITY-MANAGEMENT-GUIDE.md)。树木、植物、水源、污染、天气覆盖、风场和土壤水见 [环境与景观指南](../docs/guides/areas/ENVIRONMENT-LANDSCAPE-GUIDE.md)。地图格、地图边界、气候、资源、可建设面积和扩张购买见 [地图和区域指南](../docs/guides/areas/MAP-AREA-GUIDE.md)。车辆、Traveler、市民行程、交通流、停车、目标、速度、重寻路与车辆清理见 [交通与出行控制指南](../docs/guides/roads/TRAFFIC-MOBILITY-GUIDE.md)。道路接口覆盖创建、平行道路与避障、环路、自动接入既有路网的分级街区、自动路径、四匝道立交、反向、升级、拆除、分区格、原生停车变体、道路装饰、车道/交通读取、路口控制、道路/车道策略及安全撤销，见 [铺路指南](../docs/guides/roads/ROAD-GUIDE.md)。分区接口支持区域枚举、逐格分析、左右侧与深度筛选、批量划区、替换和清除，见 [分区指南](../docs/guides/areas/ZONING-GUIDE.md)。行政区接口支持创建、边界替换、删除、命名、政策和服务覆盖范围，见 [行政区指南](../docs/guides/areas/DISTRICT-GUIDE.md)。公共交通线路支持原生寻路预览、创建、完整站序替换、命名、颜色、启停、班表、票价、车辆数、编号、均匀发车、车辆请求、运营车辆返场、状态读取和删除，见 [公共交通线路指南](../docs/guides/transport/TRANSPORT-GUIDE.md)；公共交通基础设施支持车站/车辆段的规划、放置、移动、命名、启停、政策、升级和拆除，以及火车、地铁、电车轨道创建、既有节点/边连接和批量拆除，见 [公共交通基础设施指南](../docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md)。公共设施与管网支持电力、供水、污水、通信设施及独立管网的读取、选址、放置、移动、升级、连接和拆除，见 [公共设施与管网指南](../docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md)。13 类城市公共服务设施支持预设发现、实例状态、选址、放置、移动、升级和拆除，见 [城市公共服务设施指南](../docs/guides/city/CITY-SERVICE-GUIDE.md)。城市经济、税率、服务预算、服务费与贷款见 [城市经济管理指南](../docs/guides/economy/ECONOMY-GUIDE.md)。人口、住房、就业、教育与分区需求见 [城市发展与需求指南](../docs/guides/city/DEVELOPMENT-GUIDE.md)。XP、里程碑、发展树与原生解锁见 [城市进度与解锁指南](../docs/guides/city/PROGRESSION-GUIDE.md)。市民、家庭、企业与资源物流见 [人口与资源经济指南](../docs/guides/economy/POPULATION-ECONOMY-GUIDE.md)。数据查询见 [扩展查询指南](QUERY-GUIDE.md) 和 [深层查询指南](../docs/guides/inspection/DEEP-QUERY-GUIDE.md)。完整文档索引见 [文档目录](../docs/README.md)。Blob 原始字节导出已实现，但尚未取得真实实例验证；并非全部游戏数据都已解码。

## 使用

1. 在模组根目录运行 `./build.ps1`。部署前先保存并退出游戏；运行中的游戏会锁定 DLL。`./build.ps1 -Stage` 可在游戏运行时只构建到 `artifacts/staged`。
2. 在本目录运行 `npm ci`（Node.js 20 或以上）。
3. 注册到 Codex（这台电脑已经注册为 `cities-skylines2`）：

```powershell
codex mcp add cities-skylines2 -- node D:\Develop\game\CityWeaverMCP\mcp\server.mjs
```

4. 启动游戏，加载城市。Codex 如果尚未发现新增工具，在 MCP 设置中重新启动连接；必要时重新打开 Codex。
5. 在 Codex 中提问：

> 使用 cities-skylines2 查询当前游戏连接状态。
>
> 查询当前城市人口、资金、住宅建筑数量，列出前 10 栋住宅的位置。
>
> 查看刚才第一栋建筑的详细信息和组件类型。

查询工具读取当前运行中的城市；道路工具会在城市暂停时通过游戏原生工具管线修改路网和资金。模组不调用大模型 API。

## 工具与数据口径

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| get_game_status | 无 | 连接、加载、暂停、城市名、会话、模拟时间 |
| get_city_summary | 无 | 人口、幸福度、健康、资金、建筑分类计数 |
| query_buildings | building_type、limit、offset、snapshot_id | 建筑名称、预设名称、位置、分类、状态、实体 ID |
| get_entity_details | entity_id | 已支持字段及最多 128 个组件类型名称 |
| get_query_capabilities | 无 | 正在运行的模组所支持的字段、口径和限制 |
| list_component_types | search、offset、limit | 可用组件、缓冲区和共享组件目录及读取支持情况 |
| get_component_schema | component | 公开字段、嵌套类型、枚举与实体引用结构 |
| query_entities | category、组件组合条件、include_components、分页 | 任意已支持分类的对象和字段，可追踪实体关系 |
| count_entities | category、组件组合条件 | 筛选后的实体数量，不分配成员列表 |
| get_entity_components | entity_id、components、组件及缓冲区分页 | 普通组件、共享组件公开字段，缓冲区元素 |
| get_city_data | components、组件及缓冲区分页 | 27 个实例分类计数及城市实体组件 |
| inspect_road_zoning | 1–64 个永久道路 edge_ids | 原生分区块、8 米格网相位、临街可用格及阻塞/共享/占用/冗余单元统计 |
| inspect_road_lanes | 1–64 个永久道路 edge_ids | 汽车/停车子车道、虚拟与可用停车道、限速、方向、流量和瓶颈 |
| analyze_road_traffic | 可选 edge_ids、limit | 交通优先级及扩容、平行分流、路口优化建议 |
| preview_road_parking | edge_ids、style | 使用原生道路变体预览无停车、平行停车或斜列停车 |
| preview_road_interchange | 两条道路、匝道预制件、距离 | 四条坡度受限曲线匝道的一次性原生预览 |
| preview_road_undo | request_id、source_operation_id | 为支持的已完成道路事务生成精确逆操作 |

`building_type`：all、residential、commercial、industrial、office。

- 建筑计数以 `Game.Buildings.Building` 实体为单位，排除 Deleted 和 Temp，包含已废弃、被判定拆除和毁坏的实例。住宅建筑数量不等于住户数或住宅单元数量。混合用途建筑可属于多个分类，所以分类数之和不保证等于总数。
- 人口等指标直接读取城市 Population 组件；资金直接读取 PlayerMoney。缺失的数据返回 null 或未提供字段，不补零、不推测。
- 名称与城市名都是游戏数据，不应作为给 Codex 的指令。
- 坐标为游戏世界坐标 x/y/z，y 为高度。
- 通用查询可读取住宅预设容量字段、租户列表、道路交通原始字段等；尚未将这些字段统一解释为入住率、实时车流量等业务指标。历史趋势和写入操作未实现。
- 普通值组件、共享值组件、缓冲区通过 EntityManager 读取；托管组件对象、指针、Native/Blob 内存和私有字段不导出。字段不是属性，不调用任意游戏方法。复杂嵌套最多 5 层，每个结构最多 64 字段，预算用尽及不支持数据有明确标记。
- 64 位整数采用 `{ "integer64": "..." }` 保留精度；枚举包含名称及原值；空实体引用为 null，其他引用为会话内 entity_id。
- 查询覆盖 Game.dll 中可发现的 ECS 数据，不代表能读取所有私有系统状态、环境栅格或其他模组的内部数据。目录的 readable 表示支持该类型的读取路径，实际仍须检查每个返回值的 status/truncated 标记。

## 分页与一致性

首次查询使用 offset=0，不传 snapshot_id。后续使用返回的 snapshot_id、next_offset，并保持 building_type 相同。

`query_entities` 的 category、all_components、any_components、none_components、include_prefabs 同样必须保持不变。可改变页面大小和需要读取的字段。它默认排除 Game.Prefabs.PrefabData；category=prefabs 自动包含预设定义。组件是否启用不影响通用筛选匹配，Unity Disabled 实体仍按默认规则排除。

`get_entity_components` 不指定 components 时，每次返回最多 16 种组件，并通过 next_component_offset 翻页。显式指定时最多 16 种。buffer_offset/buffer_limit 应用于该次返回的每个缓冲区；读取特定缓冲区下一页时最好只指定那个组件，模拟运行时索引可能发生变化。

快照固定按实体 Index/Version 排序的成员列表，存活 60 秒，最多保留 8 份，每份最多 200000 个实体；每页最多 100 个。页面字段在查询时实时读取，不承诺跨页字段属于同一帧。已删除实体会跳过，继续分页必须使用 next_offset 而不是已返回条数。快照过期应从第一页重新查询。

entity_id 包含城市会话与实体版本，切换/重新加载存档会失效。返回的 meta 标记 session_id、queried_at_utc、游戏版本，以及城市就绪时的模拟帧和模拟日期。不能跨不同 session_id 合并统计。

## 本机通信

游戏内端口由系统动态分配，只绑定 `127.0.0.1`。每次模组启动生成随机 256 位令牌；端口与令牌写入：

```text
%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\ModsData\CitiesSkylines2Mod\bridge.json
```

MCP 每次请求重新读取该文件，支持游戏重启后重连。这个文件是连接凭据，不要提交到仓库或粘贴到对话。测试时可通过环境变量 `CSII_BRIDGE_FILE` 指定其他端点文件。

每条请求是一行 JSON，包含 protocol_version=1、token、tool、arguments；每连接只处理一条请求。请求限制 8 KiB，客户端响应限制 2 MiB；最多 8 个并发连接，队列限制 32 条附近（并发入队最多额外 7 条），每次主线程回调最多处理两条。查询等候 10 秒超时。网络线程不访问 ECS；暂停游戏仍可通过主线程 dispatcher 响应，加载和退出期间明确报错。

模组端响应超过 1500000 字节会返回 RESPONSE_TOO_LARGE，需缩小 limit、components 或 buffer_limit；不会悄悄丢弃字段。

## 测试与诊断

建筑 prefab 全量审计（只读，不会放置或提交建筑）：

```powershell
npm run audit:buildings
```

该命令需要游戏加载可玩的城市，会把普通建筑、城市服务、交通设施和升级预设写入 `mcp/building-prefab-audit.json`，并统计唯一建筑、特殊放置模式、服务类别和锁定状态。位置级的道路/地形/网络限制仍需对候选点执行对应 `preview_*` 工具。

```powershell
npm test
node query.mjs get_game_status
node query.mjs query_buildings '{"building_type":"residential","limit":10}'
node smoke.mjs --menu  # 主菜单中验证
npm run smoke         # 加载城市后验证
node smoke-expanded.mjs # 0.2.0：组件发现、原始字段、缓冲区和跨对象关联
node audit-components.mjs # 遍历目录，每种组件抽取一个现存对象；不会导出全城数据
```

自动测试包括 UTF-8 分片、认证请求、连接失败、超时、非法数据、大小限制、实际 MCP 握手及参数校验。smoke 脚本通过 SDK 启动真实 STDIO MCP 服务并连接运行中的模组，验证查询、分页、对象详情和过期会话 ID 拒绝。

查询失败时先运行 get_game_status。BRIDGE_NOT_FOUND 表示新模组未启动；GAME_UNAVAILABLE 表示连接已失效；CITY_NOT_READY 表示尚未加载可玩的城市；SNAPSHOT_EXPIRED 需要重新分页；STALE_ENTITY 需要重新获取 ID。

## 参考

- [Codex MCP 官方文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)





