# 统一建筑工作流

用于新增普通建筑、市政服务、公共交通设施或公用设施。该流程只编排已有游戏原生预览和提交事务；升级、移动、拆除及交通线路/轨道/管网建设仍使用各领域工具。

## 选择入口

- 需要先比较位置、影响或费用：调用 `plan_building_workflow`。向用户报告候选、影响、费用和警告；已获授权施工时将 `plan_id` 交给 `execute_building_plan`，否则用 `cancel_building_plan` 释放预览。
- 用户已明确要求直接放置一组建筑且无需逐项审阅：调用 `deploy_building_plans`。一次可放置 1–32 栋，并通过 `max_cost_per_building`、项目内 `max_cost` 和 `max_total_cost` 约束费用。
- 只诊断或讨论选址时，不提交计划。需要保持计划供后续确认时提醒其约五分钟原生 TTL；长时间分析后应取消并在执行前重规划。

## 单栋流程

1. 从当前游戏发现精确 prefab，不翻译或猜测名称。调用 `plan_building_workflow`，至少传唯一 `request_id`、`building_prefab`、搜索中心 `near`。通常保留 `category=auto`；同名 prefab 在多个专用领域出现时明确指定 `building`、`city_service`、`transport_facility` 或 `utility_facility`。
2. 检查 `state=preview_ready`、`candidate`、`cost`、`warnings`、`expires_at_utc` 和 `impact`。`near` 是搜索中心，不保证最终坐标；扩大 `search_radius_m` 或候选数前先判断是否偏离用户指定区域。已知未来要安装的兼容升级通过 `reserve_upgrade_prefabs` 传入，让沿街地面选址按扩展占地避碰；特殊放置建筑仍以升级时的原生预览为准。
3. 获得施工授权后调用 `execute_building_plan`，复用返回的 `plan_id`，使用新的执行 `request_id`，并提供明确 `max_cost`。只有 `state=completed`、永久 `result_entity_ids` 和 `readback` 才证明建成。
4. 不再施工时调用 `cancel_building_plan`。MCP 重启、切换城市会话或预览过期后，旧 `plan_id` 不可用，必须重新规划。

规划器会按 prefab 放置标志自动选择普通、岸线、水面、道路边缘或道路节点路径，跳过近似碰撞候选，并在原生拒绝后尝试下一候选。服务设施会返回覆盖代理：教育用教育需求，公园/娱乐及 `placement.unique` 标志性建筑用吸引力，交通设施用客流覆盖，其他市政服务用服务覆盖。代理结果不等于游戏寻路、容量或实际模拟效果。

## 批量与失败

`deploy_building_plans` 对每项严格串行执行“发现 → 候选 → 原生预览 → 提交 → 回读”，不要在外部并发调用多个部署请求。默认 `continue_on_error=false` 会在首个失败后停止；设为 true 时继续后续项目并返回 `partial`。已完成项目不会因后续失败自动回滚，结果中的 `completed_count`、`total_cost` 和每项状态是最终边界。

同一逻辑重试必须复用相同 `request_id` 和参数；不同参数必须使用新 ID。只读 prefab 发现可并行，原生预览和提交不可并行。高层工具会暂时暂停游戏并恢复原模拟速度，不要另行切换速度干扰正在进行的事务。

交通站、机场、港口等若依赖轨道、航线或道路类型，工作流只选择可见候选并让原生工具校验，不会自动建设缺失网络。电信、电力、供水和污水设施也不会自动铺设外部管网。遇到此类失败时先补齐前置网络，再用新规划请求重试。
