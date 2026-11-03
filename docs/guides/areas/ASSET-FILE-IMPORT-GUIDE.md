# 本地贴图替换与模型导入（1.30.0）

这是独立于地图环境预设的新文件工作流。先用 `get_asset_file_capabilities` 确认当前运行版本支持；文件路径指向**运行游戏的电脑**，不通过 MCP 上传大文件。修改前暂停并回到默认选择工具。所有操作先预览，使用同一个 `request_id` 应用；发生 `outcome_unknown` 时查询原操作和游戏导入日志，不用新 ID 重试。

## PNG/TGA 替换建筑、道路贴图

1. `list_asset_materials({prefab:"精确道路或建筑 prefab 名称"})` 遍历其渲染依赖。也可以传从实时目录获得的 `prefab_id`。返回网格 `render_prefab_id`、`surface_index`、`surface_id` 和真实纹理属性名，禁止猜属性。
2. `preview_texture_replacement` 检查材质基线、原纹理维度、文件 SHA256 并解码输入。不会替换原材质，不写入资产数据库。
3. `apply_asset_file_operation` 传预览 `operation_id`、**原 request_id** 和至少覆盖 `input_bytes` 的 `max_input_bytes`。应用前再检查文件和完整材质属性基线。创建独立本地纹理、Surface，切换网格指定材质槽并更新原生 prefab；回读纹理引用后才标记 `completed`。
4. 用游戏画面检查颜色、UV、远近 LOD 和道路/建筑外观。引用回读不等于画面或存档重载验收。
5. `restore_texture_replacement({operation_id})` 恢复原 Surface 引用；后续有其他替换时必须逆序恢复。源材质已被其他操作改动时拒绝覆盖。

```json
{
  "request_id": "retexture-building-001",
  "render_prefab_id": "使用实时返回的ID",
  "surface_index": 0,
  "property": "使用实时返回的纹理属性",
  "file_path": "D:/Art/Building_BaseColorMap.png",
  "color_space": "srgb"
}
```

颜色图用 `srgb`，法线/遮罩等数据图用 `linear`；不自动重排通道或推断游戏 shader 的法线编码。PNG 与 24/32 位真彩 TGA（未压缩或 RLE）受支持，TGA 调色板/交错布局拒绝。单图最大 64 MiB、每轴 8192、总 16MP。

**范围与保存**：替换作用于引用该 RenderPrefab 的全部建筑/道路，不是某一栋建筑或某一段路的独立皮肤。LOD 网格是独立目标，应分别发现和替换。仅接受现有 **2D 纹理槽**，纹理数组、立方体贴图、任意 shader 替换和地图地表配置不在此入口范围。当前替换是**会话级**：重载地图或卸载模组前恢复原引用，不写入原版/DLC/订阅资产文件，也不把覆盖关系写进城市存档。新生成的纹理/Surface 文件保留在用户资产数据库，恢复不会删除这些文件。

## FBX/OBJ 模型导入

自 1.30.0 起，模型导入支持已加载的城市（Game）和地图编辑器（Editor）。两种模式均须暂停、回到默认选择工具，并在异步导入完成前保持同一存档/地图和暂停状态。将一个资产组放在一个本地目录中，例如：

```text
D:/Art/House/
  House.fbx                 # 或 House.obj
  House_BaseColorMap.png
  House_NormalMap.png
  settings.json             # 可选，原生导入配置
```

`preview_model_import` 参数：

```json
{
  "request_id": "import-house-001",
  "source_directory": "D:/Art/House",
  "preset": "static_object",
  "construction_cost": 500
}
```

`preset` 可以是 `static_object` 或 `building`。`construction_cost` 为后续原生放置的建设费用，0–10,000,000，默认 0；导入本身不在城市中施工或扣除建设费用。预览对目录及依赖做指纹记录，并先解析 OBJ。允许 FBX、OBJ、MTL、PNG、TGA、JSON；最多 256 文件/目录、512 MiB，不跟随符号链接或目录联接。应用后异步执行，使用 `get_asset_file_operation` 轮询原操作，禁止把 `importing` 当成功。

