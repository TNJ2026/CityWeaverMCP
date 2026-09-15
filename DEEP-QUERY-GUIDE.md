# 0.3.2 深层数据读取

新增 6 个工具，总计 17 个 MCP 工具。2026-09-13 已完成部署和实际城市验证：15 个环境图层及分页、30 个私有原生字段、实体字段路径和旧接口回归通过。组件抽样覆盖 895 个有实例的类型；29 个样本含嵌套限制或分页标记，不代表全部字段完整导出。

## 查询方式

- `list_game_systems`：发现当前 World 中已存在的 Game 系统，不创建系统。
- `get_system_schema`：列出系统的 public/private/protected 实例字段及声明类型。
- `read_system_data`：空 `field_path` 分页系统字段；指定路径后分页读取该字段。路径示例：`["m_LowDemandFactors"]`，数组索引使用字符串。
- `list_environment_layers`：发现继承 `CellMapSystem<T>` 的 CPU 图层，包括当前游戏实际创建的污染、地价、水资源、自然资源、人口、通信、风场等系统。
- `read_environment_grid`：按 `offset/limit` 读取原始格点，返回分辨率、世界大小、坐标换算方式；最多 1024 格一页。
- `read_entity_field`：选择实体、组件、可选 `buffer_index` 和嵌套 `field_path`，单独读取大型字段。最多 4096 项或 Blob 字节一页。

原有组件接口也包含非公开字段。字段名与原始单位保持游戏定义，不把内部统计直接解释成界面指标。

## 原生存储支持

`NativeArray<T>`、`NativeList<T>` 按索引分页；`NativeReference<T>` 和 `NativeValue<T>` 读取值。原生队列、哈希表、多值哈希表、集合在其公开只读枚举器可用时分页枚举。容器没有被释放、清空或出队；仅释放本次枚举器。

`BlobAssetReference<T>` 验证引用并匹配当前 Entities 的分配头布局，按实际分配长度返回 Base64 原始字节。保留完整原始布局，但并非已解码的业务对象。BlobArray/BlobPtr 中的相对偏移必须相对于原始字段位置解析，不能把复制后的结构直接当指针读取。

读取系统状态前完成 ECS 跟踪任务与现有 Game 系统直接存储的 JobHandle；格点使用 `GetMap(true, out dependencies)` 并完成写入依赖。同步可能造成一帧停顿，大城市宜暂停后按需查询。分页结果仍是实时值，不构成跨调用原子快照。

## 仍有明确边界

没有验证布局的分配器、堆块、裸指针、独立 BlobArray/BlobPtr、GPU 专有纹理等返回 unavailable 或引用类型描述，不伪装成已读取的数据。当前不包含独立 WaterSystem/TerrainSystem 的专用地表水或高度图接口。非公开字段会随游戏版本变化；不存在的字段返回 FIELD_NOT_FOUND。

深度、节点数和字段数均有上限，截断处带标记；可使用更具体的字段路径继续读取。枚举器顺序随模拟变化，深分页扫描上限 100000。原生数组和 Blob 采用直接分页，无需复制整个分配。

## 验证

`node --test mcp/test/bridge.test.mjs` 验证传输与 MCP 注册，不代替游戏内验证。

加载城市后运行 `node mcp/smoke-deep.mjs`，验证真实私有需求数组、环境图层和分页；再运行 `node mcp/smoke-expanded.mjs` 回归已有接口。Blob 和不同原生容器需要实际实例覆盖，不能仅凭编译通过宣称全部可读。
