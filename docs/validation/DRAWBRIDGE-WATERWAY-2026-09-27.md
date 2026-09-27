# 开合桥跨狭窄船道诊断与验收补齐

## 1.24.7 重启后永久施工结果

同日重启加载马沙姆，会话 `7abdb6d9294641f8a85990d2b7a3ccbf`，已确认运行1.24.7及新增能力字段。重新发现两侧引桥节点和已有航道后，使用降低中央三点30米的方案施工，原操作 `1a779543985145489b1de1098fb3bc81` 返回 `completed`，主桥费用22,348，六条永久 DrawBridge03 道路均读到汽车车道。

`waterway_crossings_verified=true`：永久节点 `:49835:7` 连接两条桥梁边 `:49859:3` / `:49860:3` 及两条 Narrow Seaway 边 `:49865:3` / `:49866:3`。原412.31米航道被原生拆成约211.11米和201.20米两段，外侧原节点保持连接；桥梁两端分别与已有引桥共用 `:64149:1` / `:64150:1`，两侧 ConnectedEdge 均包含引桥和主桥。

交叉节点的附属对象 `:49871:3` 使用 prefab `:39892:1`，对应已发现的 WaterwayCrossing 专用结构，未使用之前冲突的普通桥墩 prefab `:39891:1`。因此本例已验证原生交叉结构生成及永久拓扑，不能推广为任意间距的桥墩控制。实际船舶穿行及开合动画尚未验证。模拟已恢复正常速度。

永久操作证据：[draw-water-1247-completed.json](../../artifacts/draw-water-1247-completed.json)。下文为此前诊断和暂存阶段的历史记录。

## 实测与判断修正

2026-09-27，游戏1.6.2f1，马沙姆，会话 `7528e817914445d09318ce9d9fc91174`，运行中的模组1.24.6。

- 已建110米宽、约412.31米长 `Narrow Seaway` 及两岸引桥，主桥未建设。
- 主桥高程541.9453米，水面约478.45米。169米和197米分段均在中央位置出现桥墩与航道 `OverlapExisting`，不能用路段长度当作桥墩净距。
- 将六段方案中央三个新控制点降低30米、保持两端引桥连接节点不变，原生预览 `ac49a842ff1d45948c42d670a0b57d39` 返回 `preview_ready`，费用22,348，错误为空。预览随后确认为 `cancelled`，恢复正常模拟速度。
- 因此，先前“模组没有生成交叉节点，所以需要补建生成流程”的结论过早。原生系统已有交叉逻辑；高程是本例的关键变量。降低后的永久节点拓扑、船舶通行与桥梁动画仍未验收。

证据：[高桥面失败及已建对象](../../artifacts/drawbridge-waterway-crossing-test.json)、[降低桥面请求](../../artifacts/draw-water-height-diagnostic.json)、[成功预览日志](../../artifacts/draw-water-height-diagnostic.log)。这些ID仅用于历史记录。

## 原生依据

本地反编译 `Game.Tools.CourseSplitSystem` 的 `MergePositions` / `IsOver` 按高度范围筛选网络交叉；`Game.Objects.SubObjectSystem.IsWaterwayCrossing` 要求节点邻接至少一条航道及两条非航道边，才选择航道交叉结构。本次 `Narrow Seaway.NetGeometryData.m_DefaultHeightRange` 为[-10,40]，桥面与桥身已高于该航道包络，但桥墩仍会穿过航道。此40米不能当作桥梁通航的通用上限，也不同于道路放置参数范围。

## 1.24.7 代码变更及验证范围

- 道路新建操作报告 `waterway_crossings`，列出实际节点和道路/航道邻接；临时节点的原节点连接及隐藏替换边按原生迭代语义处理。
- 提交后按位置逐一匹配永久节点，并重新检查至少两条道路、一条航道的永久邻接；失去交叉或迟迟未完成时返回 `outcome_unknown` / `WATERWAY_CROSSING_READBACK_FAILED`。
- `waterway_crossings_verified=true` 仅代表本次预览观察到的交叉已通过永久拓扑回读；无观测交叉时为null，不代表净空或运营已验证。
- `waterway_crossing_diagnostics` 解释原生校验标记的航道与采样高度，不新增硬高度限制，不忽略碰撞，不自动降低桥面，不直接写入永久节点或删除桥墩。
- 12项交叉高度/永久拓扑回归及原高程回归通过；官方后处理构建0警告、0错误。该测试不覆盖运行时ECS与原生交叉的全部行为，仍待游戏退出、部署、重载后实机验证。
- 暂存DLL：`artifacts/staged/CityWeaver/CityWeaver.dll`，SHA256 `D21EFE64E543C19D83C6210C0937655363CE2D4B7D2F281D4F59DAED19BF25BE`。本次未覆盖运行中的模组文件。
