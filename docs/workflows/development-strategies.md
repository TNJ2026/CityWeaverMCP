# 策略选择与评估

检索日期：2026-09-14。适用于 Cities: Skylines II，结合 Economy 2.0 后机制、本项目记录的游戏 1.6.0f1，以及本机 MCP 能力。目录：版本与证据 → 策略选择 → 财务与观察 → 工具映射 → 来源。

> **版本现实提示（2026-09-20 核对）**：本机游戏已经是 **1.6.2f1**（见[本机构建与验收记录](../validation/local-build-notes-2026-09-20.md)）。本文档的证据、阈值和观察窗来自 1.6.0f1 时期的样本，**没有在 1.6.2f1 下重新采集**。下文“版本待核实项”提到的 Autumn Breeze 内容现已随版本落地，而本文未逐项复核其对本机机制的实际影响。因此：策略框架与执行纪律继续有效，**具体阈值和财务基线在 1.6.2f1 存档上必须重新观察后再引用**；不要因为文件写于早期版本就假定其数字仍然成立。

## 版本与证据

**已发布机制**：Economy 2.0 移除了城市政府补贴，提高服务维护成本，并调整需求、住房负担和生产。购地还需考虑地块维护费。因此不能用发行初期的补贴或暴利攻略估算收益。[经济改革](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one)、[地块维护费](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/economy-patch-is-here)。

**版本待核实项**：2026-08-20 的 Autumn Breeze 介绍了垃圾车调度、企业租赁优先级、超大城市住宅需求和收入决策的拟议改动；2026-09-03 的问答仍称该补丁将在九月中旬发布。本次没有确认其已安装，不能当作本机 1.6.0f1 的现状。升级后先核对版本与正式补丁，再重建需求和财政基线。[Autumn Breeze](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/autumn-breeze)、[官方问答](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/collected-questions)。

下文标记“建议”的数值、优先级和阶段门槛是本技能综合推导的管理方法，不是官方公式或保证。玩家攻略用于空间规划启发，成本、解锁与容量由当前 prefab 和状态决定。不将一代攻略、特定 DLC/模组机制、无限资金玩法混入普通经营。

## 选一种主策略

| 策略 | 适用条件 | 主要动作 | 主要代价与切换条件 |
| --- | --- | --- | --- |
| A 稳健滚动扩张（默认） | 空城、低现金、机制不熟、希望持续盈利 | 小片开发，满足必要服务，优先利用现有容量；盈利后复制街区 | 人口增速较慢；长期有需求、容量和现金余量时转 B/C/D |
| B 紧凑公交导向 | 平地有限，已有中高密需求与教育基础，重视通勤和空间效率 | 住宅和相容就业集中在可达走廊，先验证公交客流，再升级高容量运输 | 学校、水电和站点周边压力集中；空置或运营赤字上升时暂停增密 |
| C 资源产业驱动 | 存在适合的资源地、劳动力和货运出口，住宅能避开污染 | 先做一条小规模资源—加工—消费/出口链，再补物流瓶颈 | 不保证出口暴利；库存积压、缺工、运输代价或污染抵消收益时收缩 |
| D 多中心渐进发展 | 已有城市跨河、沿山谷或中心过载，需要保留风貌 | 每个新片区补本地生活与就业，建立有需求的中心间公交/货运联系 | 重复服务和连接投资；未利用旧片区容量前不散铺孤立卫星城 |
| E 接管修复 | 现金持续恶化、缺水断电、拥堵阻塞服务、人口流失 | 先保生命线和现金，再修住房/岗位/物流错配，最后恢复扩张 | 会暂缓人口目标；稳定后回到 A 或按需求选 B/C/D |

策略不是互斥开关：可用 A 控预算、B 布住宅、C 布产业、D 做远期空间结构；E 是暂时恢复阶段。用户已经指定目标时尊重目标，明确其维护和交通代价，不强制改成利润最大化。

## 用可比较数据做决策

建议先做三个同口径样本，记录模拟日期/帧、现实时间、会话、季节、速度与干预。选择足以让相关系统更新的观察窗口：路口需看到车辆通过，财政需经历结算，入住和教育需要更长时间。不要把等待几秒现实时间当作几个月模拟；同帧多次读取不是趋势。灾害或现金即将耗尽时不等待完整趋势才救急。

财务计算均需统一到同一模拟时间单位：

- `经营净流量 = 经常性收入 - 经常性支出`。借款、里程碑奖励、卖资产等一次性流入单列；看上去有钱不等于经营盈利。
- `可动用现金 = 当前现金 - 已承诺未支付建设费 - 应急储备`。债务还本、利息是否已在支出中计入先核对，避免重复扣算。
- 净流量为负时，`现金续航 = 可动用现金 / 每期净消耗`；为正时不报告虚假的无限安全。
- 建筑方案比较 `建设费 + 同一期限维护费 + 接入道路/管线/配套费`。升级、第二座小设施、进口服务都比较，不能只看初始造价或额定容量。
- 进口电力和自建电厂可用同一期限成本比较；只有出口连接、容量、实际净收益支持时才计出口收入，不将装机容量乘售价当成利润。

可调整的**起始观察阈值**（非官方最优值）：