原始文件先复制到独立的 `ModsData/CityWeaver/AssetImports/<operation_id>/ProjectFiles` 工作目录，逐文件校验 SHA256，再交给原生资产管线。每次导入使用唯一命名空间，不覆盖已有用户资产。几何、Surface、纹理、LOD 和新的 Object/Building prefab 保存到用户资产数据库；返回 prefab 名称/ID、资产 ID 和几何计数。`completed` 要求真实几何和 prefab 注册成功，**不自动放置到地图**。后续用 `list_imported_models` 重新发现当前会话的 prefab ID、资产 ID、尺寸和放置支持，再用 `select_imported_model` 选中原生放置工具，由玩家检查预览后手动放置；编辑器中也可沿用原生资产预览/放置接口。建筑的地块、道路入口、用途、服务、经济行为仍需单独配置。重新加载后的可用性和画面需实机验收。

FBX 使用游戏原生导入器及其单位、命名、LOD/材质配置。游戏当前原生只注册 FBX，因此 OBJ 由本模组的 `CityWeaverObjImporter` 适配后进入同一几何/材质保存管线。OBJ 保持米制、Y 轴向上，将右手 Z 轴及面绕序转换为 Unity 坐标；支持正/负顶点、UV、法线索引、三角形和凸平面多边形，缺法线时生成平面法线和切线。凹面、非平面多边形请先三角化。最多 100 万展开顶点、64 个材质组；不导入曲线/曲面、骨骼或 OBJ 动画，缺 UV 不会自动展开。`usemtl` 分组保留为独立子网格，MTL 颜色和贴图路径不会自动转换为游戏材质，纹理使用原生文件命名或 `settings.json` 关联。

原生导入器可能记录错误但仍返回任务，因此工具额外检查输出几何，不以 Task 完成冒充成功。失败可能留下局部本地输出，返回 `outcome_unknown` 后应检查日志/资产；不自动删除、重导或伪称已回滚。导入期间保持暂停，不切换存档/地图、启动其他原生导入或退出游戏。加载切换会请求取消并标记未知结果；导入进行中恢复模拟也会阻止后续注册/完成步骤，可能已有局部本地输出。

## 验证状态

生产解析代码通过 PNG/TGA 边界、TGA RGBA/RLE/方向、OBJ 索引/绕序/UV/法线/多边形、文件变更和规模限制测试；MCP 握手、schema、参数转发与修改标记通过测试。正式构建使用当前游戏 DLL。资产引用、虚拟纹理显示、OBJ/FBX 原生导入和保存重载仍须部署后实机验证，不能把构建或模拟桥接测试作为实机成功证据。

### 1.29.0 实机发现与 1.29.1 修复

2026-10-26 的编辑器验证确认道路 PNG 替换及恢复成功。原生 prefab 更新会更换实体 ID，回读须重新发现目标网格。建筑 VT 槽的原始 TextureAsset 是占位引用，直接 LoadData 会失败；1.29.1 改为从原生 VTTextureAsset 或 VTSurfaceAsset 重建图像，未替换的 VT 图层转换为私有 RGBA8 纹理并重新生成 mipmaps，不修改原材质，需额外检查法线、遮罩与色彩。OBJ 首次原生导入因工作目录的分隔符不一致失败，返回 outcome_unknown 且未生成放置实体；1.29.1 将原生管线输入根路径规范化为正斜杠。以上修复待新版本部署后继续验证，不将旧失败改写为通过。

### 1.29.1 实机复验与 1.29.2 包围盒修复

1.29.1 在地图编辑器完成道路 PNG 与建筑 VT 材质 TGA 的实际应用、引用回读及恢复；恢复后原 Surface 引用一致。FBX 与 OBJ 均生成本地资产和 18 顶点/18 索引示例，原生放置预览通过并取消，未放置永久对象。但图像与组件复核发现 OBJ 的 SubMeshDescriptor.bounds 未填充，导致原生 MeshData/ObjectGeometryData 包围盒全零、LOD=255；因此不把 OBJ 导入事务 completed 当成显示成功。FBX 原生包围盒为 8×8×8 米。1.29.2 填充 OBJ 子网格包围盒、将缩放同时应用到顶点和包围盒，并要求渲染元数据及原生对象包围盒/LOD 初始化通过后才完成导入。新修复待部署后实机复验。证据在 artifacts/asset-import-1.29.1/。

