# Mi-26 跟随线路颜色 1.36.49

用户要求直升机跟随线路颜色。当前两个车型 CityWeaver Passenger Helicopter、HelicopterPassenger01 的 Mi-26 均为 source 色彩模式，无 ColorProperties。已读取模型配置、六个材质及原始机身贴图：主要橙色涂装，白色条纹与标识、深色玻璃、单独旋翼材质。

旧 route_color 仅支持中性色筛选，不能直接选择橙色机身。新增可选色相筛选及私有基础颜色去色：保留涂装亮度细节，只让目标橙色像素参与原生 Brand/CurrentRoute 通道。槽 0/1/2 参与，玻璃 3 和旋翼 4/5 使用零遮罩。配置 assets_game_import/mi26-replacement-v6-route-color.json。单操作像素上限增至 64M，以容纳三张 4096x4096 涂装遮罩，单图仍限 16M。

正式构建零警告、零错误；4 项测试通过，包括色相环绕、橙色深浅、白灰红黄蓝/透明/暗色排除、非法输入、去色边界及现有车辆模型/存档回归。源文件不改写，尚未替换城市中正在运行的直升机，待部署后实测。

部署后流程：暂停并确认普通选择工具；读取两车型当前持久化 operation_id，分别恢复旧 override，等待 restored；按新配置 preview/apply 并等 completed，核对旋翼三骨骼、60 人容量、线路车型引用与原政策。两种以上线路颜色截图验证；临时改变一条线路颜色再恢复其原色，确认实例动态更新。保存城市后验证重载持久化。当前基线 artifacts/mi26-route-before-1.36.49.json（operation_id 随重载变化，必须重新读取）。

1.36.49 部署完成：确认游戏关闭；备份 D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.49-20261028-080751；六个安装文件 SHA256 匹配，安装版本 1.36.49.0。待加载后应用两车型线路调色配置与实机验证。

## 1.36.49 实机预览与 1.36.50 修复

Session 8f1b71ba1cf7486e921e7b7994ca92d8。已暂停，恢复自有直升机旧 override 后尝试新 route 配置。预览被 Material shader does not expose _ControlMask 拒绝（未应用颜色）：原代码对未选择的玻璃材质也要求该通道。

1.36.50 对没有 _ControlMask 的未选材质保留原样；被明确选中的不支持材质仍拒绝，其他支持通道但未选的材质继续写零遮罩。新增纯规则测试覆盖四种选择/通道组合，4 项相关测试通过，正式构建零警告、零错误。

自有直升机已用原 mi26-replacement-v6-small.json 恢复 Mi-26 原色，operation c53ae94791694bc08a43ce477b9197cc completed 且 route_references_synchronized=true；HelicopterPassenger01 的旧覆盖未改。五条线路均 ready，数量仍 1/1/1/1/2，游戏保持暂停。未修改任何线路颜色。待关闭游戏部署 1.36.50 后重新读取 operation_id 并复验。

证据：artifacts/mi26-color-preview-own-1.36.49.json、mi26-source-recover-result-1.36.49.json、mi26-color-lines-recovered-1.36.49.json；构建/测试日志 artifacts/build-1.36.50.log、tests-1.36.50.log。

1.36.50 部署完成：确认游戏关闭；备份 D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.50-20261028-082136；六个安装文件 SHA256 匹配，安装版本 1.36.50.0。待加载后继续应用并验证线路颜色。

## 1.36.50 实机发现实例颜色组件缺失，1.36.51 补修

Session f17533a840f041c7b085f48cb896aac3。两种车型 route 配置预览/应用 completed，选择涂装像素 28,418,052，骨骼 3、材质 6、60 人容量及路线引用同步通过。但临时将线路 2 从 (242,137,51) 改为 (45,160,75) 后，画面机身为灰白，未随线变绿。实体 160030:1 有 CurrentRoute 却没有 Game.Rendering.MeshColor，原生 MeshColorSystem 不会为其计算外部颜色。不能将此次 completed 当作视觉成功。

