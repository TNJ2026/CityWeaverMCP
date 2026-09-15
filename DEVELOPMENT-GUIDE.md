# 城市发展与需求指南

1.9.0 提供 7 个城市发展工具，将游戏需求、人口、住房、就业和教育系统的数据整理成稳定的业务字段，并允许控制游戏原生的会话级无限建筑需求开关。

## 查询工具

| 工具 | 返回 |
| --- | --- |
| `get_zone_demand` | 住宅低/中/高密度、商业、工业、办公和仓储的公司与建筑需求，以及 19 类原生影响因子 |
| `get_resource_demand` | 41 种原生资源的商业、工业、仓储公司/建筑需求和消费需求；默认省略全零行 |
| `get_population_demographics` | 人口、幸福度、健康、年龄、教育、学生、死亡、迁入迁出、通勤、游客和无家可归统计 |
| `get_housing_statistics` | 按低/中/高密度划分的总住宅单元、空置单元、已住单元和收容容量 |
| `get_employment_statistics` | 按教育等级划分的岗位、空缺、可进入的累计空缺、劳动人口、就业人口和失业率 |
| `get_education_statistics` | 五个教育等级的居民、可就业人口、学习位置及学生总数 |

需求因子保留游戏的有符号原始贡献值：正数提高需求，负数压低需求。住宅单元来自 `CountResidentialPropertySystem`，不是住宅建筑实体数量。`accessible_free_workplaces_by_education` 是每个教育等级能够进入的累计空缺岗位，不是失业人数。

`get_resource_demand` 的 `include_zero=true` 返回全部 41 种资源；默认只返回至少一个需求字段非零的资源。各列保留原生整数，不把公司需求、建筑需求或消费需求换算成百分比。

## 无限建筑需求

`set_unlimited_demand` 接收：

- `scope`：`residential`、`commercial`、`industrial` 或 `all`。
- `enabled`：开启或关闭。

城市必须暂停。住宅开关将低、中、高密度住宅建筑需求强制为 100；商业开关将商业建筑需求强制为 100；工业开关将工业和办公建筑需求强制为 100。游戏原生实现不会用该开关强制仓储需求或公司需求。

开关只在当前游戏会话有效，不写入存档。切换存档或重启游戏后恢复为关闭。`get_zone_demand.unlimited_demand` 返回三组当前开关状态。

## 已验证范围

真实城市“沃本”中已验证全部 6 个查询接口、41 个资源行、住宅/商业/工业/办公的全部 19 类需求因子。运行中修改正确返回 `CITY_MUST_BE_PAUSED`；住宅、商业、工业三组开关分别完成启用与关闭，并完成全开、运行模拟、读取结果和全关恢复。最终三组开关均关闭，模拟恢复正常速度。结果见 `artifacts/development-reads-1.9.0.jsonl` 和 `artifacts/development-live-1.9.0.log`。