### 1.29.2 实机验收

2026-10-26 在游戏 1.6.2f1 的地图编辑器完成 1.29.2 验收：道路 PNG、建筑 VT 材质 TGA 均 preview_ready → completed → restored，原 Surface 引用已回读一致；OBJ 与 FBX 示例各生成 18 顶点/18 索引模型，native_bounds_verified=true。OBJ 原生 ObjectGeometryData 包围盒为 [-4,0,-4]..[4,8,4]、尺寸 8×8×8 米、MinLod=113。两种模型的原生放置预览无错误或警告，均取消且 created_entity_ids 为空，没有永久放到地图；样例资产保留在本地库。上一版导入的 FBX 资产在本次重启后仍可查询。证据为 artifacts/asset-import-1.29.2/acceptance.json；新 OBJ 文件的再次重载及任意外部资产/着色器的显示仍需按实际输入验收，不能将示例推广为所有资产均已验证。

## 城市导入、放置入口与存档（1.30.0）

模型文件、材质和 prefab 保存在本地用户资产库，由原生启动流程加载。城市保存仍使用游戏正常保存流程；导入不会自动保存城市，移动存档到其他电脑时应同时保留这些本地资产文件。每次加载后使用 list_imported_models 获取新 prefab_id，不复用旧会话实体 ID。该列表只发现本模组独立命名空间中生成的 Object/Building 根 prefab，并标明原生包围盒与放置配置是否就绪，不重新导入文件。

select_imported_model 仅选中工具，不产生永久对象；仍由原生预览处理碰撞、地块、建筑道路入口等限制，不能将通用建筑几何视为已配置好的住宅或公共服务。1.29.x 导入的旧资产可能缺少 PlaceableObject 配置，列表会报告 native_selectable=false，此时应显式重新导入，不自动覆盖旧资产。

1.30.0 新增城市/编辑器上下文、恢复模拟/换档中断、导入根资产识别的回归检查；正式构建与相关测试完成后，仍需部署到游戏，在城市存档中验证 OBJ/FBX 导入、原生注册和模型查询/工具选择。旧版本的编辑器验收记录不代表城市模式已经实测。

### 1.30.0 城市实测与 1.30.1 修复

2026-10-26，在城市存档“卡尼斯托塔”（Game 模式）中，OBJ 和 FBX 示例均完成原生导入，每个输出 18 顶点、18 索引，原生包围盒就绪。OBJ 已通过 select_imported_model 选入 Object Tool，尺寸 8×8×8 米、建设费用 500，未放置永久地图对象；模拟速度已恢复原值 4。模型列表查询遇到空 prefab/资产元数据时发生空引用；1.30.1 增加 prefab 空值检查并直接使用资产路径，尚待部署复验列表及重载发现。证据：artifacts/asset-import-1.30.0/city-acceptance.json。

### 1.30.1 城市重载验收

2026-10-26，已部署 1.30.1 并在城市存档重载后通过 MCP 验证：模型列表返回 6 个本地根资产，先前在城市中导入的 OBJ/FBX 两个示例均以本次会话的新实体 ID 被重新发现，原生几何边界和 PlaceableObject 配置就绪，尺寸均为 8×8×8 米、建设费用 500。FBX 已成功选入 Object Tool，未放置永久对象，模拟速度恢复原值 1。旧测试资产保留，旧版无放置配置或零边界的条目如实标记为未就绪；未自动修改或重新导入。构建零警告/错误，16 项相关测试通过。证据：artifacts/asset-import-1.30.1/acceptance.json。此验收覆盖示例文件导入、资产保存重载和原生工具选择，不代表所有外部模型均显示正确，也不代表通用 building 几何已具备住宅或服务建筑行为。

### 1.30.2 广告牌实测与 1.30.3 格式保护

