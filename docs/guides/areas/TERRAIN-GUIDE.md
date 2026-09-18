# MCP 地形修改（能力引入 MCP 1.1.0）

模组通过游戏原生 `GenerateBrushesSystem`、`ApplyBrushesSystem` 和 `TerrainSystem.ApplyBrush` 修改高度。支持 `raise`（抬高）、`lower`（降低）、`level`（整平）、`smooth`（平滑）和 `slope`（坡面）。`raise_land` 读取实时水深遮罩，只抬高干燥高度单元。`flatten_map` 将整张原生高度图写成统一绝对高度，并可清空动态水体和移除自然水源。所有管线都会触发 GPU 到 CPU 高度回读。

## 工作流

1. 用 `sample_terrain` 读取路径的当前高度。
2. 用 `preview_terrain` 验证模式、路径、刷子尺寸、强度、次数和目标高度。
3. 检查返回的基线高度，并用 `apply_terrain` 提交。
4. 轮询 `get_terrain_operation`，只有 `completed` 表示原生刷子已执行且高度回读已完成；`change_observed` 表示中心或四个径向验证点是否出现数值变化。
5. 未提交的计划可用 `cancel_terrain_preview` 取消。

城市必须暂停，且应处于默认选择工具。`request_id` 用于幂等重试；同一 ID 不可改参数。计划五分钟后过期。

## 参数

- `points`：1–64 个世界坐标。一个点是定点刷；多个点连接成连续刷子路径。坡面至少需要两个点。
- `brush_size_m`：8–1000 米，包含原生刷子的边缘衰减区。
- `strength`：0.01–1。
- `passes`：1–32 次。
- `target_height_m`：局部整平、坡面终点或整图平整的目标绝对高度。
- `start_height_m`：坡面的起点绝对高度。
- `amount_m`：`raise_land` 的整图陆地抬升量，范围 0.0625–500 米。水深超过 0.001 米的单元保持原高度。
- `clear_water`：`flatten_map` 是否将 CPU/GPU 动态水深全部清零，默认 `true`。启用时目标高度必须高于当前海平面。
- `remove_water_sources`：`flatten_map` 是否删除地图中的自然水源实体，默认 `true`。

游戏 1.6.0 的 `TerrainSystem.PreviewBrush` 方法为空，因此预览是参数校验和实时基线采样，不显示临时变形。实际高度只在 `apply_terrain` 后改变。地形没有原生撤销日志；抬高/降低可用相反刷子近似恢复，局部整平、平滑、坡面和整图平整无法从少量采样精确还原。
