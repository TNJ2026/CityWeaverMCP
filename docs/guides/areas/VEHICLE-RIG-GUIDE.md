# OBJ 刚性车轮与车门骨骼（1.34.0）

## 1.35.1 公交车门修复（待实机验收）

用户确认 1.35.0 线路配色正常，但到站没有开门。本地导入 Prefab 文件包含四扇门配置；原生 PrefabBase.Clone 使用 JsonUtility，克隆自定义 VehicleDoorProperties 时遗漏 m_Doors，仅剩 active 字段。替换流程现显式深拷贝每扇门配置，指纹与查询也改用显式字段序列化，并核验控制器注册。

另一个独立问题：本游戏版本中 TransformFlags.BoardingLeft/Right 由 TrainMoveSystem 写入，CarMoveSystem 不写入这组标志。公交改为读取 PublicTransport.Boarding 与 StopLeft/StopRight；必须处于上下客状态才开门。若停下后原生清除了左右标志，只在 Target→Connected 指向的站点 BoardingVehicle 确实等于当前车辆时，以站点相对车身的横向位置判断停靠侧。位置缺失、近中心线、距离超过 100 米或左右标志冲突时保持关门，不猜测交通侧。其他车辆仍保留原生插值标志来源。

get_vehicle_animation_state 现在返回 door_controller_registered、boarding、door_signal_source、public_transport_state，以及各部件完整 door_configuration/door_count；旧插值标志单独列为 interpolated_boarding_left/right，便于区分配置、停站信号与骨骼分配问题。

23 项相关测试通过，正式构建零警告、零错误；仍需部署后比较真实停站期间门骨骼旋转、离站后的关闭，并目视验收。公交继续按原生逻辑运行，本修复不修改停站时间或要求司机等待车门关闭。

普通 OBJ 仍然是静态网格。模组新增可选 `cityweaver-rig.json`，将明确分组的顶点绑定到骨骼，并保存原生蒙皮几何和骨骼元数据。这是本模组的扩展约定，不是 OBJ 标准动画。FBX 原生骨骼/动画导入仍保留。

## 导入流程

1. `preview_model_import` 的 source_directory 指向包含 OBJ、贴图、`cityweaver-rig.json` 和 `settings.json` 的完整导入目录，preset 为 static_object。
2. `apply_asset_file_operation` 后读取完成结果和 `get_vehicle_model`，检查骨骼、轮心、材质和尺寸。
3. 创建车辆替换 JSON，使用新导入的 render_prefab，保留源骨骼配置（rig_mode: source）。导入本身不会替换运营车辆。
4. 通过已有 preview/apply_vehicle_replacement 流程替换选定车型后，车轮由原生插值系统驱动，门扇由模组在骨骼上传前更新。
5. `get_vehicle_animation_state {vehicle_id}` 读取运营车辆的速度、左右上下客标志和骨骼旋转。对比行驶中的多帧轮子姿态与停站前后门扇姿态，并查看画面。

仅有进入渲染范围并分配了骨骼缓冲区的车辆会更新动画。单独放置的 static_object 不具有线路/上下客行为，不会因放在地面上就开始开门或滚轮。

## 侧车文件

所有 OBJ 文件使用同一组骨骼。坐标为 **Unity 米制坐标**，独立于 OBJ 输入的 Z 轴反射。骨骼只支持平移静止姿态；父节点必须在子节点之前。一个根节点位于数组索引 0。每个 OBJ `g` 必须显式映射到一个骨骼；每个顶点只有一个权重 1 的骨骼。

```json
{
  "bones": [
    {"name":"Body","parent":-1,"position":[0,0,0],"type":"None"},
    {"name":"FrontRight","parent":0,"position":[1.1,0.5,3.0],"type":"SteeringTire"},
    {"name":"DoorRearLeaf","parent":0,"position":[1.2,1.6,4.7],"type":"None","door_side":"right","open_angle_degrees":-80,"duration_seconds":1}
  ],
  "groups":{"Body":"Body","Wheel":"FrontRight","Door":"DoorRearLeaf"}
}
```

模型必须提前分好活动部件，不能把跨越车身与门扇的三角形自动拉伸成门。当前导入后会复核骨骼绑定矩阵及权重；若原生管线重排不兼容或缺少蒙皮则拒绝完成导入，保留部分输出供检查。不要通过忽略校验强行应用。

## 状态与范围

车门读取游戏 InterpolatedTransform 的 BoardingLeft/BoardingRight。对应侧上下客且速度低于 0.2 m/s 才开启；离开该状态时关闭。暂停时保持当前位置。它不改变路线、停站计时、乘客或驾驶逻辑，也不强制车辆等待关门。

