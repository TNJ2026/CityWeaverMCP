# MCP 建筑规划与操作（能力引入 MCP 1.1.0）

垃圾填埋场储存区、专门产业采集区等随建筑扩展的多边形区域不属于普通建筑放置或行政区。使用 `list_building_areas` 和统一 `preview_building_area` 事务，完整流程见 [建筑附属区域指南](BUILDING-AREA-GUIDE.md)。

建筑功能使用游戏 `ToolOutputSystem` 的原生临时实体、错误组件和提交屏障。所有修改都采用预览、检查费用、提交、轮询的流程；只有 `completed` 表示永久实体已经验证。

## 统一高层建筑工作流（能力引入 MCP 1.21.0）

普通建筑、市政服务、公共交通设施和公用设施现在可共用四个 MCP 高层工具。它们由 MCP 进程编排现有原生事务，不是新的游戏内命令：

- `plan_building_workflow`：用精确 `building_prefab` 和目标附近坐标发现所属领域，生成候选，跳过近似碰撞，依次执行原生预览直到一个候选进入 `preview_ready`，并按 `consider_service_coverage` 附上可用的服务、教育、娱乐、标志性建筑或交通影响分析。关闭该选项可减少一次候选分析查询；它只保留临时预览，不永久施工。
- `execute_building_plan`：用返回的 `plan_id` 和明确的 `max_cost` 提交，轮询到 `completed`，再用永久实体 ID 回读结果。默认恢复执行前模拟速度。
- `cancel_building_plan`：取消尚未提交的临时预览。
- `deploy_building_plans`：一次接收 1–32 项，每项串行完成规划、提交和回读；支持单项费用、每栋默认费用、总费用和遇错是否继续。

`category=auto` 会跨 `building`、`city_service`、`transport_facility`、`utility_facility` 精确匹配已解锁 prefab。若同名 prefab 同时存在于多个专用领域，应显式指定 `category`。`near` 是搜索中心而非强制落点；`search_radius_m`、`candidate_count` 和 `max_preview_attempts` 控制回退范围。对可升级的沿街地面建筑，可用 `reserve_upgrade_prefabs` 指定兼容升级，选址碰撞会按扩展后的预留占地计算。特殊的岸线、水面、道路边缘和道路节点建筑会自动切换到特殊规划/预览工具，也可用 `mode` 明确指定；特殊放置模式暂不做升级占地预留，最终由升级原生预览判定。

计划绑定当前城市会话并只存于 MCP 进程内；MCP 重启、换存档或约五分钟原生预览过期后必须重新规划。对同一逻辑重试必须复用同一 `request_id` 和参数。规划阶段会暂时暂停并恢复模拟；只读 prefab 发现可并行，但所有原生预览与提交严格串行，以避免游戏工具事务冲突。

示例顺序：先调用 `plan_building_workflow`，检查返回的 `candidate`、`impact`、`cost`、`warnings` 和 `expires_at_utc`；认可后将 `plan_id` 传给 `execute_building_plan`。用户已经明确要求直接建造多个设施时，可直接使用 `deploy_building_plans`，无需人为重复这两次调用。

Agent 使用高层流程时还应遵守以下边界：

- 只讨论或诊断选址时不提交计划；不再施工时调用 `cancel_building_plan`。需要保留计划供后续确认时，明确其约五分钟有效期，长时间分析后应取消并在执行前重新规划。
- `deploy_building_plans` 默认在首个失败后停止；`continue_on_error=true` 只会继续后续项目，已经完成的建筑不会因后续失败自动回滚。以 `completed_count`、`total_cost` 和每项状态为准。
- 服务设施的覆盖、教育、吸引力或交通分析都是候选比较代理，不等于游戏寻路、容量或长期模拟效果。
- 车站、机场、港口等不会自动建设缺失轨道或航线；电力、供水、污水和通信设施也不会自动铺设外部管网。遇到明确的前置网络错误时，先补齐网络再用新规划请求重试。

## 查询与规划