1.30.2 城市内带 UI/无 UI 截图均返回图像，可读到真实游戏错误。sale.png 用于 BillboardWallHuge02 - CheapAndRandom 时，引用回读成功后出现 ManagedBatchSystem 初始化失败；Player.log 明确记录 Texture format 87 不支持 Sample，生成文件头也记录 0x57。原 Surface 已恢复并回读一致，因此本次替换判定失败。1.30.3 将解码后的像素显式复制到 RGBA32 纹理，并在绑定前检查所有生成贴图的 GPU 格式支持及 TextureAsset.Load(0)；结果新增 gpu_load_verified。构建和相关 16 项测试通过，待部署实测，不能以引用回读替代渲染验收。证据：artifacts/sale-replacement-1.30.2/acceptance.json。

### 1.30.3 sale.png 实机复验

在城市 396 矢车菊街上部 BillboardWallHuge02 - CheapAndRandom 的槽 1 替换 sale.png 成功；gpu_load_verified=true，引用回读通过，带 UI 和无 UI 截图均可核对促销图。日志未复现 format 87/ManagedBatchSystem 初始化错误，模拟速度恢复原值 1。原广告网格 UV 裁切图片，红底与 80% 可见但 SALE 未完整显示；本次未改 UV 或制作适配图集，不能表述为完整海报适配。证据：artifacts/sale-replacement-1.30.3/acceptance.json。

### UV 广告图适配（1.30.4）

preview_texture_replacement 可选 fit_to_surface=true，仅用于 _BaseColorMap。预览从选中材质槽的真实三角形读取 UV0 范围及位置导数，计算广告面的实际宽高比；返回 uv_bounds、panel_aspect、uv_content_bounds。应用时重查几何和 UV，将整张输入图等比例烘焙到可见 UV 矩形内，空余处为不透明黑色留边，不改源图片、网格或其他贴图的 UV。输出是独立会话纹理，继续使用 GPU 加载检查。

适配要求选定槽覆盖一个无重叠的单位 UV 矩形，UV 轴正交且缩放一致；跨 tile、无有效 UV、不可读几何、UV 重叠会被拒绝；LOD RenderPrefab 是独立目标，需分别发现和适配。自动适配针对使用 UV0 的广告材质，不推断自定义 shader 的额外 UV 变换。仍须检查游戏画面，不能仅以烘焙或引用回读认定完整显示。正式构建和纯适配数学/桥接参数回归检查完成后，待部署验证当前广告牌。

### 1.30.4 实测与 1.30.5 材质槽映射修复

目标广告牌在 UV 预览阶段被拒绝，尚未绑定新材质。游戏 RenderPrefab 将多个 Mesh 的子网格材质槽展平成全局序号；1.30.4 错把 surface_index 当作每个 Mesh 的本地下标。1.30.5 改用游戏原生 ObtainMesh(materialIndex, out subMeshIndex) 解析对应网格与本地下标，完成后 ReleaseMeshes；不将多个 Mesh 误认为独立 LOD。正式构建零警告/错误，16 项相关回归测试通过，目标广告牌 UV 和完整海报仍待部署实测。证据：artifacts/sale-uv-fit-1.30.4/acceptance.json。

### 1.30.5 UV 比例实测与 1.30.6 逐三角形投影

1.30.5 已找到正确材质子网格，但各三角形 UV 比例不一致，旧版矩形适配检查在预览阶段拒绝，未绑定新材质。1.30.6 不再要求整槽 UV 比例一致：通过最大有效三角形识别主展示平面，选取共面且朝向相同的三角形，要求其物理投影覆盖矩形；完整海报按物理宽高比等比例留边，然后逐 UV 三角形重心插值反查物理投影位置并烘焙。uv_bounds 为被选展示面的 UV 总包围框，panel_content_bounds 是物理展示面归一化坐标中的内容范围，uv_triangle_count 是参与烘焙的三角形数。

预览先完成实际烘焙，拒绝超出单位 tile、过大工作量、冲突 UV 重叠或非矩形主展示面；应用前重新验证几何投影数据。测试覆盖不同比例的分离 UV 岛、镜像绕序、恒等映射、留边和冲突重叠，不以测试代替当前广告牌实测。旧版“UV 比例必须一致”的约束自此取消。非主展示面使用黑色背景，LOD RenderPrefab 仍需分别处理；自定义 shader 的其他 UV 变换不自动推断。

### 1.30.6 当前广告牌 UV 实机验收

