# 车辆外观替换（1.32.0）

## 1.36.49 有色涂装跟随线路（待实机）

`route_color` 可选 `paint_hue_degrees`（0..<360）、`hue_tolerance_degrees`（0.1..60）、`minimum_saturation`（0..1），启用色相筛选。默认不提供时仍按原先的中性色筛选方式处理，公交配置无需修改。两种方式均可用 `minimum_brightness` 与 `feather`。透明、低饱和、暗色及不在目标色相范围的像素不参与调色。

选中有色涂装时，在私有基础贴图中去除原涂装色相、保留亮度细节与 alpha，并生成原生 `_ControlMask`。这避免橙色基底与蓝色线路色相乘变黑；未选像素及未选材质保持原样。原始导入资产不被覆盖。单纹理最多 16M 像素、单操作最多 64M 遮罩像素。

Mi-26 配置：`assets_game_import/mi26-replacement-v6-route-color.json`。机身和门使用材质槽 0/1/2；槽 3 玻璃及槽 4/5 旋翼不参与。橙色中心 24°、容差 12°、最低亮度 .3、最低饱和度 .45。保留缩小尺寸和三根原有骨骼，需分别应用于自有直升机和 HelicopterPassenger01 两个当前车型。替换配置沿用现有城市存档持久化机制，应用后必须保存城市；重载及实机颜色变化仍需验证。

## 1.35.0 按线路变更车身颜色

车辆替换配置的每个 parts 条目新增 `color_mode: "route"`，同时提供 `route_color`。使用原生 ColorProperties 的 Brand 外部颜色源和通道 0，由 MeshColorSystem 按每辆车的 CurrentRoute 读取线路颜色。同一车型在不同线路上可以显示不同颜色，后续 set_transport_line_color 或游戏线路调色可直接生效，无需逐帧重绘贴图。

```json
{
  "color_mode": "route",
  "route_color": {
    "surface_indices": [5],
    "minimum_brightness": 0.45,
    "maximum_saturation": 0.12,
    "feather": 0.08
  }
}
```

选定槽位中明亮、低饱和且非透明的像素生成线性 `_ControlMask` 红通道权重；其他槽位显式使用零遮罩，保留玻璃、轮胎和内饰。原始基础贴图不改写；只在应用时生成私有遮罩/材质资产并绑定至私有渲染网格。未选中的材质槽不会随线路色变化。此亮度筛选是涂装近似，不保证任意模型上的白色文字、装饰都能区分，必须实机检查。

当前限制：仅支持具有 `_ControlMask` 的非 VT 导入材质；每个部件选择 1–16 个唯一合法材质槽，单纹理最多 16M 像素、每次操作最多 32M 遮罩像素；空遮罩会拒绝预览。预览报告 color_mode、route_paint_pixels，get_vehicle_model 返回 color_configuration；完成状态核验原生颜色通道绑定。恢复原模型同时恢复原颜色配置及材质引用，线路颜色本身保留。模型替换仍为本次会话有效。

正式构建零警告、零错误，22 项相关测试通过；待部署验证公交 1 路红色、其他线路各自颜色、动态改色及恢复。不得将绑定或遮罩生成成功等同于车身视觉验收。

## 1.34.2 线路车型引用修复

1.34.1 实机发现：原生 UpdatePrefab 更新车辆 PrefabRef，但没有同步 Game.Routes.VehicleModel 中的主、副车型引用。Bus01 从 16714:1 更新为 335290:17 后，三条公交线路仍指向失效的旧实体；TransportLineSystem 的 CheckVehicleModel 因此触发 AbandonRoute，车辆返回总站。

1.34.2 在 MainLoop 的 PrefabSystem 完成后同步这两种引用，早于 LateUpdate 的线路模拟；暂停时照常执行，不依赖客户端轮询。只替换完整旧实体身份（包含版本）匹配的字段，保留其他车型选择、线路和调度配置。应用、显式恢复以及卸载/重载清理触发的原生更新均登记同步。完成状态额外校验旧引用已经清除，返回 route_references_synchronized、updated_route_count 和 updated_route_reference_count。

正式构建和 21 项相关测试通过；仍待部署后验证三条线路的引用更新、车辆正常跑线及恢复模型的往返流程。本修复预防新的失效引用，不猜测已有坏存档中的空车型引用；复验优先使用替换前存档。若需保留当前进度，请另存并保留原存档。

实现状态：正式构建/回归测试完成后部署；原生渲染、动态车轮、灯光和动画效果需要逐模型实机验收，不能用接口返回成功替代视觉检查。

## 范围