| 指标 | 建议起点 | 触发后如何处理 |
| --- | --- | --- |
| 现金储备 | 一项必要抢修的成本，加 2–3 个已确认结算周期的预期净消耗 | 不满足时缩小可选建设；零起步需在初始资金内安排最小启动包，不能要求空城先盈利 |
| 水电污水余量 | 下一批入住后仍预计留 15–25% 有效余量 | 先查输送和实际效率，再比较扩容；波动电源及冬季需求增加余量 |
| 分密度住宅空置 | 可暂以 5–10% 为观察带，排除施工中和不可用住房 | 持续过高暂停该密度扩张；偏低且有迁入/匹配岗位时补供给，极小城市用绝对单元数判断 |
| 税率调整 | 一次只调整一个相关类别约 1–2 个百分点，且在实际范围内 | 观察需求、税基、企业/家庭状况；收益变坏时恢复，不全城拉满 |
| 扩张批量 | 从一个可回读的小街区开始 | 以住宅单元和预计岗位核算，不以涂色面积或固定 R/C/I 比例核算 |

这些目标不是必须全部精确达到才能行动；它们用于识别风险和控制批量。没有可核实数据时标记未知，先读语义工具，必要时才追 ECS。

## MCP 诊断与干预映射

按需读取，不每轮全城导出：

| 要回答的问题 | 首选读工具 | 允许执行相应任务时的干预 |
| --- | --- | --- |
| 是正常经营还是沙盒/旧档适应？ | `get_game_status`、`get_city_configuration`、`get_query_capabilities` | 记录设置，不自动改变游戏模式 |
| 钱从哪里流失？ | `get_city_economy`、`get_tax_settings`、`list_service_budgets`、`list_service_fees`、`get_loan_status` | 经济 preview/apply；有证据的非关键设施停用 |
| 缺房还是缺合适房？ | `get_housing_statistics`、`get_zone_demand`、`get_population_demographics`，必要时 `list_households` | 小批分区、补可负担且可达的住房；不直接批量造人口 |
| 缺人还是岗位不匹配？ | `get_employment_statistics`、`get_education_statistics`、`get_resource_demand` | 匹配岗位、补学位/通勤；不直接改学历或强制就业 |
| 服务容量够却到不了？ | `list_city_service_facilities`、`list_utility_facilities`、设施详情及道路/车辆查询 | 修接入、范围、线路；再判断扩容 |
| 路堵在哪里、为什么？ | `analyze_traffic_flow`、`analyze_road_traffic`、`inspect_road_lanes`、`analyze_parking`、车辆路径 | 小范围路口/道路事务、公交优化，不用清车伪装治堵 |
| 买地或增密放哪里？ | `get_map_overview`、`analyze_buildable_area`、`sample_terrain`、环境图层、分区格分析 | 选址、有限道路/分区/购地事务 |
| 措施是否生效？ | 对应回读工具、`list_city_statistics`、`get_city_statistic_history` | 比较同口径前后，不以 `completed` 推断长期经营效果 |

执行顺序：现状 → 主要瓶颈与证据 → 最小干预和费用 → 预览/应用/回读 → 模拟观察 → 继续、回退或换假设。道路与建筑可顺序组成一个建设批次，但不是跨领域原子事务；每步失败都应报告已完成部分。能力不支持的规划项目（例如某种步行/自行车设施）先发现接口；缺失时列为待实施，不用不存在的工具承诺完成。

## 来源与适用边界

以下链接均于 2026-09-14 检索。细节应优先对照当前运行版本。

- [Economy 2.0 Part 1](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one)（2024-06-03）：经济重构、需求、住房与教育；不用发行版补贴假设。
- [Economy 2.0 Part 2](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-two)：租金和旧存档适应；网页显示日期与 2024 年 Economy 2.0 公告时间不一致，不据此推断另一轮经济更新。
- [Economy 2.0 is here](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/economy-patch-is-here)（2024-06-24）：地块维护与特定版本迁移。其旧档死亡变化不能解释所有版本的死亡潮。
- [Traffic AI](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai)（2023-06-26）：出行成本和停车的基础机制，具体 AI 行为以补丁为准。
- [Public & Cargo Transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)（2023-07-03）：公交、轨道和货运的功能与成本性质；不固定解锁人口。
- [City Services](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/city-services-districts-policies)：水源污染、服务车辆、区域分配与设施升级机制；容量/费用重新查询。
- [Economy & Production](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)（2023-08-14）：生产链、资源运输和企业区位；其政府补贴段落已被经济改革替代。
- [Maps & Themes](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/maps-themes)（2023-07-31）：选址需要考虑地形、资源和外部连接；不沿用旧地图格数量或购买规则替代 MCP 校验。
- [City Planner Plays：Economy 2.0 新手建城](https://www.youtube.com/watch?v=r6ckYp1YPcI)（2024-07-11），本次读取了[第三方摘要与部分转录](https://glasp.co/youtube/r6ckYp1YPcI)：采用先勘察、顺应地形、渐进建设的玩家经验；未观看完整视频，也不照搬其模组地图与收益。
- [Autumn Breeze 预告](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/autumn-breeze)（2026-08-20）与[Collected Questions](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/collected-questions)（2026-09-03）：提醒核实未来补丁与系统问题，不作为本机已生效修复。

本次搜索找到了 1.6.0f1 的官方公告，但正文未能读取，未使用二手解读断言其具体寻路改动。上面策略是有条件的综合建议，不宣称已在所有规模城市实测。
