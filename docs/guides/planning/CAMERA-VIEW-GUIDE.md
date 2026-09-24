# 当前镜头范围与游戏画面

CityWeaverMCP 提供两个只读工具，用于把玩家当前看到的地图范围与规划工作流连接起来。它们只读取《都市：天际线 II》游戏窗口，不读取操作系统桌面或其他窗口。

## `get_camera_view`

读取当前活动游戏相机的姿态、投影参数和像素尺寸，并将屏幕四周的采样射线投影到实时地形，返回世界坐标中的 `visible_polygon` 与 `visible_bounds`。

参数：

- `edge_samples`：每条屏幕边采样数，范围 1–16，默认 4。更高的值能更好描述透视镜头在起伏地形上的边界。
- `surface_mode`：`terrain` 或 `plane`，默认 `terrain`。
- `plane_height_m`：水平投影面的高度，默认 0 米；也用作地形射线未命中时的回退面。
- `max_distance_m`：射线最大距离，默认取相机远裁剪面与 20,000 米中的较小值。

`visible_bounds` 是便于查询和渲染的 X/Z 轴包围框；`visible_polygon` 才是更接近实际屏幕覆盖范围的有序边界。两者都不等同于已购地图格。若只规划已购区域，还应读取 `list_map_tiles(state="owned")` 并做相交裁剪。

示例：

```json
{
  "edge_samples": 6,
  "surface_mode": "terrain"
}
```

推荐工作流：

1. 调用 `get_camera_view` 取得当前镜头范围。
2. 将 `visible_bounds` 作为 `get_planning_map_snapshot` 或 `render_city_plan` 的 `bounds`。
3. 如需限制在已购土地，先与已购地图格边界求交。
4. 使用 `capture_game_view` 获取视觉核对图。

## `capture_game_view`

将当前游戏视图编码为有界 PNG，并以 MCP 图片内容返回。结构化结果保留尺寸、字节数和捕获范围，不重复携带 Base64 数据。

参数：

- `include_ui`：默认 `false`，仅重新渲染活动游戏相机；设为 `true` 时捕获 Unity 游戏帧缓冲，可包含游戏内界面。
- `max_width`：320–1280，默认 960。
- `max_height`：180–720，默认 720。

图片会保持源画面宽高比缩小。若 PNG 超过桥接安全上限，模组会自动继续缩小；仍超过上限时返回 `SCREENSHOT_TOO_LARGE`，调用方应降低尺寸后重试。该操作不暂停模拟，也不改变镜头或游戏状态。

## 边界与限制

- 镜头朝向天空、超出地图或近平行于地面时，部分射线可能无法命中地形；`terrain` 模式会用指定水平面回退，并在每个点的 `source` 字段中标明。
- `visible_polygon` 不扣除被游戏 UI 遮挡的区域。
- 无 UI 捕获会单独渲染当前活动相机，因此更适合地图分析；带 UI 捕获用于确认玩家眼前的游戏画面。
- 这两个工具都是查询工具，不需要预览/提交事务，也不会购买土地或施工。

## 平滑聚焦与自动跟随施工

`focus_camera` 将游戏镜头平滑移动到指定世界坐标范围，只改变临时玩家视图，不修改城市存档。它接受中心点 `target`、区域的 `width_m`/`depth_m`、动画时间 `duration_seconds`，并可选指定 `zoom_m`、`yaw_degrees` 和 `pitch_degrees`。

所有带明确空间几何的 MCP 实体建设预览都会自动检查施工范围。若道路、地形、建筑、分区、行政区、交通设施/轨道、公用设施/管网、公共服务设施或景观建设范围不在当前镜头内，模组会在原生预览开始时安排约 0.8 秒的平滑聚焦；范围已经可见时不移动镜头。该动画使用渲染时间，因此城市暂停时仍能完成。高层建设工作流最终调用相同的原生预览接口，也会自动获得该行为。

人工操作始终优先。平滑聚焦期间一旦检测到玩家移动、旋转、缩放或通过屏幕边缘改变焦点，本次动画会立即取消，并保留玩家选择的视角，不会在同一施工批次中把镜头拉回。后续新施工批次只有在目标仍完全不可见时才会重新触发自动聚焦。

`focus_camera` 返回 `scheduled=true` 只表示接受了移动请求。随后读取 `get_camera_view.focus_status`：`idle`（尚无请求）、`scheduled`、`moving`、`completed`、`cancelled_by_user` 或 `camera_unavailable`。`completed` 表示控制器插值结束，仍应结合 `center_hit` 与 `visible_bounds` 确认目标实际进入画面；原生相机的碰撞和地形约束可能调整视角。

镜头动画系统必须在 `PreCulling` 阶段、原生 `CameraUpdateSystem` 之前注册。游戏的相对调度只关联同阶段系统；误用 `Rendering` 会导致请求已排队但动画系统不执行。该阶段在模拟暂停时仍运行。
