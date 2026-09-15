# 尚未充分验证的经验与失败案例（Field Notes）

本文档记录在真实城市开发与运维过程中遇到的失败案例、未完全解明的底层机制以及处于假设阶段、尚未完成跨存档充分交叉验证的经验。随着后续实测验证，成熟结论将晋升合并至 `docs/guides/**`。

---

## 1. 失败案例：泛型分区全空导致城市生长停滞

- **问题现象**：
  在欧洲主题（`European`）地图中，使用 `preview_zoning` 分别施划泛型名称 `"Residential Low"` 与 `"Commercial Low"`。操作状态均返回 `completed`，且 `inspect_road_zoning` 能查到有效的 `Zone Block` 与 `ValidArea`，但在高速模拟下**持续数十个循环均没有任何建筑脚手架生成，人口与建筑数恒等于 0**。
- **排查与临时方案**：
  查阅 `get_city_configuration` 发现当前地图属于欧洲主题，进一步检查 `list_building_prefabs` 发现所有低密民宅和商铺预设均为 `EU_...`。改用带前缀的精确分区名（`"EU Residential Low"`、`"EU Commercial Low"`）后，建筑立刻大规模生成。
- **待验证假设**：
  1. 泛型名称（如 `"Residential Low"`）是否仅作为编辑器抽象基类存在，在任何实际游玩地图中均无法独立生成建筑？
  2. 北美主题（`NA`）是否同样严格要求 `"NA Residential Low"`？
  3. 自定义模组地图或混合主题资产包下，是否存在支持无前缀分区的回退逻辑？

---

## 2. 失败案例：市政服务规划候选点落入交叉路口中心（GAME_REJECTED_BUILDING）

- **问题现象**：
  调用 `plan_city_service_site` 寻找市政设施（如 `MedicalClinic02`、`ElementarySchool02`、`FireHouse01`、`PoliceStation02`）的放置点时，算法返回的综合评分第一名候选点（Candidate 0），其坐标偶尔与十字交叉路口的中心线坐标完全重合，或者距交叉路口节点小于 16m。直接调用 `preview_city_service_placement` 均 100% 报错 `GAME_REJECTED_BUILDING`。
- **排查与临时方案**：
  编写候选点自动回退算法（Fallback）：在尝试放置 Candidate 0 失败后，程序不中断，自动遍历 Candidate 1, 2, 3... 直至预览成功并提交。
- **待验证假设**：
  1. `plan_city_service_site` 在计算 roadside 投影时，是否缺少了对 `ConnectedEdge` 交叉节点侵入球的剔除？
  2. 安全路口退距的硬性阈值与道路类型（Small Road 16m、Medium Road 24m、Large Road 32m）之间的具体量化关系尚需建立精确边界模型。目前实测经验表明与路口保持 $\ge 32\text{m}$ 最为安全。

---

## 3. 失败案例：超宽体公共设施在短街区放置连续碰撞

- **问题现象**：
  公墓 `Cemetery02` 沿街面宽长达 111.6m（14 个分区格深度 6 格）。在内部街区长度为 100m~150m 或横向支路交叉密集的街区尝试放置时，算法返回的 10 余个候选点全部被游戏拒绝（`GAME_REJECTED_BUILDING`）。
- **排查与临时方案**：
  将公墓移至北侧平直、连续长度超过 200m 且无支路打断的外围专线上（$Z \approx 1066$）一次性成功放置。
- **待验证假设**：
  1. 宽体建筑不仅要求沿街平直长度必须大于其面宽，其后方占地（进深）如果与相邻平行街区的后院缓冲区重叠，是否也会引发不可见的地面侵入判定？
  2. 地形坡度与路面高差超过多少米时会加剧宽体建筑的拒绝率？

---

## 4. 机制存疑：公交系统（Bus Line）在 Milestone 3 的解锁时机

- **问题现象**：
  游戏在达成 Milestone 3（繁荣村庄）时，晋级广播提示公共交通已解锁。但通过后台调用 `list_transport_line_prefabs` 查询发现 `Bus Line` 依然显示 `locked: true`；同时开发树中的 `BasicTransportationNode` 状态为 `service_unlocked: false, purchasable: false`。
- **尚未充分验证的推测**：
  在游戏原生自然晋级逻辑中，完整的公交车库与运营系统可能固定归属于 Milestone 4（大村庄，8,300 XP），或者需要通过开发点（Development Points）主动在开发树中点亮激活。

---

## 5. 底层网格读取异常：部分环境系统单点采样报 QUERY_FAILED

- **问题现象**：
  调用 `sample_pollution` 或 `sample_wind` 传入坐标参数时报 `QUERY_FAILED`。
- **实战建议**：
  目前推荐优先通过 `get_climate_state` 读取全局恒定风向与气候属性作为工业区选址的权威依据。
