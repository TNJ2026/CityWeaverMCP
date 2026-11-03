# 源码目录

游戏模组源码按职责分组，统一使用 `CityWeaver` 命名空间；SDK 项目会递归编译这些文件。

本项目输出 `CityWeaverMCP.dll`。通用持久化类型由 `Persistence` 目录提供，不再引用直升机程序集；直升机管理仅通过可选适配访问已启用的独立模组。模型和运输模拟由同级 [TransportFever3Helicopters](../../TransportFever3Helicopters/README.md) 项目维护。构建、旧存档迁移和分发边界见[项目信息](../docs/reference/PROJECT-INFO.md)。

| 目录 | 职责 |
| --- | --- |
| `Core` | 模组入口、设置、启动系统、本地桥接与基础查询服务 |
| `Persistence` | MCP自有的模型、车门与限速持久化类型，以及已有旧组件的可选兼容迁移 |
| `Inspection` | ECS 实体、组件、系统、私有字段和原生数据读取 |
| `Buildings` | 建筑查询、放置事务与建筑附属区域 |
| `Roads` | 道路查询、规划、建设和道路高层工具 |
| `Areas` | 行政区、土地分区和地图区域 |
| `Environment` | 地形、环境图层和景观操作 |
| `Transport` | 公共交通线路、设施、轨道和交通出行 |
| `Services` | 城市公共服务、覆盖分析和公用设施 |
| `City` | 城市级名称、配置、政策和统计管理 |
| `Economy` | 财政、税率、预算和发展需求 |
| `Population` | 市民、家庭、企业和资源经济 |
| `Progression` | XP、里程碑、发展树和解锁 |
| `Disasters` | 灾害预览、触发、控制和影响查询 |
| `Planning` | 规划图快照、当前镜头范围读取与游戏画面捕获、施工自动聚焦 |