只处理明确通过车辆替换功能启用的车型，不修改原版车门或无关骨骼。1.36.36 起，验证完成的车辆替换配置随城市存档保存，载入后自动重建私有渲染、骨骼、车门控制与线路车型引用；恢复原车型会移除该城市的对应记录。导入的源资产仍须保留；单独的贴图/调色会话修改不包含在此保存机制中。旧存档没有替换记录，需要在升级后重新应用一次并保存。get_vehicle_model.persistence 返回保存意图、当前操作编号与恢复错误；saved_in_city 表示配置已登记到待保存的城市数据，并不表示用户已写入磁盘。缺失资产保留记录并报告错误，不猜测替代模型。

当前开发验收：原始几何计数与分组检查、离线开合姿态、纯逻辑测试及正式构建；原生带蒙皮导入、真实行驶轮转和停站开门须在部署后实机验证。

### 1.34.1 原生蒙皮兼容修正

1.34.0 的首次实机导入在蒙皮校验处被拒绝，未替换运营车型。GeometryAsset 不恢复普通 Unity Mesh 的 bindposes 数组，不能据此判定骨骼丢失。

1.34.1 使用原生 UInt32 单索引刚性蒙皮流，并从 ProceduralAnimationProperties 校验骨骼名称、父子关系、轮心和绑定矩阵；逐顶点检查原生索引范围。导入目录中的 settings.json 必须显式启用实际渲染组的骨骼组件，例如：

```json
{"createProceduralAnimationForPrefab":["VehicleBody01"]}
```

修正版仍须部署后复验原生导入和动画，不能将逻辑测试通过视为动画实机验收。

## 1.36.32 Mi-26 旋翼接入（待部署验证）

OBJ 刚性骨骼侧车新增 PoweredRotation，支持 rotation_degrees、speed、acceleration。旋翼必须为根骨骼直接子节点、转速非零且加速度为正；旋转轴由骨骼本地 Y 轴定义。静止绑定矩阵由完整父子 TRS 的逆矩阵生成，导入时验证轴向、层级、轴心及绑定矩阵。其他骨骼仍不接受非零旋转，保持车轮与车门约定。

`tools/prepare-mi26-rig.mjs` 生成 `assets_game_import/mi26-rig-v5`，从原始层级矩阵取得主旋翼和尾桨轴心。三根骨骼、六个材质文件、62265 个三角形；主旋翼 4242 个面、尾桨 2274 个面。机身与玻璃保留原 OBJ/UV，玻璃使用 DefaultGlass。主旋翼和尾桨使用原生 PoweredRotation；转速 10/20、加速度 1/2 为游戏动画参数，不作为真实 Mi-26 转速声称。

当前采用真实桨叶旋转，明确排除原始静态模糊盘，尚未实现高速模糊盘动态切换。正式构建零警告、零错误，6 项相关测试通过。尚未导入新版模型、替换运营直升机或完成蒙皮/飞行视觉验收；本轮不改变城市车辆。

1.36.32 实机：带骨骼 Mi-26 导入完成，3 根骨骼与 6 个材质通过原生校验。分别替换 CityWeaver Passenger Helicopter 和 HelicopterPassenger01，各影响 1 个实例，两个操作均 completed 且各同步 1 条线路车型引用。多帧骨骼采样确认主旋翼及尾桨旋转变化、机身骨骼保持不动；模组自有机型载 2 名乘客从远端站起飞，保持 EnRoute，容量仍为 15。停站及飞行截图已检查，未见静态模糊盘重叠。两条线路仍 service_ready=true、各 1 架。恢复正常模拟速度，未自动保存。完整往返及本次替换后的重载尚未验证；替换仍为会话级，动态模糊桨盘切换未实现。证据：artifacts/mi26-rig-1.36.32-verification.json、mi26-rig-parked.png、mi26-rig-running.png、mi26-rig-flight.png。


### 1.36.36 验证状态

正式构建与车辆保存生命周期、骨骼/动画、车门、线路引用及 Mi-26 相关测试通过。原生游戏存档写入、退出重载后自动恢复尚待部署实测。当前城市需重新应用 `assets_game_import/mi26-replacement-v6-small.json` 到 `CityWeaver Passenger Helicopter` 与 `HelicopterPassenger01`，确认完成后保存，再重载核对缩放、旋翼、60 人容量及线路运行。

1.36.36 实机存档重载通过：会话从 be4a13bfcc724a9c9283ebe47bf0a0bb 变为 ba0f7b4567ce4019bc2c89bec6ba4f39，两种直升机由 restore-save 自动操作恢复 v6-small Mi-26，均 completed、各同步一条线路引用，无人工重新应用。两架容量均为 60，四条线路 service_ready，主旋翼和尾桨多帧旋转变化，截图确认外观恢复。保留正常模拟速度。证据 artifacts/reload-1.36.36.json 与 artifacts/mi26-1.36.36-after-reload.png。本轮验证同一游戏进程内存档重载，完整退出游戏再启动尚未单独实测。
