# 1.36.73 自定义道路限速
用户指定双向八车道高速200km/h、双向十二车道道路160km/h。EightLaneHighwaySystem与TwelveLaneRoadSystem设置原生RoadPrefab.m_SpeedLimit为200、160（原生资产单位km/h），高速描述同步。
新增CustomRoadSpeedSystem：在PrefabSystem后，读取永久稳定Road+Edge，严格匹配自有两种RoadPrefab，对已保存边的RoadComposition.m_SpeedLimit、SubLane CarLane.m_DefaultSpeedLimit及m_SpeedLimit以km/h除3.6转换更新；HashSet每加载道路只处理一次，不持续压制后续手动设置。排除Created/Deleted/Temp/Updated，保留其他道路及环路。
正式暂存构建1.36.73零警告零错误。待部署验证实际存档车道速度、新建八车道高速及重载保留。本版包含尚未部署的1.36.72八车道高速资产；不需要先部署1.36.72。
