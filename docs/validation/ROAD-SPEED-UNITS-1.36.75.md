# Road displayed speed correction 1.36.75

用户截图显示十二车道路面数字80，1.36.74接口返回160。重新回读CarLane仍44.4444，原验证误把模拟速度乘3.6当显示km/h。

实时证据：artifacts/sign-160-model.json中原生StaticObjectPrefab名为EU LaneMarkings Speed80，但artifacts/sign-prefabs.json对应TrafficSignData.m_SpeedLimit=160；标线选择由SecondaryObjectSystem依据车道默认速度乘3.6匹配。游戏显示速度应为模拟速度乘1.8，Prefab速度除2。没有修改原生标线数据或纹理。

1.36.75统一道路目录、车道回读、预览写入和交通标识回读的显示单位。十二车道Prefab=320，高速=400；一次性迁移旧120及各自旧默认160/200原生值，其他车道覆盖值保留。此前用户手动设置的覆盖值无法自动区分意图；不批量翻倍这些值。

提交车道限速后，以ChangedDistrict请求SecondaryObjectSystem重选装饰，避免Updated触发LaneSystem重建并覆盖单车道设置；原生系统处理后移除该标记。迁移亦请求刷新。

构建：正式build.ps1 -Stage零警告、零错误。road-speed-units及editor-access两项回归通过。

待部署验证：十二车道和高速显示速度160/200；标线重选和保存重载。原生LaneMarkings候选的最高原生速度240（显示120），已补充独立白色几何160/200数字标线，原生导入完成且边界校验通过；RoadSpeedMarkingSystem克隆原生标线对象并注册原生值320/400，加入标线候选池，保留原版模型与材质。仍需部署后验证方向、可见性、道路坡面和实际自动选择。游戏保持暂停，本轮未改地图。

标线源文件：assets/road-markings/generate.mjs及CWLimit160/200。导入结果：artifacts/marking160-result.json、marking200-result.json。正式重新构建零警告零错误；补充资产接入尚未在运行DLL中验证。
