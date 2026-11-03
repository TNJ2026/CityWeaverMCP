# 1.36.69 环岛移除行人设施与信号灯
用户明确要求斑马线和环路两侧人行道都移除。当前环路仍为Large Road Oneway，未修改。
新增稳定自有SixLaneRingRoadSystem，克隆原生Highway Oneway - 5 lanes，复制一组无条件Highway Drive Section 4剖面，预计28米宽6条同向车道，无行人/停车剖面，限速40km/h、m_TrafficLights=false、无沿街分区。中文菜单名“单向六车道环路（无人行道）”。
编辑器明确开放道路upgrade/batch_upgrade、intersection_control/rules和inspect_intersection_controls；只对null事务这些原生路网操作放行，保留经济/其他变更禁用。编辑器升级绕过城市解锁检查，仍走原生预览与校验。editor-access测试覆盖新允许项及不相关事务、城市模式、拆除等拒绝边界，一项通过。
正式暂存构建零警告、零错误。待部署后：原环4段升级、四节点uncontrolled、每节点三接近口crosswalk=false，再回读实际车道/人行道/信号灯与渲染。目前未执行上述更改。
已确认游戏关闭并部署1.36.69.0。完整备份：D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.69-20261029-075656。六个安装文件SHA256与暂存包一致，安装DLL版本正确。待加载施工与实机验证。

实机完成四处uncontrolled（enabled=false）和四条主路入口RemoveCrosswalk标记，ring69-final-verification.json证明。某无行人目标路段的RemoveCrosswalk操作返回outcome_unknown，未重试该操作。用户退出Lane Connector Tool后其余三个主路过街设置完成。
最终回读发现高速路肩仍有2条Pedestrian车道（X±13，高差-0.2），尽管没有普通人行道外观。不能宣称行人路径已清除。
1.36.70补修：独立复制环路剖面和含PedestrianLane的NetPiece，过滤行人NetPieceLanes，保留原生源资产、车道及路肩网格。新资产名CityWeaver Oneway Road - 6 Lanes No Pedestrians；旧No Sidewalk名称继续注册兼容存档。速度单位按原生RoadPrefab设置40（km/h），修复此前重复除3.6。正式构建零警告零错误，editor-access回归一项通过。待部署、升级四段及验证Pedestrian为0，地图当前暂停。
已确认游戏关闭并部署1.36.70.0。完整备份：D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.70-20261029-081035。六个安装文件SHA256与暂存包一致，安装DLL版本正确。待加载后升级环路并验证。

1.36.70实机最终验证通过，会话1f9fc040177441f3a3eaf90ba52e189e。四段环路batch_upgrade completed，实际每段NetCompositionLane均6条非Master Road、0条Pedestrian；inspect_intersection_controls四节点traffic_lights.enabled均false；四条主路入口Upgraded相应端均含RemoveCrosswalk。证据artifacts/ring70-final-verification.json及ring70-upgrade-result.json。当前地图暂停，未自动保存。保存重载后的新版环路保留尚未复验。
