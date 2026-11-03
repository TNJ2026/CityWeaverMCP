更正（1.36.75）：下文200/160等数值是旧接口错误换算结果，不能当作游戏显示km/h。实测EU LaneMarkings Speed80的TrafficSignData为160；原十二车道对应显示80，高速对应显示100。操作生命周期、车道筛选及几何保留结果仍有效，显示限速结论撤回。详见ROAD-SPEED-UNITS-1.36.75.md。

# 1.36.74 地图编辑器实时道路限速
开放preview_road_policies到编辑器，但PreviewRoadPolicies在编辑器只接受speed_limit_kph，可选lane_ids；拒绝road_name、停车、转向、公交专用等其他字段。要求普通选择工具、暂停。沿用原生永久Road验证、最多64段和5..500km/h参数范围、修改快照冲突拒绝、原子写入与回滚。
编辑器事务标记direct_editor_speed，仅此标记+road_policies允许后续get/build/cancel，不开放城市direct_atomic/其他直接写入域。城市路径不变。
CustomRoadSpeedSystem只迁移旧120km/h默认车道，避免每次重载覆盖160/200以外已保存实时限速；原先手动设为120与旧默认不可区分，仍可能迁移到道路默认值。此限制待持久化专用覆盖记录再解决，不能宣称所有自定义值稳定重载。
正式暂存构建1.36.74零警告零错误。editor-access域边界回归测试通过，包括direct_editor_speed仅允许road_policies、其他域及城市模式不走编辑器旁路。
当前仍为1.36.71，地图未实际调速。1.36.74包含未部署的八车道高速及200/160默认限速，无需先部署72/73。待部署后验证预览不修改、单段/多段/指定车道变更、原值恢复、其他车道/几何保留。
已确认游戏关闭并部署1.36.74.0。完整备份：D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.74-20261029-090108。六个安装文件SHA256与暂存包一致，安装DLL版本正确。待加载实机验证。

实机验证通过：会话ea6e79fa5e974b9c8e51b8ff0d1a2e99，编辑器1.36.74。新八车道高速宽38米，实际4+4条非Master Road车道、Pedestrian为0，初始限速200km/h；新十二车道实际6+6条，初始限速160km/h。抽取四段旧十二车道全CarLane限速160km/h。
两条独立200米测试路：预览调至180时回读仍200/160；正式提交后全部CarLane为180；仅选一个lane_id改150后其余保持180；分别恢复200/160后批量拆除测试路completed。未退出游戏或替换DLL。
speed74-final-check.json确认现有道路总200、前100条道路Edge/Curve未变、测试道路残留0。地图保持暂停，未自动保存。未实测保存重载覆盖值保留，120km/h与旧默认不可区分的限制仍存在。
证据speed74-before/after-preview/at-180/single-lane/restored.json，speed74-composition-0/1.json及各操作结果。高速路口与曲线外观尚未专门实测。
