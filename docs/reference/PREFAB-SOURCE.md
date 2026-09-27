# 建筑、道路与桥梁的内容来源

以下目录每项增加 `source`：`list_building_prefabs`（含升级）、`list_road_prefabs`（含桥梁）、`list_transport_facility_prefabs`、`list_city_service_prefabs`、`list_utility_facility_prefabs`。

## 分类与证据

`source.category` 描述资产声明的内容依赖，以及是否为已订阅模组资产，不代表发行日期或购买状态：

| 值 | 含义 |
| --- | --- |
| `dlc` | 内容前置条件包含 `RequireDlc` |
| `mod` | 包含 `RequireMod`，或资产标记为已订阅模组 |
| `account_reward` | 包含 `RequirePdxLogin`，即需登录账号的内容 |
| `mixed_requirements` | 同时存在以上多类条件 |
| `no_declared_requirement` | 未发现上述条件；不能据此断言首发本体资产 |
| `unknown` | 资产或前置条件无法解析，或出现未知条件位 |

- `is_builtin_asset`：原生 `PrefabBase.isBuiltin`，表示内置资产。内置 DLC 和免费更新资产也可能为 `true`。
- `is_subscribed_mod`：原生已订阅模组标记。两种标记读取失败时保留 `null`。
- `content_requirements`：去重后的内容实体、引用来源 `via`、内容 prefab 名称、原生 flags、DLC ID、`dlc_display_name` 和 `mod_id`。DLC 展示名来自原生内容组件，可能包含 “DLC” 后缀；无法读取时为 `null`，不硬编码 ID 对照表，也不猜中文译名。
- `asset_packs`：资产包实体、名称及解析状态。归属某资产包不等于需要付费 DLC。
- `requirements_complete`：本次直接条件解析是否完整；不表示已遍历所有子资产、升级或资产包的依赖。
- `content_available`：原生 `ContentPrefab.IsAvailable()` 对直接前置条件的检查结果；DLC 条件由游戏检查所有权等要求。任一条件不满足为 `false`，无法确认则为 `null`，不能用 `locked=false` 代替。
- `evidence`：读取使用的组件或原生标记；缺失数据的记录也保留于此。
- `base_game_status`：当前固定为 `unverified`。这些元数据不足以区分首发本体与后续免费更新。

内容依赖、DLC 所有权、里程碑解锁和可施工性是不同概念。`source` 不替代目录的 `locked` 字段，也不替代原生放置预览。查询仅覆盖当前已加载的 prefab，不提供所有未安装 DLC 的完整资产清单。

## 使用

先查询相关目录，再按返回的 `source.category` 或 `content_requirements[].dlc_id` 在调用方筛选。目录暂未新增服务器端来源筛选参数。分页仍遵循原工具的 `next_offset`；来源实体 ID 仅在当前城市会话有效。

默认规划策略为 **游戏内置资产 + 当前拥有且可用的 DLC**：

1. 每次规划先查询当前城市会话和目录，检查 `source` 与 `locked`。没有对应 DLC，或 DLC 不可用时，自动选材使用同用途的可用内置资产；拥有且可用的 DLC 可以纳入候选，并不强制优先使用。
2. 网格自动道路选材仅接受 `requirements_complete=true`、`content_available=true`、`is_builtin_asset=true`、`is_subscribed_mod=false`，且分类为 `no_declared_requirement` 或 `dlc` 的未锁定资产。返回 `content_policy.road_checks` 记录候选是否可用及原因。
3. 建筑规划工作流在选址前执行相同检查。用户指定的确切道路或建筑不满足条件时停止该资产绑定，不静默替换为其他资产；由规划者选择可用内置替代后重新规划。
4. 来源缺失、可用性未知、订阅模组及账号专属内容默认不纳入自动候选。旧版模组缺少字段时应更新模组，不把缺失字段当成拥有全部 DLC。
5. 其他领域、升级和子资产在规划时分别核对；当前自动代码门禁覆盖网格道路选材和建筑规划工作流，不是所有低层 preview 接口的全局 DLC 拦截。概念占位必须在绑定具体资产时完成检查。

此处“游戏自带”指经核验的游戏内置且没有上述内容条件的资产，包括可能的免费更新；不承诺区分首发版本。换存档、内容状态改变或准备施工时重新查询，仍须通过原生预览。

例如 `category=dlc`、`is_builtin_asset=true` 表示游戏内置的 DLC 条件资产，并不矛盾。只有 `category=no_declared_requirement` 时，应表述为“未发现 DLC／模组／登录前置条件”，不能直接写成“游戏首发自带”。

验证：生产来源读取器的内存 ECS 回归覆盖内置 DLC、运行时展示名、账号内容、订阅模组、混合及重复条件、资产包和失效引用。尚需部署新版模组后核对当前游戏目录输出。