适用于加载的 VehiclePrefab：汽车、服务车、公交、列车/车厢、船舶、飞机等。修改同一车型全部现有和未来实例的外观；保留原车型组件中的运输用途、容量和行为参数。原生系统会按新网格/骨骼重新计算车辆尺寸、轴距等几何相关数据。

支持：
- FBX/OBJ 经现有导入流程生成的 RenderPrefab，或已经加载的原生 RenderPrefab。
- 多部件车身、部件位置/旋转、状态网格及材质。
- FBX 骨骼/蒙皮及原生程序化骨骼类型：滚动/转向轮胎、悬挂、转向架、螺旋桨等。
- 源模型原生动画片段的层、状态、播放方式、加速度映射；兼容原车型的骨骼行为映射。
- 单材质与多层发光区域的灯光用途、颜色、亮度、响应时间和已有动画曲线索引。
- 原车灯光/其他特效的位置、旋转、缩放、强度和父网格映射。
- 原车型颜色映射的可选复制，以及通过现有贴图工具修改私有替换网格。
- 原始网格与特效恢复、预览取消、幂等请求、应用前输入指纹校验和实例数量上限。

源文件必须具备对应数据：OBJ 没有骨骼和动画；系统不会自动把静态车身变成正确的转向轮胎。车轮位置、骨骼绑定矩阵、蒙皮权重应在 FBX 中制作。尺寸按米解释，需要缩放时在模型制作工具或原生导入设置中调整。灯光映射需要兼容的车辆 shader、发光材质/遮罩；仅设置 purpose 不会给任意网格生成车灯。

替换为本次会话生效，重载/关闭前恢复原始引用；导入的源资产仍在磁盘。不自动保存城市，不覆盖原游戏资产，不创建新运输逻辑。拖车/编组中的各车型分别配置，不自动将整列车视为单个模型。

## 操作步骤

1. `list_vehicle_models` 查询精确车型和当前会话 prefab_id。
2. `get_vehicle_model` 查看原部件、骨骼名称/角色、动画、灯光与特效。响应也列出当前原生枚举值。
3. 如需新模型，使用现有 `preview_model_import` → `apply_asset_file_operation` → `get_asset_file_operation` 流程。FBX 原生设置须启用需要的程序化动画/动画导入选项。
4. 用 `list_asset_materials` 查询导入物件，取得准确的 render_prefab 或 render_prefab_id；配置引用的是渲染网格，不是静态物件根预制体。也可将该渲染网格传给 get_vehicle_model 查看源骨骼/动画/灯光，再编写映射。
5. 将 JSON 配置保存为游戏主机上的绝对本地文件，最多 1MiB，不允许链接/目录联接。暂停并返回默认选择工具。
6. 调用 `preview_vehicle_replacement`，参数为 request_id、prefab 或 prefab_id、configuration_path。检查 changes、affected_instances_at_preview。
7. 调用 `apply_vehicle_replacement`，使用返回的 operation_id、原 request_id、max_affected_instances。该上限需覆盖所有同车型实例，包括停放/非当前画面中的车辆。
8. 轮询 `get_vehicle_replacement_operation`；completed 表示原生预制体网格和旧实例引用已更新，不代表动画视觉验收完成。
9. 检查车身、轮胎滚动/转向、灯光、车门/动作和正常运输。恢复测试前模拟速度。
10. 需要撤销时暂停并调用 `restore_vehicle_replacement`，轮询至 restored。未应用预览使用 `cancel_vehicle_replacement`。

超时/断线时用原 operation_id 查询，不更换 request_id 盲目重复。outcome_unknown 表示需要检查，不能当作成功。同一车型不允许叠加多个已应用替换，须先恢复。

## 配置格式

下面是结构示例；替换所有示例名称、索引，删除源模型不存在的可选骨骼/动画/灯光条目。

```json
{
  "parts": [
    {
      "render_prefab": "从 list_asset_materials 得到的渲染网格名称",
      "original_part": 0,
      "position": [0, 0, 0],
      "rotation_degrees": [0, 0, 0],
      "rig_mode": "source",
      "color_mode": "source",
      "bones": [
        {"name": "源模型轮胎骨骼名称", "type": "SteeringTire", "speed": 1, "acceleration": 1}
      ],
      "animations": [
        {"index": 0, "acceleration": 1}
      ],
      "lights": [
        {"material_id": 0, "purpose": "Headlight_LowBeam", "color": [1, 1, 1], "intensity": 1, "luminance": 1, "response_time": 0.1}
      ]
    }
  ],
  "effects": [
    {"index": 0, "position": [0, 0.5, 2], "rotation_degrees": [0, 0, 0], "scale": [1, 1, 1], "intensity": 1, "parent_mesh": 0}
  ]
}
```