- `list_building_prefabs`：列出建筑或服务升级 prefab，包含精确名称、锁定状态、造价、占地格、物理尺寸、道路/通行需求、可用接入侧和完整放置类型。`kind=building` 与 `kind=upgrade` 严格分离，升级模块不会被误当成独立建筑放置。
- `list_building_upgrades`：输入一个永久主体建筑 ID，返回所有兼容升级、安装费用、锁定状态、能否重复安装、当前安装数量及已安装实体。对可移动升级还返回原生 `placement_geometry`：高亮范围、四角范围校验轮廓、主体四侧吸附段和合法 `placement_offset_m`；原生允许长距离放置时还包含范围内的 `road_side_candidates`。
- `get_building_state`：读取建筑自定义名称、启用状态、是否支持开关，以及当前原生建筑政策。
- `plan_building_site`：只为同时带 `RoadSide` 和 `OnGround` 放置规则的建筑，沿允许分区/沿街接入的地面道路生成候选位置。它读取道路实际宽度和表面标高，过滤高速公路、超过 15% 的道路坡度、道路与地形高差超过 2 米、建筑占地高差超过 3 米的地点，并返回各类拒绝数量。岸线、水面、道路节点和道路边缘等特殊建筑应根据 `placement` 字段选择精确坐标，再交给原生预览校验。
- `plan_building_row`：在 1–64 条指定道路的一侧或两侧规划最多 32 栋同类建筑。间距使用 prefab 的完整物理尺寸和占地尺寸，碰撞使用带旋转的矩形分离轴检测；每块地基采样 3×3 个地形点，并计算道路表面目标高度、地形高差、入口距离和入口朝向误差。
- `plan_special_building_site`：为 `Shoreline`、`Floating`、`RoadEdge` 和 `RoadNode` 建筑规划候选。`auto` 会按 prefab 的放置标志选择模式。道路边缘/节点模式搜索全部永久网络边或节点，并返回网络 prefab 与原生吸附目标；边缘模式按建筑物理长度避开边端点。需要道路的岸线建筑同时检查可接入道路、道路/地形高差、建筑外缘水深和水面高度。纯水面建筑直接读取实时水面高度与水深。
- 规划结果属于快速空间筛选，最终道路接入、地形、碰撞、唯一建筑和升级兼容性由预览时的游戏原生校验决定。

### 建成区选址注意

- 宽体公共设施优先选择远离交叉口的长直路段。候选距路口过近或侵入道路基础时，按候选顺序有限回退，不在同一点重复提交。
- 已完全长满建筑的高密街区通常没有足够沿街净空。优先检查外围干道、片区连接线或其他开阔地，不因内部无位置就自动拆除现有建筑。
- 停车场等地面设施可能带有超出主体轮廓的贴花或子对象；曲线道路和路口附近即使主体包围盒看似可放，仍可能被原生预览拒绝。最终结果以游戏碰撞校验为准。
- 规划未来升级时使用 `reserve_upgrade_prefabs` 扩大预留占地。特殊岸线、水面、道路边缘或节点建筑仍须在升级时通过原生预览。

`list_road_prefabs` 的 `zoning_enabled` 可用于选择能够布置沿街建筑的道路；`uses_highway_rules` 标记高速规则。地图整体升降地形后，如果旧道路没有同步升降，规划器会将其报告为 `elevated_or_sunken_edges`，不会把建筑放在与道路断开的高度。

## 可执行操作

- `preview_building_placement`：放置建筑。
- `preview_special_building_placement`：接收特殊选址候选的三维位置、旋转和可选 `snap_target_id`，把道路边、轨道边、航线边或网络节点作为游戏原生吸附目标。水面建筑保留规划器给出的水面 Y 坐标。
- `preview_building_batch_placement`：接收 `plan_building_row` 的结果，最多批量放置 32 栋同类建筑。它会重新检查入口距道路误差不超过 1 米、朝向误差不超过 2 度、道路与地形高度、地基高差和批次内碰撞，然后在一个 MCP operation 内逐栋执行原生预检；全部通过后才允许提交，提交时逐栋应用并返回每个永久建筑实体 ID。
- `preview_building_move`：移动并旋转已有建筑。普通地面建筑可只传 `x/z` 并由游戏读取地形高度；浮水、岸线、道路边缘和节点建筑可传规划器返回的 `x/y/z`，并用 `snap_target_id` 绑定道路、轨道、航线边或网络节点。
- `preview_building_replacement`：在一次原生提交中拆除旧建筑并在原位置放置新 prefab。
- `preview_building_upgrade`：给服务建筑安装兼容升级模块。`placement_mode=owner_side` 使用升级列表返回的主体侧吸附点及 `placement_side`/`placement_offset_m`；`placement_mode=road_side` 必须原样使用 `road_side_candidates` 的 `position`、`rotation_degrees` 和 `road_edge_id`。道路可以位于主体与模块之间，但模块不得覆盖道路，且候选仍须经过原生碰撞、地形与净空预览。
- `preview_building_rebuild`：修复已摧毁建筑。
- `preview_building_demolition`：拆除建筑。
- `preview_building_upgrade_removal`：移除已安装的服务升级实体。
- `set_building_name`：通过游戏 `NameSystem` 设置自定义名称；空名称恢复游戏生成名称。
- `set_building_active`：通过游戏建筑政策系统启用或停用具有效率数据的服务建筑，并可用 `get_building_state` 验证下一帧结果。
- `list_building_policies`：按游戏原生适用性规则列出建筑可执行政策、锁定状态、当前状态和滑块范围；包括游戏通过独立控件执行但从通用政策列表隐藏的停用政策。
- `set_building_policy`：按政策名或 `inactive`、`paid_parking`、`empty` 选项启停或调整建筑政策。

移动、替换、升级、重建和普通拆除只接受顶层主体建筑；升级移除只接受 `ServiceUpgrade` 实体。安装升级前会使用 `ServiceUpgradeBuilding` 兼容表校验主体 prefab，并提前阻止禁止重复的升级再次安装。重建只接受带 `Destroyed` 状态的建筑。