2026-10-26 在 396 矢车菊街上部 BillboardWallHuge02 - CheapAndRandom 完成 sale.png 的 UV 适配。主展示面由 2 个三角形组成，UV 范围约 U=[0.0110,0.8853]、V=[0.5801,0.9897]，实际宽高比 2.133。海报等比例放入面板横向 [0.0800,0.9200]，两侧留边。原生 GPU 加载和材质引用回读通过，带 UI/无 UI 游戏截图均显示完整的“80% SALE”，日志未出现之前的纹理格式/批次初始化空引用错误。模拟速度恢复原值 1。证据：artifacts/sale-uv-fit-1.30.6/acceptance.json。覆盖仍为共享网格材质的会话级覆盖，重载会恢复原图。

## 模型导出（1.31.0，实机验证待部署）

`export_model` 支持城市和地图编辑器中已加载的车辆、建筑、静态物件及 RenderPrefab。
先暂停模拟并返回默认选择工具；通过已有查询取得精确的 `prefab`、`prefab_id` 或实例 `entity_id`。
实例仅用于定位预制体，导出的是静态预制体姿态，不是当前车辆动画或实例涂装。

```json
{
  "request_id": "vehicle-export-001",
  "entity_id": "从当前会话查询取得的实体 ID",
  "output_directory": "D:/Exports",
  "include_textures": true
}
```

`output_directory` 必须是游戏主机上已存在的绝对本地目录，不允许符号链接或目录联接。
工具返回 operation_id 后，用 `get_model_export_operation` 轮询；同一 request_id 重试返回原记录，参数不同则拒绝。
导出创建唯一 `CityWeaver_<operation_id>` 子目录，不覆盖已有文件，不改动城市或原始游戏资产。

输出：
- `model.obj`：米制、Y 向上、右手坐标；翻转 Z 与三角形绕序，保留 UV0/法线，烘焙部件位置和旋转。
- `model.mtl`：材质分组与基础颜色贴图关联。
- `part_XXX_tex_YY.png`：可读取的原生 2D 贴图（含可恢复的虚拟纹理）；属性名对应关系在清单中。
- `manifest.json`：预制体、部件、状态条件、文件 SHA256、警告和限制。

`completed_with_warnings` 表示几何已导出但部分贴图未导出，必须检查 warnings。
`failed` / `interrupted` 保留已有部分文件；不能把这些文件当作完整成功的模型。
导出过程中切换地图、恢复模拟或启用其他工具会终止导出。轮询本身可在主菜单读取本会话日志。

边界：不导出骨骼/动画、行驶逻辑、拖车或放置的子物件；所有声明的状态网格都输出，损坏等变体可能重叠，按清单自行选择。
暂不导出道路程序化几何或 FBX。法线/遮罩的通道编码、玻璃/发光及游戏 shader 不自动转换为通用材质。
最多 128 个原生部件、256 个材质组、256 张贴图、累计 200 万输出顶点；单贴图最多 16MP；OBJ 最多 256MiB，总输出最多 512MiB。

### 1.31.0 实机结果与 1.31.1 修复

城市模式 TrainOilCar01 已导出并验证 5,850 顶点、4,890 三角形、UV/法线索引和文件 SHA256。原版车辆的贴图保存在内嵌 VTSurface，1.31.0 返回明确缺失警告。1.31.1 补充通过原生 VTSurfaceDataHandler 在私有临时材质中重建这些贴图，不绑定或卸载渲染器共享材质；生成纹理在 PNG 读取后释放。正式构建和 17 项回归测试通过，内嵌贴图实机验证待部署。

1.31.1 实机验收通过：TrainOilCar01 导出状态 completed，零警告；5,850 顶点、4,890 三角形，UV/法线索引和文件哈希有效；BaseColorMap、ControlMask、MaskMap、NormalMap 四张 4096×4096 RGBA PNG 均完整解码，基础色贴图人工检查可见车体和危险品标志。证据 artifacts/model-export-1.31.1-live/validation.json。已恢复测试前正常模拟速度。此结果验证石油车厢样本，不代表所有资产和 shader 的兼容性。

车辆导入替换、车轮/动画/灯光映射及恢复流程见 [车辆外观替换指南](VEHICLE-MODEL-REPLACEMENT-GUIDE.md)。
