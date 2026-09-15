# MCP 分区操作（1.2.0）

模组可以读取道路生成的原生 8 米分区格，并按道路行进方向的左侧、右侧或双侧批量指定住宅、商业、工业和办公区域。每侧最多选择 6 格深度。

分区 prefab 与城市主题和已加载资产包绑定。先用 `get_city_configuration` 读取主题，再以 `list_zone_types` 返回的精确名称为准；不要把泛型展示名或其他主题的 `EU` / `NA` 名称直接套用，否则分区可能无法生成建筑。

推荐调用顺序：

1. `list_zone_types` 获取当前游戏和资产包实际加载的区域名称、索引、用途、窄地块支持和高度限制。
2. `analyze_zoning_cells` 查看道路两侧各格的位置、深度、当前区域、占用和阻挡状态。
3. `preview_zoning` 创建逐格快照。`overwrite` 可替换已有区域；`include_occupied` 可包含已有建筑占用格；区域名传 `none` 可清除。
4. 检查返回的 `changed_cell_count` 和 `sample_cells`，再调用 `apply_zoning`。
5. 用 `analyze_zoning_cells` 回读验证。

提交要求城市暂停。操作最多覆盖 64 条道路和 4096 个格子，预览有效期 5 分钟。提交前会比较每个格子的区域、状态和高度；有任一冲突时整批不写入。写入异常会恢复已经修改的格子。成功写入后，模组添加游戏原生 `Updated` 标记，让格子检查、空地计算和建筑生成系统刷新。

`Blocked`、`Shared` 和 `Redundant` 格不会被修改。`Occupied` 默认跳过，只有明确设置 `include_occupied: true` 才会改写；这可能使已成长建筑与新区域不匹配。

当前接口操作道路拥有的分区格。专业产业区域、水域专用区域能出现在区域列表中，但其实际建筑生成还取决于资源区、水面、产业区工具以及对应游戏规则。

## 地图主题与分区预设绑定实战铁律

- **严禁使用无前缀泛型名称**：
  在实际建城中，严禁盲目传入 `"Residential Low"` 或 `"Commercial Low"`。虽然预览和提交能返回 `completed`，但游戏后台找不到泛型匹配模型，会导致划区长期 100% 全空、人口零增长。
- **主题与精确分区映射表**：
  - **欧洲主题（`European`）**：
    - 低密度住宅：`"EU Residential Low"`
    - 中密度联排住宅：`"EU Residential Medium Row"`
    - 低密度商业：`"EU Commercial Low"`
  - **北美主题（`North American`）**：
    - 低密度住宅：`"NA Residential Low"`
    - 中密度联排住宅：`"NA Residential Medium Row"`
    - 低密度商业：`"NA Commercial Low"`
  - **通用工业与办公**：
    - 标准低密度制造业工业区：`"Industrial Manufacturing"`（不受主题限制）
- **操作标准流程**：
  1. 调用 `get_city_configuration` 查明当前存档的 `theme` 字段。
  2. 调用 `list_zone_types` 获取对应主题的 `zone_index` 与精确全称。
  3. 传入 `preview_zoning` 时，必须使用上述带前缀的完整字符串。

