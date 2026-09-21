# 渔港码头延长

用于用户要求延长现有码头、从捕鱼建筑升级菜单选择渔港码头，或排查码头预览失败。先核实运行中的工具 schema；本流程处理 Pathway，不创建船舶 Waterway 或捕鱼航线。

## 发现与长度

1. 读取 `get_game_status` 和能力。换存档、重启后重新发现实体，不复用历史节点 ID。用户指向屏幕时先用 `get_camera_view`，必要时 `capture_game_view` 确认目标。
2. 用 `list_pier_pathways(near, radius_m)` 获取现有码头、端点和 `owned_by`；用 `list_pier_pathway_prefabs(search)` 核实精确资产及解锁状态。列表也可能含隐形路径，不能取第一项作为码头。
3. 用户提到建筑升级菜单时读 `list_building_upgrades`。Fishing Pier 可以同时出现在升级列表和网络资产列表；`native_only` 不代表另一个建筑模块，不应因为调用网络接口就声称资产不同。列表顺序不能证明游戏菜单顺序。
4. 找到面向水域的永久控制点或自由末端。不要默认它一定是 edge.end；结合岸线、建筑位置、连接边和当前画面判断。记录所在建筑的 Transform、Attachment、InstalledUpgrade，以及原有码头拓扑，供施工后对比。
5. 明确长度是“新增 L 米”还是“总长达到 L 米”。沿直线码头向外延伸时，以水侧末端 P 和另一端 Q 计算 `u=(P-Q)/|P-Q|`，终点为 `P+L*u`。原段为曲线时用端点切线，不能用首尾连线冒充切线。不要从建筑中心起画或从屏幕像素反推坐标。
6. 查询延伸走廊水域及障碍。新端默认继承起点绝对高度。当前接口限制单段 16～512 米，并受 prefab 自身范围约束；12 米被接口拒绝不等于游戏原生禁止。宽度、长度、费用和水面净空均以当前发现及原生预览为准，不把单次案例数值当通用规则。

## 预览与施工

- 记录原模拟速度，暂停后调用 `preview_pier_pathway`：精确 `pathway_prefab`、永久 `start_node_id`、`end:{x,z}`（或同 owner 的 `end_node_id`），以及稳定 `request_id`。
- 轮询 `get_pier_pathway_operation`，仅 `preview_ready` 且 `can_commit=true`、无错误并通过费用检查才可提交。仅要求预览时保留有效预览供查看，报告到期时间；不调用 apply。
- 修改长度前取消原预览并确认释放。新几何使用新 request_id；同一次操作遇 TOOL_BUSY 等重试沿用原参数与 request_id。玩家正使用工具时请其退出，不连续抢夺工具。
- 已授权建造时，用原 operation_id、原 request_id 和预览费用以内的明确 max_cost 调用 `apply_pier_pathway_operation`，再轮询至 completed。失败、未知结果按主技能恢复规则处理，不能重建或忽略碰撞继续提交。
- 用 `list_pier_pathways` 回读 created_pathway_ids，核对 prefab、长度、两端坐标和 owned_by。用 `Game.Net.ConnectedEdge` 确认原码头和新码头共享真实节点；再核对 owner 的 SubNet、附着枢纽、道路绑定及升级模块与基线一致。仅画面相接不是验收。
- 无待处理预览且用户未要求暂停时恢复原速度。码头连通不等于捕鱼航线、渔船发出或产量提升，这些须另行验证。

## OverlapExisting 排查

画面没有红色不能替代原生校验，但错误名称也不能证明水中新段真的撞建筑。检查 `validation_entities` 中承载错误的实体、original、owner 和位置；它不是完整碰撞双方记录。不要靠不断改长度或拆除附近建筑掩盖问题。

已验证的一种实现缺陷：Fishing Pier 属于捕鱼区域占位建筑，而后者通过 Attachment 附着实际渔业枢纽。原生 NetToolSystem 会同时更新两层建筑、附着标记和附属网络/区域；只生成直接 owner 的预览可能导致 OverlapExisting。需要补齐原生关系，不能屏蔽碰撞检查。代码修复属于独立模组工作，运行中游戏不热替换 DLL。

当前失败预览会自动清理，不能承诺持续显示；成功预览可在返回的 expires_at_utc 前查看。

## 已验证案例与边界

2026-09-21，游戏 1.6.2f1、布斯蒂：修复附着预览后，新增 160 米 Fishing Pier 原生预览通过；新增 320 米施工 completed，永久回读确认约 15 米原段与 320 米新段共享节点、同 owner，总长约 335 米，费用 2,144。建筑位置和附着关系已回读。没有完成捕鱼运营验收；升级模块没有完整施工前基线，不能据此宣称其全部保留。上述坐标、实体 ID、费用和成功结果不可直接用于其他会话。