1.36.51 在既有 McpVehicleRouteReferenceSystem 中登记带 ColorProperties 的替换车型：确保未来实例 ObjectData archetype 有 MeshColor/CustomMeshColor；对匹配车型的现有缺失实例补齐缓冲，并标记 BatchesUpdated 让原生 MeshColorSystem 初始化。保留原生 CurrentRoute/Brand 颜色计算，不手写车辆颜色。Verified 增加颜色实例迁移检查，仍有缺失实例时不报告 completed。

正式构建零警告、零错误，5 项相关回归通过。未实机验证新补迁移。

现场已恢复：线路 2 原色 (242,137,51,255)；两个车型均恢复 mi26-replacement-v6-small.json 的源涂装并完成路线引用同步。五条线路仍 ready，游戏暂停。没有保存城市。恢复证据 artifacts/mi26-recovered-own-1.36.50.json、mi26-recovered-stock-1.36.50.json、mi26-lines-recovered-1.36.50.json；问题证据 mi26-green-meshcolor-1.36.50.json、mi26-route-green-1.36.50.png。

1.36.51 部署完成：确认游戏关闭；备份 D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.51-20261028-083617；六个安装文件 SHA256 匹配，安装版本 1.36.51.0。待加载后验证现有直升机颜色组件与线路调色。

## 1.36.51 实机验证通过，待保存重载

Session 2a990c287ca54404a8bd94d4be0a920e。两种车型均完成 route 配置替换，operation c1e5370372d042af980e0561a2af794b / 400ddefce4d94d2c81967a56f83cb2bc，路线引用同步通过。四架现有车辆均有 MeshColor：线路 1/3 蓝色 (51,166,242)，线路 2 两架为对应线路色。暂停时将线路 2 暂改 (45,160,75)，两实例颜色组件同步变化，画面确认为绿色；恢复 (242,137,51) 后画面恢复橙色。蓝色线路 1 的地面停靠画面也已确认。线路 3 仅组件读回验证，本轮未单独截取近景。

证据 artifacts/mi26-blue-1.36.51.png、mi26-green-1.36.51.png、mi26-orange-restored-1.36.51.png、mi26-green-components-1.36.51.json、mi26-final-1.36.51.json。两车型持久化登记成功、旋翼三骨骼配置保留、60 人容量、五条线路 ready，车辆数和线路颜色与本轮基线一致。模组日志无新增错误。游戏保持暂停，未代用户保存；下一步用户保存并重载，验证配色覆盖自动恢复。

## 1.36.51 保存重载验证通过

用户保存并重新载入，session 已变为 f3340794e59242f2aeea8ae3d12fa16d。未重新应用任何替换，两种车型自动恢复 route 配色，新的恢复 operation 为 d7d87f6a79484df19801fdcf65e01e11 / d8c1e2117b5d47b49a9dd63d0964f4c7，persistence.error 均为空。四架现有直升机 MeshColor 与各自 CurrentRoute 颜色一致：1/3 号线蓝色，2 号线两架橙色。当前机场画面确认 Mi-26 橙色外观自动恢复。五条线路全部 ready，数量保持 1/1/1/1/2；60 人容量和主旋翼/尾桨骨骼配置保留。证据 artifacts/mi26-reload-1.36.51.json、mi26-reload-view-1.36.51.png。本轮未更改模拟速度、线路颜色或车辆配置。线路配色及保存重载闭环完成。

## 1.36.55 旋翼跟随线路颜色（待部署）

用户指出主旋翼未随线路改变颜色。此前 route 配置只选择机身槽0/1/2，槽4/5旋翼写零遮罩，属于此前明确保留原色的范围；旋翼贴图为浅灰/米白，不能直接复用机身橙色色相筛选。

增加可选 neutral_surface_indices：必须是 surface_indices 的有效无重复子集，在 hue 模式中指定这些材质使用原有亮度/低饱和度筛选。对明确指定的中性色材质也生成去色私有基础贴图，避免原米白底色影响线路色。旧配置未指定该字段时行为保持。Mi-26 配置改为选择0/1/2/4/5，其中4/5按中性色筛选，maximum_saturation=.35；玻璃槽3仍不改，深色和透明像素排除。单图16M上限不变，总预算从64M增到96M，以容纳5张4096平方纹理（80M）；新贴图仅用于私有替换，不覆盖源素材。

