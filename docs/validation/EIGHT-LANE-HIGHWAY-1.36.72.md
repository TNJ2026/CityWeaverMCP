# 1.36.72 双向八车道高速公路
新增稳定RoadPrefab CityWeaver Divided Highway - 8 Lanes，基于原生Highway Twoway - 4 lanes，在每侧无条件Highway Drive Section 4增加两组4米剖面，预计4+4车道。原Highway Median 0替换为原生Road Median 2，预计宽20+16+2=38米。保留高速路肩、HighwayRules，限速120km/h，关闭自动交通灯/沿街分区。
独立复制剖面及含PedestrianLane的Piece，过滤所有行人NetPieceLanes，避免高速路肩隐藏行人通道。所有内置资产保持不变。加入本地化名称与描述，沿用高速分类和图标。
源剖面MCP检查证据artifacts/highway8-sections.json。正式暂存构建1.36.72零警告零错误。现有editor-access测试通过，未声称此测试验证车道生成。待退出部署后实际道路验证双向4+4、中央隔离带、0行人/停车、限速、路口与曲线。当前地图未创建新高速或替换现有道路。
