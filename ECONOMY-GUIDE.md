# 城市经济管理指南

1.8.0 提供 12 个经济工具，覆盖经济总览、税率、公共服务预算、公共服务费和贷款。所有写操作都采用“预览 → 应用”的事务流程；预览保存目标的原值，应用前再次比对，避免覆盖玩家或其他模组刚刚作出的修改。

## 查询工具

| 工具 | 返回 |
| --- | --- |
| `get_city_economy` | 当前资金、收入与支出总额、收入/支出来源明细、收支差额、每小时变化、税收、贷款和信用额度 |
| `get_tax_settings` | 总税率、四类街区税率、五个住宅教育等级税率、全部可征税资源/产业组合及游戏原生范围 |
| `list_service_budgets` | 公共服务预设、是否可调、预算百分比、效率百分比和估算维护费 |
| `list_service_fees` | 服务费资源、当前值、默认值、最大值和是否可调 |
| `get_loan_status` | 当前贷款、利息、每日还款、信用额度和当前最小可还金额 |
| `get_economy_operation` | 操作种类、状态、原值、目标值、失败原因和完成结果 |

`estimated_upkeep` 沿用游戏经济系统的符号，支出通常为负数。服务费单位沿用游戏原始单位，例如电费和水费不是百分比。当前游戏配置只允许修改 `list_service_fees` 中 `adjustable=true` 的项目。

## 税率

`preview_tax_change` 的 `scope` 决定目标：

| scope | 必需参数 | 说明 |
| --- | --- | --- |
| `main` | `rate` | 城市总税率 |
| `area` | `area`, `rate` | `residential`、`commercial`、`industrial` 或 `office` |
| `residential_education` | `education_level`, `rate` | 教育等级 0–4 |
| `resource` | `area`, `resource`, `rate` | 商业、工业或办公资源税；有效组合以 `get_tax_settings.resources` 为准 |

税率范围必须使用查询返回的 `main_range`、各街区的 `range`、`residential_education_range` 或 `resource_range`。当前实测存档的原生范围为 -10 到 30。

## 服务预算、服务费和贷款

- `preview_service_budget` 接收 `service_prefab` 和 `budget_percent`，预算范围为 50–150；只接受 `adjustable=true` 的服务。
- `preview_service_fee` 接收 `resource` 和 `fee`；只接受 `adjustable=true` 且不超过该项 `maximum_fee` 的服务费。停车费由停车政策管理，不属于这个缓冲区写入接口。
- `preview_loan_change` 的 `amount` 是应用后的贷款总额。大于当前值表示借款，小于当前值表示还款；实际额度和可还金额由游戏原生贷款系统验证。

## 写入流程

1. 调用相应查询工具并保留当前值与范围。
2. 调用预览工具，传入本次唯一的 `request_id`。
3. 检查返回状态为 `preview_ready`，向用户展示目标、原值和目标值。
4. 暂停模拟，调用 `apply_economy_operation`，同时传回 `operation_id` 和相同的 `request_id`。
5. 如果贷款仍在 `applying`，轮询 `get_economy_operation`，直到进入终态。
6. 未应用的预览可以用 `cancel_economy_preview` 取消。

同一请求重复应用会返回同一结果。原值已变化时返回 `ECONOMY_CONFLICT`；城市未暂停时拒绝应用。预览有会话和有效期限制，切换存档或重启游戏后必须重新查询和预览。每个游戏会话最多保留最近 256 条经济操作。

## 已验证范围

在真实城市“沃本”中完成 71 个目标的逐项修改与恢复：总税率 1 项、街区税率 4 项、住宅教育税率 5 项、资源/产业税率 48 项、可调服务预算 11 项、可调服务费 2 项。另行验证了预览取消、运行中拒绝、幂等应用、并发冲突，以及贷款借入和还清。全部设置与资金恢复为测试前值，结果见 `artifacts/economy-live-1.8.0.log` 和 `artifacts/economy-matrix-1.8.0.log`。
