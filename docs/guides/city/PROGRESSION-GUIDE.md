# 城市进度、里程碑与解锁

自 MCP 1.10.0 起新增 10 个 MCP 工具，覆盖 XP、里程碑、发展点、发展树、地图格许可和预设锁定状态。

## 查询

- `get_city_progression`：总 XP、当前/下一里程碑、发展点、已拥有地图格和可用许可。满级时返回 `completed=true`，下一里程碑字段为 `null`。
- `list_milestones`：列出全部里程碑的 XP 门槛、金钱、发展点、地图格许可、贷款额度奖励和完成状态。
- `list_development_tree`：按名称和锁定状态分页读取发展节点、花费、所属服务、前置节点及当前是否可购买。
- `get_unlock_summary`：汇总所有带原生 `Locked` 状态的预设，并按 CLR 预设类型统计。
- `list_unlockable_prefabs`：分页读取准确预设名、类型、锁定状态与 `UnlockRequirement` 依赖。

## 操作

所有操作都要求暂停城市。

- `set_experience_points` 精确设置总 XP。跨过门槛后，游戏会在模拟继续处理时发放原生里程碑奖励。降低 XP 不会撤销已获得的里程碑与奖励。
- `set_development_points` 精确设置可用发展点。
- `purchase_development_node` 调用游戏原生 `DevTreeSystem.Purchase`，保留服务解锁、前置节点、点数和扣点规则；重复购买已解锁节点是幂等操作。
- `unlock_prefab` 为一个非里程碑预设发送原生 `Unlock` 事件。重名时同时提供 `prefab_type`。
- `unlock_all_progression` 启用游戏原生 `UnlockAllSystem`，需要 `confirm_irreversible=true`，会解锁全部里程碑、奖励、发展节点、服务和其他可解锁内容。

## 真实验证

“沃本”存档中读取到 20 个里程碑、71 个发展节点、2111 个可锁定预设和 529 个已拥有地图格。该存档已达到里程碑 20 且全部预设解锁，因此购买节点和单项解锁验证的是已解锁幂等分支；全量解锁原生调度实际执行。XP 完成 307→308→307、发展点完成 0→1→0 往返，最终模拟恢复正常速度。测试记录见 `artifacts/progression-live-1.10.0.log`。

尚未在含锁定内容的存档验证“首次购买节点”和“首次解锁单项预设”的事件落地结果；代码路径直接使用游戏原生购买系统与解锁事件，而非修改 `Locked` 标志。
