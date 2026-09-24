# 文档目录

先看[架构与功能实现](ARCHITECTURE.md)，了解游戏内模组、独立 MCP Server、规划工作流和原生施工之间的关系。

## 使用指南

- `guides/buildings`：建筑放置与建筑附属区域。
- `guides/roads`：道路、路口、停车和交通出行。
- `guides/areas`：行政区、土地分区、地图、地形与环境景观。
- `guides/transport`：公共交通线路、交通设施、轨道与公用管网。
- `guides/city`：城市管理、公共服务、发展需求和进度解锁。
- `guides/economy`：城市财政、人口、企业与资源经济。
- `guides/disasters`：灾害操作与灾后处理。
- `guides/inspection`：深层 ECS、系统与环境数据读取。
- `guides/planning`：已购区域规划图、自动网格与多层设施走廊、地形/水域叠加，以及可视化但不施工的原生道路预检。
  - [当前镜头范围与游戏画面](guides/planning/CAMERA-VIEW-GUIDE.md)

## 城市工作流

- [策略选择与评估](workflows/development-strategies.md)
- [从零建城](workflows/new-city.md)
- [接手已有城市](workflows/existing-city.md)
- [高效建设与增长](workflows/efficient-deployment.md)
- [调用、事务与诊断](workflows/operations.md)

## 参考与验证

- [游戏物理规则](reference/GAME-PHYSICS-RULES.md)
- [实机验证记录](validation/VALIDATION.md)
- [实测避坑笔记](validation/FIELD-NOTES.md)

## 版本号口径

- 各指南标题或首段的版本号是**该能力首次引入的 MCP 版本**，属历史标记，**不代表当前版本**。统一写作「自 MCP X.Y.Z 起」或「能力引入 MCP X.Y.Z」。
- **当前 MCP 版本以 `mcp/package.json` 的 `version` 字段为唯一来源**；工具总数以运行时 `tools/list` 为准。文档不重复固化这两个数字，避免随版本推进过期。
- `validation/VALIDATION.md` 是按版本倒序的实机验证档案，其中的版本号与工具总数是**当时的事实快照**，不回填修改。

MCP 服务开发、运行和协议说明位于 [`mcp`](../mcp/README.md)；供支持技能的 Agent 使用的技能入口与按需文档路由位于 [`skills/cities-skylines2`](../skills/cities-skylines2/SKILL.md)。详细内容以本目录为单一维护来源。
