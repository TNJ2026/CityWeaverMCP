# 环境与景观指南

1.15.0 提供 21 个环境与景观专用工具，并保留 `list_environment_layers`、`read_environment_grid`、`read_system_data` 供原始数据检查。

## 景观

| 工具 | 用途 |
| --- | --- |
| `list_landscape_prefabs` | 分页列出树木、植物预设及尺寸、费用、放置标志、锁定状态 |
| `list_landscape_objects` / `get_landscape_object` | 按区域、类型和名称读取现有对象、位置、旋转、树龄状态 |
| `analyze_landscape_area` | 按种类和预设统计圆形区域 |
| `place_landscape_objects` | 在一批坐标放置同一预设；省略 y 时贴合地形 |
| `plant_landscape_pattern` | 按固定随机种子生成圆盘散布或圆环，支持最小间距 |
| `move_landscape_object` | 移动和旋转树木或植物 |
| `set_tree_state` | 修改树木生长值和 Teen、Adult、Elderly、Dead、Stump、Collected 状态 |
| `remove_landscape_objects` / `clear_landscape_area` | 按 ID 或区域删除，单次最多 1000 个 |

放置直接使用预设的原生 ECS 对象原型，并加入 `Created`/`Updated` 生命周期标记。它不会执行编辑器工具的碰撞、费用和可建造性检查；需要避开建筑、道路和水面时，应先用查询结果规划坐标。

## 水体与污染

| 工具 | 用途 |
| --- | --- |
| `list_water_sources` | 读取水源位置、半径、水位、深度模式、流量、污染和原生 ID |
| `create_water_source` / `update_water_source` / `delete_water_source` | 创建、修改和删除地图水源 |
| `sample_pollution` | 批量采样空气、地面、噪声污染 |
| `set_pollution_area` | 写入圆形区域内的空气、地面或噪声污染栅格 |

污染写入值为游戏原始单位 0..32767。模拟恢复后，污染源、扩散和衰减系统会继续改变它。水源修改会直接影响水体模拟；建议先读取原值并保留恢复参数。

## 气候、天气和环境栅格

| 工具 | 用途 |
| --- | --- |
| `get_climate_state` | 读取气候、季节、天气分类、温度、降水、云量、雾、极光、雷暴、冰雹、彩虹、日期及每项覆盖状态 |
| `set_weather_override` | 设置天气覆盖；`clear: true` 将省略的覆盖项交还模拟系统 |
| `set_wind` | 设置恒定风向 x/z 和压力 |
| `sample_wind` | 批量采样实际风场矢量和速度 |
| `sample_soil_water` | 批量采样土壤含水量、最近栅格容量、饱和度和地表高度 |

天气、风、水源、污染和景观写入都要求城市暂停。`set_weather_override` 中温度范围为 -100..100，其余强度和归一化日期为 0..1。`set_wind` 的 x/z 是游戏原生水平风矢量，压力范围为 0..1000。

`sample_wind` 使用 64×64 CPU 风场；`sample_soil_water` 使用 128×128 CPU 栅格。更底层的地下水、空气污染、地面污染、噪声污染、可建造土地、电信覆盖、资源和地形等图层可先通过 `list_environment_layers` 发现，再用 `read_environment_grid` 分页读取原始单元。

## 工业区环境风向与污染排布准则

规划重污染或通用工业区（如 `Industrial Manufacturing`）时，可按以下顺序评估环境风险；这些距离是该次实测的保守起点，不是引擎硬阈值：

1. **风向矢量判定**：在选址前必须先调用 `get_climate_state`，读取当前气候环境的恒定风向矢量（如 `wind: { x, z }`）。
2. **优先下风向选址**：工业区宜位于生活区下风向，并结合污染图层和敏感设施位置验证；不要仅凭风向假设污染一定会吹出地图边界。
3. **水源与地下水风险**：远离饮用水取水点、地下水富集区和水塔。500m 可作为该次验证的保守起始距离，但应结合 `read_environment_grid` 的水体/污染图层和实际污染读数调整。
4. **污染缓冲区（Buffer Zone）**：300m～500m 可作为工业区与住宅之间的初始评估范围，最终以污染、噪声和地形数据复核；缓冲带可布置绿化或物流走廊。

## 已验证范围

真实城市中已完成以下闭环：树木与植物预设发现、批量放置、图案种植、移动、树龄状态、区域清理；水源创建/更新/删除；三种污染写入/采样/恢复；天气覆盖写入/清除；风向与压力写入/恢复；风场与土壤水采样。验证结束后删除测试景观和临时水源，恢复污染、天气、风与模拟速度。

环境系统仍会按模拟规则演化结果。景观直接放置不处理碰撞，`clear_landscape_area` 每次最多处理 1000 个对象；大区域需要分页规划或分块清理。