每个预览返回 `operation_id`。轮询 `get_building_operation` 到 `preview_ready`，确认 `cost` 和 `errors` 后调用 `apply_building_operation`，其中 `max_cost` 是本次允许的费用上限。提交后继续轮询，不能用新请求盲目重试。未提交预览可用 `cancel_building_preview` 清理。

城市必须暂停并处于默认选择工具。请求 ID 在同一城市会话中幂等，预览五分钟后过期，实体 ID 在重新加载城市后失效。

## 真实验证

在游戏 1.6.0f1 的空城存档中，已通过 MCP 和游戏原生工具管线完成以下闭环：

- 在贴地 `Medium Road` 旁规划并放置 `MedicalClinic01`，原生校验通过，费用为 60000。
- 查询到两个兼容升级，安装 `MedicalClinic01 Extension Wing` 后，主体建筑的已安装升级数量从 0 变为 1；移除后恢复为 0。
- 将诊所移到道路另一侧并重新绑定目标道路，实体位置和道路接入都由提交后的永久实体确认。
- 将 `MedicalClinic01` 原位替换为 `MedicalClinic02`，再拆除替换结果；最终建筑实例计数恢复为 0。
- 不兼容升级、非主体建筑目标、非升级实体移除和非摧毁建筑重建，会在进入原生预览前返回明确错误。
- 在两段共 400 米的 `Medium Road` 上规划两栋 `MedicalClinic02`，逐栋原生预检后一次授权提交成功，费用 60000，返回两个不同永久实体，城市建筑计数由 0 变为 2。
- 将一个测试地基中心从约 522 米抬到约 524 米，规划器报告 2.018 米地形高差并标记 `foundation_leveling_required=true`；建筑原生提交成功后，该点回到 522.008 米，道路点保持约 521.758 米，证明 prefab 自带的原生地基整平随建筑提交生效。
- 将批量位置从计算出的道路正面偏移后，预览前返回 `BUILDING_ENTRANCE_MISALIGNED`，未生成临时建筑。
- 特殊选址已在当前存档读取 10 条永久网络边，并为 `SubwayStationElevated01` 返回带网络 prefab、边参数和至少 77.8 米端点净距的候选；把候选交给原生预览后，游戏明确返回 `Highway Twoway - 4 lanes` 与地铁站虚拟桥墩冲突，证明错误网络类型不会被提交。
- 在原生含海洋和岛屿的“丝带群岛”地图中，岸线规划器按建筑外缘探测实时水深并把建筑入口朝向陆地；`SewageOutlet01` 在外缘水深 2.028 米、地面与水面高差 0.241 米的候选点完成永久提交，费用 25000。
- 同一地图的浮水规划器为 `WindTurbine02` 找到水深 7.036 米的候选点，保留实时水面 Y 坐标后原生预览和永久提交均成功，费用 17000。
- 为需要道路的岸线 `WaterPumpingStation01` 新建一段贴地 `Medium Road` 后，联合规划器自动生成带道路吸附目标的候选；外缘水深 4.165 米，原生预览和永久提交成功，费用 25000。规划器会对重合的道路采样参数去重。
- 特殊建筑移动接口接受实时水面 Y 坐标和通用网络吸附目标，因此岸线、浮水、道路边缘和节点建筑可以沿用特殊规划候选完成原生移动，而不会被强制落到水底地形。
- `WindTurbine02` 已完成浮水位置永久放置、移动至另一实时水面候选以及永久拆除；移动后主体实体 ID 保持不变，拆除退款 12750。
- `WaterPumpingStation01` 已通过 `NameSystem` 设置“北岸一号抽水站”并清除回自动名称；停用后读回 `active=false` 和 `Out of Service`，重新启用后政策移除并恢复 `active=true`。
- 通用建筑政策已覆盖全部三种原生 `BuildingOption`：抽水站的 `inactive`、`ParkingLot05` 的 `paid_parking` 和 `Landfill01` 的 `empty`。停车收费滑块从默认 10 调到 25 后读回 25，再恢复 10；越界值 51 返回 `INVALID_ARGUMENT`。填埋场清空政策已完成开启、读回和关闭闭环。
- 游戏当前全部已解锁建筑 prefab 中只有 `FerryStop02` 和 `SubwayStationElevated01` 使用 `RoadEdge`，没有任何 prefab 使用 `RoadNode`。测试地图没有已建渡轮航线或地铁轨道，因此道路边缘模式目前覆盖了候选生成、端点净距和错误网络原生拒绝；道路节点模式只能验证“无可用 stock prefab”的能力边界，不能伪造永久成功结果。

`preview_building_rebuild` 已接入游戏原生修复路径，并严格要求目标带 `Destroyed` 状态。本次空城没有自然灾害产生的摧毁建筑，因此没有人为伪造 `Destroyed` 组件做结果验证。
