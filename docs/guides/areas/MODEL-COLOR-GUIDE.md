# 模型动态调色（1.33.0）

通过 MCP 按次调整共享 RenderPrefab 材质槽的车身颜色。每次从配置指定的原始 PNG/TGA 计算遮罩和亮度，避免连续调色叠乘；不需要重新导入模型或 AI 生成贴图。需要暂停并退出放置工具。当前为 CPU 贴图计算及原生材质刷新，不适合逐帧动画或高频滑条拖动。

## 配置与使用

先用 `list_asset_materials` 找到准确的 **render_prefab 名称**和 surface_index。配置使用稳定名称，不能使用跨会话失效的实体 ID。一个配置对应一个材质槽；多槽分别配置。

```json
{
  "render_prefab": "从 list_asset_materials 获取",
  "surface_index": 5,
  "source_path": "D:/Art/VehicleBody_BaseColorMap.png",
  "mask_mode": "texture",
  "mask_path": "D:/Art/VehicleBody_PaintMask.png",
  "strength": 1,
  "color": "#B7DDB0"
}
```

遮罩必须与原始贴图尺寸及 UV 一致，红通道 0 保留原像素、255 完全调色，中间值混合。透明度保持原值，原色亮度用于保留阴影。目标色是 sRGB 输入，实际外观还受游戏光照与材质影响。源图与遮罩路径必须为本机绝对路径，保留这些文件，不使用上次生成的绿色图作为原图。

没有精确遮罩时，可显式使用 `mask_mode: neutral_paint`，并去掉 mask_path。支持 minimum_brightness（默认 0.45）、maximum_saturation（默认 0.12）、feather（默认 0.08），取值均为 0–1。筛选原图中的浅色中性像素；黑色轮胎、玻璃及饱和灯色通常被排除，但白色标识或浅色内饰也可能被选中。复杂涂装必须使用人工制作的精确遮罩。

```json
// set_model_color：一次完成预检和应用
{
  "request_id": "bus-paint-green-001",
  "configuration_path": "D:/Art/vehicle-paint.json",
  "color": "#B7DDB0"
}
```

省略 color 使用配置中的颜色。换色使用新的 request_id；同一请求重试复用原 ID 并检查 state/error，不自动重试 outcome_unknown。`preview_model_color` 使用同样参数，只生成预检，随后用 `apply_asset_file_operation` 提交返回的 operation_id、request_id、input_bytes。源图、遮罩或配置在预览后变化会被拒绝。

`get_asset_file_operation` 查看配置、paint_pixel_count、原生引用/GPU 验证结果。验证结果不等于画面验收。

`restore_model_color {operation_id}` 从**最新**调色操作反向撤销该槽连续的调色记录，恢复调色前外观；遇到普通贴图替换停止，遇到后来修改的引用或材质冲突拒绝覆盖。`restore_texture_replacement` 仍可仅撤销单步。

`save_model_color_preset {operation_id}` 在游戏用户目录 ModsData/CityWeaver/ColorPresets 下写入新的 JSON 配置，返回 configuration_path。重载后显式调用 set_model_color 重新应用；**不会自动随存档恢复颜色**。源图、遮罩及导入模型必须仍然存在。

## 范围与限制

所有引用该网格材质槽的对象一起变色，不是单车实例颜色。原文件保留，模组卸载或地图重载恢复原材质引用；生成的用户资产文件保留。每次应用产生原生 Texture/Surface 资产并使用现有会话操作日志（上限 512），因此不应高频循环调用。改色中不会创建轮子动画或改变车辆运营行为。
