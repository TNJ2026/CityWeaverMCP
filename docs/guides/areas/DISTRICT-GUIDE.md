# 行政区 MCP 指南

自 MCP 1.3.0 起提供 15 个行政区工具。`list_districts`、`get_district`、`find_district_at` 和 `get_district_coverage` 查询边界、面积、名称、政策及原生 `CurrentDistrict` 成员。

创建、重画和删除采用统一的原生预览流程：调用 `preview_district_create`、`preview_district_boundary` 或 `preview_district_delete`，轮询 `get_district_operation` 到 `preview_ready`，暂停城市后调用 `apply_district_operation`，再轮询到 `completed`。预览五分钟过期；提交前会再次比较目标边界快照。边界为 3 到 64 个点，相邻点至少相距 4 米，不能自交，面积至少 100 平方米。首尾重复点会自动去重。

`set_district_name` 设置或清除名称。`list_district_policies` 枚举当前游戏版本中带 `DistrictOptionData` 或 `DistrictModifierData` 的政策，`set_district_policy` 通过游戏原生政策事件设置开关和滑块值。

`get_service_districts` 与 `set_service_districts` 读取和替换市政服务建筑的原生 `ServiceDistrict` 缓冲区。空数组表示覆盖全部行政区；非空数组表示只覆盖列出的行政区。写入要求城市暂停。
