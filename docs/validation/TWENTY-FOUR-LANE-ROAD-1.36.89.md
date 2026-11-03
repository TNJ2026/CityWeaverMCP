# 双向二十四车道道路 1.36.89

新增独立预制体 `CityWeaver Divided Road - 24 Lanes`，中文菜单名称“双向二十四车道分隔道路”。从原生 `Large Road Divided` 克隆，在每侧首个无条件 `Car Drive Section 3` 后添加九条三米宽车道，合计每方向十二条。中央隔离带、两侧人行道及条件升级段保留，不修改原预制体或既有道路。默认 160 km/h，预计总宽 86 米，实际车道与宽度待实机读取。

在 PrefabSystem 前注册，继承原生道路菜单分类和图标，解除解锁及旧资产标识。通用 `list_road_prefabs` 和原生道路工具可选择，无需新增 MCP 工具。限速同步与公制 160 标线纳入现有自定义道路逻辑；未动态生成字形几何。

2026-10-30，4 项相关测试通过：实际生产注册系统和分段规则的独立 .NET 回放，核对 12+12 条基础车道、隔离带/人行道/条件段保持一次、方向与偏移等元数据保留、缺失/无效模板拒绝、原模板不变、菜单优先级、160 换算及只注册一次；另外验证限速单位、公制标线和保存限速回归。测试记录 `artifacts/test-1.36.89.log`。

正式 Stage 构建成功，零警告、零错误，包已生成至 `artifacts/staged/CityWeaver`，日志 `artifacts/build-1.36.89.log`。尚待完成部署后的原生目录、实际 24 条车道、路面宽度、道路菜单预览与交叉口验证。未在城市放置道路，需用户保存城市并退出后才能替换 DLL。

## 1.36.89 实机核对与 1.36.90 摘要修正

2026-10-30 已部署 1.36.89，在奥尔顿 session `e127d374a97844338e2788c7c78fd12d` 读取原生目录和 UIObjectData：宽 86 米，限速 160 km/h，双向，未锁定，继承菜单组、优先级 12。临时直路预览 `130a6077cfdd48d383f0ef6c583ad818` preview_ready、can_commit=true、无错误，费用 4100，随后主动取消，commit_dispatched=false。此前预览被用户切换工具取消，未施工。

读取预览生成的原生 NetGeometryComposition / NetCompositionLane：排除 Master 汇总通道后，反向及正向分别 12 条 Road 车道，车道中心各相隔 3 米，最内侧中心为 ±2.5 米，中央净隔离带 2 米；两侧人行道和停车带保留。原生 RoadComposition 限速换算为 160 km/h。实际车道证据 `artifacts/road24-native-lanes.json`、摘要 `artifacts/road24-live-verification.json`，截图 `artifacts/road24-live-straight-preview.png`。本轮未落地施工，也未实测永久十字路口。

同时发现旧 RoadPrefabTraits 通过子串从 1 到 12 枚举名称，误将“24 Lanes”报告为 4，十二车道也可能误读为 2。1.36.90 改用数字词边界完整解析，支持 1..128，保留 advertised 字段语义，不冒充实际车道读数。回归包含 12、24、32、128、连字符名称及嵌入字母/超范围/空名称拒绝。4 项相关测试通过，1.36.90 正式构建零警告、零错误；摘要修正待部署。

1.36.90 已部署并于 2026-10-30 在奥尔顿重新载入验证，session `024a6a342b2540fc9ffca58061e7e844`。道路目录正确回读 advertised_lane_count=24、width_m=86、speed_limit=160、双向、未锁定；十二车道目录同时正确返回 12。证据 `artifacts/road24-1.36.90-catalog.json`、`artifacts/road12-1.36.90-catalog.json`。本轮只查询，保留用户正常运行状态，未放置道路。