最简配置只有 `parts` 和每项的 `render_prefab`（或 `render_prefab_id`）。最多 64 部件，最终部件顺序就是数组顺序。

- `original_part` 指定用于默认位置/旋转/状态和原骨骼映射的旧部件，默认为同索引（超出时最后一个）。省略变换会继承它，不会把新模型自动缩放到原车。
- `required_state` 可选，使用查询返回的单一 ObjectState 值；省略保留旧部件状态。
- `rig_mode: source` 保留导入骨骼/动画；`original_by_name` 要求源/原骨骼名称集合与父子关系一致，映射程序化类型和控制参数。复制原动画还要求骨骼顺序与绑定矩阵一致；不兼容时拒绝，改用源模型动画。
- `bones` 按唯一名称配置 type、speed、acceleration、connection_id、source_id；connection_id/source_id 范围 0..900；source_id 按原生规则引用另一个骨骼的 connection_id，0 表示无来源，不是骨骼数组下标。不会改写绑定位置/蒙皮权重。
- `animations` 按现有片段 index 配置 layer、state、playback、acceleration。必须有可加载的原生动画资产；有效枚举通过 get_vehicle_model 获取，不猜值。
- `color_mode: original` 复制原 ColorProperties，要求材质槽数量匹配；遮罩语义仍由模型作者保证。默认 source。
- 省略 `lights` 保留源灯光；显式数组替换单材质/多层灯光映射，空数组移除映射。每项必须且只能设置 material_id 或 layer_id，purpose 必填。可选 color_off、animation_index（引用源已有灯光动画曲线）。
- `effects` 仅调整原车已有特效，index 来自 get_vehicle_model；不改变其 EffectPrefab。也可指定已有 animation_index。省略保留原配置；所有父网格索引仍须有效。

贴图工作流：应用完成后查询 `get_vehicle_model` / `list_asset_materials`，对 `CityWeaver_Vehicle_<operation>_<part>` 私有 RenderPrefab 使用 `preview_texture_replacement` → `apply_asset_file_operation`，支持现有 PNG/TGA 功能。不要误选原始共享 RenderPrefab；替换私有网格贴图只影响这个车型的本次替换。

## 验证限制

预览检查输入字段、文件、骨骼循环/重名、供体匹配、蒙皮索引、原生动画资产、几何尺寸和材质/特效索引。它不是游戏画面的可视化预览，也不能自动证明任意第三方 FBX 的 shader、动画或车辆控制语义正确。实际渲染和动态行为必须在部署后逐模型验证。

## 实机验证记录

1.32.0：TrainOilCar01 的 19 个实例和 Car08 的 1,057 个实例均完成私有网格替换及原生回读，随后恢复原网格、骨骼、灯光和特效。Car08 显式测试 original_by_name、5 根骨骼映射、9 组灯光及特效位置配置。测试全程暂停，结束恢复正常速度。证据：artifacts/vehicle-model-1.32.0-live/validation.json。尚未完成第三方 FBX 动画或动态行驶视觉验收。

车型目录查询暴露原生 TryGetPrefab<T> 返回成功但输出对象为空的情况；1.32.1 改为先查询 PrefabBase，再检查 VehiclePrefab 类型，并跳过空名称。灯光 response_time 也允许原生使用的 0（即时响应）。18 项测试通过，修复待部署复验。

1.32.1 车型目录修复已通过实机复验：106 个车型；列表、名称筛选、第二页分页和 Car08 网格/5 根骨骼详情均正常。本轮仅查询，未改动车辆或模拟速度。证据：artifacts/vehicle-model-1.32.1-live/validation.json。第三方 FBX 动画和行驶视觉验收仍需具体模型。

线路调色补充（1.36.55）：route_color 可设置 neutral_surface_indices，值必须是 surface_indices 的子集。在 paint_hue_degrees 筛选机身时，这些槽改用 minimum_brightness / maximum_saturation / feather 选择浅色涂装，并去除其原底色色偏。适合独立灰白旋翼与彩色机身共用一个 RenderPrefab 的模型。没有选择的玻璃材质继续保留原样。总纹理处理预算96M像素、单图16M。

1.36.56：neutral_uv_regions 支持 [{surface_index:0,triangles:[[u0,v0,u1,v1,u2,v2],...]]}，坐标须在0..1，单区域最多10000三角形，每材质最多一个区域且必须被surface_indices选中。可在同一材质内把中性色UV区域与机身色相选择合并。Mi-26真正旋翼位于槽0，槽4/5为内饰；该模型使用精确面组UV配置，不使用整槽中性色选择。