正式构建零警告、零错误，5项相关回归测试通过，新增材质子集/重复/未选择槽拒绝及米白桨叶筛选检查。尚未部署或重新应用两种车型配置，当前城市外观未改变。部署后须读取当前两车型 operation_id，依次恢复旧覆盖、preview/apply新配置、轮询完成，再验证不同线路主旋翼/尾桨颜色、旋转和保存重载。证据 artifacts/build-1.36.55.log、tests-1.36.55.log。

1.36.55 已部署。确认游戏关闭，备份至 D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.55-20261028-091722；六个安装文件 SHA256 与暂存包一致，安装版本 1.36.55.0。待加载后重新应用两种车型配色配置并验证主旋翼、尾桨。

## 1.36.55 实机失败与 1.36.56 UV 补修

55版两车型预览和应用 completed，56,181,280像素，画面主旋翼仍灰白。进一步核对真实源OBJ face group/usemtl发现：rotor_top和rotor_bck在Part01（槽0），Part05/06（槽4/5）实际是interior。此前按槽号推断旋翼材质错误，不能将55版应用完成当作效果通过。截图 artifacts/mi26-rotors-blue-1.36.55.png。

已恢复两车型原机身配色（mi26-replacement-v6-body-route-color.json），恢复操作均completed、路线同步true；五条线路ready，线路原色未改，游戏暂停。原始模型和旋翼动画未修改。

56版新增 route_color.neutral_uv_regions：每个区域指定唯一已选材质槽以及0..1 UV三角形（最多10000），像素中心三角形栅格化得到遮罩，与原机身色相选择取并集。只在指定UV中增加灰白低饱和度配色，保留原机身橙色选择和去色逻辑。Mi-26 从源OBJ rotor_top/rotor_bck面组提取6516三角形（478918字节配置），槽0/1/2，玻璃与内饰均不选择。单图与总预算仍有界。

正式构建零警告、零错误，5项回归测试通过，增加UV三角形内部/外部、绕序、非法坐标/长度检查。尚未实机验证UV位置与实际桨叶颜色。待退出部署56后重新应用两车型，必须目视验证，不可只以completed判断成功。证据 build-1.36.56.log、tests-1.36.56.log、mi26-recovered-own/stock-1.36.55.json、mi26-recovered-lines-1.36.55.json。

1.36.56 已部署。确认游戏关闭，备份至 D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.56-20261028-092456；六个安装文件 SHA256 与暂存包一致，安装版本 1.36.56.0。待加载后重新应用两种车型配色配置并目视验证旋翼 UV。

## 1.36.56 实机旋翼配色通过，待保存重载

当前会话 cb5acbf76e5043c9baf78e92fd6a93bc，两车型已应用6516 UV三角形配置，操作2aaf64197df7451abac2780308692d58与8cc13c4e32b449b0a9fd8b5ba0319640。东侧独立停机坪实拍确认主旋翼、尾桨均为橙色；临时将2号线改为RGB(45,160,75)，同一架飞机的机身、主旋翼、尾桨同步变绿，随后在finally恢复RGB(242,137,51)。证据 artifacts/mi26-orange-1.36.56.png、mi26-green-1.36.56.png、mi26-live-1.36.56.json。游戏保持暂停。本轮验证的是颜色更新，未重新验证飞行动画。新UV配置保存重载仍待用户保存并重新加载。

## 1.36.56 保存重载验证通过

用户保存重载后会话变为8f5c7c1ade74404899bae12d3a777907。未重新应用替换，两车型自动恢复操作c383bb1ae05543579d2f6bf8e346524b、08fd9b7761d54e5f985ce4b21420ff1f均completed，saved_in_city=true，error=null，路线同步true。两者均恢复28966390配色像素和3骨骼，包含新的旋翼UV遮罩；五条线路ready，原线路色与车辆数保持。实拍蓝色Mi-26机身与主旋翼已自动恢复线路色，尾桨保留暗色部分。为截图短暂暂停后恢复原正常速度。证据artifacts/mi26-reload-1.36.56.json、mi26-reload-view-1.36.56.png。本轮未修改配色、线路或模型配置。
