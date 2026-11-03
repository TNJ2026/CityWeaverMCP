# 移除自定义道路，保留通用接口

用户要求删除自定义道路，并明确通用接口与逻辑可以保留。本地桥接版本更新为1.37.3，Node服务仍为1.36.12。此次没有修改游戏目录、城市存档、独立直升机项目或线上条目159998。

移除12/24车道分隔道路、6车道单向无行人道路、8车道分隔高速的生成系统，以及只服务这些道路的CustomRoadSpeedSystem、RoadSpeedMarkingSystem。清理启动注册、本地化名称和专用标线模型目录assets/road-markings。共16个原文件移至忽略的备份目录，逐项SHA-256核对通过。

通用模型导入、替换、配色、车门动画、线路车型引用修正及存档恢复逻辑保留，MCP工具未删除。通用道路编辑、限速和持久化逻辑保留；SavedRoadSpeedSystem改在原生PrefabSystem之后执行，去掉对已删除专用限速系统的排序依赖。通用道路截面、车道名称解析、字体计算规则及测试继续保留，资产专属注册断言改为验证保留下来的规则。

旧存档若包含上述自定义道路，应先在旧版中替换为原生道路后再升级；本次没有实现或运行存档道路迁移。旧版线上下载和已经运行的游戏不会因源码修改而自动改变。

验证：

- 正式Stage构建零警告、零错误，输出artifacts/staged/CityWeaverMCP，入口文件版本1.37.3.0。
- 13项实际检查通过，覆盖通用道路规则、限速、模型与骨骼校验、动画、配色、存档、线路引用、STDIO工具发现及程序集隔离。
- 程序集元数据确认六个道路专用系统不存在，通用SavedRoadSpeedSystem、McpVehicleDoorSystem、McpVehicleRouteReferenceSystem、VehicleModelOperation、ObjRigidRig及七个车型查询/替换方法仍存在。
- 真实STDIO工具发现确认通用道路限速和车型查询、预览、应用、状态、恢复、取消接口仍注册；没有连接游戏执行写入。
- tools/check-publish.ps1 -RequireStagedBuild -UpdateVersion通过，配置及暂存桥接版本1.37.3，条目159998、Public保持。本次没有上传，也未进行游戏内载入验收。

变更清单与备份：artifacts/remove-custom-content-20261101.json；备份目录artifacts/backups/remove-custom-content-20261101-150416-195。测试的完整旧副本亦保留在该目录。

构建日志：artifacts/remove-custom-content-build-1.37.3-20261101.log。

测试日志：artifacts/remove-custom-content-tests-1.37.3-20261101.log、artifacts/remove-custom-content-assembly-1.37.3-20261101.log、artifacts/remove-custom-content-animation-retest-1.37.3-20261101.log。首次测试中的源模型缺失曾直接return而显示成功，现已改为显式skip，并以上述复测为准。
